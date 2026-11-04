// Navigation end to end: Back and Forward through the places the caret was, Recent Files, Go to
// Line, and selecting the opened file in the Project tool window.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-navigation-')));
const repo = join(root, 'project');

const page = () => running.page;
const mac = process.platform === 'darwin';
/** The line the caret is on, and the active tab. */
const where = async () => ({
  tab: await page().locator('.cerebro-editor-tab--active').first().textContent(),
  line: await page().locator('.cm-activeLine').first().textContent(),
});

/** Opens a file with Go to File. */
async function open(name: string): Promise<void> {
  await page().keyboard.press(KEYS.goToFile);
  await page().keyboard.type(name);
  await page().locator('.cerebro-popup-item', { hasText: name }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.cm-line').first().waitFor();
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  // A call at the top, its definition far below.
  const lines = ['target();', ...Array.from({ length: 80 }, (_, i) => `// ${String(i)}`)];
  writeFileSync(join(repo, 'a.ts'), [...lines, 'export function target() {}', ''].join('\n'));
  writeFileSync(join(repo, 'b.ts'), 'export const b = 1;\n');
  // Opened first from the Project tree.
  writeFileSync(join(repo, 'd.ts'), 'export const d = 1;\n');
  writeFileSync(join(repo, 'e.ts'), 'export const e = 1;\n');
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  writeFileSync(join(repo, 'src', 'deep', 'c.ts'), 'export const c = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
    cwd: repo,
  });
  running = await launch({ CEREBRO_REPO: repo });
  // The Claude tool window takes room from the editor, which these tests click in.
  await page().locator('.cerebro-stripe-button[data-id="claude"]').click({ force: true });
  await page().locator('.cerebro-statusbar').getByText('Indexed').waitFor({ timeout: 30_000 });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('goes back and forward through the places the caret was, within a file and across files', async () => {
  const back = mac ? 'Meta+BracketLeft' : 'Control+Alt+ArrowLeft';
  const forward = mac ? 'Meta+BracketRight' : 'Control+Alt+ArrowRight';
  await open('a.ts');
  await page().locator('.cm-line').first().click();
  await page().keyboard.press('Home');
  // To the definition, in the same file.
  await page().keyboard.press('ControlOrMeta+b');
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'export function target() {}' });
  await open('b.ts');
  await expect.poll(where).toEqual({ tab: 'b.ts', line: 'export const b = 1;' });
  await page().keyboard.press(back);
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'export function target() {}' });
  await page().keyboard.press(back);
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'target();' });
  await page().keyboard.press(forward);
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'export function target() {}' });
  await page().keyboard.press(forward);
  await expect.poll(where).toEqual({ tab: 'b.ts', line: 'export const b = 1;' });
});

it('lists the recent files, the latest first, and goes to the one before with Enter', async () => {
  // The last test left b.ts shown, after a.ts.
  const recent = async () => {
    await page().keyboard.press('ControlOrMeta+e');
    await page().locator('.cerebro-popup').waitFor();
  };
  const labels = () => page().locator('.cerebro-popup-item__label').allTextContents();
  const highlighted = () =>
    page().locator('.cerebro-popup-item--highlighted .cerebro-popup-item__label').textContent();
  await recent();
  expect(await labels()).toEqual(['b.ts', 'a.ts']);
  expect(await highlighted()).toBe('a.ts');
  await page().keyboard.press('Enter');
  await expect.poll(where).toMatchObject({ tab: 'a.ts' });
  // A closed file stays in the list.
  await page().locator('.cerebro-editor-tab', { hasText: 'b.ts' }).click({ button: 'middle' });
  await page().locator('.cerebro-editor-tab', { hasText: 'b.ts' }).waitFor({ state: 'detached' });
  await recent();
  expect(await labels()).toEqual(['a.ts', 'b.ts']);
  await page().keyboard.press('Enter');
  await expect.poll(where).toMatchObject({ tab: 'b.ts' });
});

it('shows only the files edited with Show edited only, flipped by Recent Files’ key again', async () => {
  // The last test left b.ts shown, after a.ts: an edit to b.ts, taken back so it isn't saved.
  await page().locator('.cm-line').first().click();
  await page().keyboard.press('End');
  await page().keyboard.type(' ');
  await page().keyboard.press('ControlOrMeta+z');
  const labels = () => page().locator('.cerebro-popup-item__label').allTextContents();
  const edited = page().getByRole('checkbox', { name: 'Show edited only' });
  await page().keyboard.press('ControlOrMeta+e');
  await page().locator('.cerebro-popup').waitFor();
  expect(await labels()).toEqual(['b.ts', 'a.ts']);
  expect(await edited.isChecked()).toBe(false);
  await page().keyboard.press('ControlOrMeta+e');
  await expect.poll(labels).toEqual(['b.ts']);
  expect(await edited.isChecked()).toBe(true);
  // Its checkbox flips it too.
  await edited.click();
  await expect.poll(labels).toEqual(['b.ts', 'a.ts']);
  expect(
    await page()
      .locator('.cerebro-popup input[type="text"]')
      .evaluate((e) => e === document.activeElement),
  ).toBe(true);
  await page().keyboard.press('Escape');
  await page().locator('.cerebro-popup').waitFor({ state: 'detached' });
});

