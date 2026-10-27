// The window's own colours follow the page's theme: its background (shown while it resizes or
// loads), and on Windows and Linux the window controls drawn over the toolbar, which Electron draws
// in the colours it's given. The page sends its theme's frame and text colours when the theme
// changes.

import { BrowserWindow, ipcMain } from 'electron';

export const SET_COLOURS = 'cerebro:window:colours';

/** A colour the window can take: #rrggbb. */
const COLOUR = /^#[0-9a-f]{6}$/i;

/** Lets pages set their window's colours. */
export function installWindowColours(platform: NodeJS.Platform = process.platform): void {
  ipcMain.on(SET_COLOURS, (event, frame: unknown, text: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || typeof frame !== 'string' || typeof text !== 'string') return;
    if (!COLOUR.test(frame) || !COLOUR.test(text)) return;
    window.setBackgroundColor(frame);
    // macOS draws its own traffic lights.
    if (platform !== 'darwin') window.setTitleBarOverlay({ color: frame, symbolColor: text });
  });
}
