// Navigation: go to definition and find usages from the editor, asking the file's language server
// first (meanings, not names) and the index when none answers. The index matches names, not
// meanings, so its lists say "Name matches". Go to definition on a declaration shows its usages, as
// IntelliJ's Go to Declaration or Usages. Go to Symbol is Search Everywhere's.

import {
  ChangePlaces,
  NavigationHistory,
  RecentTabs,
  type EditorArea,
  type Environment,
  type Position,
  type Tab,
} from '@cerebro-ide/layout';
import { effect, ObservableMap } from '@cerebro-ide/reactive';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import type {
  CompletionEdit,
  CompletionItem,
  CompletionList,
  Documentation,
  EditorDocument,
  Fold,
  FormatEdit,
  Indent,
  Mark,
  MarkerKind,
  Problem,
  Renaming,
  Signatures,
  Selected,
  Usage,
} from '@cerebro-ide/ui-editor';
import { documentFor, onEdited, reloadOpen, saveAll, saveFiles } from './documents.js';
import { active, currentHost, hostFor, workspace } from './environments.js';
import { icon } from './icons.js';
import { openStructure, type FileSymbol } from './structure.js';

interface Located {
  path: string;
  line: number;
  column: number;
  name?: string;
  kind?: string;
}

type Choice = PickerItem & { at: Located };

/**
 * Whether the definitions found are the word asked about itself: the caret is on a declaration,
 * where IntelliJ's Go to Declaration shows its usages instead (GotoDeclarationOrUsageHandler2's
 * `fromTargetData`: a reference goes to what it refers to; a declaration, referring to nothing
 * else, to its usages). Each starts at the word's start, on the caret's line.
 */
function declaredAt(places: readonly Located[], name: string, asked: Asked | undefined): boolean {
  return (
    asked !== undefined &&
    places.length > 0 &&
    places.every(
      (place) =>
        place.path === asked.path &&
        place.line === asked.line &&
        place.column <= asked.column &&
        asked.column <= place.column + name.length,
    )
  );
}

/** A gutter marker, as the host gives it: where it goes too. */
interface Marked extends Mark {
  targets: Located[];
}

/** The list a gutter marker with several places offers, as IntelliJ's (a claim: not measured). */
const MARKED: Record<MarkerKind, string> = {
  implements: 'Super methods of',
  overrides: 'Super methods of',
  implemented: 'Implementations of',
  overridden: 'Overriding methods of',
};

/** What Alt+Enter offers, as the host gives it: a server's fix, made by its edits. */
interface ContextAction {
  title: string;
  edits: { from: Position; to: Position; text: string }[];
}

/** A place in a file as the editor has it, unsaved edits and all: what a language server is asked. */
export interface Asked {
  path: string;
  text: string;
  line: number;
  column: number;
}

/** A file's edits, of a rename's. */
interface FileEdits {
  path: string;
  edits: { from: Position; to: Position; text: string }[];
}

/** Positions to reveal in open files, by path: the editor follows them. */
export const reveals = new ObservableMap<
  string,
  { line: number; column: number; top?: number | undefined }
>();

/** Open files whose editor is to take the focus, by path: the editor takes each request once. */
export const focusing = new ObservableMap<string, object>();

const GROUP = 'Name matches';

/** Where each open file's caret is, by path, as its editor says. */
export const carets = new ObservableMap<string, Position>();
/** What each open file's editor has selected, by path, as it says: none for nothing selected. */
export const selections = new ObservableMap<string, Selected>();
/** Which line is at the top of each open file's editor, as it says. */
export const tops = new Map<string, number>();

/** Where each environment's Recent Files is kept between runs, and its edited files. */
const recentKey = (env: Environment) => `cerebro.recent:${env.id}`;
const editedKey = (env: Environment) => `cerebro.recentEdited:${env.id}`;

/** What was kept under `key` in an earlier run: nothing when it's unreadable. */
function saved(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}

