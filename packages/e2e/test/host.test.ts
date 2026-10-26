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
  await page
    .locator(`.cerebro-tree-row[data-key="${gitPath(repo, 'src')}"] .cerebro-tree-row__arrow`)
    .click();
  await page.locator('.cerebro-tree-row', { hasText: 'app.ts' }).waitFor();
  expect(await names()).toEqual(['src', 'app.ts', 'README.md']);
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
