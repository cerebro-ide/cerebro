import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const appListeners = new Map<string, Listener>();
  const handlers = new Map<string, Listener>();
  const windows: FakeWindow[] = [];
  let ids = 0;
  class FakeWindow {
    static getAllWindows = () => windows;
    static fromWebContents = (contents: { id: number }) =>
      windows.find((w) => w.webContents.id === contents.id) ?? null;
    options: unknown;
    shown = false;
    loaded: string | undefined;
    minimized = false;
    onceListeners = new Map<string, Listener>();
    listeners = new Map<string, Listener>();
    openHandler: Listener | undefined;
    contentListeners = new Map<string, Listener>();
    focus = vi.fn();
    restore = vi.fn();
    close = vi.fn();
    webContents = {
      id: ++ids,
      setZoomFactor: vi.fn(),
      send: vi.fn(),
      executeJavaScript: vi.fn((): Promise<unknown> => Promise.resolve()),
      setWindowOpenHandler: (handler: Listener) => {
        this.openHandler = handler;
      },
      on: (event: string, listener: Listener) => {
        this.contentListeners.set(event, listener);
      },
    };
    constructor(options: unknown) {
      this.options = options;
      windows.push(this);
    }
    once(event: string, listener: Listener) {
      this.onceListeners.set(event, listener);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
    }
    isMinimized() {
      return this.minimized;
    }
    show() {
      this.shown = true;
    }
    loadURL(url: string) {
      this.loaded = url;
      return Promise.resolve();
    }
    loadFile(path: string) {
      this.loaded = path;
      return FakeWindow.failLoad ? Promise.reject(new Error('gone')) : Promise.resolve();
    }
    static failLoad = false;
  }
  const app = {
    on: (event: string, listener: Listener) => {
      appListeners.set(event, listener);
    },
    quit: vi.fn(),
    setPath: vi.fn(),
    getPath: vi.fn(() => '/nowhere'),
    whenReady: () => Promise.resolve(),
  };
  const ipcMain = {
    handle: (channel: string, handler: Listener) => {
      handlers.set(channel, handler);
    },
  };
  const dialog = { showOpenDialog: vi.fn() };
  return { app, appListeners, handlers, ipcMain, dialog, windows, BrowserWindow: FakeWindow };
});

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  ipcMain: electron.ipcMain,
  dialog: electron.dialog,
  screen: { getPrimaryDisplay: () => ({ scaleFactor: 2 }) },
}));

const display = vi.hoisted(() => ({
  installDisplayScale: vi.fn((): number | undefined => undefined),
  zoomFor: vi.fn((): number | undefined => undefined),
}));
vi.mock('../src/display.js', () => display);

const host = vi.hoisted(() => {
  const hosts = { attach: vi.fn(), detach: vi.fn() };
  return { hosts, installHosts: vi.fn(() => hosts) };
});
vi.mock('../src/host.js', () => host);

const menu = vi.hoisted(() => ({ installMenu: vi.fn() }));
vi.mock('../src/menu.js', () => menu);
vi.mock('../src/colours.js', () => ({ installWindowColours: vi.fn() }));
vi.mock('../src/fullscreen.js', () => ({ installFullScreen: vi.fn() }));

const {
  createWindow,
  installProjects,
  projectWindow,
  saveFiles,
  start,
  PROJECT_CLOSE,
  PROJECT_CURRENT,
  PROJECT_FORGET,
  PROJECT_OPEN,
  PROJECT_PICK,
  PROJECT_RECENT,
} = await import('../src/main.js');
const { ProjectStore } = await import('../src/projects.js');

type FakeWindow = (typeof electron.windows)[number];

/** Whether navigating to `url` is let through. */
function navigates(window: FakeWindow, url: string) {
  const event = { preventDefault: vi.fn() };
  (window.contentListeners.get('will-navigate') as Listener)(event, url);
  return event.preventDefault.mock.calls.length === 0;
}

const folder = () => mkdtempSync(join(tmpdir(), 'cerebro-main-'));

