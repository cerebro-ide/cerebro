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

it('finds in a directory, the active file’s to start with, and in the files a mask keeps', async () => {
  // src/use.ts is open, from the first test.
  mkdirSync(join(repo, 'notes'));
  writeFileSync(join(repo, 'notes', 'shape.md'), 'shape\n');
  await page().keyboard.press('ControlOrMeta+Shift+F');
  await page().keyboard.type('shape');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(5);
  await page().getByRole('tab', { name: 'Directory' }).click();
  expect(await page().getByLabel('Directory').inputValue()).toBe('src');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(4);
  await page().getByRole('checkbox', { name: 'File mask' }).check();
  await page().getByRole('textbox', { name: 'File mask' }).fill('*.ts, !use.ts');
  await expect
    .poll(rows, { timeout: 15_000 })
    .toEqual([expect.stringContaining('// Shapes.'), expect.stringContaining('class Shape')]);
  // Kept for the next search, as IntelliJ keeps them; put back for the tests after this one.
  await page().getByRole('checkbox', { name: 'File mask' }).uncheck();
  await page().getByRole('tab', { name: 'In Project' }).click();
  // From the checkbox, which has the focus.
  await page().keyboard.press('Escape');
  expect(await page().locator('.cerebro-popup').count()).toBe(0);
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

it('replaces in files, the highlighted line, then all, with a regular expression’s groups', async () => {
  mkdirSync(join(repo, 'rep'));
  writeFileSync(join(repo, 'rep', 'a.txt'), 'colour red\ncolour blue\n');
  writeFileSync(join(repo, 'rep', 'b.txt'), 'colour green\n');
  const file = (name: string) => readFileSync(join(repo, 'rep', name), 'utf8');
  await page().keyboard.press('ControlOrMeta+Shift+R');
  await page().keyboard.press('Alt+KeyX');
  await page().keyboard.type('colou?r (\\w+)');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(3);
  await page().getByRole('textbox', { name: 'Replace with' }).fill('color: $1');
  // The highlighted line only: the first.
  await page().getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => file('a.txt'), { timeout: 15_000 }).toBe('color: red\ncolour blue\n');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(2);
  await page().getByRole('button', { name: 'Replace All' }).click();
  // Asked first.
  await page().getByText('Replace 2 matches in 2 files with “color: $1”?').waitFor();
  await page().getByRole('button', { name: 'Replace', exact: true }).click();
  await expect.poll(() => file('a.txt'), { timeout: 15_000 }).toBe('color: red\ncolor: blue\n');
  expect(file('b.txt')).toBe('color: green\n');
  expect(await page().locator('.cerebro-popup').count()).toBe(0);
});

it('opens what’s found in the Find window, as a tree, and a line from there', async () => {
  expect(await page().locator('.cerebro-stripe-button[data-id="find"]').count()).toBe(0);
  await page().keyboard.press('ControlOrMeta+Shift+F');
  await page().keyboard.type('shape');
  await expect.poll(rows, { timeout: 15_000 }).toHaveLength(4);
  await page().keyboard.press('ControlOrMeta+Enter');
  const title = page().locator('.playground-occurrences__title');
  await expect
    .poll(() => title.textContent(), { timeout: 15_000 })
    .toBe("Occurrences of 'shape' in Project4 matches in 3 files");
  // Folders, then files, then lines, as found: src/use.ts's Shape is Form since the find bar's test.
  expect(
    await page().locator('.playground-occurrences .cerebro-tree-row').allTextContents(),
  ).toEqual([
    'notes1 match',
    'shape.md1 match',
    '1shape',
    'src3 matches',
    'shape.ts2 matches',
    '1// Shapes.',
    '2export class Shape {}',
    'use.ts1 match',
    "1import { Form } from './shape';",
  ]);
  expect(await page().locator('.cerebro-stripe-button[data-id="find"]').count()).toBe(1);
  // By the keys: here, a double click on a row the tree had to scroll to opened the row above it.
  await page().locator('.playground-occurrences .cerebro-tree-row').first().click();
  for (let i = 0; i < 6; i++) await page().keyboard.press('ArrowDown');
  await page().keyboard.press('Enter');
  await expect
    .poll(() => page().locator('.cerebro-statusbar').textContent())
    .toContain('src/shape.ts');
  await expect
    .poll(() => page().locator('.cm-activeLine').textContent())
    .toBe('export class Shape {}');
});
