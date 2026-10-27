// Runs in the window before the page, sandboxed (so CommonJS): tells the page it runs in the app,
// and on which platform, so it can leave room for the window controls; and on macOS lets it show
// its menu as the application menu (see menu.ts), keep the display scale chosen (display.ts), open
// and close projects (projects.ts), and reach its projects' hosts (host.ts).

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
// Kept in step with projects.ts.
const PROJECT_ADDED = 'cerebro:project:added';
const PROJECT_SHOW = 'cerebro:project:show';

/** Calls `listener` with each message on `channel`; returns a function that stops it. */
function listen(channel: string, listener: (...args: unknown[]) => void): () => void {
  const handler = (_event: unknown, ...args: unknown[]) => {
    listener(...args);
  };
  electron.ipcRenderer.on(channel, handler);
  return () => {
    electron.ipcRenderer.off(channel, handler);
  };
}

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
    /**
     * Colours the window as the theme: its background, its controls on Windows and Linux, and the
     * grey of its buttons in full screen on macOS.
     */
    setColours: (frame: string, text: string, fullScreenButtons: string) => {
      electron.ipcRenderer.send(SET_COLOURS, frame, text, fullScreenButtons);
    },
  },
  project: {
    /** The projects this window shows, in the order they were opened; none in the Welcome window. */
    current: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_CURRENT),
    /** The projects opened recently, the latest first, each saying whether it's still there. */
    recent: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_RECENT),
    /** Asks for a folder with the system's dialog; null if none was chosen. */
    pick: (): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_PICK),
    /**
     * Opens a project from this window: as more tabs ('new'), or in the place of its project
     * `replacing` ('this').
     */
    open: (path: string, where: 'this' | 'new', replacing?: string): Promise<unknown> =>
      electron.ipcRenderer.invoke(PROJECT_OPEN, path, where, replacing),
    /** Closes one of this window's projects; its last closes the window. */
    close: (path: string): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_CLOSE, path),
    /** Calls `listener` with each project that joins this window. */
    onAdded: (listener: (project: unknown) => void) => listen(PROJECT_ADDED, listener),
    /** Calls `listener` with a project of this window's asked to open again: show it. */
    onShow: (listener: (path: unknown) => void) => listen(PROJECT_SHOW, listener),
    /** Removes a project from the recent ones. */
    forget: (path: string): Promise<unknown> => electron.ipcRenderer.invoke(PROJECT_FORGET, path),
  },
  host: {
    /** Sends a request to a project's host; resolves with its result. */
    request: (project: string, method: string, params?: unknown): Promise<unknown> =>
      electron.ipcRenderer.invoke(HOST_REQUEST, project, method, params),
    /**
     * Calls `listener` with each notification from the hosts, with the project of the host it
     * came from; returns a function that stops it.
     */
    onNotification: (listener: (project: string, method: string, params: unknown) => void) =>
      listen(HOST_NOTIFICATION, (project, method, params) => {
        if (typeof project === 'string' && typeof method === 'string') {
          listener(project, method, params);
        }
      }),
  },
  menu: {
    set: (items: unknown) => {
      electron.ipcRenderer.send(SET_MENU, items);
    },
    onCommand: (listener: (command: string) => void) =>
      listen(MENU_COMMAND, (command) => {
        if (typeof command === 'string') listener(command);
      }),
  },
});
