// The system's shell, for the page. Select In's file manager target, as IntelliJ's "Reveal in
// Finder" ("Show in Explorer" on Windows): the page asks for a file to be shown in the system's file
// manager, which opens its folder with the file selected (Electron's `shell.showItemInFolder`).
// And Delete's bin: IntelliJ moves what it deletes to the system's trash by default
// (GeneralSettings' `deleteToBin`), as `shell.trashItem` does. And a web link's page, in the
// system's browser, as IntelliJ opens a link in Quick Documentation or the Markdown preview
// (`BrowserUtil.browse`): only `http:` and `https:` addresses, Claude's choice, open to change, as a
// file's comments can hold any.

import { isAbsolute, normalize } from 'node:path';
import { ipcMain, shell } from 'electron';
import { handle } from './ipc.js';

export const REVEAL = 'cerebro:shell:reveal';
export const TRASH = 'cerebro:shell:trash';
export const BROWSE = 'cerebro:shell:browse';

/** Whether `address` is a web page's: `http:` or `https:`. */
export function isWebAddress(address: string): boolean {
  return /^https?:\/\/./i.test(address);
}

/**
 * Lets pages show a file in the system's file manager, and move a file or folder to the trash, its
 * path in the platform's form (the page's have forward slashes). A path that isn't absolute is
 * ignored by the first, and fails the second. And open a web page in the browser; any other
 * address is ignored.
 */
export function installShell(): void {
  ipcMain.on(REVEAL, (_event, path: unknown) => {
    if (typeof path === 'string' && isAbsolute(path)) shell.showItemInFolder(normalize(path));
  });
  ipcMain.on(BROWSE, (_event, address: unknown) => {
    if (typeof address === 'string' && isWebAddress(address)) void shell.openExternal(address);
  });
  handle(TRASH, (_event, path: unknown) => {
    if (typeof path !== 'string' || !isAbsolute(path))
      throw new Error(`Not a full path: ${String(path)}`);
    return shell.trashItem(normalize(path));
  });
}
