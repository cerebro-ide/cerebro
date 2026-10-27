// Editing end to end: typing in a file, undo, Save All, edits kept across tabs, saving when the
// window closes, and a file changed on disk shown again.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-editing-')));
const repo = join(root, 'project');
const first = join(repo, 'src', 'first.ts');
const second = join(repo, 'src', 'second.ts');

const page = () => running.page;
const disk = (path: string) => readFileSync(path, 'utf8');
/** The active editor's text, its lines joined. */
const shown = () =>
  page()
    .locator('.cm-line')
    .allTextContents()
    .then((lines) => lines.join('\n'));

/** Opens a file with Go to File, and puts the cursor at the end of its first line. */
async function open(name: string): Promise<void> {
  await page().keyboard.press('ControlOrMeta+Shift+N');
  await page().keyboard.type(name);
  await page().locator('.cerebro-popup-item', { hasText: name }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.cm-line').first().click();
  await page().keyboard.press('End');
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  mkdirSync(join(repo, 'src'));
  writeFileSync(first, 'const first = 1;\r\nexport {};\r\n');
  writeFileSync(second, 'const second = 2;\n');
  writeFileSync(join(repo, 'image.bin'), new Uint8Array([0, 1, 2]));
  // More than the editor and the Project tool window show.
  writeFileSync(join(repo, 'long.ts'), 'export {};\n'.repeat(300));
  for (let i = 0; i < 40; i++) writeFileSync(join(repo, `file${String(i)}.txt`), '');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
    cwd: repo,
  });
  running = await launch({ CEREBRO_REPO: repo });
  // The Claude tool window takes room from the editor, which these tests click in.
  await page().locator('.cerebro-stripe-button[data-id="claude"]').click({ force: true });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('edits a file, undoes, and saves it with Save All, keeping its line separators', async () => {
  await open('first.ts');
  await page().keyboard.type(' // typed');
  expect(await shown()).toContain('const first = 1; // typed');
  // Not saved yet.
  expect(disk(first)).toBe('const first = 1;\r\nexport {};\r\n');
  await page().keyboard.press('ControlOrMeta+z');
  expect(await shown()).not.toContain('typed');
  await page().keyboard.type(' // kept');
  await page().keyboard.press('ControlOrMeta+s');
  await expect.poll(() => disk(first)).toBe('const first = 1; // kept\r\nexport {};\r\n');
});

it('keeps a file’s unsaved edits when another tab is shown, and saves before closing', async () => {
  await open('second.ts');
  await page().keyboard.type(' // unsaved');
  await open('first.ts');
  await page().locator('.cerebro-editor-tab', { hasText: 'second.ts' }).click();
  expect(await shown()).toContain('const second = 2; // unsaved');
  expect(disk(second)).toBe('const second = 2;\n');
  // Quitting saves.
  await running.restart();
  expect(disk(second)).toBe('const second = 2; // unsaved\n');
});

it('shows a file changed on disk', async () => {
  await page().locator('.cerebro-editor-tab', { hasText: 'second.ts' }).click();
  await page().locator('.cm-line').first().waitFor();
  writeFileSync(second, 'const second = 3;\n');
  await expect.poll(shown, { timeout: 15_000 }).toBe('const second = 3;\n');
});

it('shows no scrollbar where nothing overflows: the Project tool window, a file it can’t open', async () => {
  await page().keyboard.press('ControlOrMeta+Shift+N');
  await page().keyboard.type('image.bin');
  await page().locator('.cerebro-popup-item', { hasText: 'image.bin' }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.playground-code__note', { hasText: 'binary' }).waitFor();
  // Scrolled areas whose content is taller than they are: there should be none.
  const overflowing = await page().evaluate(() =>
    [...document.querySelectorAll('.cerebro-tool-window__body, .cerebro-editor-content')]
      .filter((e) => e.scrollHeight > e.clientHeight)
      .map((e) => `${e.className}: ${String(e.scrollHeight)} > ${String(e.clientHeight)}`),
  );
  expect(overflowing).toEqual([]);
});

it('draws scrollbars over the content, taking no room: the Project tool window, the editor', async () => {
  await open('long.ts');
  // Native scrollbars would take room beside the content: none do.
  const room = await page().evaluate(() =>
    [
      document.querySelector('.cerebro-tree'),
      document.querySelector('.cerebro-editor-code')?.shadowRoot?.querySelector('.cm-scroller'),
    ].map((e) =>
      e instanceof HTMLElement && e.scrollHeight > e.clientHeight
        ? e.offsetWidth - e.clientWidth
        : 'nothing to scroll',
    ),
  );
  expect(room).toEqual([0, 0]);
  // A thumb shows over the editor while it's hovered.
  await page().locator('.cm-line').first().hover();
  await page().locator('.cerebro-scrollbar--y.cerebro-scrollbar--shown').first().waitFor();
});

it('scrolls tabs that don’t fit, keeping the active one in view, and lists them all', async () => {
  const more = page().locator('.cerebro-tabs-more');
  for (let i = 0; i < 16; i++) await open(`file${String(i)}.txt`);
  await more.waitFor();
  // The active tab, the last opened, is whole inside the strip.
  const inView = () =>
    page().evaluate(() => {
      const [strip, tab] = ['.cerebro-editor-tabs', '.cerebro-editor-tab--active'].map((selector) =>
        document.querySelector(selector)?.getBoundingClientRect(),
      );
      return !!strip && !!tab && tab.left >= strip.left && tab.right <= strip.right;
    });
  expect(await inView()).toBe(true);
  // Forced: under xvfb in CI, clicks can wait forever for the button to be "stable".
  await more.click({ force: true });
  await page().keyboard.type('file0.txt');
  await page().locator('.cerebro-popup-item', { hasText: 'file0.txt' }).waitFor();
  await page().keyboard.press('Enter');
  await expect
    .poll(() => page().locator('.cerebro-editor-tab--active').textContent())
    .toContain('file0.txt');
  expect(await inView()).toBe(true);
  // Leaves the tabs as they were: the middle button closes each, scrolled or not.
  for (let i = 0; i < 16; i++) {
    await page()
      .locator('.cerebro-editor-tab', { hasText: `file${String(i)}.txt` })
      .click({ button: 'middle', force: true });
  }
  const titles = () => page().locator('.cerebro-editor-tab').allTextContents();
  await expect.poll(titles).toEqual(expect.not.arrayContaining([expect.stringMatching(/^file/)]));
  await more.waitFor({ state: 'hidden' });
});
