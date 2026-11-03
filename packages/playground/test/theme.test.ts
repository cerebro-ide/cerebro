import '@cerebro-ide/theme/themes.css';
import type { Settings } from '@cerebro-ide/settings';
import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { applyTheme, themeIsDark } from '../src/theme.js';

afterEach(() => {
  delete window.cerebro;
});

function settings(values: Record<string, unknown>): Settings {
  return { get: (id: string) => values[id] } as unknown as Settings;
}

describe('the theme', () => {
  it('is the one chosen, dark unless light', () => {
    expect(themeIsDark(settings({ 'appearance.theme': 'light' }))).toBe(false);
    expect(themeIsDark(settings({ 'appearance.theme': 'dark' }))).toBe(true);
  });

  it('is the system’s with Sync with OS, as it changes', async () => {
    const synced = settings({ 'appearance.syncWithOs': true, 'appearance.theme': 'light' });
    await commands.colorScheme('dark');
    await expect.poll(() => themeIsDark(synced)).toBe(true);
    await commands.colorScheme('light');
    await expect.poll(() => themeIsDark(synced)).toBe(false);
  });

  it('shows on the page, and colours the app’s window as it', () => {
    const colours: string[][] = [];
    window.cerebro = {
      window: { setColours: (...args: string[]) => colours.push(args) },
    } as unknown as NonNullable<Window['cerebro']>;
    applyTheme(false);
    expect(document.documentElement.dataset['cerebroTheme']).toBe('light');
    applyTheme(true);
    expect(document.documentElement.dataset['cerebroTheme']).toBe('dark');
    expect(colours).toHaveLength(2);
    expect(colours[0]?.every((c) => c !== '')).toBe(true);
    expect(colours[0]).not.toEqual(colours[1]);
  });

  it('shows on the page in a browser, without the app', () => {
    applyTheme(true);
    expect(document.documentElement.dataset['cerebroTheme']).toBe('dark');
  });
});
