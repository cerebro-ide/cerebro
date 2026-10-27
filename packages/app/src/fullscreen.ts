// Full screen on macOS hides the traffic lights until the pointer reaches the top of the screen;
// IntelliJ keeps them where they were (JetBrains Runtime puts real ones in the window), and so does
// Cerebro, with the native module built from native/fullscreen.m. Electron has no option for it: it
// leaves the buttons to macOS in full screen (native_window_mac.mm).

import { createRequire } from 'node:module';
import { app, type BrowserWindow } from 'electron';

/** The native module's functions; a window is given as its getNativeWindowHandle(). */
export interface Buttons {
  /** Puts the buttons in the window, grey in the colour given (#rrggbb) until hovered. */
  show(handle: Buffer, colour: string): boolean;
  /** Takes them out. */
  hide(handle: Buffer): boolean;
  /** Greys them in another colour. */
  colour(handle: Buffer, colour: string): boolean;
}

/** The dark theme's grey, until the page gives its theme's (--cerebro-fullscreen-button). */
const GREY = '#575a5c';

/** Each window's grey, as its page's theme. */
const greys = new WeakMap<BrowserWindow, string>();
let installed: Buttons | undefined;

/** Loads the native module, built next to this file (scripts/native.mjs). */
export function loadButtons(): Buttons {
  return createRequire(import.meta.url)('./fullscreen.node') as Buttons;
}

/** On macOS, keeps every window's buttons in full screen. */
export function installFullScreen(
  platform: NodeJS.Platform = process.platform,
  load: () => Buttons = loadButtons,
): void {
  if (platform !== 'darwin') return;
  const buttons = load();
  installed = buttons;
  app.on('browser-window-created', (_event, window) => {
    window.on('enter-full-screen', () => {
      buttons.show(window.getNativeWindowHandle(), greys.get(window) ?? GREY);
    });
    window.on('leave-full-screen', () => {
      buttons.hide(window.getNativeWindowHandle());
    });
  });
}

/** Greys a window's full-screen buttons as its page's theme (colours.ts). */
export function greyFullScreenButtons(window: BrowserWindow, colour: string): void {
  greys.set(window, colour);
  installed?.colour(window.getNativeWindowHandle(), colour);
}
