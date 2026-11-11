// The Electron main process: a window per project showing Cerebro's UI, or the Welcome window (see
// projects.ts). In development it loads the dev server's URL (CEREBRO_DEV_URL); otherwise the built
// page. Windows open no other windows and navigate nowhere else.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  screen,
  type OpenDialogOptions,
  type WebContents,
} from 'electron';
import { fileURLToPath } from 'node:url';
import { watchEventLoop } from '@cerebro-ide/host/slow';
import { installWindowColours } from './colours.js';
import { installFullScreen } from './fullscreen.js';
import { diffHash, installDiffWindows, windowOf, type DiffSpec } from './diff-windows.js';
import { installDisplayScale, zoomFor } from './display.js';
import { installHosts, type Hosts } from './host.js';
import { handle } from './ipc.js';
import { logPage, PAGE_LOG, writeLog } from './log.js';
import { installMenu } from './menu.js';
import { installPasswords, PasswordStore } from './passwords.js';
import { installReveal } from './reveal.js';
import { ProjectStore, ProjectWindows, projectName, type ProjectWindow } from './projects.js';
import { sizeFrom, WELCOME_SIZE, windowOptions } from './window.js';

/** The built UI, relative to this file once compiled to dist/. */
const PAGE = fileURLToPath(new URL('../../playground/dist/index.html', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));

/** The display scale forced at the start, if any. */
let forcedScale: number | undefined;

/**
 * Keeps a window's contents on its own pages: no new windows, no navigation elsewhere. (A file
 * URL's origin is "null", as is a data URL's, so files are matched by protocol instead.)
 */
export function confine(contents: WebContents, allowed: (url: URL) => boolean): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!allowed(new URL(url))) event.preventDefault();
  });
}

export const PROJECT_CURRENT = 'cerebro:project:current';
export const PROJECT_RECENT = 'cerebro:project:recent';
export const PROJECT_PICK = 'cerebro:project:pick';
export const PROJECT_OPEN = 'cerebro:project:open';
export const PROJECT_CLOSE = 'cerebro:project:close';
export const PROJECT_FORGET = 'cerebro:project:forget';

/** Loads a window's page: the dev server's, or the built one; with a hash, what it's to show. */
async function load(
  window: BrowserWindow,
  devUrl: string | undefined,
  zoom: number | undefined,
  hash: string | undefined,
) {
  if (devUrl) {
    const origin = new URL(devUrl).origin;
    confine(window.webContents, (url) => url.origin === origin);
    await window.loadURL(hash === undefined ? devUrl : `${devUrl}#${hash}`);
  } else {
    confine(window.webContents, (url) => url.protocol === 'file:');
    await window.loadFile(PAGE, hash === undefined ? undefined : { hash });
  }
  // Again once loaded: a zoom kept from the last run overrides the window's zoomFactor (measured in
  // CI on macOS: 1.25 after going back to Auto, with zoomFactor 1).
  if (zoom !== undefined) window.webContents.setZoomFactor(zoom);
}

/**
 * A window showing the UI, for a project or, smaller, the Welcome window, or with `hash`, a diff
 * window; `loaded` settles once its page has loaded.
 */
export function createWindow(
  welcome = false,
  devUrl = process.env['CEREBRO_DEV_URL'],
  size = sizeFrom(process.env['CEREBRO_WINDOW_SIZE']),
  hash?: string,
): { window: BrowserWindow; loaded: Promise<void> } {
  const zoom = zoomFor(forcedScale, process.platform, screen.getPrimaryDisplay().scaleFactor);
  const window = new BrowserWindow(
    windowOptions(process.platform, PRELOAD, zoom, welcome ? WELCOME_SIZE : size),
  );
  window.once('ready-to-show', () => {
    window.show();
  });
  return { window, loaded: load(window, devUrl, zoom, hash) };
}

/** A diff window's size to start with (a claim: IntelliJ keeps the size its diff window was left at). */
export const DIFF_SIZE = { width: 1100, height: 750 };

/** A diff window, its page logged as a project window's. */
export function diffWindow(spec: DiffSpec): ReturnType<typeof windowOf> {
  const { window, loaded } = createWindow(false, undefined, DIFF_SIZE, diffHash(spec));
  const log = join(app.getPath('userData'), PAGE_LOG);
  logPage(window.webContents, log);
  loaded.catch((error: unknown) => {
    console.error('The diff window could not load', error);
  });
  return windowOf(window.webContents);
}

/** How long a page gets to save its files before its window closes anyway. */
export const SAVE_TIMEOUT = 5000;

/** Whether the app is quitting: a window that held its closing back to save quits it again. */
let quitting = false;

/**
 * Has a page save its unsaved files (the page's `cerebroSaveAll`, which the Welcome window hasn't),
 * waiting at most SAVE_TIMEOUT; never fails.
 */
