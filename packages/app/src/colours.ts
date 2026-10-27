// The window's own colours follow the page's theme: its background (shown while it resizes or
// loads); on Windows and Linux the window controls drawn over the toolbar, which Electron draws in
// the colours it's given; and on macOS the grey of the buttons kept in full screen (fullscreen.ts).
// The page sends its theme's colours when the theme changes.

import { BrowserWindow, ipcMain } from 'electron';
import { greyFullScreenButtons } from './fullscreen.js';

export const SET_COLOURS = 'cerebro:window:colours';

/** A colour the window can take: #rrggbb. */
const COLOUR = /^#[0-9a-f]{6}$/i;

/** Lets pages set their window's colours. */
export function installWindowColours(platform: NodeJS.Platform = process.platform): void {
  ipcMain.on(SET_COLOURS, (event, frame: unknown, text: unknown, buttons: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || typeof frame !== 'string' || typeof text !== 'string') return;
    if (!COLOUR.test(frame) || !COLOUR.test(text)) return;
    window.setBackgroundColor(frame);
    // macOS draws its own traffic lights.
    if (platform !== 'darwin') window.setTitleBarOverlay({ color: frame, symbolColor: text });
    else if (typeof buttons === 'string' && COLOUR.test(buttons)) {
      greyFullScreenButtons(window, buttons);
    }
  });
}
