import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  PROJECT_ADDED,
  PROJECT_SHOW,
  ProjectStore,
  ProjectWindows,
  type ProjectWindow,
} from '../src/projects.js';

const folder = () => mkdtempSync(join(tmpdir(), 'cerebro-projects-'));

describe('ProjectStore', () => {
  it('starts empty, and keeps what was opened, the latest first, and what’s open by window', () => {
    const file = join(folder(), 'data', 'projects.json');
    let time = 0;
    const store = new ProjectStore(file, () => ++time);
    expect(store.recent).toEqual([]);
    expect(store.open).toEqual([]);
    store.opened('/work/a');
    store.opened('/work/b');
    store.opened('/work/a');
    expect(store.recent).toEqual([
      { path: '/work/a', name: 'a', opened: 3 },
      { path: '/work/b', name: 'b', opened: 2 },
    ]);
    store.setOpen([['/work/a', '/work/c'], ['/work/b']]);
    store.forget('/work/b');
    const again = new ProjectStore(file);
    expect(again.recent).toEqual([{ path: '/work/a', name: 'a', opened: 3 }]);
    expect(again.open).toEqual([['/work/a', '/work/c'], ['/work/b']]);
  });

  it('keeps 20 recent projects, and names a root by its path', () => {
    const store = new ProjectStore(join(folder(), 'projects.json'));
    for (let i = 0; i < 25; i++) store.opened(`/p${String(i)}`);
    expect(store.recent).toHaveLength(20);
    expect(store.recent[0]?.path).toBe('/p24');
    store.opened('/');
    expect(store.recent[0]?.name).toBe('/');
  });

  it('skips what it can’t read, and carries on when it can’t save', () => {
    const dir = folder();
    const file = join(dir, 'projects.json');
    writeFileSync(
      file,
      JSON.stringify({
        recent: [{ path: '/a' }, { path: '/b', name: 'b', opened: 1 }],
        // A path alone, as saved before windows had several projects, is a window of its own.
        open: ['/b', 5, ['/c', '/d'], [], ['/e', 6]],
      }),
    );
    const store = new ProjectStore(file);
    expect(store.recent).toEqual([{ path: '/b', name: 'b', opened: 1 }]);
    expect(store.open).toEqual([['/b'], ['/c', '/d']]);
    writeFileSync(file, '{');
    expect(new ProjectStore(file).recent).toEqual([]);
    writeFileSync(file, '{}');
    expect(new ProjectStore(file).open).toEqual([]);
    // Its folder is a file: saving fails.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const blocked = new ProjectStore(join(file, 'projects.json'));
    blocked.opened('/c');
    expect(blocked.recent[0]?.path).toBe('/c');
    expect(error).toHaveBeenCalledWith('Could not save the projects', expect.any(Error));
    error.mockRestore();
    expect(readFileSync(file, 'utf8')).toBe('{}');
  });
});

interface FakeWindow extends ProjectWindow {
  welcome: boolean;
  focus: Mock;
  send: Mock;
  /** Closes it as the user would. */
  closeNow: () => void;
}

/** Fake windows, the hosts they get, and the folders that exist. */
function setup(open: string[][] = [], exists = (path: string) => !path.includes('missing')) {
  const dir = folder();
  const store = new ProjectStore(join(dir, 'projects.json'));
  store.setOpen(open);
  const windows: FakeWindow[] = [];
  let ids = 0;
  const hosts = { attach: vi.fn(), detach: vi.fn() };
  const create = (welcome: boolean) => {
    const listeners: (() => void)[] = [];
    const window: FakeWindow = {
      id: ++ids,
      welcome,
      send: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(() => {
        window.closeNow();
      }),
      onClosed: (listener: () => void) => listeners.push(listener),
      closeNow: () => {
        windows.splice(windows.indexOf(window), 1);
        for (const listener of listeners) listener();
      },
    };
    windows.push(window);
    return window;
  };
  const projects = new ProjectWindows({ store, hosts, create, exists });
  /** Each window's projects, or 'welcome'. */
  const shown = () => windows.map((w) => (w.welcome ? 'welcome' : [...projects.projectsOf(w.id)]));
  return { store, hosts, windows, projects, shown };
}

