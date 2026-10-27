import { describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const ipc = new Map<string, Listener>();
  const window = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
  return {
    ipc,
    window,
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

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, ipcMain: electron.ipcMain }));

const { installWindowColours, SET_COLOURS } = await import('../src/colours.js');

const send = (id: number, ...args: unknown[]) =>
  (electron.ipc.get(SET_COLOURS) as Listener)({ sender: { id } }, ...args);

describe('installWindowColours', () => {
  it('colours the window and its controls as the page’s theme, ignoring what isn’t a colour', () => {
    installWindowColours('win32');
    send(1, '#ebecf0', '#1e1f22');
    expect(electron.window.setBackgroundColor).toHaveBeenCalledWith('#ebecf0');
    expect(electron.window.setTitleBarOverlay).toHaveBeenCalledWith({
      color: '#ebecf0',
      symbolColor: '#1e1f22',
    });
    vi.clearAllMocks();
    send(1, 'red', '#1e1f22');
    send(1, '#ebecf0', 3);
    send(2, '#ebecf0', '#1e1f22');
    expect(electron.window.setBackgroundColor).not.toHaveBeenCalled();
  });

  it('leaves macOS’s traffic lights alone', () => {
    installWindowColours('darwin');
    vi.clearAllMocks();
    send(1, '#ebecf0', '#1e1f22');
    expect(electron.window.setBackgroundColor).toHaveBeenCalled();
    expect(electron.window.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
