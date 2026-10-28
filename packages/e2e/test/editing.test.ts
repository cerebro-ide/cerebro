// Editing end to end: typing in a file, undo, Save All, edits kept across tabs, saving on its own
// (when the editor loses the focus, when the window closes), a byte order mark kept, a file changed
// on disk shown again, a file changed in both resolved, a deleted file's tab closed, and the Edit
// menu.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

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
  await page().keyboard.press(KEYS.goToFile);
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
  writeFileSync(join(repo, 'bom.txt'), '\uFEFFmarked\n');
  writeFileSync(join(repo, 'gone.txt'), 'deleted soon\n');
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

it('keeps a file’s edits when another tab is shown, and saves before closing', async () => {
  await open('second.ts');
  await page().keyboard.type(' // kept');
  await open('first.ts');
  await page().locator('.cerebro-editor-tab', { hasText: 'second.ts' }).click();
  expect(await shown()).toContain('const second = 2; // kept');
  await page().locator('.cm-line').first().click();
  await page().keyboard.press('End');
  await page().keyboard.type(' // unsaved');
  expect(disk(second)).toBe('const second = 2; // kept\n');
  // Quitting saves.
  await running.restart();
  expect(disk(second)).toBe('const second = 2; // kept // unsaved\n');
});

it('saves a file with its byte order mark, which isn’t shown', async () => {
  await open('bom.txt');
  expect(await shown()).toBe('marked\n');
  await page().keyboard.type(' kept');
  await page().keyboard.press('ControlOrMeta+s');
  await expect.poll(() => disk(join(repo, 'bom.txt'))).toBe('\uFEFFmarked kept\n');
});

it('closes a file’s tab when the file is deleted on disk', async () => {
  const tab = page().locator('.cerebro-editor-tab', { hasText: 'gone.txt' });
  await open('gone.txt');
  await tab.waitFor();
  rmSync(join(repo, 'gone.txt'));
  // Read again every 2 seconds.
  await tab.waitFor({ state: 'detached', timeout: 15_000 });
});

it('shows a file changed on disk', async () => {
  await page().locator('.cerebro-editor-tab', { hasText: 'second.ts' }).click();
  await page().locator('.cm-line').first().waitFor();
  writeFileSync(second, 'const second = 3;\n');
  await expect.poll(shown, { timeout: 15_000 }).toBe('const second = 3;\n');
});

it('saves a file on its own when the editor loses the focus', async () => {
  await open('second.ts');
  await page().keyboard.type(' // autosaved');
  expect(disk(second)).toBe('const second = 3;\n');
  await page().locator('.cerebro-tree').first().focus();
  await expect
    .poll(() => disk(second), { timeout: 15_000 })
    .toBe('const second = 3; // autosaved\n');
});

