// The theme on the page, and the window's own colours with it: its background, in the app on
// Windows and Linux the window controls drawn over the toolbar, and on macOS the grey of the window
// buttons in full screen, which the page's CSS can't reach.

import { signal } from '@cerebro-ide/reactive';
import type { Settings } from '@cerebro-ide/settings';

const system = window.matchMedia('(prefers-color-scheme: dark)');
/** Whether the system's appearance is dark, as it changes. */
const systemDark = signal(system.matches);
system.addEventListener('change', (event) => {
  systemDark.set(event.matches);
});

/** Whether the theme is dark: the system's appearance with Sync with OS, else the one chosen. */
export function themeIsDark(settings: Settings): boolean {
  if (settings.get('appearance.syncWithOs') === true) return systemDark.get();
  return settings.get('appearance.theme') !== 'light';
}

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
