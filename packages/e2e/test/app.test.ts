// The desktop app end to end: the window, dialogs, popups, settings and shortcuts, as a user drives
// them. These are the flows checked by hand while building them.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP, KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-app-')));
const repo = join(root, 'project');
/** A second worktree, on its own branch. */
const other = join(root, 'project-agent');

beforeAll(async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'layout.ts'), 'export const layout = {};\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  git('worktree', 'add', '-q', '-b', 'feat/agent', other);
  running = await launch({ CEREBRO_REPO: repo });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await running.reset();
});

const page = () => running.page;
const count = (selector: string) => page().locator(selector).count();
const theme = () => page().evaluate(() => document.documentElement.dataset['cerebroTheme']);
const fontSize = () =>
  page()
    .locator('.cm-scroller')
    .first()
    .evaluate((code) => getComputedStyle(code).fontSize);
/** Opens src/layout.ts with Go to File. */
async function openLayout(): Promise<void> {
  await page().keyboard.press(KEYS.goToFile);
  await page().keyboard.type('layout');
  await page().locator('.cerebro-popup-item', { hasText: 'layout.ts' }).waitFor();
  await page().keyboard.press('Enter');
}
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
      expect(info.paddingRight).toBe(`${String(controls + 5)}px`);
    }
  });

  it('has a Content-Security-Policy that nothing it does breaks', async () => {
    expect(
      await page().locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
    ).toContain("script-src 'self'");
    // Electron warns at load about a page without one.
    expect(running.messages.filter((m) => m.includes('Content-Security-Policy'))).toEqual([]);
    await page().evaluate(() => {
      const seen: string[] = [];
      (window as { violations?: string[] }).violations = seen;
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(`${event.violatedDirective}: ${event.blockedURI}`);
      });
    });
    // Each opens something; each is seen open, then closed, before the next. (macOS has no menu
    // bar in the window: its menu is the system's.)
    for (const [keys, opens] of [
      ['ControlOrMeta+Shift+A', '.cerebro-popup'],
      [KEYS.goToFile, '.cerebro-popup'],
      [KEYS.settings, '.cerebro-dialog'],
      ...(process.platform === 'darwin' ? [] : [['Alt+F', '.cerebro-menu']]),
    ] as const) {
      await page().keyboard.press(keys);
      await page().locator(opens).waitFor();
      await page().keyboard.press('Escape');
      await page().locator(opens).waitFor({ state: 'detached' });
    }
    await page().locator('.cerebro-menubar--takeover').waitFor({ state: 'detached' });
    // Forced: in CI under xvfb these clicks waited forever for the button, then the item, to be
    // "stable", which Playwright measures over animation frames (not reproduced locally, even
    // under xvfb).
    await page().locator('[aria-label^="Branch:"]').click({ force: true });
    await page().locator('.cerebro-popup-item', { hasText: 'New Branch' }).click({ force: true });
    await page().keyboard.press('Escape');
    expect(await page().evaluate(() => (window as { violations?: string[] }).violations)).toEqual(
      [],
    );
  });

  // macOS draws its own traffic lights.
  it.skipIf(process.platform === 'darwin')(
    'draws the window controls in the theme’s colours',
    async () => {
      // What the window's controls are given, from now on.
      await running.app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0] as Electron.BrowserWindow;
        const given: unknown[] = [];
        (globalThis as { overlays?: unknown[] }).overlays = given;
        const set = window.setTitleBarOverlay.bind(window);
        window.setTitleBarOverlay = (options) => {
          given.push(options);
          set(options);
        };
      });
      const overlays = () =>
        running.app.evaluate(() => (globalThis as { overlays?: unknown[] }).overlays);
      await page().keyboard.press(KEYS.darkTheme);
      await expect.poll(overlays).toEqual([{ color: '#e8eaee', symbolColor: '#1e1f22' }]);
      await page().keyboard.press(KEYS.darkTheme);
      await expect.poll(overlays).toContainEqual({ color: '#25282c', symbolColor: '#d1d3d9' });
    },
  );

  // Only macOS hides its window buttons in full screen. The pointer over them, which shows close
  // and zoom as themselves, can't be driven from here: it's macOS's own mouse.
  it.runIf(process.platform === 'darwin')(
    'keeps the window’s buttons in full screen, as IntelliJ: real ones, where they were',
    async () => {
      const fullScreen = (value?: boolean) =>
        running.app.evaluate(({ BrowserWindow }, value) => {
          const window = BrowserWindow.getAllWindows()[0] as Electron.BrowserWindow;
          if (value !== undefined) window.setFullScreen(value);
          return window.isFullScreen();
        }, value);
      /** The buttons in the window, from the native module's own report. */
      const buttons = () =>
        running.app.evaluate(
          ({ BrowserWindow }, module) => {
            const window = BrowserWindow.getAllWindows()[0] as Electron.BrowserWindow;
            const loaded = { exports: {} as { state(handle: Buffer): unknown } };
            process.dlopen(loaded, module);
            return loaded.exports.state(window.getNativeWindowHandle());
          },
          join(APP, 'dist', 'fullscreen.node'),
        );
      expect(await buttons()).toBeNull();
      await fullScreen(true);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(true);
      await expect.poll(buttons, { timeout: 15_000 }).not.toBeNull();
      const shown = (await buttons()) as {
        class: string;
        hidden: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
      }[];
      // For CI's log.
      console.log('Full-screen buttons:', JSON.stringify(shown));
      // AppKit's own close, minimize and zoom buttons (their classes, as seen on CI's macOS), grey
      // until the pointer is over them.
      expect(shown.map((button) => button.class)).toEqual([
        '_NSThemeCloseWidget',
        '_NSThemeWidget',
        '_NSThemeZoomWidget',
      ]);
      expect(shown.every((button) => button.hidden)).toBe(true);
      // Where the traffic lights sit out of full screen (window.ts).
      expect(shown[0]).toMatchObject({ x: 14, y: 13 });
      await fullScreen(false);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(false);
      await expect.poll(buttons, { timeout: 15_000 }).toBeNull();
    },
  );

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
    await page().keyboard.press(KEYS.goToFile);
    expect(await count('.cerebro-menu')).toBe(0);
    expect(await count('.cerebro-popup')).toBe(0);
    await page().keyboard.press('Escape');
    expect(await count('.cerebro-dialog')).toBe(0);
    await page().keyboard.press(KEYS.goToFile);
    expect(await count('.cerebro-popup')).toBe(1);
  });
});

