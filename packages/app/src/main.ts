// The Electron main process: one window showing Cerebro's UI. In development it loads the dev
// server's URL (CEREBRO_DEV_URL); otherwise the built page. The window opens no other windows and
// navigates nowhere else.

import { app, BrowserWindow, screen, type WebContents } from 'electron';
import { fileURLToPath } from 'node:url';
import { installDisplayScale, zoomFor } from './display.js';
import { installMenu } from './menu.js';
import { windowOptions } from './window.js';

/** The built UI, relative to this file once compiled to dist/. */
const PAGE = fileURLToPath(new URL('../../playground/dist/index.html', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));

/** The display scale forced at the start, if any. */
let forcedScale: number | undefined;

/**
 * Keeps a window's contents on its own pages: no new windows, no navigation elsewhere. (A file
 * URL's origin is "null", as is a data URL's, so files are matched by protocol instead.)
 */
export function confine(contents: WebContents, allowed: (url: URL) => boolean): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!allowed(new URL(url))) event.preventDefault();
  });
}

export async function createWindow(
  devUrl = process.env['CEREBRO_DEV_URL'],
): Promise<BrowserWindow> {
  const zoom = zoomFor(forcedScale, process.platform, screen.getPrimaryDisplay().scaleFactor);
  const window = new BrowserWindow(windowOptions(process.platform, PRELOAD, zoom));
  window.once('ready-to-show', () => {
    window.show();
  });
  if (devUrl) {
    const origin = new URL(devUrl).origin;
    confine(window.webContents, (url) => url.origin === origin);
    await window.loadURL(devUrl);
  } else {
    confine(window.webContents, (url) => url.protocol === 'file:');
    await window.loadFile(PAGE);
  }
  return window;
}

/**
 * Starts the app: a window when ready, another when re-activated without one (macOS), and on macOS
 * the application menu from the page, at the display scale chosen. `userData` replaces the folder
 * the app keeps its data in.
 */
export function start(userData = process.env['CEREBRO_USER_DATA']): void {
  // Somewhere else for the app's data, such as a throwaway folder for end-to-end tests.
  if (userData) app.setPath('userData', userData);
  // Before the app is ready: Chromium fixes the scale when it starts.
  forcedScale = installDisplayScale();
  installMenu();
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
  void app.whenReady().then(() => createWindow());
}
