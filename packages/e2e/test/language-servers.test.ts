// Language servers end to end: go to definition and find usages answered by meaning (TypeScript's
// own server, basedpyright for Python, bash-language-server for shell scripts), where the index's
// name matches would list every function of that name.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-lsp-')));
const repo = join(root, 'project');

const page = () => running.page;
const popup = () => page().locator('.cerebro-popup');
/** The line the caret is on, and the active tab. */
const where = async () => ({
  tab: await page().locator('.cerebro-editor-tab--active').first().textContent(),
  line: await page().locator('.cm-activeLine').first().textContent(),
});

/** Opens a file with Go to File, the caret at the start of a line holding `text`. */
async function openAt(name: string, text: string): Promise<void> {
  await page().keyboard.press(KEYS.goToFile);
  await page().keyboard.type(name);
  await page().locator('.cerebro-popup-item', { hasText: name }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.cm-line', { hasText: text }).click();
  await page().keyboard.press('Home');
}

/**
 * Presses `keys` until a language server answers: while TypeScript's is still loading, the name
 * matches show instead, which this closes.
 */
async function untilAnswered<T>(keys: string, answered: () => Promise<T>): Promise<void> {
  await expect
    .poll(
      async () => {
        await page().keyboard.press(keys);
        await page().waitForTimeout(500);
        const names = await popup().getByText('Name matches').count();
        if (names > 0) {
          await page().keyboard.press('Escape');
          return false;
        }
        return answered();
      },
      { timeout: 30_000, interval: 1_000 },
    )
    .toBeTruthy();
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  // TypeScript's server sees a project whole only with a tsconfig.json.
  writeFileSync(join(repo, 'tsconfig.json'), '{}');
  // Two functions named run: the index can't tell which is meant, TypeScript can.
  writeFileSync(join(repo, 'lib.ts'), 'export function run() {}\n');
  writeFileSync(join(repo, 'other.ts'), 'export function run() {}\nrun();\n');
  writeFileSync(join(repo, 'main.ts'), "import { run } from './lib';\n\nrun();\n");
  // A variable named alike in two functions: each is its own.
  writeFileSync(
    join(repo, 'scope.ts'),
    [
      'export function a() {',
      '  const extra = 1;',
      '  return extra;',
      '}',
      'export function b() {',
      '  const extra = 2;',
      '  return extra;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(join(repo, 'lib.py'), 'def walk():\n    pass\n');
  writeFileSync(join(repo, 'other.py'), 'def walk():\n    pass\n\nwalk()\n');
  writeFileSync(join(repo, 'main.py'), 'from lib import walk\n\nwalk()\n');
  writeFileSync(join(repo, 'lib.sh'), 'greet() {\n  echo hi\n}\n');
  writeFileSync(join(repo, 'other.sh'), 'greet() {\n  echo hello\n}\n\ngreet\n');
  writeFileSync(join(repo, 'main.sh'), 'source ./lib.sh\n\ngreet\n');
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

it('goes straight to the definition meant, not to every function of that name', async () => {
  await openAt('main.ts', 'run();');
  await untilAnswered('ControlOrMeta+b', async () => {
    const at = await where();
    return at.tab === 'lib.ts' && at.line === 'export function run() {}';
  });
});

it('finds the usages of the function meant, not of every one of that name', async () => {
  // The caret is on lib.ts's run, from the last test.
  await untilAnswered(
    'Alt+F7',
    async () =>
      (await popup()
        .getAttribute('aria-label', { timeout: 1_000 })
        .catch(() => null)) === 'Usages of run',
  );
  // Not other.ts's call to its own run.
  expect(await popup().locator('.cerebro-popup-item__detail').allTextContents()).toEqual([
    'main.ts:3',
  ]);
  await page().keyboard.press('Escape');
});

it('does the same for Python', async () => {
  await openAt('main.py', 'walk()');
  await untilAnswered('ControlOrMeta+b', async () => {
    const at = await where();
    return at.tab === 'lib.py' && at.line === 'def walk():';
  });
  await untilAnswered(
    'Alt+F7',
    async () =>
      (await popup()
        .getAttribute('aria-label', { timeout: 1_000 })
        .catch(() => null)) === 'Usages of walk',
  );
  // The import, and the call; not other.py's call to its own walk.
  expect(await popup().locator('.cerebro-popup-item__detail').allTextContents()).toEqual([
    'main.py:1',
    'main.py:3',
  ]);
  await page().keyboard.press('Escape');
});

it('does the same for shell scripts, following what a script sources', async () => {
  await openAt('main.sh', 'greet');
  await untilAnswered('ControlOrMeta+b', async () => {
    const at = await where();
    return at.tab === 'lib.sh' && at.line === 'greet() {';
  });
});

it('highlights the symbol at the caret where it is, not another of its name', async () => {
  // Into a's `return extra;`, inside the name.
  await openAt('scope.ts', 'const extra = 1;');
  for (const key of ['ArrowDown', 'End', 'ArrowLeft', 'ArrowLeft'])
    await page().keyboard.press(key);
  // The lines the usages are drawn on, by their middles.
  const usageLines = () =>
    page().evaluate(() => {
      const root = document.querySelector('.cerebro-editor-code')?.shadowRoot;
      const lines = [...(root?.querySelectorAll('.cm-line') ?? [])].map((line) =>
        line.getBoundingClientRect(),
      );
      return [...(root?.querySelectorAll('.cerebro-usage') ?? [])].map((usage) => {
        const { top, bottom } = usage.getBoundingClientRect();
        const middle = (top + bottom) / 2;
        const line = lines.findIndex((l) => l.top <= middle && middle <= l.bottom) + 1;
        return `${String(line)}${usage.classList.contains('cerebro-usage--write') ? ' write' : ''}`;
      });
    });
  // Declared on line 2, read on 3; not b's, on 6 and 7. Asked again until the server answers: one
  // still loading (on Windows in CI) doesn't, and only a move asks again.
  await expect
    .poll(
      async () => {
        const lines = await usageLines();
        if (lines.length === 0) {
          await page().keyboard.press('ArrowRight');
          await page().keyboard.press('ArrowLeft');
        }
        return lines;
      },
      { timeout: 45_000, interval: 1_000 },
    )
    .toEqual(['2 write', '3']);
}, 60_000);

it('shows a word with a definition as a link under the pointer with Ctrl held', async () => {
  await openAt('main.ts', 'run();');
  const box = (await page().locator('.cm-line', { hasText: 'run();' }).boundingBox()) as {
    x: number;
    y: number;
    height: number;
  };
  // Over "run", its first letters.
  await page().mouse.move(box.x + 8, box.y + box.height / 2);
  await page().keyboard.down('Control');
  await expect
    .poll(
      () =>
        page()
          .locator('.cerebro-link')
          .textContent({ timeout: 1_000 })
          .catch(() => null),
      {
        timeout: 15_000,
      },
    )
    .toBe('run');
  await page().keyboard.up('Control');
  await page().locator('.cerebro-link').waitFor({ state: 'detached' });
});
