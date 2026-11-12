// The desktop app end to end: the window, dialogs, popups, settings and shortcuts, as a user drives
// them. These are the flows checked by hand while building them.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP, findAction, KEYS, launch, type Running } from './app.js';

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
    await page().locator('[aria-label^="Branch:"]').click();
    try {
      await page().locator('.cerebro-popup-item', { hasText: 'New Branch' }).click();
    } catch (error) {
      // "Element is not visible" once on macOS in CI (#168, 2026-11-11), 10 ms after the item was
      // seen shown. The popup closes when the window loses the focus or is resized: what was there.
      console.log(
        'After the click failed:',
        await page().evaluate(() => ({
          popups: document.querySelectorAll('.cerebro-popup').length,
          items: [...document.querySelectorAll('.cerebro-popup-item')].map((item) => [
            item.textContent,
            JSON.stringify(item.getBoundingClientRect()),
          ]),
          focused: document.hasFocus(),
          size: [innerWidth, innerHeight],
        })),
      );
      throw error;
    }
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
      /** One of the native module's functions, on the window. */
      const native = (name: 'state' | 'press' | 'window', ...args: unknown[]) =>
        running.app.evaluate(
          ({ BrowserWindow }, [module, name, args]) => {
            const window = BrowserWindow.getAllWindows()[0] as Electron.BrowserWindow;
            type Call = (handle: Buffer, ...args: unknown[]) => unknown;
            const loaded = { exports: {} as Record<string, Call> };
            process.dlopen(loaded, module);
            return (loaded.exports[name] as Call)(window.getNativeWindowHandle(), ...args);
          },
          [join(APP, 'dist', 'fullscreen.node'), name, args] as const,
        );
      /** The buttons in the window, from the native module's own report. */
      const buttons = () => native('state');
      expect(await buttons()).toBeNull();
      await fullScreen(true);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(true);
      await expect.poll(buttons, { timeout: 15_000 }).not.toBeNull();
      const state = (await buttons()) as {
        buttons: {
          class: string;
          hidden: boolean;
          x: number;
          y: number;
          width: number;
          height: number;
        }[];
        reached: boolean;
      };
      // For CI's log.
      console.log('Full-screen buttons:', JSON.stringify(state));
      const shown = state.buttons;
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
      // A click on them reaches them, over the toolbar that drags the window.
      expect(state.reached).toBe(true);
      // The window's state at each step, for CI's log.
      const states: Record<string, unknown> = { inFullScreen: await native('window') };
      await fullScreen(false);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(false);
      await expect.poll(buttons, { timeout: 15_000 }).toBeNull();
      states.leftBySetFullScreen = await native('window');
      // Its green button leaves full screen, and the window shows as it did.
      await fullScreen(true);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(true);
      await expect.poll(buttons, { timeout: 15_000 }).not.toBeNull();
      expect(await native('press', 2)).toBe(true);
      await expect.poll(() => fullScreen(), { timeout: 15_000 }).toBe(false);
      await expect.poll(buttons, { timeout: 15_000 }).toBeNull();
      states.leftByGreenButton = await native('window');
      console.log('The window:', JSON.stringify(states));
      const shows = { visible: true, alpha: 1, contentHidden: false, frameHidden: false };
      expect(states).toEqual({
        inFullScreen: shows,
        leftBySetFullScreen: shows,
        leftByGreenButton: shows,
      });
    },
  );

  it('opens no other windows', async () => {
    const opened = await page().evaluate(() => window.open('https://example.com') === null);
    expect(opened).toBe(true);
    expect(running.app.windows()).toHaveLength(1);
  });
});