/** Calls an IPC handler as `window`'s page would. */
const ask = (channel: string, window: FakeWindow | undefined, ...args: unknown[]) =>
  (electron.handlers.get(channel) as Listener)(
    { sender: { id: window?.webContents.id ?? -1 } },
    ...args,
  );

beforeEach(() => {
  electron.windows.length = 0;
  electron.appListeners.clear();
  electron.handlers.clear();
  electron.app.quit.mockClear();
  electron.BrowserWindow.failLoad = false;
});

describe('createWindow', () => {
  it('loads the dev server, staying on its origin', async () => {
    await createWindow(false, 'http://localhost:5173/').loaded;
    const window = electron.windows[0] as FakeWindow;
    expect(window.loaded).toBe('http://localhost:5173/');
    expect(window.options).toEqual(
      expect.objectContaining({
        width: 1440,
        webPreferences: expect.objectContaining({
          preload: expect.stringMatching(/preload\.cjs$/) as unknown,
        }) as unknown,
      }),
    );
    expect(navigates(window, 'http://localhost:5173/other')).toBe(true);
    expect(navigates(window, 'https://example.com/')).toBe(false);
    expect((window.openHandler as Listener)()).toEqual({ action: 'deny' });
    expect(window.shown).toBe(false);
    (window.onceListeners.get('ready-to-show') as Listener)();
    expect(window.shown).toBe(true);
  });

  it('loads the built page without one, staying on files; the Welcome window is smaller', async () => {
    vi.stubEnv('CEREBRO_DEV_URL', '');
    await createWindow(true).loaded;
    vi.unstubAllEnvs();
    const window = electron.windows[0] as FakeWindow;
    expect(window.loaded).toMatch(/playground[/\\]dist[/\\]index\.html$/);
    expect(window.options).toEqual(expect.objectContaining({ width: 800, height: 650 }));
    expect(navigates(window, 'file:///elsewhere/index.html')).toBe(true);
    expect(navigates(window, 'https://example.com/')).toBe(false);
  });
});

describe('saveFiles', () => {
  const contents = (result: Promise<unknown>) =>
    ({ executeJavaScript: () => result }) as unknown as Parameters<typeof saveFiles>[0];

  it('waits for the page to save, and carries on when it fails or takes too long', async () => {
    await expect(saveFiles(contents(Promise.resolve(3)))).resolves.toBeUndefined();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await saveFiles(contents(Promise.reject(new Error('no'))));
    expect(error).toHaveBeenCalledWith('The page could not save its files', expect.any(Error));
    await saveFiles(contents(new Promise(() => undefined)), 1);
    expect(error).toHaveBeenCalledWith('The page took too long to save its files');
    error.mockRestore();
  });
});

