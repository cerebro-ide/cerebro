// The main window's options: hardened, and with the title bar merged into the app's own toolbar, as
// IntelliJ does. The OS title bar is hidden; on Windows and Linux the window controls are drawn over
// the toolbar's right end, and macOS keeps its traffic lights at the left.

import type { BrowserWindowConstructorOptions } from 'electron';

/** The main toolbar's height: the window controls are drawn at this height over it. */
export const TOOLBAR_HEIGHT = 43;

/** The dark theme's frame and text colours, so the window doesn't flash white while loading. */
const FRAME = '#25282c';
const TEXT = '#d1d3d9';

/** The Welcome window's size: smaller than a project's, as IntelliJ's. */
export const WELCOME_SIZE = { width: 800, height: 650 };

/**
 * A project window's size from `CEREBRO_WINDOW_SIZE` ("1024x768"), for the tests: the window starts
 * at it, rather than being resized after it shows, which Linux's window manager can undo as it
 * places the window (measured under WSLg: the size went back to 1440×900, 1 ms after the resize).
 */
export function sizeFrom(value: string | undefined): { width: number; height: number } | undefined {
  const match = /^(\d+)x(\d+)$/.exec(value ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

export function windowOptions(
  platform: NodeJS.Platform,
  preload: string,
  /** The page's zoom, if it's to be other than 1 (see display.ts). */
  zoomFactor?: number,
  size: { width: number; height: number } = { width: 1440, height: 900 },
): BrowserWindowConstructorOptions {
  return {
    ...size,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: FRAME,
    show: false,
    titleBarStyle: 'hidden',
    ...(platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: FRAME, symbolColor: TEXT, height: TOOLBAR_HEIGHT } }),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      ...(zoomFactor === undefined ? {} : { zoomFactor }),
    },
  };
}