it('focuses the editor of the file chosen in Go to File, Recent Files or the Project tree, as IntelliJ does', async () => {
  /** Whether the focus is in the shown editor's text: other tabs' editors are kept, hidden. */
  const inShownEditor = () =>
    page().evaluate(() => {
      const host = document.activeElement as HTMLElement | null;
      return (
        host?.classList.contains('cerebro-editor-code') === true &&
        host.offsetParent !== null &&
        host.shadowRoot?.activeElement?.classList.contains('cm-content') === true
      );
    });
  const blur = () =>
    page().evaluate(() => {
      (document.activeElement as HTMLElement).blur();
    });
  await blur();
  await open('b.ts');
  await expect.poll(where).toMatchObject({ tab: 'b.ts' });
  await expect.poll(inShownEditor).toBe(true);
  await blur();
  await page().keyboard.press('ControlOrMeta+e');
  await page().locator('.cerebro-popup').waitFor();
  await page().keyboard.press('Enter');
  await expect.poll(where).toMatchObject({ tab: 'a.ts' });
  await expect.poll(inShownEditor).toBe(true);
  // In the Project tree: a double click, and Enter.
  const row = (name: string) =>
    page().locator(
      `.cerebro-tool-window[data-id="project"] .cerebro-tree-row[data-key="${repo.replaceAll('\\', '/')}/${name}"]`,
    );
  await blur();
  await row('d.ts').dblclick({ force: true });
  await expect.poll(where).toMatchObject({ tab: 'd.ts' });
  await expect.poll(inShownEditor).toBe(true);
  await row('e.ts').click({ force: true });
  await page().keyboard.press('Enter');
  await expect.poll(where).toMatchObject({ tab: 'e.ts' });
  await expect.poll(inShownEditor).toBe(true);
});

it('goes to a line and column, from the caret’s, and back', async () => {
  await open('a.ts');
  // Its caret is where it was left, at the definition: to the top.
  await page().keyboard.press('ControlOrMeta+Home');
  // a.ts's own line: the last file's may still show for a moment, and a click there is lost.
  await page().locator('.cm-line', { hasText: 'target();' }).first().click();
  await page().keyboard.press('Home');
  await page().keyboard.press(mac ? 'Meta+l' : 'Control+g');
  const field = page().locator('.cerebro-dialog-field__input');
  expect(await field.inputValue()).toBe('1:1');
  // Typed over the selected text.
  await page().keyboard.type('82:8');
  await page().keyboard.press('Enter');
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'export function target() {}' });
  await page().keyboard.press(mac ? 'Meta+BracketLeft' : 'Control+Alt+ArrowLeft');
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'target();' });
});

it('selects the opened file in the Project tool window, opening the folders down to it', async () => {
  await open('c.ts');
  const project = page().locator('.cerebro-tool-window[data-id="project"]');
  const key = `${repo.replaceAll('\\', '/')}/src/deep/c.ts`;
  const row = project.locator(`.cerebro-tree-row[data-key="${key}"]`);
  // Its folder is closed.
  expect(await row.count()).toBe(0);
  await project.locator('[data-command="project.selectOpenedFile"]').click();
  await expect.poll(() => row.getAttribute('aria-selected')).toBe('true');
});

it('selects the file in a place chosen from Select In, by its number', async () => {
  await open('b.ts');
  await page().keyboard.press('Alt+F1');
  await page().locator('.cerebro-menu-heading', { hasText: 'Select In' }).waitFor();
  // The file manager is listed, not chosen: that would open the system's.
  const manager = { darwin: 'Reveal in Finder', win32: 'Show in Explorer' }[
    process.platform as string
  ];
  expect(await page().locator('.cerebro-menu-item__label').allTextContents()).toEqual([
    '1. Project',
    `2. ${manager ?? 'Show in File Manager'}`,
  ]);
  await page().keyboard.press('1');
  const row = page().locator(
    `.cerebro-tool-window[data-id="project"] .cerebro-tree-row[data-key="${repo.replaceAll('\\', '/')}/b.ts"]`,
  );
  await expect.poll(() => row.getAttribute('aria-selected')).toBe('true');
  expect(await page().locator('.cerebro-menu-heading').count()).toBe(0);
});

