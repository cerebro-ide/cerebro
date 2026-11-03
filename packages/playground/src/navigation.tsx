// Navigation: go to definition and find usages from the editor, asking the file's language server
// first (meanings, not names) and the index when none answers. The index matches names, not
// meanings, so its lists say "Name matches". Go to Symbol is Search Everywhere's.

import {
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
  EditorDocument,
  Mark,
  MarkerKind,
  Problem,
  Usage,
} from '@cerebro-ide/ui-editor';
import { onEdited } from './documents.js';
import { active, currentHost, hostFor, workspace } from './environments.js';
import { icon } from './icons.js';

interface Located {
  path: string;
  line: number;
  column: number;
  name?: string;
  kind?: string;
}

type Choice = PickerItem & { at: Located };

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

/** Positions to reveal in open files, by path: the editor follows them. */
export const reveals = new ObservableMap<
  string,
  { line: number; column: number; top?: number | undefined }
>();

/** Open files whose editor is to take the focus, by path: the editor takes each request once. */
export const focusing = new ObservableMap<string, object>();

const GROUP = 'Name matches';

/** Where each open file's caret is, by path, as its editor says. */
export const carets = new Map<string, Position>();
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
  recent?.edit({ id: path, title: path.slice(path.lastIndexOf('/') + 1) });
});

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
    reveals.set(at.path, { line: at.line, column: at.column });
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
  const ask = async <T = Located[],>(method: string, asked: Asked | undefined) => {
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
        if (precise.length === 1) openAt(precise[0] as Located);
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
      if (found.length === 1) openAt(found[0] as Located);
      else {
        await choose(
          `Definitions of ${name}`,
          `No definition named ${name}`,
          found.map((d) => choice(d, d.name ?? name)),
        );
      }
    },

    async findUsages(name: string, asked?: Asked) {
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
    },
  };
}
