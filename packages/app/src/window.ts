// The main window's options: hardened, and with the title bar merged into the app's own toolbar, as
// IntelliJ does. The OS title bar is hidden; on Windows and Linux the window controls are drawn over
// the toolbar's right end, and macOS keeps its traffic lights at the left.

import type { BrowserWindowConstructorOptions } from 'electron';

/** The main toolbar's height: the window controls are drawn at this height over it. */
export const TOOLBAR_HEIGHT = 40;

/** The dark theme's panel and text colours, so the window doesn't flash white while loading. */
const PANEL = '#2b2d30';
const TEXT = '#dfe1e5';

export function windowOptions(
  platform: NodeJS.Platform,
  preload: string,
): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: PANEL,
    show: false,
    titleBarStyle: 'hidden',
    ...(platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 13 } }
      : { titleBarOverlay: { color: PANEL, symbolColor: TEXT, height: TOOLBAR_HEIGHT } }),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}
