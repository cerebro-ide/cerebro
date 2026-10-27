// Runs in the window before the page, sandboxed (so CommonJS): tells the page it runs in the app,
// and on which platform, so it can leave room for the window controls; and on macOS lets it show
// its menu as the application menu (see menu.ts), keep the display scale chosen (display.ts), open
// and close projects (projects.ts), and reach its window's host (host.ts).

// The CommonJS form of an import; verbatimModuleSyntax rules out `import … from` here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import electron = require('electron');

// Kept in step with menu.ts, which a sandboxed preload can't import.
const SET_MENU = 'cerebro:menu:set';
const MENU_COMMAND = 'cerebro:menu:command';
// Kept in step with host.ts.
const HOST_REQUEST = 'cerebro:host:request';
const HOST_NOTIFICATION = 'cerebro:host:notification';
// Kept in step with display.ts.
const SET_SCALE = 'cerebro:display:scale';
// Kept in step with colours.ts.
const SET_COLOURS = 'cerebro:window:colours';
// Kept in step with main.ts.
const PROJECT_CURRENT = 'cerebro:project:current';
const PROJECT_RECENT = 'cerebro:project:recent';
const PROJECT_PICK = 'cerebro:project:pick';
const PROJECT_OPEN = 'cerebro:project:open';
const PROJECT_CLOSE = 'cerebro:project:close';
const PROJECT_FORGET = 'cerebro:project:forget';

electron.contextBridge.exposeInMainWorld('cerebro', {
  app: true,
  platform: process.platform,
  display: {
    /** Keeps the display scale chosen for the next start: 'auto', or a factor such as '1.5'. */
    setScale: (choice: string) => {
      electron.ipcRenderer.send(SET_SCALE, choice);
    },
  },
  window: {
    /** Colours the window (its background, and its controls on Windows and Linux) as the theme. */
    setColours: (frame: string, text: string) => {
      electron.ipcRenderer.send(SET_COLOURS, frame, text);
    },
  },
  project: {
    /** The project this window shows, or null in the Welcome window. */
    current: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_CURRENT),
    /** The projects opened recently, the latest first, each saying whether it's still there. */
    recent: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_RECENT),
    /** Asks for a folder with the system's dialog; null if none was chosen. */
    pick: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_PICK),
    /** Opens a project in this window or a new one. */
    open: (path: string, where: 'this' | 'new'): Promise<unknown> =>
      electron.ipcRenderer.invoke(PROJECT_OPEN, path, where),
    /** Closes this window's project. */
    close: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_CLOSE),
    /** Removes a project from the recent ones. */
    forget: (path: string): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_FORGET, path),
  },
  host: {
    /** Sends a request to the host; resolves with its result. */
    request: (method: string, params?: unknown): Promise<unknown> =>
      electron.ipcRenderer.invoke(HOST_REQUEST, method, params),
    /** Calls `listener` with each notification from the host; returns a function that stops it. */
    onNotification: (listener: (method: string, params: unknown) => void) => {
      const handler = (_event: unknown, method: unknown, params: unknown) => {
        if (typeof method === 'string') listener(method, params);
      };
      electron.ipcRenderer.on(HOST_NOTIFICATION, handler);
      return () => {
        electron.ipcRenderer.off(HOST_NOTIFICATION, handler);
      };
    },
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
