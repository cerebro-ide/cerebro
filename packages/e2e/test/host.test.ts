// The host end to end: the app starts it for a repository, and the page shows what it reports.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name, which git and
// the app write out in full.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-repo-')));
const repo = join(root, 'project');

/** A path as git and Cerebro write it: with forward slashes, on every OS. */
const gitPath = (...parts: string[]) => join(...parts).replaceAll('\\', '/');

beforeAll(async () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'README.md'), '# project');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'app.ts'), 'export {};');
  writeFileSync(join(repo, 'src', 'shape.ts'), '// Shapes.\nexport class Shape {}\n');
  writeFileSync(join(repo, 'src', 'tool.py'), 'class Toolbox:\n    pass\n');
  writeFileSync(
    join(repo, 'src', 'use.ts'),
    "import { Shape } from './shape';\n\nconst first = new Shape();\nconst second = new Shape();\n",
  );
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/e2e', join(root, 'project-e2e'));
  running = await launch({ CEREBRO_REPO: repo });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('answers the page through the host it started', async () => {
  const pong = await running.page.evaluate(() =>
    (
      window as unknown as { cerebro: { host: { request(m: string): Promise<unknown> } } }
    ).cerebro.host.request('host.ping'),
  );
  expect(pong).toEqual({ version: 1 });
});

