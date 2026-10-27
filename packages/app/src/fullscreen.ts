// Full screen on macOS hides the traffic lights until the pointer reaches the top of the screen;
// IntelliJ keeps buttons there (JetBrains Runtime draws its own), and so does the page. Each page
// hears when its window enters or leaves full screen, and its buttons close the window or leave
// full screen.

import { app, BrowserWindow, ipcMain } from 'electron';

export const FULL_SCREEN = 'cerebro:window:full-screen';
export const LEAVE_FULL_SCREEN = 'cerebro:window:leave-full-screen';
export const CLOSE_WINDOW = 'cerebro:window:close';

/** Tells pages whether their window is full screen, and lets them leave it or close the window. */
export function installFullScreen(): void {
  app.on('browser-window-created', (_event, window) => {
    const send = () => {
      window.webContents.send(FULL_SCREEN, window.isFullScreen());
    };
    window.on('enter-full-screen', send);
    window.on('leave-full-screen', send);
    // A page loaded again starts over.
    window.webContents.on('did-finish-load', send);
  });
  ipcMain.on(LEAVE_FULL_SCREEN, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(false);
  });
  // Closing as the OS's button does: the page saves first (main.ts).
  ipcMain.on(CLOSE_WINDOW, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
