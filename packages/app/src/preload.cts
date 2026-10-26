// Runs in the window before the page, sandboxed (so CommonJS): tells the page it runs in the app,
// and on which platform, so it can leave room for the window controls; and on macOS lets it show
// its menu as the application menu (see menu.ts), keep the display scale chosen (display.ts), and
// reach the host (host.ts).

// The CommonJS form of an import; verbatimModuleSyntax rules out `import … from` here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

// Kept in step with menu.ts, which a sandboxed preload can't import.
const SET_MENU = 'cerebro:menu:set';
const MENU_COMMAND = 'cerebro:menu:command';
// Kept in step with host.ts.
const HOST_REQUEST = 'cerebro:host:request';
// Kept in step with display.ts.
const SET_SCALE = 'cerebro:display:scale';

electron.contextBridge.exposeInMainWorld('cerebro', {
  app: true,
  platform: process.platform,
  display: {
    /** Keeps the display scale chosen for the next start: 'auto', or a factor such as '1.5'. */
    setScale: (choice: string) => {
      electron.ipcRenderer.send(SET_SCALE, choice);
    },
  },
  host: {
    /** Sends a request to the host; resolves with its result. */
    request: (method: string, params?: unknown): Promise<unknown> =>
      electron.ipcRenderer.invoke(HOST_REQUEST, method, params),
  },
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
