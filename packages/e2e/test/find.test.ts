// Find end to end: in files (ripgrep through the host, the options, a bad pattern, the preview, and
// opening a line found), and in a file, with its bar, replacing and saving.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-find-')));
const repo = join(root, 'project');

const page = () => running.page;
const rows = () => page().locator('.cerebro-popup-item').allTextContents();

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'shape.ts'), '// Shapes.\nexport class Shape {}\n');
  writeFileSync(join(repo, 'src', 'use.ts'), "import { Shape } from './shape';\nnew Shape();\n");
  running = await launch({ CEREBRO_REPO: repo });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('finds a text in the files, with Match Case, and opens a line found', async () => {
  await page().keyboard.press('ControlOrMeta+Shift+F');
  await page().keyboard.type('shape');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(4);
  expect(await page().locator('.playground-find__count').textContent()).toBe(
    '5 matches in 2 files',
  );
  // The highlighted line's file, below.
  await page().locator('.playground-find__preview .cm-line', { hasText: 'Shapes.' }).waitFor();
  await page().keyboard.press('Alt+KeyC');
  await expect.poll(rows).toHaveLength(1);
  expect(await page().locator('.playground-find__option[aria-pressed="true"]').count()).toBe(1);
  await page().keyboard.press('Enter');
  await expect
    .poll(() => page().locator('.cerebro-statusbar').textContent())
    .toContain('src/use.ts');
  // Only `./shape` matches the case.
  expect(await page().locator('.cm-activeLine').textContent()).toBe(
    "import { Shape } from './shape';",
  );
});

it('says what’s wrong with a bad regular expression', async () => {
  await page().keyboard.press('ControlOrMeta+Shift+F');
  await page().keyboard.press('Alt+KeyX');
  await page().keyboard.type('(');
  await expect
    .poll(() => page().locator('.playground-find__error').textContent(), { timeout: 15_000 })
    .toContain('unclosed group');
  await page().keyboard.press('Escape');
});

it('finds and replaces in the open file, with the find bar', async () => {
  // src/use.ts is open, from the first test.
  await page().locator('.cm-content').click();
  await page().keyboard.press('ControlOrMeta+f');
  await page().keyboard.type('Shape');
  const count = () => page().locator('.cerebro-find__count').textContent();
  // Case ignored, `./shape` too.
  await expect.poll(count).toMatch(/^\d\/3$/);
  await page().keyboard.press('Alt+KeyC');
  await expect.poll(count).toMatch(/^\d\/2$/);
  await page().keyboard.press('ControlOrMeta+r');
  await page().keyboard.type('Form');
  await page().locator('.cerebro-find__button', { hasText: 'Replace All' }).click();
  await page().keyboard.press('ControlOrMeta+s');
  await expect
    .poll(() => readFileSync(join(repo, 'src', 'use.ts'), 'utf8'))
    .toBe("import { Form } from './shape';\nnew Form();\n");
  await page().keyboard.press('Escape');
  expect(await page().locator('.cerebro-find').count()).toBe(0);
});