describe('popups', () => {
  it('goes to a file', async () => {
    await openLayout();
    // The status bar names the active file.
    expect(await page().locator('.cerebro-statusbar').textContent()).toContain('src/layout.ts');
  });

  it('searches everywhere and runs an action, the theme staying after a reload', async () => {
    expect(await theme()).toBe('dark');
    await page().keyboard.press('ControlOrMeta+Shift+A');
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
    await openLayout();
    expect(await fontSize()).toBe('13px');
    await page().keyboard.press(KEYS.settings);
    await page().locator('[data-page="editor/font"]').click();
    await page().locator('[data-scope="worktree"]').click();
    await page().locator('[data-setting="editor.fontSize"] input').fill('18');
    await page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    expect(await fontSize()).toBe('18px');
    await page().reload();
    await page().waitForSelector('.cerebro-toolbar');
    expect(await fontSize()).toBe('18px');
    await page().keyboard.press(KEYS.settings);
    await page().locator('[data-page="editor/font"]').click();
    await page().locator('[data-scope="repo"]').click();
    expect(await page().locator('[data-setting="editor.fontSize"]').textContent()).toContain(
      'Overridden in Worktree',
    );
  });

  it('chooses Islands Dark or Light in Appearance, or follows the system with Sync with OS', async () => {
    const appearance = async () => {
      await page().keyboard.press(KEYS.settings);
      await page().locator('[data-page="appearance"]').click();
      await page().locator('[data-scope="global"]').click();
    };
    const ok = () => page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    await appearance();
    const row = page().locator('[data-setting="appearance.theme"] .cerebro-setting__row');
    expect(await row.locator('option').allTextContents()).toEqual([
      'Islands Dark',
      'Islands Light',
    ]);
    await row.locator('select').selectOption({ label: 'Islands Light' });
    // Sync with OS is on the Theme's row, as IntelliJ's.
    await row.getByText('Sync with OS').click();
    await page().emulateMedia({ colorScheme: 'dark' });
    await ok();
    await expect.poll(theme).toBe('dark');
    await page().emulateMedia({ colorScheme: 'light' });
    await expect.poll(theme).toBe('light');
    await page().emulateMedia({ colorScheme: 'dark' });
    await expect.poll(theme).toBe('dark');
    // Off: the theme chosen again.
    await appearance();
    await row.getByText('Sync with OS').click();
    await ok();
    await expect.poll(theme).toBe('light');
    await page().emulateMedia({ colorScheme: null });
    // Dark again, for the tests after.
    await appearance();
    await row.locator('select').selectOption({ label: 'Islands Dark' });
    await ok();
    await expect.poll(theme).toBe('dark');
  });
});

