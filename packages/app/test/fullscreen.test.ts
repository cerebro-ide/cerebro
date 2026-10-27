import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const ipc = new Map<string, Listener>();
  const appListeners = new Map<string, Listener>();
  const window = { setFullScreen: vi.fn(), close: vi.fn() };
  return {
    ipc,
    appListeners,
    window,
    app: {
      on: (event: string, listener: Listener) => {
        appListeners.set(event, listener);
      },
    },
    BrowserWindow: {
      fromWebContents: (contents: { id: number }) => (contents.id === 1 ? window : null),
    },
    ipcMain: {
      on: (channel: string, listener: Listener) => {
        ipc.set(channel, listener);
      },
    },
  };
});

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  ipcMain: electron.ipcMain,
}));

const { CLOSE_WINDOW, FULL_SCREEN, installFullScreen, LEAVE_FULL_SCREEN } =
  await import('../src/fullscreen.js');

const send = (channel: string, id: number) => {
  (electron.ipc.get(channel) as Listener)({ sender: { id } });
};

/** A window as `browser-window-created` gives it: events, whether it's full screen, its page. */
function created(fullScreen: () => boolean) {
  const contents = Object.assign(new EventEmitter(), { send: vi.fn() });
  const window = Object.assign(new EventEmitter(), {
    isFullScreen: fullScreen,
    webContents: contents,
  });
  (electron.appListeners.get('browser-window-created') as Listener)({}, window);
  return { window, contents };
}

describe('installFullScreen', () => {
  it('tells a window’s page when it enters and leaves full screen, and when it loads', () => {
    installFullScreen();
    let full = false;
    const { window, contents } = created(() => full);
    contents.emit('did-finish-load');
    full = true;
    window.emit('enter-full-screen');
    full = false;
    window.emit('leave-full-screen');
    expect(contents.send.mock.calls).toEqual([
      [FULL_SCREEN, false],
      [FULL_SCREEN, true],
      [FULL_SCREEN, false],
    ]);
  });

  it('leaves full screen and closes the window its page asks for, if it has one', () => {
    installFullScreen();
    send(LEAVE_FULL_SCREEN, 1);
    expect(electron.window.setFullScreen).toHaveBeenCalledWith(false);
    send(CLOSE_WINDOW, 1);
    expect(electron.window.close).toHaveBeenCalled();
    vi.clearAllMocks();
    send(LEAVE_FULL_SCREEN, 2);
    send(CLOSE_WINDOW, 2);
    expect(electron.window.setFullScreen).not.toHaveBeenCalled();
    expect(electron.window.close).not.toHaveBeenCalled();
  });
});
