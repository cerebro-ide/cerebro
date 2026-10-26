// The host end to end: the app starts it for a repository, and the page shows what it reports.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-e2e-repo-')));
const repo = join(root, 'project');

beforeAll(async () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'README.md'), '# project');
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