/** Each environment's Back and Forward, following its editor area from when it opens. */
const histories = new WeakMap<Environment, NavigationHistory>();
/** Each environment's Recent Files, likewise. */
const recents = new WeakMap<Environment, RecentTabs>();
/** Each environment's places of changes: Last and Next Edit Location. */
const changes = new WeakMap<Environment, ChangePlaces>();
effect(() => {
  for (const env of workspace.open) {
    if (histories.has(env)) continue;
    const recent = new RecentTabs(env.editor);
    recent.restore(saved(recentKey(env)));
    recent.restoreEdited(saved(editedKey(env)));
    // Kept as they change, as IntelliJ keeps them.
    for (const [key, list] of [
      [recentKey(env), () => recent.tabs],
      [editedKey(env), () => recent.edited],
    ] as const) {
      effect(() => {
        const json = JSON.stringify(list());
        try {
          localStorage.setItem(key, json);
        } catch {
          // Storage may be full or blocked: it just isn't kept.
        }
        return undefined;
      });
    }
    recents.set(env, recent);
    changes.set(
      env,
      new ChangePlaces((place) => {
        // A jump within the file is a place left, as Back's.
        if (env.editor.activeGroup.active === place.tab.id) histories.get(env)?.record();
        env.editor.open(place.tab);
        if (place.at) reveals.set(place.tab.id, { ...place.at, top: place.top });
        focusing.set(place.tab.id, {});
      }),
    );
    histories.set(
      env,
      new NavigationHistory(
        env.editor,
        (path) => carets.get(path),
        (place) => {
          if (place.at) reveals.set(place.tab.id, { ...place.at, top: place.top });
        },
        (path) => tops.get(path),
      ),
    );
  }
  return undefined;
});

// A file edited goes first among its environment's edited files (the active one's, for a sample).
onEdited((path) => {
  const env = workspace.open.find((e) => path.startsWith(`${e.id}/`)) ?? active();
  const recent = env && recents.get(env);
  const tab = { id: path, title: path.slice(path.lastIndexOf('/') + 1) };
  recent?.edit(tab);
  // Where the caret is once the editor has said, after the change.
  const places = env && changes.get(env);
  queueMicrotask(() => {
    places?.changed({ tab, at: carets.get(path), top: tops.get(path) });
  });
});

/** The active environment's places of changes. */
export function changePlaces(): ChangePlaces | undefined {
  const env = active();
  return env && changes.get(env);
}

/** The active environment's Recent Files. */
export function recentTabs(): RecentTabs | undefined {
  const env = active();
  return env && recents.get(env);
}

/** The active environment's Back and Forward. */
export function history(): NavigationHistory | undefined {
  const env = active();
  return env && histories.get(env);
}

