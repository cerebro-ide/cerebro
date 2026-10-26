// The desktop app end to end: the window, dialogs, popups, settings and shortcuts, as a user drives
// them. These are the flows checked by hand while building them.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;

beforeAll(async () => {
  running = await launch();
});

afterAll(async () => {
  await running.close();
});

beforeEach(async () => {
  await running.reset();
});

const page = () => running.page;
const count = (selector: string) => page().locator(selector).count();
const theme = () => page().evaluate(() => document.documentElement.dataset['cerebroTheme']);
const fontSize = () =>
  page()
    .locator('.playground-code')
    .first()
    .evaluate((code) => getComputedStyle(code).fontSize);
const branch = () => page().locator('[aria-label^="Branch:"]').getAttribute('aria-label');

describe('the window', () => {
  it('runs the page in the app, the toolbar being its title bar', async () => {
    const info = await page().evaluate(() => {
      const toolbar = document.querySelector('.cerebro-toolbar') as HTMLElement;
      // Not in TypeScript's DOM types yet.
      const overlay = (
        navigator as Navigator & {
          windowControlsOverlay: { visible: boolean; getTitlebarAreaRect(): DOMRect };
        }
      ).windowControlsOverlay;
      return {
        cerebro: (window as { cerebro?: { app: boolean } }).cerebro?.app,
        classes: document.documentElement.className,
        drag: getComputedStyle(toolbar).getPropertyValue('app-region'),
        paddingLeft: getComputedStyle(toolbar).paddingLeft,
        paddingRight: getComputedStyle(toolbar).paddingRight,
        overlay: overlay.visible ? overlay.getTitlebarAreaRect() : undefined,
        width: window.innerWidth,
      };
    });
    expect(info.cerebro).toBe(true);
    expect(info.classes).toContain('cerebro-app');
    expect(info.classes).toContain(`cerebro-platform-${process.platform}`);
    expect(info.drag).toBe('drag');
    if (process.platform === 'darwin') {
      // The traffic lights are at the left.
      expect(info.paddingLeft).toBe('80px');
    } else {
      // The window controls are drawn over the right of the toolbar, which leaves them room.
      const rect = info.overlay as DOMRect;
      const controls = info.width - rect.x - rect.width;
      expect(controls).toBeGreaterThan(0);
      expect(info.paddingRight).toBe(`${String(controls + 6)}px`);
    }
  });

  it('opens no other windows', async () => {
    const opened = await page().evaluate(() => window.open('https://example.com') === null);
    expect(opened).toBe(true);
    expect(running.app.windows()).toHaveLength(1);
  });
});

describe('dialogs', () => {
  it('creates a branch from the branch picker, refusing one that exists', async () => {
    await page().locator('[aria-label^="Branch:"]').click();
    await page().locator('.cerebro-popup-item', { hasText: 'New Branch' }).click();
    await page().keyboard.type('main');
    await expect
      .poll(() => page().locator('.cerebro-dialog-field__error').textContent())
      .toBe('Branch main exists');
    await page().keyboard.press('Enter');
    expect(await count('.cerebro-dialog')).toBe(1);
    await page().keyboard.type('-e2e');
    await page().keyboard.press('Enter');
    expect(await count('.cerebro-dialog')).toBe(0);
    expect(await branch()).toBe('Branch: main-e2e');
  });

  it('keeps the app’s shortcuts and menu bar from running behind a dialog', async () => {
    await page().locator('[aria-label^="Branch:"]').click();
    await page().locator('.cerebro-popup-item', { hasText: 'New Branch' }).click();
    await page().keyboard.press('Alt+F');
    await page().keyboard.press('Control+Shift+N');
    expect(await count('.cerebro-menu')).toBe(0);
    expect(await count('.cerebro-popup')).toBe(0);
    await page().keyboard.press('Escape');
    expect(await count('.cerebro-dialog')).toBe(0);
    await page().keyboard.press('Control+Shift+N');
    expect(await count('.cerebro-popup')).toBe(1);
  });
});

describe('popups', () => {
  it('goes to a file', async () => {
    await page().keyboard.press('Control+Shift+N');
    await page().keyboard.type('layout');
    await page().keyboard.press('Enter');
    // The status bar names the active file.
    expect(await page().locator('.cerebro-statusbar').textContent()).toContain('src/layout.ts');
  });

  it('searches everywhere and runs an action, the theme staying after a reload', async () => {
    expect(await theme()).toBe('dark');
    await page().keyboard.press('Control+Shift+A');
    await page().keyboard.type('dark theme');
    await page().keyboard.press('Enter');
    expect(await theme()).toBe('light');
    await page().reload();
    await page().waitForSelector('.cerebro-toolbar');
    expect(await theme()).toBe('light');
  });
});

describe('settings', () => {
  it('applies a worktree’s setting, saved across a reload, overriding the repository', async () => {
    expect(await fontSize()).toBe('13px');
    await page().keyboard.press('Control+Alt+S');
    await page().locator('[data-page="editor/font"]').click();
    await page().locator('[data-scope="worktree"]').click();
    await page().locator('[data-setting="editor.fontSize"] input').fill('18');
    await page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    expect(await fontSize()).toBe('18px');
    await page().reload();
    await page().waitForSelector('.cerebro-toolbar');
    expect(await fontSize()).toBe('18px');
    await page().keyboard.press('Control+Alt+S');
    await page().locator('[data-page="editor/font"]').click();
    await page().locator('[data-scope="repo"]').click();
    expect(await page().locator('[data-setting="editor.fontSize"]').textContent()).toContain(
      'Overridden in Worktree',
    );
  });
});

describe('shortcuts', () => {
  it('runs a sequence, and abandons one left waiting', async () => {
    await page().keyboard.press('Control+K');
    await page().keyboard.press('Control+T');
    expect(await theme()).toBe('light');
    await page().keyboard.press('Control+K');
    await page().waitForTimeout(2500);
    await page().keyboard.press('Control+T');
    expect(await theme()).toBe('light');
  });

  it('shows no tooltip over the menu the ☰ button opens', async () => {
    const button = page().locator('.cerebro-menubar__button');
    await button.hover();
    await button.click();
    expect(await count('.cerebro-menu')).toBe(1);
    await page().waitForTimeout(1000);
    expect(await count('.cerebro-tooltip')).toBe(0);
  });
});