describe('projectWindow', () => {
  it('acts on its window until it closes, then does nothing', () => {
    vi.stubEnv('CEREBRO_DEV_URL', '');
    const window = projectWindow(false);
    vi.unstubAllEnvs();
    const fake = electron.windows[0] as FakeWindow;
    expect(window.id).toBe(fake.webContents.id);
    const closed = vi.fn();
    window.onClosed(closed);
    window.send('channel', 1);
    expect(fake.webContents.send).toHaveBeenCalledWith('channel', 1);
    window.focus();
    expect(fake.restore).not.toHaveBeenCalled();
    fake.minimized = true;
    window.focus();
    expect(fake.restore).toHaveBeenCalled();
    expect(fake.focus).toHaveBeenCalledTimes(2);
    window.close();
    expect(fake.close).toHaveBeenCalledOnce();
    (fake.listeners.get('closed') as Listener)();
    expect(closed).toHaveBeenCalled();
    window.send('channel', 2);
    window.focus();
    window.close();
    expect(fake.webContents.send).toHaveBeenCalledOnce();
    expect(fake.focus).toHaveBeenCalledTimes(2);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it('has its page save its files before it closes, then quits again if the app was quitting', async () => {
    vi.stubEnv('CEREBRO_DEV_URL', '');
    installProjects(host.hosts as never, new ProjectStore(join(folder(), 'projects.json')));
    projectWindow(false);
    vi.unstubAllEnvs();
    const fake = electron.windows[0] as FakeWindow;
    const close = fake.listeners.get('close') as Listener;
    const event = { preventDefault: vi.fn() };
    close(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(fake.webContents.executeJavaScript).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(fake.close).toHaveBeenCalledOnce();
    });
    // Saved: the close goes ahead.
    const again = { preventDefault: vi.fn() };
    close(again);
    expect(again.preventDefault).not.toHaveBeenCalled();
    // While quitting, the app quits again once the page has saved.
    (electron.appListeners.get('before-quit') as Listener)();
    projectWindow(false);
    const other = electron.windows[1] as FakeWindow;
    (other.listeners.get('close') as Listener)({ preventDefault: vi.fn() });
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalled();
    });
    expect(other.close).not.toHaveBeenCalled();
  });

  it('says when its page can’t load, and logs it in the app’s data folder', async () => {
    const data = folder();
    electron.app.getPath.mockReturnValueOnce(data);
    vi.stubEnv('CEREBRO_DEV_URL', '');
    electron.BrowserWindow.failLoad = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    projectWindow(true);
    vi.unstubAllEnvs();
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('The window could not load', expect.any(Error));
    });
    expect(readFileSync(join(data, 'pages.log'), 'utf8')).toMatch(/could not load: Error: gone\n$/);
    error.mockRestore();
  });

  it('logs what goes wrong in its page', () => {
    const data = folder();
    electron.app.getPath.mockReturnValueOnce(data);
    projectWindow(false);
    const fake = electron.windows[0] as FakeWindow;
    (fake.contentListeners.get('render-process-gone') as Listener)(
      {},
      { reason: 'crashed', exitCode: 1 },
    );
    expect(readFileSync(join(data, 'pages.log'), 'utf8')).toMatch(/page gone: crashed/);
  });
});

describe('installProjects', () => {
  it('tells a page its projects, lists the recent ones, and forgets one', async () => {
    const a = folder();
    const store = new ProjectStore(join(folder(), 'projects.json'));
    store.opened('/gone');
    const windows = installProjects(host.hosts as never, store);
    windows.start(a);
    const window = electron.windows[0] as FakeWindow;
    expect(await ask(PROJECT_CURRENT, window)).toEqual([
      { path: a, name: expect.any(String) as unknown },
    ]);
    expect(await ask(PROJECT_CURRENT, undefined)).toEqual([]);
    expect(await ask(PROJECT_RECENT, window)).toEqual([
      expect.objectContaining({ path: a, exists: true }),
      expect.objectContaining({ path: '/gone', exists: false }),
    ]);
    await ask(PROJECT_FORGET, window, '/gone');
    expect(store.recent.map((r) => r.path)).toEqual([a]);
    expect(() => ask(PROJECT_FORGET, window, 5)).toThrow('path must be a path');
  });

  it('asks for a folder with the system’s dialog, over the window asking when there is one', async () => {
    installProjects(host.hosts as never, new ProjectStore(join(folder(), 'projects.json')));
    createWindow(false, 'http://localhost/');
    const window = electron.windows[0] as FakeWindow;
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/x'] });
    expect(await ask(PROJECT_PICK, window)).toBe('/x');
    expect(electron.dialog.showOpenDialog).toHaveBeenLastCalledWith(window, {
      title: 'Open',
      properties: ['openDirectory', 'createDirectory'],
    });
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await ask(PROJECT_PICK, undefined)).toBeNull();
    expect(electron.dialog.showOpenDialog.mock.lastCall).toHaveLength(1);
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    expect(await ask(PROJECT_PICK, window)).toBeNull();
  });

  it('opens a project where asked, closes one, and keeps them open when the app quits', () => {
    const a = folder();
    const b = folder();
    const store = new ProjectStore(join(folder(), 'projects.json'));
    installProjects(host.hosts as never, store);
    expect(() => ask(PROJECT_OPEN, undefined, a, 'elsewhere')).toThrow('where must be');
    expect(() => ask(PROJECT_OPEN, undefined, '', 'new')).toThrow('path must be a path');
    ask(PROJECT_OPEN, undefined, a, 'new');
    ask(PROJECT_OPEN, undefined, b, 'new');
    expect(store.open).toEqual([[a], [b]]);
    expect(host.hosts.attach).toHaveBeenCalledTimes(2);
    // In the place of the window's project.
    const c = folder();
    expect(() => ask(PROJECT_OPEN, electron.windows[0], c, 'this', 5)).toThrow(
      'replacing must be a path',
    );
    ask(PROJECT_OPEN, electron.windows[0], c, 'this', a);
    expect(store.open).toEqual([[c], [b]]);
    expect(() => ask(PROJECT_CLOSE, electron.windows[0])).toThrow('path must be a path');
    ask(PROJECT_CLOSE, electron.windows[0], c);
    expect(store.open).toEqual([[b]]);
    (electron.appListeners.get('before-quit') as Listener)();
    (electron.windows[1]?.listeners.get('closed') as Listener)();
    expect(store.open).toEqual([[b]]);
  });
});

