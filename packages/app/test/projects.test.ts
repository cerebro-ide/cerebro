import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { ProjectStore, ProjectWindows, type ProjectWindow } from '../src/projects.js';

const folder = () => mkdtempSync(join(tmpdir(), 'cerebro-projects-'));

describe('ProjectStore', () => {
  it('starts empty, and keeps what was opened, the latest first, for the next start', () => {
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
    expect(store.open).toEqual(['/work/a', '/work/b']);
    store.closed('/work/a');
    store.forget('/work/b');
    const again = new ProjectStore(file);
    expect(again.recent).toEqual([{ path: '/work/a', name: 'a', opened: 3 }]);
    expect(again.open).toEqual(['/work/b']);
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
        open: ['/b', 5],
      }),
    );
    const store = new ProjectStore(file);
    expect(store.recent).toEqual([{ path: '/b', name: 'b', opened: 1 }]);
    expect(store.open).toEqual(['/b']);
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
  project: string | undefined;
  focus: Mock;
  reload: Mock;
  /** Closes it as the user would. */
  closeNow: () => void;
}

/** Fake windows, the hosts they get, and the folders that exist. */
function setup(open: string[] = [], exists = (path: string) => !path.includes('missing')) {
  const dir = folder();
  const store = new ProjectStore(join(dir, 'projects.json'));
  for (const path of open) store.opened(path);
  const windows: FakeWindow[] = [];
  let ids = 0;
  const hosts = { attach: vi.fn(), detach: vi.fn() };
  const create = (project: string | undefined) => {
    const listeners: (() => void)[] = [];
    const window: FakeWindow = {
      id: ++ids,
      project,
      send: vi.fn(),
      focus: vi.fn(),
      reload: vi.fn(),
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
  return { store, hosts, windows, projects };
}

const a = resolve('/work/a');
const b = resolve('/work/b');

describe('ProjectWindows', () => {
  it('opens CEREBRO_REPO’s project, else those open at the last quit that are there, else Welcome', () => {
    const repo = setup([a]);
    repo.projects.start('/work/b');
    expect(repo.windows.map((w) => w.project)).toEqual([b]);
    expect(repo.hosts.attach).toHaveBeenCalledWith(repo.windows[0], b);
    expect(repo.projects.projectOf(1)).toBe(b);
    const last = setup([a, resolve('/missing'), b]);
    last.projects.start();
    expect(last.windows.map((w) => w.project)).toEqual([a, b]);
    const none = setup();
    none.projects.start();
    expect(none.windows.map((w) => w.project)).toEqual([undefined]);
    expect(none.projects.projectOf(1)).toBeUndefined();
    expect(none.hosts.attach).not.toHaveBeenCalled();
  });

  it('opens a project in a new window, or in the asking one, and brings one open to the front', () => {
    const { projects, windows, hosts, store } = setup();
    projects.start(a);
    const first = windows[0] as (typeof windows)[number];
    projects.open('/work/b', 'new', first.id);
    expect(windows.map((w) => w.project)).toEqual([a, b]);
    expect(store.open).toEqual([a, b]);
    projects.open('/work/a', 'this', 2);
    expect(first.focus).toHaveBeenCalled();
    expect(windows).toHaveLength(2);
    const c = resolve('/work/c');
    projects.open('/work/c', 'this', first.id);
    expect(projects.projectOf(first.id)).toBe(c);
    expect(hosts.attach).toHaveBeenLastCalledWith(first, c);
    expect(first.reload).toHaveBeenCalled();
    expect(store.open).toEqual([b, c]);
    expect(() => {
      projects.open('/missing', 'new');
    }).toThrow('is not a folder that can be opened');
    // Without a window asking (no page), a new window.
    projects.open('/work/d', 'this');
    expect(windows).toHaveLength(3);
  });

  it('gives the Welcome window’s place to the project it opens', () => {
    const { projects, windows } = setup();
    projects.start();
    projects.open('/work/a', 'this', 1);
    expect(windows.map((w) => w.project)).toEqual([a]);
  });

  it('closes a project’s window, showing Welcome after the last; Welcome has none to close', () => {
    const { projects, windows, store, hosts } = setup([a, b]);
    projects.start();
    projects.close(1);
    expect(windows.map((w) => w.project)).toEqual([b]);
    expect(hosts.detach).toHaveBeenCalledOnce();
    projects.close(2);
    expect(windows.map((w) => w.project)).toEqual([undefined]);
    expect(store.open).toEqual([]);
    projects.close(3);
    projects.close(99);
    expect(windows).toHaveLength(1);
  });

  it('reopens the last project closed with its window, but not one closed beside others', () => {
    const { projects, windows, store } = setup([a, b]);
    projects.start();
    windows[0]?.closeNow();
    expect(store.open).toEqual([b]);
    windows[0]?.closeNow();
    expect(store.open).toEqual([b]);
  });

  it('keeps every project open when the app quits', () => {
    const { projects, windows, store } = setup([a, b]);
    projects.start();
    projects.quit();
    windows[0]?.closeNow();
    windows[0]?.closeNow();
    expect(store.open).toEqual([a, b]);
  });
});
