// The native application menu on macOS, from the tree the page sends (see ui-menu's native.ts). The
// tree comes from the page, so only known fields are taken from it, and never roles. The system's
// own menus frame it: the app menu (About, Hide, Quit…) first, which macOS names after the app, and
// the Window menu last.
//
// Clicks send the chosen command back to the page. Clicks an accelerator triggers are ignored: the
// page's keymap handles shortcuts, and the menu only shows them.

import { ipcMain, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

/** Channels between the page and the menu. */
export const SET_MENU = 'cerebro:menu:set';
export const MENU_COMMAND = 'cerebro:menu:command';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The page's menu tree as Electron's template, dropping anything that isn't a known item. */
export function template(
  items: unknown,
  run: (command: string) => void,
): MenuItemConstructorOptions[] {
  if (!Array.isArray(items)) return [];
  return items.filter(isRecord).map((item): MenuItemConstructorOptions => {
    if (item['separator'] === true) return { type: 'separator' };
    const label = typeof item['label'] === 'string' ? item['label'] : '';
    if (Array.isArray(item['submenu'])) {
      return { label, submenu: template(item['submenu'], run) };
    }
    const command = typeof item['command'] === 'string' ? item['command'] : undefined;
    const options: MenuItemConstructorOptions = {
      label,
      enabled: command !== undefined && item['enabled'] !== false,
      click: (_item, _window, event) => {
        if (command !== undefined && !event.triggeredByAccelerator) run(command);
      },
    };
    if (typeof item['checked'] === 'boolean') {
      options.type = 'checkbox';
      options.checked = item['checked'];
    }
    if (typeof item['accelerator'] === 'string') options.accelerator = item['accelerator'];
    return options;
  });
}

/** Builds the application menu from a page's tree; only macOS has one. */
export function applicationMenu(items: unknown, sender: WebContents): Menu {
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    ...template(items, (command) => {
      sender.send(MENU_COMMAND, command);
    }),
    { role: 'windowMenu' },
  ]);
}

/** On macOS, shows the menu the page sends as the application menu; elsewhere, none. */
export function installMenu(platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') {
    // Elsewhere the menu bar is the page's own. Electron's default menu would sit behind it, with
    // its own Alt handling and shortcuts; null suppresses it and the window's menu bar (Electron's
    // docs).
    Menu.setApplicationMenu(null);
    return;
  }
  ipcMain.on(SET_MENU, (event, items: unknown) => {
    Menu.setApplicationMenu(applicationMenu(items, event.sender));
  });
}