describe('start', () => {
  it('shows the Welcome window with no project, and again on activation without windows', async () => {
    vi.stubEnv('CEREBRO_REPO', undefined);
    electron.app.getPath.mockReturnValueOnce(folder());
    start();
    vi.unstubAllEnvs();
    await vi.waitFor(() => {
      expect(electron.windows).toHaveLength(1);
    });
    expect(electron.windows[0]?.options).toEqual(expect.objectContaining({ width: 800 }));
    (electron.appListeners.get('activate') as Listener)();
    expect(electron.windows).toHaveLength(1);
    electron.windows.length = 0;
    (electron.appListeners.get('activate') as Listener)();
    expect(electron.windows).toHaveLength(1);
  });

  it('opens CEREBRO_REPO’s project', async () => {
    const repo = folder();
    vi.stubEnv('CEREBRO_REPO', repo);
    electron.app.getPath.mockReturnValueOnce(folder());
    start();
    vi.unstubAllEnvs();
    await vi.waitFor(() => {
      expect(electron.windows).toHaveLength(1);
    });
    expect(host.hosts.attach).toHaveBeenLastCalledWith(expect.anything(), repo);
  });

  it('does nothing on activation before it’s ready', () => {
    start();
    electron.windows.length = 0;
    const activate = electron.appListeners.get('activate') as Listener;
    electron.appListeners.clear();
    // The listener from a start whose `whenReady` hasn't run: no windows to manage yet.
    expect(() => activate()).not.toThrow();
  });

  it('keeps its data where it’s told to, if told, then applies the display scale', () => {
    start('/tmp/cerebro-test');
    expect(electron.app.setPath).toHaveBeenCalledWith('userData', '/tmp/cerebro-test');
    expect(host.installHosts).toHaveBeenCalled();
    expect(menu.installMenu).toHaveBeenCalled();
    expect(display.installDisplayScale).toHaveBeenCalled();
    expect(electron.app.setPath.mock.invocationCallOrder[0]).toBeLessThan(
      display.installDisplayScale.mock.invocationCallOrder[0] as number,
    );
    electron.app.setPath.mockClear();
    vi.stubEnv('CEREBRO_USER_DATA', '');
    start();
    vi.unstubAllEnvs();
    expect(electron.app.setPath).not.toHaveBeenCalled();
  });

  it('zooms its windows as the display scale forced asks', async () => {
    display.installDisplayScale.mockReturnValueOnce(1.25);
    display.zoomFor.mockReturnValueOnce(0.625);
    electron.app.getPath.mockReturnValueOnce(folder());
    start();
    await vi.waitFor(() => {
      expect(electron.windows).toHaveLength(1);
    });
    expect(display.zoomFor).toHaveBeenLastCalledWith(1.25, process.platform, 2);
    expect(electron.windows[0]?.options).toEqual(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ zoomFactor: 0.625 }) as unknown,
      }),
    );
    await vi.waitFor(() => {
      expect(electron.windows[0]?.webContents.setZoomFactor).toHaveBeenCalledWith(0.625);
    });
  });

  it('quits when the last window closes, except on macOS', () => {
    start();
    const closed = electron.appListeners.get('window-all-closed') as Listener;
    const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      closed();
      expect(electron.app.quit).not.toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      closed();
      expect(electron.app.quit).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });
});
