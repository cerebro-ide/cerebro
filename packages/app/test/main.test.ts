import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const appListeners = new Map<string, Listener>();
  const windows: FakeWindow[] = [];
  class FakeWindow {
    static getAllWindows = () => windows;
    options: unknown;
    shown = false;
    loaded: string | undefined;
    onceListeners = new Map<string, Listener>();
    openHandler: Listener | undefined;
    contentListeners = new Map<string, Listener>();
    webContents = {
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
    show() {
      this.shown = true;
    }
    loadURL(url: string) {
      this.loaded = url;
      return Promise.resolve();
    }
    loadFile(path: string) {
      this.loaded = path;
      return Promise.resolve();
    }
  }
  const app = {
    on: (event: string, listener: Listener) => {
      appListeners.set(event, listener);
    },
    quit: vi.fn(),
    setPath: vi.fn(),
    whenReady: () => Promise.resolve(),
  };
  return { app, appListeners, windows, BrowserWindow: FakeWindow };
});

vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow }));

const host = vi.hoisted(() => ({ installHost: vi.fn() }));
vi.mock('../src/host.js', () => host);

const { createWindow, start } = await import('../src/main.js');

/** Whether navigating to `url` is let through. */
function navigates(window: (typeof electron.windows)[number], url: string) {
  const event = { preventDefault: vi.fn() };
  (window.contentListeners.get('will-navigate') as Listener)(event, url);
  return event.preventDefault.mock.calls.length === 0;
}

beforeEach(() => {
  electron.windows.length = 0;
  electron.appListeners.clear();
  electron.app.quit.mockClear();
});

describe('createWindow', () => {
  it('loads the dev server, staying on its origin', async () => {
    await createWindow('http://localhost:5173/');
    const window = electron.windows[0] as (typeof electron.windows)[number];
    expect(window.loaded).toBe('http://localhost:5173/');
    expect(window.options).toEqual(
      expect.objectContaining({
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

  it('loads the built page without one, staying on files', async () => {
    vi.stubEnv('CEREBRO_DEV_URL', '');
    await createWindow();
    vi.unstubAllEnvs();
    const window = electron.windows[0] as (typeof electron.windows)[number];
    expect(window.loaded).toMatch(/playground[/\\]dist[/\\]index\.html$/);
    expect(navigates(window, 'file:///elsewhere/index.html')).toBe(true);
    expect(navigates(window, 'https://example.com/')).toBe(false);
  });
});

describe('start', () => {
  it('opens a window when ready, and another on activation without one', async () => {
    start();
    await vi.waitFor(() => {
      expect(electron.windows).toHaveLength(1);
    });
    (electron.appListeners.get('activate') as Listener)();
    expect(electron.windows).toHaveLength(1);
    electron.windows.length = 0;
    (electron.appListeners.get('activate') as Listener)();
    expect(electron.windows).toHaveLength(1);
  });

  it('keeps its data where it’s told to, if told', () => {
    start('/tmp/cerebro-test');
    expect(electron.app.setPath).toHaveBeenCalledWith('userData', '/tmp/cerebro-test');
    expect(host.installHost).toHaveBeenCalled();
    electron.app.setPath.mockClear();
    vi.stubEnv('CEREBRO_USER_DATA', '');
    start();
    vi.unstubAllEnvs();
    expect(electron.app.setPath).not.toHaveBeenCalled();
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