it('asks about a file changed both in the editor and on disk: keep, load, or merge', async () => {
  const dialog = page().locator('.cerebro-dialog', { hasText: 'File Cache Conflict' });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  /** Edits the file, changes it on disk, and waits to be asked. */
  const conflict = async (typed: string, written: string) => {
    await open('second.ts');
    await page().keyboard.type(typed);
    writeFileSync(second, written);
    // Read again every 2 seconds.
    await dialog.waitFor({ timeout: 15_000 });
  };
  await conflict(' // mine', 'const second = 4;\n');
  await button('Keep Memory Changes').click();
  await dialog.waitFor({ state: 'detached' });
  // Saved over the disk's, now that it's chosen.
  await page().keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() => disk(second), { timeout: 15_000 })
    .toBe('const second = 3; // autosaved // mine\n');

  await conflict(' // lost', 'const second = 5;\n');
  await button('Load File System Changes').click();
  await expect.poll(shown).toBe('const second = 5;\n');

  // The disk's change taken into the edits, by the arrow beside it, and saved.
  await conflict(' // merged', 'const second = 6;\n');
  await button('Show Difference').click();
  const merge = page().locator('.cerebro-dialog', { hasText: 'Save Memory Content' });
  const revert = merge.locator('.cm-merge-revert button').first();
  await revert.waitFor();
  await revert.click();
  await merge.getByRole('button', { name: 'Save Memory Content' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page().keyboard.press('ControlOrMeta+s');
  await expect.poll(() => disk(second), { timeout: 15_000 }).toBe('const second = 6;\n');
});

// macOS shows the menu in the system's menu bar, which Playwright can't click.
it.skipIf(process.platform === 'darwin')(
  'undoes, copies and pastes in the editor through the Edit menu',
  async () => {
    const edit = async (item: string) => {
      await page().keyboard.press('Alt+E');
      await page().locator('.cerebro-menu-item', { hasText: item }).click();
      await page().locator('.cerebro-menu').first().waitFor({ state: 'detached' });
    };
    await open('second.ts');
    const before = await shown();
    const line = before.split('\n')[0] as string;
    await page().keyboard.type(' x');
    await edit('Undo');
    expect(await shown()).toBe(before);
    await page().keyboard.press('Home');
    await page().keyboard.press('Shift+End');
    await edit('Copy');
    await page().keyboard.press('End');
    await edit('Paste');
    await expect.poll(shown).toBe(before.replace(line, line + line));
    await edit('Undo');
    await expect.poll(shown).toBe(before);
  },
);

// macOS shows the menu in the system's menu bar, which Playwright can't click.
it.skipIf(process.platform === 'darwin')(
  'names what Undo and Redo would do, and disables them with nothing to do',
  async () => {
    const item = (name: RegExp) =>
      page().locator('.cerebro-menu-item', {
        has: page().locator('.cerebro-menu-item__label', { hasText: name }),
      });
    const menu = async () => {
      await page().keyboard.press('Alt+E');
      const [undo, redo] = [item(/^Undo/), item(/^Redo/)];
      const state = async (i: typeof undo) =>
        `${(await i.locator('.cerebro-menu-item__label').textContent()) ?? ''}: ${(await i.getAttribute('aria-disabled')) === 'true' ? 'disabled' : 'enabled'}`;
      return [await state(undo), await state(redo)];
    };
    const close = async () => {
      await page().keyboard.press('Escape');
      await page().locator('.cerebro-menu').first().waitFor({ state: 'detached' });
    };
    // Never edited.
    await open('file39.txt');
    expect(await menu()).toEqual(['Undo: disabled', 'Redo: disabled']);
    await close();
    await page().keyboard.type('typed');
    expect(await menu()).toEqual(['Undo Typing: enabled', 'Redo: disabled']);
    await item(/^Undo/).click();
    await page().locator('.cerebro-menu').first().waitFor({ state: 'detached' });
    expect(await shown()).toBe('');
    expect(await menu()).toEqual(['Undo: disabled', 'Redo Typing: enabled']);
    await close();
    // Leaves the tabs as they were (the tab test below counts them).
    await page()
      .locator('.cerebro-editor-tab', { hasText: 'file39.txt' })
      .dispatchEvent('auxclick', { button: 1 });
  },
);

it('pastes into the find bar’s field with the keys, not into the editor', async () => {
  await open('second.ts');
  const before = await shown();
  await running.app.evaluate(({ clipboard }) => {
    // Electron's clipboard writes at once; its types say a promise.
    void clipboard.writeText('pasted');
  });
  await page().keyboard.press('ControlOrMeta+f');
  const field = page().locator('.cerebro-find__field').first();
  await field.waitFor();
  await field.fill('');
  await page().keyboard.press('ControlOrMeta+v');
  await expect.poll(() => field.inputValue()).toBe('pasted');
  expect(await shown()).toBe(before);
  await page().keyboard.press('Escape');
});

it('shows no scrollbar where nothing overflows: the Project tool window, a file it can’t open', async () => {
  await page().keyboard.press(KEYS.goToFile);
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
  // The editor's: tool windows with tabs have their own.
  const more = page().locator('.cerebro-editor-tab-bar .cerebro-tabs-more');
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
  // Leaves the tabs as they were. The middle button's event, not a real click: under xvfb in CI a
  // forced middle click on a scrolled tab could wait forever (navigation.test.ts clicks for real).
  for (let i = 0; i < 16; i++) {
    await page()
      .locator('.cerebro-editor-tab', { hasText: `file${String(i)}.txt` })
      .dispatchEvent('auxclick', { button: 1 });
  }
  const titles = () => page().locator('.cerebro-editor-tab').allTextContents();
  await expect.poll(titles).toEqual(expect.not.arrayContaining([expect.stringMatching(/^file/)]));
  await more.waitFor({ state: 'hidden' });
});
