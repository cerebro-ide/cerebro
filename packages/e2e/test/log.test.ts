// The Git tool window's Log end to end: a repository's commits, with a branch merged back, a tag
// and the branch checked out, from real git through the host; read again with the focus back.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-log-')));
const repo = join(root, 'project');
let time = 1_700_000_000;
/** Git in the repository, each commit a second after the last, so the order is known. */
const git = (...args: string[]) => {
  time += 1;
  const date = `${String(time)} +0000`;
  return execFileSync('git', ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
};
const commit = (message: string) => {
  writeFileSync(join(repo, 'file.txt'), `${message}\n`);
  git('add', '.');
  git('commit', '-qm', message);
};
/** Through the host, which runs git: longer than `expect.poll`'s second (rule "End-to-end"). */
const HOST = { timeout: 15_000 };

const page = () => running.page;
const subjects = () => page().locator('.playground-log__message').allTextContents();

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  commit('First');
  git('checkout', '-qb', 'side');
  commit('On the side');
  git('checkout', '-q', 'main');
  writeFileSync(join(repo, 'other.txt'), 'other\n');
  git('add', '.');
  git('commit', '-qm', 'On main');
  git('merge', '-q', '--no-ff', '-m', 'Merge side', 'side');
  git('tag', 'v1');
  running = await launch({ CEREBRO_REPO: repo, CEREBRO_LANGUAGE_SERVERS: '' });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('lists the commits newest first, with the graph and the refs at each', async () => {
  // Under xvfb in CI a click can wait forever for the button to be "stable" (rule "End-to-end").
  await page().locator('.cerebro-stripe-button[data-id="git"]').click({ force: true });
  await expect.poll(subjects, HOST).toEqual(['Merge side', 'On main', 'On the side', 'First']);
  const refs = (row: number) =>
    page()
      .locator('.cerebro-tool-window[data-id="git"] .cerebro-tree-row')
      .nth(row)
      .locator('.playground-log__ref')
      .allTextContents();
  expect(await refs(0)).toEqual(['main', 'v1']);
  expect(await refs(2)).toEqual(['side']);
  // The merge's second parent in a lane of its own: the graph is two lanes wide.
  expect(await page().locator('.playground-log__graph').first().getAttribute('width')).toBe('28');
  expect(await page().locator('.playground-log__author').first().textContent()).toBe('Ada');
  // A commit made outside the app shows when the window gets the focus back.
  commit('Later');
  await page().evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(subjects, HOST)
    .toEqual(['Later', 'Merge side', 'On main', 'On the side', 'First']);
});

it('shows a commit’s files and message, and opens a file’s diff between it and its parent', async () => {
  const log = page().locator('.cerebro-tool-window[data-id="git"]');
  await log.locator('.cerebro-tree-row', { hasText: 'On the side' }).click({ force: true });
  const file = log.locator('.playground-log__files .cerebro-tree-row', { hasText: 'file.txt' });
  await file.waitFor(HOST);
  expect(await log.locator('.playground-log__details-subject').textContent()).toBe('On the side');
  await file.dblclick({ force: true });
  // The diff: the first commit's text on the left, the side's on the right.
  const added = page().locator('.cerebro-editor-diff .cm-merge-b .cm-changedLine');
  await expect.poll(() => added.allTextContents(), HOST).toEqual(['On the side']);
});