describe('plugins', () => {
  it('shows a plugin’s view, and runs its command from search and from its shortcut', async () => {
    const notes = () => page().locator('.playground-view li').allTextContents();
    await page().locator('.cerebro-stripe-button[data-id="notes"]').click();
    const input = page().locator('.playground-notes__input');
    await input.click();
    await page().keyboard.type('first');
    await page().keyboard.press('Enter');
    await page().keyboard.type('second');
    await page().keyboard.press('Enter');
    expect(await notes()).toEqual(['first', 'second']);
    await page().keyboard.press('ControlOrMeta+Shift+A');
    await page().keyboard.type('clear notes');
    await page().keyboard.press('Enter');
    expect(await notes()).toEqual([]);
    await input.click();
    await page().keyboard.type('third');
    await page().keyboard.press('Enter');
    // Out of the field, so the shortcut reaches the app.
    await page().locator('.cerebro-statusbar').click();
    await page().keyboard.press('ControlOrMeta+Alt+Shift+K');
    expect(await notes()).toEqual([]);
  });
});

describe('the layout', () => {
  /** What the window shows: open tool windows, environment tabs, the active one and its file. */
  const snapshot = () =>
    page().evaluate(() => ({
      tools: [...document.querySelectorAll('.cerebro-stripe-button[aria-pressed="true"]')].map(
        (b) => (b as HTMLElement).dataset['id'],
      ),
      envs: [...document.querySelectorAll('.cerebro-env-tab')].map(
        (t) => (t as HTMLElement).dataset['env'],
      ),
      active: document.querySelector<HTMLElement>('.cerebro-env-tab--active')?.dataset['env'],
      file: document.querySelector('.cerebro-statusbar')?.textContent,
    }));

  it('is as it was left after a reload', async () => {
    // Rearranged: Project closed, Git opened, another environment, a file opened in it.
    await page().locator('.cerebro-stripe-button[data-id="project"]').click();
    await page().locator('.cerebro-stripe-button[data-id="git"]').click();
    await page().locator('[aria-label^="Worktree:"]').click();
    await page().locator('.cerebro-popup-item', { hasText: 'project-agent' }).click();
    await openLayout();
    const before = await snapshot();
    expect(before.tools).not.toContain('project');
    expect(before.tools).toContain('git');
    // Environments are known by their worktree's path, as git writes it.
    expect(before.envs).toEqual([repo, other].map((p) => p.replaceAll('\\', '/')));
    expect(before.file).toContain('src/layout.ts');
    await page().reload();
    await page().waitForSelector('.cerebro-toolbar');
    expect(await snapshot()).toEqual(before);
  });
});

describe('shortcuts', () => {
  /** Chooses a keymap in Settings → Keymap. */
  const useKeymap = async (label: string, settings: string = KEYS.settings) => {
    await page().keyboard.press(settings);
    await page().locator('[data-page="keymap"]').click();
    await page().locator('[data-setting="keymap"] select').selectOption({ label });
    await page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
  };

  it('takes VS Code’s keys, its sequences included, when its keymap is chosen', async () => {
    const mac = process.platform === 'darwin';
    await useKeymap(mac ? 'VS Code (macOS)' : 'VS Code');
    // Go to File is VS Code's; IntelliJ's no longer is.
    await page().keyboard.press(mac ? 'Meta+P' : 'Control+P');
    await page().locator('.cerebro-popup').waitFor();
    await page().keyboard.press('Escape');
    // Dark Theme: a sequence, then one left waiting is abandoned.
    const chord = mac ? 'Meta' : 'Control';
    await page().keyboard.press(`${chord}+K`);
    await page().keyboard.press(`${chord}+T`);
    expect(await theme()).toBe('light');
    await page().keyboard.press(`${chord}+K`);
    await page().waitForTimeout(2500);
    await page().keyboard.press(`${chord}+T`);
    expect(await theme()).toBe('light');
    // That T, alone, is VS Code's Go to Symbol: its popup closes.
    await page().keyboard.press('Escape');
    // Back, through VS Code's Settings key.
    await useKeymap(mac ? 'IntelliJ IDEA (macOS)' : 'IntelliJ IDEA', `${chord}+Comma`);
  });

  // macOS shows the menu in the system's menu bar, not behind a ☰ button.
  it.skipIf(process.platform === 'darwin')(
    'shows no tooltip over the menu the ☰ button opens',
    async () => {
      const button = page().locator('.cerebro-menubar__button');
      await button.hover();
      await button.click();
      expect(await count('.cerebro-menu')).toBe(1);
      await page().waitForTimeout(1000);
      expect(await count('.cerebro-tooltip')).toBe(0);
    },
  );
});
