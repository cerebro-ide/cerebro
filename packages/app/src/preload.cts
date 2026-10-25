// Runs in the window before the page, sandboxed (so CommonJS): tells the page it runs in the app,
// and on which platform, so it can leave room for the window controls; and on macOS lets it show
// its menu as the application menu (see menu.ts).

// The CommonJS form of an import; verbatimModuleSyntax rules out `import … from` here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

// Kept in step with menu.ts, which a sandboxed preload can't import.
const SET_MENU = 'cerebro:menu:set';
const MENU_COMMAND = 'cerebro:menu:command';

electron.contextBridge.exposeInMainWorld('cerebro', {
  app: true,
  platform: process.platform,
  menu: {
    set: (items: unknown) => {
      electron.ipcRenderer.send(SET_MENU, items);
    },
    onCommand: (listener: (command: string) => void) => {
      const handler = (_event: unknown, command: unknown) => {
        if (typeof command === 'string') listener(command);
      };
      electron.ipcRenderer.on(MENU_COMMAND, handler);
      return () => {
        electron.ipcRenderer.off(MENU_COMMAND, handler);
      };
    },
  },
});
