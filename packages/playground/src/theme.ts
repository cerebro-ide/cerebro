// The theme on the page, and the window's own colours with it: its background, in the app on
// Windows and Linux the window controls drawn over the toolbar, and on macOS the grey of the window
// buttons in full screen, which the page's CSS can't reach.

/** Shows the dark or light theme, and colours the window as it. */
export function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  root.dataset['cerebroTheme'] = dark ? 'dark' : 'light';
  const style = getComputedStyle(root);
  const colour = (name: string) => style.getPropertyValue(name).trim();
  window.cerebro?.window.setColours(
    colour('--cerebro-frame'),
    colour('--cerebro-text'),
    colour('--cerebro-fullscreen-button'),
  );
}
