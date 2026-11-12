import type { Project, RecentProject } from '../src/bridge.js';
import { FakeHost } from './fakes.js';

// The desktop app's bridge, for the page as the app shows it: a window with the project `/r`, and
// each project's host answering as a test says.

type Bridge = NonNullable<Window['cerebro']>;
type Notify = (project: string, method: string, params: unknown) => void;

/** What each host answers, by method, over the defaults; an Error fails it. */
export const answers = new Map<string, unknown>();
let terminals = 0;
const DEFAULTS: Record<string, (params: Record<string, unknown>) => unknown> = {
  'fs.read': ({ path }) => ({ text: `// ${String(path)}\nconst a = 1;\n` }),
  'fs.exists': () => true,
  'git.diff': () => ({ original: 'a\n', text: 'b\n' }),
  'terminal.open': () => ({ id: ++terminals, buffer: '' }),
  'search.text': () => ({ matches: [], limited: false }),
};
// What lists things lists nothing, unless a test says.
for (const method of [
  'fs.list',
  'git.files',
  'git.branches',
  'git.changes',
  'git.ignored',
  'git.shelves',
  'git.stashes',
  'agent.turns',
  'index.definitions',
  'index.usages',
  'index.symbols',
  'lsp.markers',
  'lsp.problems',
  'lsp.contextActions',
]) {
  DEFAULTS[method] = () => [];
}
/** `/r` has a second worktree; `/n` isn't a repository; the others are, with one worktree. */
const worktreesOf = (project: string) => {
  if (project === '/n') throw new Error('not a repository');
  const main = { path: project, branch: 'main', main: true, bare: false };
  return project === '/r'
    ? [main, { path: '/r/w', branch: 'w', main: false, bare: false }]
    : [main];
};
/** A project's host: as `answers` says, else the defaults, else nothing. */
const hostFor = (project: string) =>
  new FakeHost(
    new Proxy(
      {},
      {
        get: (_, method: string) => (params: Record<string, unknown>) => {
          if (method === 'git.worktrees') return worktreesOf(project);
          const answer = answers.has(method) ? answers.get(method) : DEFAULTS[method]?.(params);
          if (answer instanceof Error) throw answer;
          return typeof answer === 'function'
            ? (answer as (p: unknown) => unknown)(params)
            : answer;
        },
      },
    ),
  );
const hosts = new Map<string, FakeHost>();
export const host = (project: string) => {
  let found = hosts.get(project);
  if (!found) {
    found = hostFor(project);
    hosts.set(project, found);
  }
  return found;
};
const listeners = new Set<Notify>();
export const notify: Notify = (project, method, params) => {
  for (const listener of listeners) listener(project, method, params);
};
export const calls: unknown[][] = [];
type Added = (project: Project & { replaces?: string }) => void;
let onAdded: Added = () => undefined;
let onShow: (path: string) => void = () => undefined;
let onJump: (at: unknown) => void = () => undefined;
let onTab: (spec: unknown) => void = () => undefined;
let onDocumentAsked: (path: unknown, text: unknown) => void = () => undefined;
/** A project joins the window, as the app says when one opens. */
export const added: Added = (project) => {
  onAdded(project);
};
/** A project of the window is asked to open again. */
export const shownAgain = (path: string): void => {
  onShow(path);
};
/** Jump to Source from a diff window this window opened. */
export const jumped = (at: unknown): void => {
  onJump(at);
};
/** Show Diff in Editor Tab from a diff window this window opened. */
export const tabbed = (spec: unknown): void => {
  onTab(spec);
};
/** A diff window this window opened asks for a file's document (`text` null), or edits it. */
export const askedDocument = (path: string, text: string | null): void => {
  onDocumentAsked(path, text);
};
const recent: RecentProject[] = [
  { path: '/r', name: 'r', opened: 3, exists: true },
  { path: '/x', name: 'x', opened: 2, exists: true },
  { path: '/gone', name: 'gone', opened: 1, exists: false },
];

/** Gives the page the app's bridge, on this platform, with this native menu. */
export function installBridge(platform: string, menu: unknown = {}): void {
  window.cerebro = {
    app: true,
    platform,
    display: { setScale: (scale: string) => void calls.push(['scale', scale]) },
    shell: { reveal: (path: string) => void calls.push(['reveal', path]) },
    window: { setColours: () => undefined },
    menu,
    project: {
      current: () => Promise.resolve([{ path: '/r', name: 'r' }]),
      recent: () => Promise.resolve(recent),
      pick: () => Promise.resolve(null),
      open: (path: string, where: string, from?: string) => {
        calls.push(['open', path, where, from]);
        return Promise.resolve();
      },
      close: (path: string) => {
        calls.push(['close', path]);
        return Promise.resolve();
      },
      forget: () => Promise.resolve(),
      onAdded: (listener: Added) => {
        onAdded = listener;
        return () => undefined;
      },
      onShow: (listener: typeof onShow) => {
        onShow = listener;
        return () => undefined;
      },
    },
    diff: {
      open: (spec: unknown) => {
        calls.push(['diff', spec]);
        return Promise.resolve();
      },
      jump: () => Promise.resolve(),
      onJump: (listener: typeof onJump) => {
        onJump = listener;
        return () => undefined;
      },
      toTab: () => Promise.resolve(),
      onTab: (listener: typeof onTab) => {
        onTab = listener;
        return () => undefined;
      },
      onDocumentAsked: (listener: typeof onDocumentAsked) => {
        onDocumentAsked = listener;
        return () => undefined;
      },
      documentText: (path: string, text: string | null) => {
        calls.push(['documentText', path, text]);
        return Promise.resolve();
      },
    },
    host: {
      request: (project: string, method: string, params?: unknown) =>
        host(project).request(method, params),
      onNotification: (listener: Notify) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  } as unknown as Bridge;
}
