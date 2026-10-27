// Navigation: go to definition and find usages from the editor, asking the file's language server
// first (meanings, not names) and the index when none answers. The index matches names, not
// meanings, so its lists say "Name matches". Go to Symbol is Search Everywhere's.

import {
  NavigationHistory,
  RecentTabs,
  type EditorArea,
  type Environment,
  type Position,
} from '@cerebro-ide/layout';
import { effect, ObservableMap } from '@cerebro-ide/reactive';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
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

const GROUP = 'Name matches';

/** Where each open file's caret is, by path, as its editor says. */
export const carets = new Map<string, Position>();
/** Which line is at the top of each open file's editor, as it says. */
export const tops = new Map<string, number>();

/** Where each environment's Recent Files is kept between runs. */
const recentKey = (env: Environment) => `cerebro.recent:${env.id}`;

/** Each environment's Back and Forward, following its editor area from when it opens. */
const histories = new WeakMap<Environment, NavigationHistory>();
/** Each environment's Recent Files, likewise. */
const recents = new WeakMap<Environment, RecentTabs>();
effect(() => {
  for (const env of workspace.open) {
    if (histories.has(env)) continue;
    const recent = new RecentTabs(env.editor);
    try {
      recent.restore(JSON.parse(localStorage.getItem(recentKey(env)) ?? '[]'));
    } catch {
      // Unreadable: it starts empty.
    }
    // Kept as it changes, as IntelliJ keeps it.
    effect(() => {
      const json = JSON.stringify(recent.tabs);
      try {
        localStorage.setItem(recentKey(env), json);
      } catch {
        // Storage may be full or blocked: it just isn't kept.
      }
      return undefined;
    });
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
  const ask = async (method: string, asked: Asked | undefined) => {
    const env = active();
    if (!env || !asked) return null;
    const host = hostFor(env.id);
    if (!host) return null;
    try {
      return (await host.request(method, { worktree: env.id, ...asked })) as Located[] | null;
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
    /** Whether navigation by name works here: the app, on a real repository. */
    available: () => currentHost() !== undefined && active() !== undefined,

    /** Starts the file's language server, if it has one, so it's ready when asked. */
    opened(path: string, text: string) {
      const env = active();
      const host = env ? hostFor(env.id) : undefined;
      if (host && env)
        void host.request('lsp.open', { worktree: env.id, path, text }).catch(() => undefined);
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
