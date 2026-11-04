// Language servers end to end: go to definition and find usages answered by meaning (TypeScript's
// own server, basedpyright for Python, bash-language-server for shell scripts), where the index's
// name matches would list every function of that name.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  // A popup left open (an earlier test's late name matches, a claim: two Windows runs failed every
  // test after the shell one, Go to File never showing) is printed and closed first.
  const left = await popup().count();
  if (left > 0) {
    console.log('A popup was left open:', await popup().first().textContent());
    await page().keyboard.press('Escape');
    await popup().first().waitFor({ state: 'detached' });
  }
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
async function untilAnswered(keys: string, answered: () => Promise<boolean>): Promise<void> {
  let presses = 0;
  let pressed = 0;
  await expect
    .poll(
      async () => {
        // An answer can come after the check (the host waits up to 3 s for a server): pressing
        // again from where it went asks something else (a Windows run ended in lib.py, with the
        // name matches of a Ctrl+B pressed there).
        if (await answered()) return true;
        presses++;
        pressed = Date.now();
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
  // An earlier press's answer may still come, and go there again after the next test has moved on
  // (a Windows run went back to lib.sh from scope.ts): it's waited for, as long as the host waits.
  if (presses > 1) await page().waitForTimeout(Math.max(0, pressed + 3_500 - Date.now()));
}

/**
 * Prints what the host answers about a place, asked directly, and the page's console, then throws
 * `error`: CI's log is all there is. Asked with the file as the focused editor has it, edits
 * included; as it is on disk without one.
 */
async function explain(
  error: unknown,
  file: string,
  line: number,
  column: number,
  methods: string[],
): Promise<never> {
  const lines = await page().locator('.cm-editor.cm-focused .cm-line').allTextContents();
  const text = lines.length > 0 ? lines.join('\n') : readFileSync(join(repo, file), 'utf8');
  // With what formatting takes too; the others take no notice of it.
  const asked = {
    worktree: repo,
    path: join(repo, file),
    text,
    line,
    column,
    tabSize: 2,
    insertSpaces: true,
  };
  const answers = await page().evaluate(
    async ({ asked, repo, methods }) => {
      const host = (
        window as unknown as {
          cerebro: { host: { request: (p: string, m: string, a: unknown) => Promise<unknown> } };
        }
      ).cerebro.host;
      const answered: Record<string, string> = {};
      for (const method of methods) {
        const started = Date.now();
        answered[method] = await host.request(repo, method, asked).then(
          (result) => `${JSON.stringify(result)} in ${String(Date.now() - started)}ms`,
          (failure: unknown) => `failed: ${String(failure)}`,
        );
      }
      return answered;
    },
    { asked, repo, methods },
  );
  // And where the page is: the tab and line, what has the focus, and any popup.
  const state = {
    ...(await where()),
    focus: await page().evaluate(() => {
      let element = document.activeElement;
      while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
      return element ? `${element.tagName}.${element.className}` : null;
    }),
    popup: await popup()
      .first()
      .textContent({ timeout: 1_000 })
      .catch(() => null),
  };
  console.log(
    'Asked directly:',
    answers,
    '\nThe page:',
    state,
    '\nConsole:',
    running.messages.join('\n'),
  );
  throw error;
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
  // A variable declared at the top of a long file and read at its bottom: marks on the scrollbar.
  writeFileSync(
    join(repo, 'long.ts'),
    [
      'export function far() {',
      '  const distant = 1;',
      ...Array.from({ length: 300 }, (_, i) => `  // ${String(i)}`),
      '  return distant;',
      '}',
      '',
    ].join('\n'),
  );
  // An interface and two classes implementing it: gutter markers between them.
  writeFileSync(join(repo, 'shape.ts'), 'export interface Shape {\n  area(): number;\n}\n');
  for (const [name, n] of [
    ['Square', 1],
    ['Circle', 2],
  ] as const) {
    writeFileSync(
      join(repo, `${name.toLowerCase()}.ts`),
      `import { Shape } from './shape';\nexport class ${name} implements Shape {\n  area() { return ${String(n)}; }\n}\n`,
    );
  }
  // A type error, and a variable never read: an underline, and greyed.
  writeFileSync(
    join(repo, 'wrong.ts'),
    'export function f(): number {\n  const idle = 1;\n  return "text";\n}\n',
  );
  // A function called, not imported: two files export one of that name, each a fix.
  writeFileSync(join(repo, 'needs.ts'), 'run();\nexport {};\n');
  // An object's members, and a function from another file: completions, one with its import.
  writeFileSync(join(repo, 'completes.ts'), 'export const shape = { width: 1 };\n// here\n');
  writeFileSync(join(repo, 'tally.ts'), 'export function tally() {}\n');
  // A function to rename where it's used: renamed where it's defined too.
  writeFileSync(join(repo, 'measures.ts'), 'export function measure() {}\n');
  writeFileSync(join(repo, 'measured.ts'), "import { measure } from './measures';\nmeasure();\n");
  // A file to fold: a region, which only its server folds, by its name.
  writeFileSync(
    join(repo, 'regions.ts'),
    '// #region Setup\nconst a = 1;\n// #endregion\nexport function f() {\n  return a;\n}\n',
  );
  // A file to format.
  writeFileSync(join(repo, 'unformatted.ts'), 'const  x=1;\n');
  // A call to write: what's called, and the parameter the caret's at.
  writeFileSync(
    join(repo, 'calls.ts'),
    'function add(a: number, b = 2) {\n  return a + b;\n}\n// call\n',
  );
  writeFileSync(join(repo, 'wrong.py'), 'count: int = "text"\n');
  writeFileSync(join(repo, 'lib.py'), 'def walk():\n    pass\n');
  writeFileSync(join(repo, 'other.py'), 'def walk():\n    pass\n\nwalk()\n');
  writeFileSync(join(repo, 'main.py'), 'from lib import walk\n\nwalk()\n');
  // A key its schema doesn't have.
  writeFileSync(
    join(repo, 'schema.json'),
    JSON.stringify({ type: 'object', properties: { name: {} }, additionalProperties: false }),
  );
  writeFileSync(
    join(repo, 'config.yaml'),
    '# yaml-language-server: $schema=./schema.json\nname: x\nnmae: y\n',
  );
  // A value its schema doesn't allow, and a property CSS doesn't have.
  writeFileSync(
    join(repo, 'settings.schema.json'),
    JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } }),
  );
  writeFileSync(
    join(repo, 'settings.json'),
    '{\n  "$schema": "./settings.schema.json",\n  "name": 1\n}\n',
  );
  writeFileSync(join(repo, 'style.css'), '.a {\n  colr: red;\n}\n');
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
  try {
    await untilAnswered('ControlOrMeta+b', async () => {
      const at = await where();
      return at.tab === 'lib.py' && at.line === 'def walk():';
    });
  } catch (error) {
    await explain(error, 'main.py', 2, 1, ['lsp.definitions', 'lsp.markers', 'lsp.definitions']);
  }
  try {
    await untilAnswered(
      'Alt+F7',
      async () =>
        (await popup()
          .getAttribute('aria-label', { timeout: 1_000 })
          .catch(() => null)) === 'Usages of walk',
    );
  } catch (error) {
    // A Windows run (#115) never showed them, from lib.py's walk.
    await explain(error, 'lib.py', 0, 5, ['lsp.usages', 'lsp.usages']);
  }
  // The import, and the call; not other.py's call to its own walk.
  expect(await popup().locator('.cerebro-popup-item__detail').allTextContents()).toEqual([
    'main.py:1',
    'main.py:3',
  ]);
  await page().keyboard.press('Escape');
}, 60_000);

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
  // still loading doesn't, and only a move asks again.
  try {
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
  } catch (error) {
    await explain(error, 'scope.ts', 2, 10, ['lsp.highlights', 'lsp.definitions']);
  }
}, 60_000);

