import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const appListeners = new Map<string, Listener>();
  return {
    appListeners,
    app: {
      on: (event: string, listener: Listener) => {
        appListeners.set(event, listener);
      },
    },
  };
});

vi.mock('electron', () => ({ app: electron.app }));

const { greyFullScreenButtons, installFullScreen, loadButtons } =
  await import('../src/fullscreen.js');

const buttons = { show: vi.fn(), hide: vi.fn(), colour: vi.fn() };

/** A window as `browser-window-created` gives it: its events, and its handle. */
function created() {
  const handle = Buffer.alloc(8);
  const window = Object.assign(new EventEmitter(), { getNativeWindowHandle: () => handle });
  (electron.appListeners.get('browser-window-created') as Listener)({}, window);
  return { window, handle };
}

beforeEach(() => {
  vi.clearAllMocks();
  electron.appListeners.clear();
});

describe('installFullScreen', () => {
  it('only remembers a window’s grey before it’s installed', () => {
    const { window } = (() => {
      installFullScreen('win32', () => buttons);
      return { window: Object.assign(new EventEmitter(), { getNativeWindowHandle: vi.fn() }) };
    })();
    greyFullScreenButtons(window as never, '#7a7b80');
    expect(window.getNativeWindowHandle).not.toHaveBeenCalled();
  });

  it('puts the buttons in a window as it enters full screen, and takes them out as it leaves', () => {
    installFullScreen('darwin', () => buttons);
    const { window, handle } = created();
    window.emit('enter-full-screen');
    // The dark theme's grey until the page gives its own.
    expect(buttons.show).toHaveBeenCalledWith(handle, '#575a5c');
    window.emit('leave-full-screen');
    expect(buttons.hide).toHaveBeenCalledWith(handle);
  });

  it('greys them as the page’s theme', () => {
    installFullScreen('darwin', () => buttons);
    const { window, handle } = created();
    greyFullScreenButtons(window as never, '#7a7b80');
    expect(buttons.colour).toHaveBeenCalledWith(handle, '#7a7b80');
    window.emit('enter-full-screen');
    expect(buttons.show).toHaveBeenCalledWith(handle, '#7a7b80');
  });

  it('does nothing elsewhere: only macOS hides the buttons', () => {
    const load = vi.fn(() => buttons);
    installFullScreen('win32', load);
    expect(load).not.toHaveBeenCalled();
    expect(electron.appListeners.size).toBe(0);
  });

  it('loads the native module from next to it, where the build puts it', () => {
    // Not built next to the source.
    expect(loadButtons).toThrow(/fullscreen\.node/);
  });
});