describe('dialogs', () => {
  it('creates a branch from the branches popup, refusing one that exists, and checks out another', async () => {
    await page().locator('[aria-label^="Branch:"]').click();
    await page().locator('.cerebro-popup-item', { hasText: 'New Branch' }).click();
    await page().keyboard.type('main');
    await expect
      .poll(() => page().locator('.cerebro-dialog-field__error').textContent())
      .toBe('Branch name main already exists. Change the name or overwrite existing branch');
    await page().keyboard.press('Enter');
    expect(await count('.cerebro-dialog')).toBe(1);
    await page().keyboard.type('-e2e');
    await page().keyboard.press('Enter');
    expect(await count('.cerebro-dialog')).toBe(0);
    // Made and checked out by git.
    await expect.poll(branch, { timeout: 15_000 }).toBe('Branch: main-e2e');
    // Back on main, for the tests after: from its row's menu.
    await page().locator('[aria-label^="Branch:"]').click();
    await page()
      .locator('.cerebro-popup-item', { hasText: /^main$/ })
      .click();
    await page().locator('.cerebro-menu-item', { hasText: 'Checkout' }).click();
    await expect.poll(branch, { timeout: 15_000 }).toBe('Branch: main');
    expect(await count('.cerebro-popup')).toBe(0);
  });

  it('makes a tag from Git → New Tag…, annotated by its message, refusing one that exists', async () => {
    // Someone to tag as: without, git refuses an annotated tag ("Committer identity unknown",
    // measured), and CI's git has no one.
    const config = (...args: string[]) =>
      execFileSync('git', ['config', ...args], { cwd: repo, stdio: 'pipe' });
    config('user.name', 't');
    config('user.email', 't@t');
    await findAction(page(), 'New Tag');
    const box = page().locator('.cerebro-dialog');
    await box.waitFor();
    expect(await box.locator('.cerebro-dialog__title').textContent()).toBe('Tag');
    await page().keyboard.type('v1-e2e');
    await box.locator('textarea').fill('The first');
    await box.locator('.cerebro-dialog__button', { hasText: 'Create Tag' }).click();
    expect(await count('.cerebro-dialog')).toBe(0);
    const tag = () =>
      execFileSync('git', ['for-each-ref', '--format=%(objecttype) %(contents)', 'refs/tags'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim();
    try {
      await expect.poll(tag, { timeout: 15_000 }).toBe('tag The first');
    } catch (error) {
      console.log('Balloons:', await page().locator('.cerebro-balloon').allTextContents());
      throw error;
    }
    // Taken now: only with Force. The dialog opens once the tags are read.
    await findAction(page(), 'New Tag');
    await box.waitFor();
    await page().keyboard.type('v1-e2e');
    await expect
      .poll(() => box.locator('.cerebro-dialog-field__error').textContent())
      .toBe('The tag with the same name exists.');
    await page().keyboard.press('Escape');
    execFileSync('git', ['tag', '-d', 'v1-e2e'], { cwd: repo, stdio: 'pipe' });
    config('--unset', 'user.name');
    config('--unset', 'user.email');
  });

  it('resets HEAD to a commit from Git → Reset HEAD…', async () => {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    const first = git('rev-parse', 'HEAD');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'second', '--allow-empty');
    await findAction(page(), 'Reset HEAD');
    const box = page().locator('.cerebro-dialog');
    await box.waitFor();
    expect(await box.locator('.cerebro-dialog__title').textContent()).toBe('Reset Head');
    await box.locator('input').fill('HEAD~1');
    await box.locator('.cerebro-dialog__button', { hasText: /^Reset$/ }).click();
    try {
      await expect.poll(() => git('rev-parse', 'HEAD'), { timeout: 15_000 }).toBe(first);
    } catch (error) {
      console.log('Balloons:', await page().locator('.cerebro-balloon').allTextContents());
      throw error;
    }
  });

  it('adds, renames and removes a remote from Git → Manage Remotes…', async () => {
    const remotes = () =>
      execFileSync('git', ['remote', '-v'], { cwd: repo, encoding: 'utf8' })
        .split('\n')
        .filter((line) => line.endsWith('(fetch)'))
        .map((line) => line.split('\t')[0]);
    const box = () => page().locator('.cerebro-dialog').last();
    await findAction(page(), 'Manage Remotes');
    const dialog = page().locator('.cerebro-dialog', {
      has: page().locator('.playground-remotes'),
    });
    await dialog.waitFor();
    // Added: the other worktree's repository, which answers git's ls-remote.
    await dialog.locator('button[aria-label="Add"]').click();
    await expect
      .poll(() => box().locator('.cerebro-dialog__title').textContent())
      .toBe('Define Remote');
    await box().locator('input[type="text"]').nth(1).fill(other);
    await box().locator('input[type="checkbox"]').uncheck();
    await box().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    try {
      await expect.poll(remotes, { timeout: 15_000 }).toEqual(['origin']);
    } catch (error) {
      console.log('Dialogs:', await page().locator('.cerebro-dialog').allTextContents());
      throw error;
    }
    await expect.poll(() => dialog.locator('.playground-remotes__row').count()).toBe(1);
    // Renamed, from the row.
    await dialog.locator('.playground-remotes__row').dblclick();
    await box().locator('input[type="text"]').first().fill('upstream');
    await box().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    await expect.poll(remotes, { timeout: 15_000 }).toEqual(['upstream']);
    // The dialog waits for the fetch after it, then reads the remotes again.
    await expect
      .poll(() => dialog.locator('.playground-remotes__row td').first().textContent(), {
        timeout: 15_000,
      })
      .toBe('upstream');
    // Removed, once asked.
    await dialog.locator('.playground-remotes__row').click();
    await dialog.locator('button[aria-label="Remove"]').click();
    await box().locator('.cerebro-dialog__button', { hasText: 'Yes' }).click();
    await expect.poll(remotes, { timeout: 15_000 }).toEqual([]);
    await dialog.locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    expect(await count('.cerebro-dialog')).toBe(0);
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

  it('shows more of a kind in Search Everywhere’s All with its “… more”, until the query changes', async () => {
    await page().keyboard.press('Shift');
    await page().keyboard.press('Shift');
    // The Actions group's rows, the last group: other kinds' results may come in at any time.
    const actions = () =>
      page().evaluate(() => {
        const rows = [...document.querySelectorAll('.cerebro-popup__group, .cerebro-popup-item')];
        const header = rows.findLastIndex((r) => r.textContent === 'Actions');
        return header < 0 ? [] : rows.slice(header + 1).map((r) => r.textContent);
      });
    // More actions match than All lists of a kind: the first 8, then "… more".
    await page().keyboard.type('o');
    await expect.poll(async () => (await actions()).length).toBe(9);
    expect((await actions()).at(-1)).toBe('\u2026 more');
    // To the row itself, wherever it is by then: another kind's results coming in move it down,
    // and a click by place then ran the action now there (Close, measured on Windows).
    await page().locator('.cerebro-popup-item--more').last().dispatchEvent('click');
    await expect.poll(async () => (await actions()).length).toBeGreaterThan(9);
    expect(await page().locator('.cerebro-popup').count()).toBe(1);
    // Another query: the first few again.
    await page().keyboard.press('Backspace');
    await page().keyboard.type('o');
    await expect.poll(async () => (await actions()).length).toBe(9);
    await page().keyboard.press('Escape');
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
    // The file's caret and indent show on the status bar once its editor has read it, after the
    // window's laid out (measured on macOS in CI: the status bar was read before they showed).
    await expect.poll(snapshot, { timeout: 15_000 }).toEqual(before);
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
    // On Linux, its Linux sheet's keys where they differ: Go Back, as the Navigate menu shows.
    if (process.platform === 'linux') {
      await page().keyboard.press('Alt+N');
      const back = page().locator('.cerebro-menu-item', {
        has: page().locator('.cerebro-menu-item__label', { hasText: /^Back$/ }),
      });
      expect(await back.locator('.cerebro-menu-item__shortcut').textContent()).toBe('Ctrl+Alt+-');
      await page().keyboard.press('Escape');
      await page().locator('.cerebro-menu').first().waitFor({ state: 'detached' });
    }
    // Back, through VS Code's Settings key.
    await useKeymap(mac ? 'IntelliJ IDEA (macOS)' : 'IntelliJ IDEA', `${chord}+Comma`);
  });

  it('takes Eclipse’s and Emacs’s keys, from IntelliJ’s files for them, when chosen', async () => {
    const mac = process.platform === 'darwin';
    /** The tab Search Everywhere opened on, then closed. */
    const opened = async () => {
      const tab = page().locator('.cerebro-popup [role="tab"][aria-selected="true"]');
      const label = await tab.textContent();
      await page().keyboard.press('Escape');
      await page().locator('.cerebro-popup').waitFor({ state: 'detached' });
      return label;
    };
    await useKeymap(mac ? 'Eclipse (macOS)' : 'Eclipse');
    // Eclipse's Open Resource is Go to File.
    await page().keyboard.press(mac ? 'Meta+Shift+R' : 'Control+Shift+R');
    expect(await opened()).toBe('Files');
    // Settings is IntelliJ's still: Eclipse's file doesn't name it.
    await useKeymap('Emacs', mac ? 'Meta+Comma' : 'Control+Alt+S');
    // A sequence: Ctrl+X Ctrl+F, Emacs's find-file.
    await page().keyboard.press('Control+X');
    await page().keyboard.press('Control+F');
    expect(await opened()).toBe('Files');
    await useKeymap(mac ? 'IntelliJ IDEA (macOS)' : 'IntelliJ IDEA', 'Control+Alt+S');
  });

  it('takes a shortcut the user gives an action on the Keymap page, kept after a reload', async () => {
    /** Opens Settings → Keymap on Go to File's row. */
    const goToFileRow = async () => {
      await page().keyboard.press(KEYS.settings);
      await page().locator('[data-page="keymap"]').click();
      await page().locator('.cerebro-keymap__search').fill('Go to File');
      await page().locator('[data-command="file.goTo"]').click();
    };
    await goToFileRow();
    await page().locator('.cerebro-keymap__action', { hasText: 'Add Keyboard Shortcut' }).click();
    await page().keyboard.press('F9');
    // Enter, once there's a stroke, is the shortcut dialog's OK.
    await page().keyboard.press('Enter');
    expect(
      await page().locator('[data-command="file.goTo"] .cerebro-keymap__keys').textContent(),
    ).toMatch(/^F9, /);
    await page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    await page().reload();
    await page().waitForSelector('.cerebro-toolbar');
    await page().keyboard.press('F9');
    await page().locator('.cerebro-popup').waitFor();
    await page().keyboard.press('Escape');
    // Back as it was.
    await goToFileRow();
    await page().locator('.cerebro-keymap__action', { hasText: 'Reset Shortcuts' }).click();
    await page().locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
    await page().keyboard.press('F9');
    await page().waitForTimeout(500);
    expect(await count('.cerebro-popup')).toBe(0);
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