it('selects each file as its tab is chosen, with Always Select Opened File on', async () => {
  const project = page().locator('.cerebro-tool-window[data-id="project"]');
  const row = (path: string) =>
    project.locator(`.cerebro-tree-row[data-key="${repo.replaceAll('\\', '/')}/${path}"]`);
  const toggle = async () => {
    await project.locator('[data-menu="project/options"]').click();
    await page().locator('.cerebro-menu-item', { hasText: 'Always Select Opened File' }).click();
  };
  await toggle();
  await open('b.ts');
  await expect.poll(() => row('b.ts').getAttribute('aria-selected')).toBe('true');
  await page().locator('.cerebro-editor-tab', { hasText: 'c.ts' }).click();
  await expect.poll(() => row('src/deep/c.ts').getAttribute('aria-selected')).toBe('true');
  // Off again: the tree stays where it is.
  await toggle();
  await page().locator('.cerebro-editor-tab', { hasText: 'b.ts' }).click();
  await page().waitForTimeout(500);
  expect(await row('src/deep/c.ts').getAttribute('aria-selected')).toBe('true');
});

it('goes back to a place as it was scrolled, not just to its caret', async () => {
  await open('a.ts');
  await page().keyboard.press('ControlOrMeta+Home');
  await page().locator('.cm-line', { hasText: 'target();' }).first().click();
  await page().keyboard.press('Home');
  /** The line drawn at the top of the editor. */
  const top = () =>
    page().evaluate(() => {
      // The shown editor: other tabs' are kept, hidden.
      const editor = [...document.querySelectorAll<HTMLElement>('.cerebro-editor-code')].find(
        (e) => e.offsetParent !== null,
      ) as HTMLElement;
      const root = editor.shadowRoot as ShadowRoot;
      const box = (root.querySelector('.cm-scroller') as HTMLElement).getBoundingClientRect();
      // The first line not wholly scrolled out of view.
      return [...root.querySelectorAll('.cm-line')].find(
        (line) => line.getBoundingClientRect().bottom > box.top,
      )?.textContent;
    });
  // Scrolled down by the wheel, the caret left where it was.
  await page().locator('.cm-line', { hasText: 'target();' }).first().hover();
  await page().mouse.wheel(0, 200);
  await expect.poll(top).not.toBe('target();');
  const scrolled = await top();
  await page().keyboard.press('ControlOrMeta+b');
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'export function target() {}' });
  await page().keyboard.press(mac ? 'Meta+BracketLeft' : 'Control+Alt+ArrowLeft');
  await expect.poll(where).toEqual({ tab: 'a.ts', line: 'target();' });
  // Once the editor has scrolled (a frame) and measured (another): polling could catch the moment
  // before, which may match by chance.
  await page().evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await top()).toBe(scrolled);
});

it('keeps the recent files when the app restarts', async () => {
  const labels = async () => {
    await page().keyboard.press('ControlOrMeta+e');
    await page().locator('.cerebro-popup').waitFor();
    const shown = await page().locator('.cerebro-popup-item__label').allTextContents();
    await page().keyboard.press('Escape');
    return shown;
  };
  const before = await labels();
  expect(before.length).toBeGreaterThan(1);
  await running.restart();
  await page().locator('.cm-line').first().waitFor();
  expect(await labels()).toEqual(before);
});

it('switches to the tab shown before with Ctrl+Tab, and moves on with Tab while Ctrl is held', async () => {
  await open('b.ts');
  await open('e.ts');
  // Ctrl on every platform, as IntelliJ's macOS keymap has it too.
  await page().keyboard.down('Control');
  await page().keyboard.press('Tab');
  const switcher = page().locator('.cerebro-switcher');
  await switcher.waitFor();
  const selected = switcher.locator('.cerebro-popup-item--highlighted .cerebro-popup-item__label');
  expect(await selected.textContent()).toBe('b.ts');
  await page().keyboard.up('Control');
  await switcher.waitFor({ state: 'detached' });
  expect((await where()).tab).toBe('b.ts');
  // Back to e.ts, the one shown before b.ts, then on past it.
  await page().keyboard.down('Control');
  await page().keyboard.press('Tab');
  expect(await selected.textContent()).toBe('e.ts');
  await page().keyboard.press('Tab');
  const third = await selected.textContent();
  await page().keyboard.up('Control');
  expect((await where()).tab).toBe(third);
});
