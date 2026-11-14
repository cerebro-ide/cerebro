// The system's shell, for the page. Select In's file manager target, as IntelliJ's "Reveal in
// Finder" ("Show in Explorer" on Windows): the page asks for a file to be shown in the system's file
// manager, which opens its folder with the file selected (Electron's `shell.showItemInFolder`).
// And Delete's bin: IntelliJ moves what it deletes to the system's trash by default
// (GeneralSettings' `deleteToBin`), as `shell.trashItem` does.

import { isAbsolute, normalize } from 'node:path';
import { ipcMain, shell } from 'electron';
import { handle } from './ipc.js';

export const REVEAL = 'cerebro:shell:reveal';
export const TRASH = 'cerebro:shell:trash';

/**
 * Lets pages show a file in the system's file manager, and move a file or folder to the trash, its
 * path in the platform's form (the page's have forward slashes). A path that isn't absolute is
 * ignored by the first, and fails the second.
 */
export function installShell(): void {
  ipcMain.on(REVEAL, (_event, path: unknown) => {
    if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(normalize(path));
  });
  handle(TRASH, (_event, path: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new Error(`Not a full path: ${String(path)}`);
    return shell.trashItem(normalize(path));
  });
}