export function saveFiles(contents: WebContents, timeout = SAVE_TIMEOUT): Promise<void> {
  const saving = contents.executeJavaScript('globalThis.cerebroSaveAll?.()').then(
    () => undefined,
    (error: unknown) => {
      console.error('The page could not save its files', error);
    },
  );
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.error('The page took too long to save its files');
      resolve();
    }, timeout);
  });
  return Promise.race([saving, late]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * A new window as projects see it; its page loads in the background, and what goes wrong in it is
 * logged to PAGE_LOG in the app's data folder.
 */
export function projectWindow(welcome: boolean): ProjectWindow {
  const { window, loaded } = createWindow(welcome);
  const contents = window.webContents;
  const log = join(app.getPath('userData'), PAGE_LOG);
  logPage(contents, log);
  loaded.catch((error: unknown) => {
    console.error('The window could not load', error);
    writeLog(log, String(contents.id), `could not load: ${String(error)}`);
  });
  const closed: (() => void)[] = [];
  let open = true;
  // The page saves its files first: the close waits for it, then happens again.
  let saved = false;
  window.on('close', (event) => {
    if (saved) return;
    event.preventDefault();
    void saveFiles(contents).then(() => {
      saved = true;
      if (quitting) app.quit();
      else window.close();
    });
  });
  window.on('closed', () => {
    open = false;
    for (const listener of closed) listener();
  });
  return {
    id: contents.id,
    send: (channel, ...args) => {
      if (open) contents.send(channel, ...args);
    },
    focus: () => {
      if (!open) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    },
    close: () => {
      if (open) window.close();
    },
    onClosed: (listener) => {
      closed.push(listener);
    },
  };
}

const isFolder = (path: string) => existsSync(path) && statSync(path).isDirectory();

/** Lets pages ask which projects they show, list and open projects, and close theirs. */
export function installProjects(hosts: Hosts, store: ProjectStore): ProjectWindows {
  const windows = new ProjectWindows({
    store,
    hosts,
    create: projectWindow,
    exists: isFolder,
  });
  const text = (value: unknown, name: string): string => {
    if (typeof value !== 'string' || value === '') throw new Error(`${name} must be a path`);
    return value;
  };
  handle(PROJECT_CURRENT, (event) =>
    windows.projectsOf(event.sender.id).map((path) => ({ path, name: projectName(path) })),
  );
  handle(PROJECT_RECENT, () =>
    store.recent.map((recent) => ({ ...recent, exists: isFolder(recent.path) })),
  );
  handle(PROJECT_PICK, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Open',
      properties: ['openDirectory', 'createDirectory'],
    };
    const picked = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  handle(PROJECT_OPEN, (event, path: unknown, where: unknown, replacing: unknown) => {
    if (where !== 'this' && where !== 'new') throw new Error('where must be "this" or "new"');
    windows.open(
      text(path, 'path'),
      where,
      event.sender.id,
      replacing === undefined ? undefined : text(replacing, 'replacing'),
    );
  });
  handle(PROJECT_CLOSE, (event, path: unknown) => {
    windows.close(event.sender.id, text(path, 'path'));
  });
  handle(PROJECT_FORGET, (_event, path: unknown) => {
    store.forget(text(path, 'path'));
  });
  app.on('before-quit', () => {
    quitting = true;
    windows.quit();
  });
  return windows;
}

/**
 * Starts the app: at the display scale chosen, the project CEREBRO_REPO names, else the projects
 * open when it last quit, else the Welcome window; on macOS the application menu from the page,
 * and when re-activated without windows, the same again. `userData` replaces the folder the app
 * keeps its data in.
 */
export function start(userData = process.env['CEREBRO_USER_DATA']): void {
  // Somewhere else for the app's data, such as a throwaway folder for end-to-end tests.
  if (userData) app.setPath('userData', userData);
  // Before the app is ready: Chromium fixes the scale when it starts.
  forcedScale = installDisplayScale();
  installMenu();
  installWindowColours();
  installReveal();
  installFullScreen();
  // Its main process held up is reported, as the host's is: a stall's cause (the backlog).
  watchEventLoop("the app's");
  const hosts = installHosts();
  installDiffWindows(hosts, diffWindow);
  // Empty is unset: a test or a shell can clear it without removing it.
  const repo = process.env['CEREBRO_REPO'] || undefined;
  let windows: ProjectWindows | undefined;
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) windows?.start(repo);
  });
  void app.whenReady().then(() => {
    windows = installProjects(
      hosts,
      new ProjectStore(join(app.getPath('userData'), 'projects.json')),
    );
    // Once ready: the keychain isn't known before (safeStorage's documentation).
    installPasswords(new PasswordStore(join(app.getPath('userData'), 'passwords.json')));
    windows.start(repo);
  });
}
