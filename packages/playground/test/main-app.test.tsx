import { Environments } from '@cerebro-ide/layout';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Project, RecentProject } from '../src/bridge.js';
import { diffTab } from '../src/changes.js';
import { workspace } from '../src/environments.js';
import { loadProjects } from '../src/projects.js';
import { closeAll, dialog, dialogText, FakeHost, menuItems, popupItems, press } from './fakes.js';

// The page, as the desktop app shows it: a window with a project, its host answering through the
// app's bridge. It's made once, as it's imported: each test goes on from where the last left it.

type Bridge = NonNullable<Window['cerebro']>;
type Notify = (project: string, method: string, params: unknown) => void;

/** What each host answers, by method, over the defaults; an Error fails it. */
const answers: Record<string, unknown> = {};
let terminals = 0;
const DEFAULTS: Record<string, (params: Record<string, unknown>) => unknown> = {
  'git.worktrees': () => [
    { path: '/r', branch: 'main', main: true, bare: false },
    { path: '/r/w', branch: 'w', main: false, bare: false },
  ],
  'fs.read': ({ path }) => ({ text: `// ${String(path)}\nconst a = 1;\n` }),
  'fs.exists': () => true,
  'git.diff': () => ({ original: 'a\n', text: 'b\n' }),
  'terminal.open': () => ({ id: ++terminals, buffer: '' }),
};
/** A project's host: as `answers` says, else the defaults, else nothing. */
const hostFor = (project: string) =>
  new FakeHost(
    new Proxy(
      {},
      {
        get: (_, method: string) => (params: Record<string, unknown>) => {
          if (project === '/n' && method === 'git.worktrees') throw new Error('not a repository');
          const answer = method in answers ? answers[method] : DEFAULTS[method]?.(params);
          if (answer instanceof Error) throw answer;
          return typeof answer === 'function'
            ? (answer as (p: unknown) => unknown)(params)
            : answer;
        },
      },
    ),
  );
const hosts = new Map<string, FakeHost>();
const host = (project: string) => {
  let found = hosts.get(project);
  if (!found) {
    found = hostFor(project);
    hosts.set(project, found);
  }
  return found;
};
const listeners = new Set<Notify>();
const notify: Notify = (project, method, params) => {
  for (const listener of listeners) listener(project, method, params);
};
const calls: unknown[][] = [];
let added: (project: Project & { replaces?: string }) => void = () => undefined;
let shownAgain: (path: string) => void = () => undefined;
const recent: RecentProject[] = [
  { path: '/r', name: 'r', opened: 3, exists: true },
  { path: '/x', name: 'x', opened: 2, exists: true },
  { path: '/gone', name: 'gone', opened: 1, exists: false },
];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  window.cerebro = {
    app: true,
    platform: 'linux',
    display: { setScale: (scale: string) => void calls.push(['scale', scale]) },
    shell: { reveal: (path: string) => void calls.push(['reveal', path]) },
    window: { setColours: () => undefined },
    menu: {},
    project: {
      current: () => Promise.resolve([{ path: '/r', name: 'r' }]),
      recent: () => Promise.resolve(recent),
      pick: () => Promise.resolve(null),
      open: (path: string, where: string) => {
        calls.push(['open', path, where]);
        return Promise.resolve();
      },
      close: (path: string) => {
        calls.push(['close', path]);
        return Promise.resolve();
      },
      forget: () => Promise.resolve(),
      onAdded: (listener: typeof added) => {
        added = listener;
        return () => undefined;
      },
      onShow: (listener: typeof shownAgain) => {
        shownAgain = listener;
        return () => undefined;
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
  // The layout the window was left with: the main worktree, a file open.
  const saved = new Environments();
  saved.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  saved.active?.editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
  localStorage.setItem('cerebro.layout:/r', JSON.stringify({ environments: saved.state() }));
  await loadProjects();
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/main.js');
});

afterEach(async () => {
  await closeAll();
  for (const method of Object.keys(answers)) delete answers[method];
  vi.restoreAllMocks();
});

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
const status = () =>
  [...document.querySelectorAll('.cerebro-statusbar__text')].map((t) => t.textContent);
const stripe = (id: string) => q(`.cerebro-stripe-button[data-id="${id}"]`);
const tooltipText = () => document.querySelector('.cerebro-tooltip')?.textContent;
const env = () => workspace.active as NonNullable<typeof workspace.active>;
const editorRoot = () =>
  document.querySelector('.cerebro-editor-group--active .cerebro-editor-code')?.shadowRoot;
const code = () => editorRoot()?.querySelector('.cm-content') as HTMLElement | null | undefined;

describe('the page in the app', () => {
  it('opens the window’s project as it was left, named after it, in the app’s look', async () => {
    expect(document.documentElement.classList).toContain('cerebro-app');
    expect(document.documentElement.classList).toContain('cerebro-platform-linux');
    expect(document.title).toBe('r');
    expect(env().id).toBe('/r');
    expect(env().editor.activeGroup.active).toBe('/r/src/a.ts');
    await expect.poll(() => code()?.textContent).toContain('// /r/src/a.ts');
    expect(calls).toContainEqual(['scale', expect.any(String)]);
    expect(status()[0]).toBe('r · main');
  });

  it('shows the index’s progress in the status bar, from the host', async () => {
    notify('/r', 'index.progress', { worktree: '/r', done: 1, total: 4 });
    await expect.poll(() => status()[2]).toBe('Indexing… 1 / 4');
    const item = document.querySelectorAll('.cerebro-statusbar__item')[2] as HTMLElement;
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('The worktree’s sources, indexed for navigation by name');
    await userEvent.unhover(item);
    notify('/r', 'index.progress', { worktree: '/r', done: 4, total: 4 });
    await expect.poll(() => status()[2]).toBe('Indexed');
  });
});

describe('a diff tab', () => {
  it('shows the changes the host reads, or why it can’t', async () => {
    env().editor.open(diffTab('src/a.ts'));
    await expect
      .poll(() =>
        [
          ...(document
            .querySelector('.cerebro-editor-group--active .cerebro-editor-diff')
            ?.shadowRoot?.querySelectorAll('.cm-content') ?? []),
        ].map((side) => side.textContent),
      )
      .toEqual(['a', 'b']);
    expect(host('/r').params('git.diff')).toContainEqual({ path: '/r', file: 'src/a.ts' });
    answers['git.diff'] = new Error('no such file');
    env().editor.open(diffTab('src/b.ts'));
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-editor-group--active .playground-code__note')
            ?.textContent,
      )
      .toBe('Can’t show the changes to src/b.ts: no such file');
  });
});

describe('a file that can’t be read', () => {
  it('says why', async () => {
    answers['fs.read'] = new Error('EACCES');
    env().editor.open({ id: '/r/locked.ts', title: 'locked.ts' });
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-editor-group--active .playground-code__note')
            ?.textContent,
      )
      .toBe('Can’t open /r/locked.ts: EACCES');
  });
});