it('goes to a usage when its mark on the scrollbar is clicked, through the scrollbar’s track', async () => {
  await openAt('long.ts', 'const distant = 1;');
  // Into the name.
  await page().keyboard.press('End');
  for (let i = 0; i < 7; i++) await page().keyboard.press('ArrowLeft');
  // The read at the bottom, its mark low on the scrollbar, under the track while the pointer's there.
  const mark = page().locator('.cerebro-usageMark:not(.cerebro-usageMark--write)');
  await mark.waitFor({ timeout: 30_000 });
  // Where it stays: lines not drawn yet have estimated heights, so a mark can move once they're
  // measured (a macOS run clicked beside it once).
  type Box = { x: number; y: number; width: number; height: number };
  let box = (await mark.boundingBox()) as Box;
  await expect
    .poll(
      async () => {
        const before = box;
        await new Promise((resolve) => setTimeout(resolve, 200));
        box = (await mark.boundingBox()) as Box;
        return JSON.stringify(box) === JSON.stringify(before);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page().mouse.move(x, y);
  await page().mouse.down();
  await page().mouse.up();
  try {
    await expect
      .poll(where, { timeout: 5_000 })
      .toEqual({ tab: 'long.ts', line: '  return distant;' });
  } catch (error) {
    // What was under the pointer, and where the mark is now.
    console.log(
      await page().evaluate(
        ([px, py]) =>
          document
            .elementsFromPoint(px as number, py as number)
            .map((e) => `${e.tagName}.${e.className}`),
        [x, y],
      ),
      box,
      await mark.boundingBox(),
    );
    throw error;
  }
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

it('shows gutter markers between an interface and its implementations, and goes where they say', async () => {
  await openAt('shape.ts', 'area(): number;');
  const marker = (label: string) => page().locator(`.cerebro-marker[aria-label="${label}"]`);
  // Asked as the file opens; TypeScript's server may still be loading.
  await marker('area is implemented in Circle, Square').waitFor({ timeout: 30_000 });
  await marker('area is implemented in Circle, Square').click();
  await expect
    .poll(() => popup().locator('.cerebro-popup-item__detail').allTextContents(), {
      timeout: 15_000,
    })
    .toEqual(['circle.ts:3', 'square.ts:3']);
  await page().keyboard.press('Escape');
  await openAt('square.ts', 'area()');
  await marker('Implements area in Shape').waitFor({ timeout: 30_000 });
  await marker('Implements area in Shape').click();
  await expect
    .poll(where, { timeout: 15_000 })
    .toEqual({ tab: 'shape.ts', line: '  area(): number;' });
});

/** What the editor shows of its problems: the underlined text, and the file's status. */
const problems = () =>
  page().evaluate(() => {
    const root = document.querySelector('.cerebro-editor-code')?.shadowRoot;
    const shown = (name: string) =>
      [...(root?.querySelectorAll(`.cerebro-problem--${name}`) ?? [])].map((e) => e.textContent);
    return {
      errors: shown('error'),
      warnings: shown('warning'),
      unused: shown('unused'),
      status: [...(root?.querySelectorAll('.cerebro-problems [title]') ?? [])].map((e) =>
        e.getAttribute('title'),
      ),
      stripe: root?.querySelectorAll('.cerebro-problemMark--error').length ?? 0,
    };
  });

it('underlines errors, greys what is never read, and goes to the error with F2', async () => {
  await openAt('wrong.ts', 'export function');
  // Asked as the file opens; TypeScript's server may still be loading.
  try {
    await expect.poll(problems, { timeout: 30_000, interval: 500 }).toEqual({
      errors: ['return'],
      warnings: [],
      unused: ['idle'],
      status: ['1 error', 'Previous Highlighted Error', 'Next Highlighted Error'],
      stripe: 1,
    });
  } catch (error) {
    await explain(error, 'wrong.ts', 1, 1, ['lsp.problems']);
  }
  await page().keyboard.press('F2');
  expect(await where()).toEqual({ tab: 'wrong.ts', line: '  return "text";' });
}, 60_000);

it('fixes an error with Alt+Enter, with the fix chosen of those its server offers', async () => {
  await openAt('needs.ts', 'run();');
  try {
    await expect
      .poll(async () => (await problems()).errors, { timeout: 30_000, interval: 500 })
      .toEqual(['run']);
  } catch (error) {
    await explain(error, 'needs.ts', 0, 1, ['lsp.problems', 'lsp.contextActions']);
  }
  await page().keyboard.press('Alt+Enter');
  const items = popup().locator('.cerebro-popup-item');
  await items.first().waitFor();
  expect(await items.allTextContents()).toEqual(
    expect.arrayContaining(['Add import from "./lib"', 'Add import from "./other"']),
  );
  await page().keyboard.type('lib');
  await expect.poll(() => items.allTextContents()).toEqual(['Add import from "./lib"']);
  await page().keyboard.press('Enter');
  await page().locator('.cm-line', { hasText: 'import { run } from "./lib";' }).waitFor();
  expect((await where()).tab).toBe('needs.ts');
}, 60_000);

it('does the same for Python', async () => {
  await openAt('wrong.py', 'count');
  try {
    await expect
      .poll(async () => (await problems()).errors, { timeout: 30_000, interval: 500 })
      .toEqual(['"text"']);
  } catch (error) {
    await explain(error, 'wrong.py', 1, 1, ['lsp.problems']);
  }
}, 60_000);

it('does the same for YAML, against its schema', async () => {
  await openAt('config.yaml', 'name');
  try {
    await expect
      .poll(async () => (await problems()).errors, { timeout: 30_000, interval: 500 })
      .toEqual(['nmae']);
  } catch (error) {
    await explain(error, 'config.yaml', 2, 1, ['lsp.problems']);
  }
}, 60_000);

it('does the same for JSON, against its schema', async () => {
  await openAt('settings.json', '"name"');
  try {
    await expect
      .poll(async () => (await problems()).warnings, { timeout: 30_000, interval: 500 })
      .toEqual(['1']);
  } catch (error) {
    await explain(error, 'settings.json', 2, 3, ['lsp.problems']);
  }
}, 60_000);

it('fixes a CSS property’s name with Alt+Enter', async () => {
  await openAt('style.css', 'colr');
  try {
    await expect
      .poll(async () => (await problems()).warnings, { timeout: 30_000, interval: 500 })
      .toEqual(['colr']);
  } catch (error) {
    await explain(error, 'style.css', 1, 3, ['lsp.problems', 'lsp.contextActions']);
  }
  await page().keyboard.press('Alt+Enter');
  const items = popup().locator('.cerebro-popup-item');
  await items.first().waitFor();
  expect((await items.allTextContents())[0]).toBe("Rename to 'color'");
  await page().keyboard.press('Enter');
  await page().locator('.cm-line', { hasText: 'color: red;' }).waitFor();
}, 60_000);

it('shows what a symbol is on Ctrl+Q, and with the pointer resting on it', async () => {
  await openAt('main.ts', 'run();');
  const quick = page().locator('.cerebro-quickDoc');
  try {
    await untilAnswered(KEYS.quickDocumentation, async () => (await quick.count()) > 0);
  } catch (error) {
    await explain(error, 'main.ts', 2, 0, ['lsp.hover']);
  }
  expect(await quick.locator('.cerebro-doc__definition').textContent()).toBe(
    // Imported here: TypeScript calls it an alias.
    '(alias) function run(): void',
  );
  await page().keyboard.press('Escape');
  await quick.waitFor({ state: 'detached' });
  await page()
    .locator('.cm-line', { hasText: 'run();' })
    .hover({ position: { x: 8, y: 8 } });
  await expect
    .poll(() => page().locator('.cm-tooltip-hover .cerebro-doc__definition').textContent(), {
      timeout: 10_000,
    })
    .toBe('(alias) function run(): void');
}, 60_000);

it('shows what’s called as its arguments are typed, the parameter the caret is at in bold, and on Ctrl+P', async () => {
  await openAt('calls.ts', '// call');
  await page().keyboard.press('End');
  await page().keyboard.press('Enter');
  const bold = page().locator('.cerebro-parameterInfo strong');
  await page().keyboard.type('add(');
  try {
    await expect.poll(() => bold.textContent(), { timeout: 15_000 }).toBe('a: number');
  } catch (error) {
    await explain(error, 'calls.ts', 4, 4, ['lsp.signatures']);
  }
  expect(await page().locator('.cerebro-parameterInfo').textContent()).toBe(
    'a: number, b?: number',
  );
  await page().keyboard.type('1, ');
  await expect.poll(() => bold.textContent(), { timeout: 10_000 }).toBe('b?: number');
  await page().keyboard.press('Escape');
  await bold.waitFor({ state: 'detached' });
  await page().keyboard.press(KEYS.parameterInfo);
  await expect.poll(() => bold.textContent(), { timeout: 10_000 }).toBe('b?: number');
  await page().keyboard.press('Escape');
}, 60_000);

it('renames a function in place with Shift+F6, where it’s defined too, saved; undone as one', async () => {
  await openAt('measured.ts', 'measure();');
  await page().keyboard.press('ArrowRight');
  const box = page().locator('.cerebro-rename');
  try {
    await untilAnswered('Shift+F6', async () => (await box.count()) > 0);
  } catch (error) {
    await explain(error, 'measured.ts', 1, 1, ['lsp.renaming']);
  }
  expect(await box.textContent()).toBe('measure');
  await page().keyboard.type('gauge');
  await page().keyboard.press('Enter');
  await expect
    .poll(() => readFileSync(join(repo, 'measures.ts'), 'utf8'), { timeout: 15_000 })
    .toBe('export function gauge() {}\n');
  expect(readFileSync(join(repo, 'measured.ts'), 'utf8')).toBe(
    "import { gauge } from './measures';\ngauge();\n",
  );
  await page().keyboard.press(KEYS.undo);
  await page()
    .locator('.cm-line', { hasText: /^measure\(\);$/ })
    .waitFor();
}, 60_000);

it('formats a file on Ctrl+Alt+L by its language server, and says how many lines changed', async () => {
  await openAt('unformatted.ts', 'const');
  const formatted = page().locator('.cm-line', { hasText: /^const x = 1;$/ });
  try {
    await untilAnswered(KEYS.reformat, async () => (await formatted.count()) > 0);
  } catch (error) {
    await explain(error, 'unformatted.ts', 0, 0, ['lsp.format']);
  }
  // Pressed again while the server was loading: already formatted, then.
  expect(['Formatted 1 line', 'No lines changed: content is already properly formatted']).toContain(
    await page().locator('.cerebro-hint').textContent(),
  );
  await page().keyboard.press(KEYS.undo);
  await page()
    .locator('.cm-line', { hasText: /^const {2}x=1;$/ })
    .waitFor();
}, 60_000);

it('folds a file where its language server says on Ctrl+Shift+-, a region by its name, and unfolds it', async () => {
  await openAt('regions.ts', 'export');
  const region = page().locator('.cerebro-folded', { hasText: /^Setup$/ });
  try {
    await untilAnswered(KEYS.collapseAll, async () => (await region.count()) > 0);
  } catch (error) {
    await explain(error, 'regions.ts', 0, 0, ['lsp.folds']);
  }
  expect(
    await page()
      .locator('.cm-line', { hasText: /^export function f\(\) \{\.\.\.\}$/ })
      .count(),
  ).toBe(1);
  await page().keyboard.press(KEYS.expandAll);
  await page()
    .locator('.cm-line', { hasText: /^const a = 1;$/ })
    .waitFor();
}, 60_000);

it('lists a file’s structure on Ctrl+F12, the symbol at the caret highlighted, and goes to the one chosen', async () => {
  await openAt('square.ts', 'area()');
  const highlighted = popup().locator(
    '.cerebro-popup-item--highlighted .cerebro-popup-item__label',
  );
  // The server's answer: the name imported (as TypeScript's server lists it, measured), Square,
  // and its area in it.
  const listed = async () =>
    (await popup().locator('.cerebro-popup-item__label').allTextContents()).join(',') ===
    'Shape,Square,area';
  try {
    await expect
      .poll(
        async () => {
          if (await listed()) return true;
          if ((await popup().count()) > 0) await page().keyboard.press('Escape');
          await page().keyboard.press(KEYS.fileStructure);
          await popup().waitFor();
          return listed();
        },
        { timeout: 30_000, interval: 1_000 },
      )
      .toBe(true);
  } catch (error) {
    await explain(error, 'square.ts', 0, 0, ['lsp.structure']);
  }
  expect(await highlighted.textContent()).toBe('area');
  await page().keyboard.type('Squ');
  expect(await highlighted.textContent()).toBe('Square');
  await page().keyboard.press('Enter');
  await expect
    .poll(async () => (await where()).line)
    .toBe('export class Square implements Shape {');
}, 60_000);

it('completes as one types, a member after a `.`, and a function from another file with its import', async () => {
  await openAt('completes.ts', '// here');
  await page().keyboard.press('End');
  await page().keyboard.press('Enter');
  const list = page().locator('.cm-tooltip-autocomplete');
  /** Types `text`, waits for `label` in the list, and chooses it. */
  const choose = async (text: string, label: string) => {
    await page().keyboard.type(text);
    try {
      await list.locator('.cm-completionLabel', { hasText: label }).first().waitFor();
    } catch (error) {
      const { line } = await where();
      await explain(error, 'completes.ts', 2, String(line).length, ['lsp.completions']);
    }
    // The first one, filtered by what's typed; CodeMirror's list takes no keys for 75 ms.
    expect(await list.locator('li[aria-selected] .cm-completionLabel').textContent()).toBe(label);
    await page().waitForTimeout(100);
    await page().keyboard.press('Enter');
  };
  await choose('shape.wi', 'width');
  await page().locator('.cm-line', { hasText: 'shape.width' }).waitFor();
  await page().keyboard.press('End');
  await page().keyboard.press('Enter');
  await choose('tall', 'tally');
  await page()
    .locator('.cm-line', { hasText: /^import \{ tally \} from ["']\.\/tally["'];$/ })
    .waitFor();
  await page()
    .locator('.cm-line', { hasText: /^tally$/ })
    .waitFor();
  // Undone as one: the import with the completion.
  await page().keyboard.press(KEYS.undo);
  await page()
    .locator('.cm-line', { hasText: /^tall$/ })
    .waitFor();
  expect(await page().locator('.cm-line', { hasText: 'import' }).count()).toBe(0);
}, 60_000);