const a = resolve('/work/a');
const b = resolve('/work/b');
const c = resolve('/work/c');

describe('ProjectWindows', () => {
  it('opens CEREBRO_REPO’s project, else those open at the last quit that are there, else Welcome', () => {
    const repo = setup([[a]]);
    repo.projects.start('/work/b');
    expect(repo.shown()).toEqual([[b]]);
    expect(repo.hosts.attach).toHaveBeenCalledWith(repo.windows[0], b);
    const last = setup([[a, resolve('/missing')], [resolve('/missing')], [b, c]]);
    last.projects.start();
    expect(last.shown()).toEqual([[a], [b, c]]);
    expect(last.hosts.attach).toHaveBeenCalledTimes(3);
    expect(last.store.open).toEqual([[a], [b, c]]);
    const none = setup();
    none.projects.start();
    expect(none.shown()).toEqual(['welcome']);
    expect(none.projects.projectsOf(1)).toEqual([]);
    expect(none.hosts.attach).not.toHaveBeenCalled();
  });

  it('opens a project in a new window, or as tabs in the asking one, and shows one already open', () => {
    const { projects, windows, hosts, store, shown } = setup();
    projects.start(a);
    const first = windows[0] as FakeWindow;
    projects.open('/work/b', 'new', first.id);
    expect(shown()).toEqual([[a], [b]]);
    expect(store.open).toEqual([[a], [b]]);
    // This Window: the project joins it, its page told, with a host of its own.
    projects.open('/work/c', 'this', first.id);
    expect(shown()).toEqual([[a, c], [b]]);
    expect(hosts.attach).toHaveBeenLastCalledWith(first, c);
    expect(first.send).toHaveBeenCalledWith(PROJECT_ADDED, { path: c, name: 'c' });
    expect(store.open).toEqual([[a, c], [b]]);
    expect(store.recent[0]?.path).toBe(c);
    // Open already: its window comes to the front, and its page shows it.
    projects.open('/work/c', 'this', 2);
    expect(first.focus).toHaveBeenCalled();
    expect(first.send).toHaveBeenLastCalledWith(PROJECT_SHOW, c);
    expect(windows).toHaveLength(2);
    expect(() => {
      projects.open('/missing', 'new');
    }).toThrow('is not a folder that can be opened');
    // Without a window asking (no page), a new window.
    projects.open('/work/d', 'this');
    expect(windows).toHaveLength(3);
  });

  it('gives the Welcome window’s place to the project it opens', () => {
    const { projects, shown } = setup();
    projects.start();
    projects.open('/work/a', 'this', 1);
    expect(shown()).toEqual([[a]]);
  });

  it('closes a project, its host and, with its last, its window; Welcome shows after the last', () => {
    const { projects, store, hosts, shown, windows } = setup([[a, c], [b]]);
    projects.start();
    const first = windows[0] as FakeWindow;
    projects.close(first.id, c);
    expect(shown()).toEqual([[a], [b]]);
    expect(hosts.detach).toHaveBeenCalledWith(first, c);
    expect(store.open).toEqual([[a], [b]]);
    // Not one of the window's: nothing.
    projects.close(first.id, b);
    expect(shown()).toEqual([[a], [b]]);
    projects.close(first.id, a);
    expect(shown()).toEqual([[b]]);
    expect(store.open).toEqual([[b]]);
    projects.close(2, b);
    expect(shown()).toEqual(['welcome']);
    expect(store.open).toEqual([]);
    projects.close(3, b);
    projects.close(99, b);
    expect(windows).toHaveLength(1);
  });

  it('reopens the last window’s projects when it closes, but not those of one closed beside others', () => {
    const { projects, windows, store } = setup([[a, c], [b]]);
    projects.start();
    windows[0]?.closeNow();
    expect(store.open).toEqual([[b]]);
    windows[0]?.closeNow();
    expect(store.open).toEqual([[b]]);
  });

  it('keeps every project open when the app quits', () => {
    const { projects, windows, store } = setup([[a], [b]]);
    projects.start();
    projects.quit();
    windows[0]?.closeNow();
    windows[0]?.closeNow();
    expect(store.open).toEqual([[a], [b]]);
  });
});
