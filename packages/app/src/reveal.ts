// Select In's file manager target, as IntelliJ's "Reveal in Finder" ("Show in Explorer" on Windows):
// the page asks for a file to be shown in the system's file manager, which opens its folder with
// the file selected (Electron's `shell.showItemInFolder`).

import { isAbsolute, normalize } from 'node:path';
import { ipcMain, shell } from 'electron';

export const REVEAL = 'cerebro:shell:reveal';

/**
 * Lets pages show a file in the system's file manager, its path in the platform's form (the page's
 * have forward slashes); a path that isn't absolute is ignored.
 */
export function installReveal(): void {
  ipcMain.on(REVEAL, (_event, path: unknown) => {
    if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(normalize(path));
  });
}