it('shows the worktree’s files in the project tree, and opens one', async () => {
  const page = running.page;
  const names = () => page.locator('.cerebro-tree-row').allTextContents();
  await page.locator('.cerebro-tree-row', { hasText: 'README.md' }).waitFor();
  // Folders first; git's own folder isn't shown.
  expect(await names()).toEqual(['src', 'README.md']);
  // Forced, as in app.test.ts: in CI under xvfb this click waited forever for the arrow to be
  // "stable" (not reproduced locally, even under xvfb).
  await page
    .locator(`.cerebro-tree-row[data-key="${gitPath(repo, 'src')}"] .cerebro-tree-row__arrow`)
    .click({ force: true });
  await page.locator('.cerebro-tree-row', { hasText: 'app.ts' }).waitFor();
  expect(await names()).toEqual(['src', 'app.ts', 'shape.ts', 'tool.py', 'use.ts', 'README.md']);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { violations?: string[] }).violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective}: ${event.blockedURI}`);
    });
  });
  await page.locator('.cerebro-tree-row', { hasText: 'app.ts' }).dblclick();
  expect(await page.locator('.cerebro-statusbar').textContent()).toContain(
    gitPath(repo, 'src', 'app.ts'),
  );
  // The file's own text, in the editor, highlighted, with no Content-Security-Policy broken.
  await page.locator('.cm-line', { hasText: 'export' }).waitFor();
  expect(await page.locator('.cm-content').textContent()).toBe('export {};');
  const keyword = page.locator('.cm-line span', { hasText: 'export' });
  expect(await keyword.evaluate((span) => getComputedStyle(span).color)).not.toBe(
    await page.locator('.cm-content').evaluate((content) => getComputedStyle(content).color),
  );
  expect(await page.evaluate(() => (window as { violations?: string[] }).violations)).toEqual([]);
});

it('keeps the file open after a reload, read again from disk', async () => {
  const page = running.page;
  await page.reload();
  await page.locator('.cerebro-editor-tab--active', { hasText: 'app.ts' }).waitFor();
  await page.locator('.cm-line', { hasText: 'export' }).waitFor();
  expect(await page.locator('.cm-content').textContent()).toBe('export {};');
});

it('goes to a file of the worktree, and finds new ones next time', async () => {
  const page = running.page;
  const labels = () => page.locator('.cerebro-popup-item__label').allTextContents();
  await page.keyboard.press('ControlOrMeta+Shift+N');
  await page.keyboard.type('app');
  await page.locator('.cerebro-popup-item__label', { hasText: 'app.ts' }).waitFor();
  expect(await labels()).toEqual(['app.ts']);
  expect(await page.locator('.cerebro-popup-item__detail').first().textContent()).toBe('src');
  await page.keyboard.press('Enter');
  await page.locator('.cm-line', { hasText: 'export' }).waitFor();
  writeFileSync(join(repo, 'fresh.md'), '# new');
  await page.keyboard.press('ControlOrMeta+Shift+N');
  await page.keyboard.type('fresh');
  await page.locator('.cerebro-popup-item__label', { hasText: 'fresh.md' }).waitFor();
  await page.keyboard.press('Escape');
});

it('goes to a symbol by name, opening its file there', async () => {
  const page = running.page;
  await page.keyboard.press('ControlOrMeta+Alt+Shift+N');
  await page.keyboard.type('Shape');
  await page.locator('.cerebro-popup-item', { hasText: 'Shape' }).waitFor();
  expect(await page.locator('.cerebro-popup__group').textContent()).toBe('Name matches');
  expect(await page.locator('.cerebro-popup-item__detail').first().textContent()).toBe(
    'src/shape.ts:2',
  );
  await page.keyboard.press('Enter');
  await page.locator('.cm-activeLine', { hasText: 'export class Shape' }).waitFor();
});

it('finds symbols in Python too', async () => {
  const page = running.page;
  await page.keyboard.press('ControlOrMeta+Alt+Shift+N');
  await page.keyboard.type('Toolbox');
  await page.locator('.cerebro-popup-item', { hasText: 'Toolbox' }).waitFor();
  expect(await page.locator('.cerebro-popup-item__detail').first().textContent()).toBe(
    'src/tool.py:1',
  );
  await page.keyboard.press('Escape');
});

it('goes to a definition with Ctrl+click, and finds usages with Alt+F7', async () => {
  const page = running.page;
  await page.keyboard.press('ControlOrMeta+Shift+N');
  await page.keyboard.type('use.ts');
  await page.locator('.cerebro-popup-item__label', { hasText: 'use.ts' }).waitFor();
  await page.keyboard.press('Enter');
  const line = page.locator('.cm-line', { hasText: 'const first' });
  await line.waitFor();
  // Ctrl+click on "Shape" in `new Shape()`: the definition, in shape.ts.
  const box = await line.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node.textContent ?? '').indexOf('Shape');
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 5);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return { x: 0, y: 0 };
  });
  await page.keyboard.down('Control');
  await page.mouse.click(box.x, box.y);
  await page.keyboard.up('Control');
  await page.locator('.cm-activeLine', { hasText: 'export class Shape' }).waitFor();
  // Alt+F7 on the class's name: every place the name appears.
  await page.keyboard.press('Alt+F7');
  await page.locator('.cerebro-popup-item').first().waitFor();
  expect(await page.locator('.cerebro-popup__group').textContent()).toBe('Name matches');
  expect(await page.locator('.cerebro-popup-item__detail').allTextContents()).toEqual([
    'src/shape.ts:2',
    'src/use.ts:1',
    'src/use.ts:3',
    'src/use.ts:4',
  ]);
  await page.keyboard.press('Escape');
});

it('says why a file can’t be opened', async () => {
  const page = running.page;
  writeFileSync(join(repo, 'image.bin'), new Uint8Array([0, 1, 2]));
  // Folders are listed once; reloading reads the main worktree's again.
  await page.reload();
  await page.locator('.cerebro-tree-row', { hasText: 'image.bin' }).dblclick();
  await page.locator('.playground-code__note', { hasText: 'binary' }).waitFor();
});

it('lists the repository’s real worktrees, opening the main one', async () => {
  const page = running.page;
  expect(await page.locator('[aria-label^="Environment:"]').getAttribute('aria-label')).toBe(
    'Environment: project',
  );
  expect(await page.locator('[aria-label^="Branch:"]').getAttribute('aria-label')).toBe(
    'Branch: main',
  );
  await page.locator('[aria-label^="Environment:"]').click();
  expect(
    await page.locator('.cerebro-popup-item .cerebro-popup-item__label').allTextContents(),
  ).toEqual(['New Worktree…', 'project', 'project-e2e']);
  await page.locator('.cerebro-popup-item', { hasText: 'project-e2e' }).click();
  expect(await page.locator('[aria-label^="Branch:"]').getAttribute('aria-label')).toBe(
    'Branch: feat/e2e',
  );
});

/** The repository's worktrees, as git lists them. */
const gitWorktrees = () =>
  execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));

/** Creates a worktree from the environment picker, waiting for git and for its tab. */
async function createWorktree(name: string) {
  const page = running.page;
  await page.locator('[aria-label^="Environment:"]').click();
  await page.locator('.cerebro-popup-item', { hasText: 'New Worktree' }).click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.locator(`.cerebro-env-tab[data-env="${gitPath(root, name)}"]`).waitFor();
}

/** Chooses Remove Worktree… on an environment tab. */
async function removeFromTab(path: string) {
  const page = running.page;
  await page.locator(`.cerebro-env-tab[data-env="${path}"]`).click({ button: 'right' });
  await page.locator('.cerebro-menu-item', { hasText: 'Remove Worktree' }).click();
}

it('creates a worktree beside the main one, on a new branch, and opens it', async () => {
  await createWorktree('extra');
  const page = running.page;
  expect(await page.locator('[aria-label^="Environment:"]').getAttribute('aria-label')).toBe(
    'Environment: extra',
  );
  expect(await page.locator('[aria-label^="Branch:"]').getAttribute('aria-label')).toBe(
    'Branch: extra',
  );
  expect(gitWorktrees()).toContain(gitPath(root, 'extra'));
});

it('removes a worktree after asking, and offers to force one with changes', async () => {
  const page = running.page;
  await removeFromTab(gitPath(root, 'extra'));
  await page.locator('.cerebro-dialog__button', { hasText: 'Remove' }).click();
  await page.locator(`.cerebro-env-tab[data-env="${gitPath(root, 'extra')}"]`).waitFor({
    state: 'detached',
  });
  expect(gitWorktrees()).not.toContain(gitPath(root, 'extra'));

  await createWorktree('dirty');
  writeFileSync(join(root, 'dirty', 'README.md'), 'changed');
  await removeFromTab(gitPath(root, 'dirty'));
  await page.locator('.cerebro-dialog__button', { hasText: 'Remove' }).click();
  await page.locator('.cerebro-dialog__button', { hasText: 'Remove Anyway' }).click();
  await page.locator(`.cerebro-env-tab[data-env="${gitPath(root, 'dirty')}"]`).waitFor({
    state: 'detached',
  });
  expect(gitWorktrees()).not.toContain(gitPath(root, 'dirty'));
});

it('offers to remove a linked worktree, but not the main one', async () => {
  const page = running.page;
  const removable = async (path: string) => {
    await page.locator(`.cerebro-env-tab[data-env="${path}"]`).click({ button: 'right' });
    const disabled = await page
      .locator('.cerebro-menu-item', { hasText: 'Remove Worktree' })
      .getAttribute('aria-disabled');
    await page.keyboard.press('Escape');
    return disabled === 'false';
  };
  // Two tabs, so the tabs show.
  await page.locator('[aria-label^="Environment:"]').click();
  await page.locator('.cerebro-popup-item', { hasText: 'project-e2e' }).click();
  expect(await removable(gitPath(root, 'project-e2e'))).toBe(true);
  expect(await removable(gitPath(repo))).toBe(false);
});