export function setupNavigation(editor: () => EditorArea | undefined) {
  /** Opens a file at a position. */
  const openAt = (at: Located) => {
    // A jump within the file is a place left too; to another file, the history sees the tab change.
    if (editor()?.activeGroup.active === at.path) history()?.record();
    editor()?.open({ id: at.path, title: at.path.split('/').at(-1) as string });
    // A new object each time, so revealing the same place again works.
    const reveal = () => {
      reveals.set(at.path, { line: at.line, column: at.column });
    };
    // Open, it's read again first: the place may be in what's changed on disk since (measured: F4
    // from a diff put the caret in the editor's old text, read again a second later).
    const reading = reloadOpen(at.path);
    if (reading) void reading.finally(reveal);
    else reveal();
  };
  /** Opens a file with its editor focused, as IntelliJ does after a file is chosen from a list. */
  const open = (tab: Tab) => {
    editor()?.open(tab);
    // A new object each time, so asking again works.
    focusing.set(tab.id, {});
  };
  const relative = (path: string) => {
    const root = active()?.id;
    return root !== undefined && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  };
  const choice = (at: Located, label: string, group: string | null = GROUP): Choice => ({
    label,
    detail: `${relative(at.path)}:${String(at.line + 1)}`,
    ...(at.kind === undefined ? {} : { shortcut: at.kind }),
    ...(group === null ? {} : { group }),
    icon: () => icon(at.kind === undefined ? 'file' : 'structure'),
    at,
  });
  const request = async (method: string, params: Record<string, string>) => {
    const env = active();
    if (!env) return [];
    const host = hostFor(env.id);
    if (!host) return [];
    return (await host.request(method, { worktree: env.id, ...params })) as Located[];
  };
  /** A language server's answer; null when there's none (no server, or it didn't answer in time). */
  // A file, a place in it, and a rename's new name.
  const ask = async <T = Located[],>(method: string, asked: object | undefined) => {
    const env = active();
    if (!env || !asked) return null;
    const host = hostFor(env.id);
    if (!host) return null;
    try {
      return (await host.request(method, { worktree: env.id, ...asked })) as T | null;
    } catch {
      return null;
    }
  };
  /** Find Usages: the language server's, or else the index's by name. */
  const findUsages = async (name: string, asked?: Asked) => {
    const precise = await ask('lsp.usages', asked);
    if (precise) {
      await choose(
        `Usages of ${name}`,
        `No usages of ${name}`,
        precise.map((u) => choice(u, relative(u.path).split('/').at(-1) as string, null)),
      );
      return;
    }
    const found = await request('index.usages', { name });
    await choose(
      `Usages of ${name}`,
      `No usages of ${name}`,
      found.map((u) => choice(u, relative(u.path).split('/').at(-1) as string)),
    );
  };
  /** A list to choose a place from, opening the one chosen. */
  const choose = async (label: string, empty: string, items: Choice[]) => {
    const chosen = await openPicker<Choice>({
      label,
      placeholder: 'Filter',
      position: 'top',
      empty,
      items: (query) => fuzzyFilter(items, query),
    }).result;
    if (chosen) openAt(chosen.at);
  };

  return {
    openAt,
    open,
    /** Whether navigation by name works here: the app, on a real repository. */
    available: () => currentHost() !== undefined && active() !== undefined,

    /** Starts the file's language server, if it has one, so it's ready when asked. */
    opened(path: string, text: string) {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (host && env)
        void host.request('lsp.open', { worktree: env.id, path, text }).catch(() => undefined);
    },

    /** Where the symbol at a place is in its file, from its language server; none without one. */
    usages(asked: Asked): Promise<Usage[] | null> {
      return ask<Usage[]>('lsp.highlights', asked);
    },

    /** What the symbol at a place is, from its file's language server: its hover; none without. */
    documentation(asked: Asked): Promise<Documentation | null> {
      return ask<Documentation>('lsp.hover', asked);
    },

    /** What's called at a place, from its file's language server: Parameter Info; none without. */
    signatures(asked: Asked): Promise<Signatures | null> {
      return ask<Signatures>('lsp.signatures', asked);
    },

    /** Where the name at a place is that Rename renames, from its language server, or why not. */
    renaming(asked: Asked): Promise<Renaming | { refused: string } | null> {
      return ask<Renaming | { refused: string }>('lsp.renaming', asked);
    },

    /**
     * Renames the name at a place everywhere, from its language server: the edits made in each
     * file's document, as one edit undo takes back, and saved, labelled in the Local History as
     * IntelliJ labels it. The files are saved first: the server reads those not open from disk.
     * Says why not, if it can't be (a file that can't be saved first), and which files it couldn't
     * be renamed in.
     */
    async rename(asked: Asked, name: string): Promise<string | undefined> {
      const unsaved = await saveAll().then(
        () => undefined,
        (error: unknown) => (error as Error).message,
      );
      if (unsaved !== undefined) return `Not renamed: ${unsaved}`;
      const answer = await ask<FileEdits[] | { refused: string }>('lsp.rename', {
        ...asked,
        name,
      });
      if (!answer) return 'No language server answered the rename.';
      if ('refused' in answer) return answer.refused;
      const changed: string[] = [];
      const failed: string[] = [];
      for (const file of answer) {
        const doc = await documentFor(file.path);
        if ('error' in doc) {
          failed.push(`${relative(file.path)}: ${doc.error}`);
          continue;
        }
        const text = doc.text.peek();
        const offset = (place: Position) => text.line(place.line + 1).from + place.column;
        doc.edit(
          file.edits.map((e) => ({ from: offset(e.from), to: offset(e.to), insert: e.text })),
        );
        changed.push(file.path);
      }
      await saveFiles(changed, 'Rename');
      return failed.length > 0 ? `Not renamed in ${failed.join(', ')}` : undefined;
    },

    /**
     * File Structure (structure.tsx) for a file as the editor has it, from its language server,
     * the symbol at the caret highlighted; goes to the one chosen.
     */
    async fileStructure(path: string, text: string, caret: Position): Promise<void> {
      const symbols = await ask<FileSymbol[]>('lsp.structure', { path, text });
      const chosen = await openStructure(path.split('/').at(-1) as string, symbols, caret);
      if (chosen) openAt({ path, ...chosen.at });
    },

    /**
     * The edits that format a file as the editor has it, or the part from `from` to `to`, from its
     * language server, indented with `indent`; why not, if it won't.
     */
    async format(
      file: { path: string; text: string },
      indent: Indent,
      tabSize: number,
      range?: { from: Position; to: Position },
    ): Promise<FormatEdit[] | { refused: string }> {
      // LSP's tabSize is the indent's, in spaces; a tab's with tabs.
      const answer = await ask<FormatEdit[] | { refused: string }>('lsp.format', {
        ...file,
        tabSize: indent.tabs ? tabSize : indent.size,
        insertSpaces: !indent.tabs,
        ...range,
      });
      return answer ?? { refused: 'No language server answered.' };
    },

    /** The edits that organize a file's imports, from its language server; why not, if none. */
    async organizeImports(file: {
      path: string;
      text: string;
    }): Promise<FormatEdit[] | { refused: string }> {
      const answer = await ask<FormatEdit[]>('lsp.organizeImports', file);
      return answer ?? { refused: 'No language server answered.' };
    },

    /** What can go at a place, from its file's language server; none without one. */
    completions(asked: Asked): Promise<CompletionList | null> {
      return ask<CompletionList>('lsp.completions', asked);
    },

    /** A completion's other edits (an import), from the language server that gave it. */
    async completionEdits(path: string, item: CompletionItem): Promise<CompletionEdit[] | null> {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (!env || !host) return null;
      try {
        return (await host.request('lsp.completionEdits', {
          worktree: env.id,
          path,
          item: item.resolve,
        })) as CompletionEdit[] | null;
      } catch {
        return null;
      }
    },

    /** A file's gutter markers, from its language server; none without one. */
    async markers(path: string, text: string): Promise<Marked[] | null> {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (!env || !host) return null;
      try {
        return (await host.request('lsp.markers', { worktree: env.id, path, text })) as
          Marked[] | null;
      } catch {
        return null;
      }
    },

    /** Where a file folds, from its language server; none without one, and its grammar's then. */
    async folds(path: string, text: string): Promise<Fold[] | null> {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (!env || !host) return null;
      try {
        return (await host.request('lsp.folds', { worktree: env.id, path, text })) as Fold[] | null;
      } catch {
        return null;
      }
    },

    /** A file's errors and warnings, from its language server; none without one. */
    async problems(path: string, text: string): Promise<Problem[] | null> {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (!env || !host) return null;
      try {
        return (await host.request('lsp.problems', { worktree: env.id, path, text })) as
          Problem[] | null;
      } catch {
        return null;
      }
    },

    /**
     * What can be done at the caret, from the file's language server, listed below it, as
     * IntelliJ's Show Context Actions (Alt+Enter). The one chosen is made in the document, as an
     * edit undo takes back, and the editor has the focus again.
     */
    async contextActions(
      asked: Asked,
      caret: Pick<Element, 'getBoundingClientRect'>,
      doc: EditorDocument,
    ) {
      const before = doc.text.peek();
      const actions = (await ask<ContextAction[]>('lsp.contextActions', asked)) ?? [];
      const items = actions.map((action) => ({
        label: action.title,
        icon: () => icon('bulb'),
        action,
      }));
      const chosen = await openPicker({
        label: 'Context actions',
        placeholder: 'Filter',
        position: { below: caret },
        // IntelliJ's words (LangBundle).
        empty: 'No context actions available at this location',
        items: (query) => fuzzyFilter(items, query),
      }).result;
      // Made in the text it was found for: the server's places are in it.
      if (chosen && doc.text.peek() === before) {
        const offset = (at: Position) => before.line(at.line + 1).from + at.column;
        doc.edit(
          chosen.action.edits.map((e) => ({
            from: offset(e.from),
            to: offset(e.to),
            insert: e.text,
          })),
        );
      }
      focusing.set(asked.path, {});
    },

    /** Goes where a gutter marker says: there, or to the one chosen of several. */
    async goToMarked(mark: Mark) {
      const { targets, name, kind } = mark as Marked;
      if (targets.length === 1) {
        openAt(targets[0] as Located);
        return;
      }
      await choose(
        `${MARKED[kind]} ${name}`,
        `None found`,
        targets.map((t) => choice(t, relative(t.path).split('/').at(-1) as string, null)),
      );
    },

    /**
     * Go to Super Method, as IntelliJ's `GotoSuperMethod`: where the gutter's up marker of the
     * innermost member or type around the caret goes (what it implements or overrides); nothing
     * where none has one.
     */
    async goToSuperMethod(asked: Asked) {
      const { path, text, line, column } = asked;
      const [symbols, marks] = await Promise.all([
        ask<FileSymbol[]>('lsp.structure', { path, text }),
        this.markers(path, text),
      ]);
      const before = (a: Position, b: Position) =>
        a.line < b.line || (a.line === b.line && a.column <= b.column);
      const caret = { line, column };
      // The symbols around the caret, the outermost first.
      const around: FileSymbol[] = [];
      let level = symbols ?? [];
      for (;;) {
        const inside = level.find((s) => before(s.from, caret) && before(caret, s.to));
        if (!inside) break;
        around.push(inside);
        level = inside.children;
      }
      const up = (s: FileSymbol) =>
        marks?.find(
          (m) => m.line === s.at.line && (m.kind === 'implements' || m.kind === 'overrides'),
        );
      const mark = around
        .reverse()
        .map(up)
        .find((m) => m !== undefined);
      if (mark) await this.goToMarked(mark);
    },

    /** Whether the word at a place has a definition to go to: its server's, or a name's match. */
    async hasDefinition(name: string, asked: Asked): Promise<boolean> {
      const precise = await ask('lsp.definitions', asked);
      if (precise) return precise.length > 0;
      try {
        return (await request('index.definitions', { name })).length > 0;
      } catch {
        return false;
      }
    },

    async goToDefinition(name: string, asked?: Asked) {
      const precise = await ask('lsp.definitions', asked);
      if (precise) {
        if (declaredAt(precise, name, asked)) await findUsages(name, asked);
        else if (precise.length === 1) openAt(precise[0] as Located);
        else {
          await choose(
            `Definitions of ${name}`,
            `Cannot find declaration to go to`,
            precise.map((d) => choice(d, name, null)),
          );
        }
        return;
      }
      const found = await request('index.definitions', { name });
      if (declaredAt(found, name, asked)) await findUsages(name, asked);
      else if (found.length === 1) openAt(found[0] as Located);
      else {
        await choose(
          `Definitions of ${name}`,
          `No definition named ${name}`,
          found.map((d) => choice(d, d.name ?? name)),
        );
      }
    },

    /**
     * Go to Implementation(s), as IntelliJ's `GotoImplementation`: the language server's one
     * implementation, or a list of several; with none, IntelliJ's words.
     */
    async goToImplementation(name: string, asked: Asked) {
      const found = (await ask('lsp.implementations', asked)) ?? [];
      if (found.length === 1) {
        openAt(found[0] as Located);
        return;
      }
      // IntelliJ's words (CodeInsightBundle's goto.implementation).
      await choose(
        `Choose Implementation of ${name} (${String(found.length)} found)`,
        'No implementations found',
        found.map((i) => choice(i, relative(i.path).split('/').at(-1) as string, null)),
      );
    },

    /**
     * Go to Type Declaration, as IntelliJ's `GotoTypeDeclaration`: where the type of the symbol is
     * declared, from its language server, or a list of several; nothing with none, as IntelliJ's.
     */
    async goToTypeDeclaration(name: string, asked: Asked) {
      const found = (await ask('lsp.typeDefinitions', asked)) ?? [];
      if (found.length === 0) return;
      if (found.length === 1) {
        openAt(found[0] as Located);
        return;
      }
      // IntelliJ's title (CodeInsightBundle's choose.type.popup.title).
      await choose(
        'Choose Type',
        '',
        found.map((t) => choice(t, relative(t.path).split('/').at(-1) as string, null)),
      );
    },

    findUsages,
  };
}
