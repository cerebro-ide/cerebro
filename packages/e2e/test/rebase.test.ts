// The Log's Interactively Rebase from Here… end to end: the dialog's list given to real git, with
// the app itself as git's sequence and message editor (run as Node, `rebase-editor` mode).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-rebase-')));
const repo = join(root, 'project');
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
const commit = (name: string) => {
  writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
  git('add', '.');
  git('commit', '-qm', name);
};
/** Through the host, which runs git: longer than `expect.poll`'s second (rule "End-to-end"). */
const HOST = { timeout: 15_000 };
const page = () => running.page;
const subjects = () => page().locator('.playground-log__message').allTextContents();

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  commit('First');
  commit('Second');
  commit('Third');
  running = await launch({ CEREBRO_REPO: repo, CEREBRO_LANGUAGE_SERVERS: '' });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('rebases with the list: a commit reworded, another dropped', async () => {
  await page().locator('.cerebro-stripe-button[data-id="git"]').click();
  await expect.poll(subjects, HOST).toEqual(['Third', 'Second', 'First']);
  // The commit's row: in this window (854 wide under xvfb) its subject has no width (measured; the
  // backlog's "The Log's subject column shrinks to nothing in a narrow window").
  await page()
    .locator('.cerebro-tool-window[data-id="git"] .cerebro-tree-row', { hasText: 'Second' })
    .click({ button: 'right' });
  await page().locator('.cerebro-menu-item', { hasText: 'Interactively Rebase from Here' }).click();
  const rows = page().locator('.playground-rebase__subject');
  await expect.poll(() => rows.allTextContents(), HOST).toEqual(['Second', 'Third']);
  await rows.nth(1).click();
  await page().locator('.playground-rebase__toolbar button', { hasText: 'Drop' }).click();
  await rows.nth(0).click();
  await page().locator('.playground-rebase__toolbar button', { hasText: 'Reword' }).click();
  const field = page().locator('.playground-rebase__message');
  // Five lines, as IntelliJ's, not a dialog field's one: the field's own rule loads after the dialog's.
  expect((await field.boundingBox())?.height).toBeGreaterThan(80);
  await field.fill('Second, reworded\n\nWhy.');
  await field.press('Control+Enter');
  await page().locator('.cerebro-dialog__button', { hasText: 'Start Rebasing' }).click();
  await expect.poll(subjects, HOST).toEqual(['Second, reworded', 'First']);
  expect(git('log', '--format=%B', '-1')).toBe('Second, reworded\n\nWhy.\n\n');
  expect(git('status', '--porcelain')).toBe('');
});
