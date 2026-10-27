// Navigation end to end: Back and Forward through the places the caret was, Recent Files, Go to
// Line, and selecting the opened file in the Project tool window.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

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
  await page().keyboard.press('ControlOrMeta+Shift+N');
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

it('goes to a line and column, from the caret’s, and back', async () => {
  await open('a.ts');
  await page().locator('.cm-line').first().click();
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
