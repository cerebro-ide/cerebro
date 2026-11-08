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
/**
 * One of the Log toolbar's filters and actions, in the popup its » shows them in when pointed at:
 * the popup lies over the », so a click there would land on what's in it.
 */
/** What resizing the window found and did, printed when the » is hidden. */
let resized: unknown;

const inToolbar = async (selector: string) => {
  const popup = page().locator('.cerebro-toolbar-row__popup');
  if ((await popup.count()) === 0) {
    const more = page().locator('.cerebro-tool-window[data-id="git"] .cerebro-toolbar-row__more');
    // It was hidden once in a full local run (backlog): what was seen, for next time.
    if (!(await more.isVisible()))
      console.log(
        'The » is hidden:',
        await page().evaluate(() => ({
          window: [innerWidth, innerHeight],
          toolbar: document.querySelector('.playground-log__toolbar')?.getBoundingClientRect()
            .width,
          row: document
            .querySelector('.cerebro-tool-window[data-id="git"] .cerebro-toolbar-row')
            ?.getBoundingClientRect().width,
          // Wider than shown, with the » hidden: the row's fit (in an animation frame) hasn't run.
          items: (() => {
            const items = document.querySelector(
              '.cerebro-tool-window[data-id="git"] .cerebro-toolbar-row__items',
            );
            return items && { scroll: items.scrollWidth, client: items.clientWidth };
          })(),
          visibility: document.visibilityState,
          focused: document.hasFocus(),
        })),
        await running.app.evaluate(({ BrowserWindow, screen }) => ({
          windows: BrowserWindow.getAllWindows().map((window) => window.getBounds()),
          screen: screen.getPrimaryDisplay().workArea,
        })),
        resized,
      );
    await more.hover({ force: true });
  }
  return popup.locator(selector);
};

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
  // As narrow as CI's macOS and Windows windows came out: the Log's toolbar hides its filters and
  // Refresh behind its » here, on every platform.
  resized = await running.app.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    windows[0]?.setSize(1024, 768);
    return { windows: windows.length, bounds: windows[0]?.getBounds() };
  });
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
      .locator('.cerebro-tool-window[data-id="git"] .playground-log__list .cerebro-tree-row')
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

it('filters by the branch double-clicked in its pane, or chosen in the toolbar, and refreshes', async () => {
  const log = page().locator('.cerebro-tool-window[data-id="git"]');
  const branch = log.locator('.playground-log__branches .cerebro-tree-row', { hasText: /^side$/ });
  await branch.waitFor(HOST);
  await branch.dblclick({ force: true });
  await expect.poll(subjects, HOST).toEqual(['On the side', 'First']);
  const filter = await inToolbar('.cerebro-toolbar-dropdown[aria-label^="Branch:"]');
  expect(await filter.textContent()).toBe('Branch: side');
  await filter.click({ force: true });
  await page().locator('.cerebro-popup-item', { hasText: 'All' }).first().waitFor();
  await page().keyboard.press('Enter');
  await expect.poll(subjects, HOST).toHaveLength(5);
  // A commit made outside the app shows on Refresh.
  commit('After refresh');
  await (await inToolbar('[data-command="log.refresh"]')).click({ force: true });
  await expect.poll(async () => (await subjects())[0], HOST).toBe('After refresh');
  // Away from the popup: it goes.
  await page().locator('.cerebro-statusbar').click({ force: true });
  await expect.poll(() => page().locator('.cerebro-toolbar-row__popup').count()).toBe(0);
});

it('filters by text on Enter, in any case or as typed, and by a hash', async () => {
  const log = page().locator('.cerebro-tool-window[data-id="git"]');
  const field = log.locator('.playground-log__search-field');
  await field.click({ force: true });
  await field.fill('on');
  await page().keyboard.press('Enter');
  // In any case, in the messages of every branch.
  await expect.poll(subjects, HOST).toEqual(['On main', 'On the side']);
  await log.locator('.playground-log__search [aria-label="Match Case"]').click({ force: true });
  await expect.poll(subjects, HOST).toEqual([]);
  await log.locator('.playground-log__search [aria-label="Match Case"]').click({ force: true });
  const hash = git('rev-parse', '--short', 'HEAD~1').trim();
  await field.fill(hash);
  await page().keyboard.press('Enter');
  await expect.poll(subjects, HOST).toEqual(['Later']);
  await log.locator('.playground-log__search-clear').click({ force: true });
  await expect.poll(subjects, HOST).toHaveLength(6);
});

it('filters by user and by date, each cleared with its X', async () => {
  git(
    '-c',
    'user.name=Bob',
    '-c',
    'user.email=bob@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'By Bob',
  );
  await (await inToolbar('[data-command="log.refresh"]')).click({ force: true });
  await expect.poll(async () => (await subjects())[0], HOST).toBe('By Bob');
  await (await inToolbar('.cerebro-toolbar-dropdown[aria-label^="User:"]')).click({ force: true });
  await page().keyboard.type('bob');
  await page().locator('.cerebro-popup-item', { hasText: 'Bob' }).first().waitFor(HOST);
  await page().keyboard.press('Enter');
  await expect.poll(subjects, HOST).toEqual(['By Bob']);
  await (await inToolbar('[aria-label="Clear User"]')).click({ force: true });
  await expect.poll(subjects, HOST).toHaveLength(7);
  // The commits here were made in 2023: none in the last 24 hours.
  await (await inToolbar('.cerebro-toolbar-dropdown[aria-label^="Date:"]')).click({ force: true });
  await page().locator('.cerebro-popup-item', { hasText: 'Last 24 hours' }).waitFor();
  await page().keyboard.press('ArrowDown');
  await page().keyboard.press('Enter');
  await expect.poll(subjects, HOST).toEqual([]);
  await (await inToolbar('[aria-label="Clear Date"]')).click({ force: true });
  await expect.poll(subjects, HOST).toHaveLength(7);
});

it('filters by paths typed or checked in the tree, cleared with its X', async () => {
  await (await inToolbar('.cerebro-toolbar-dropdown[aria-label^="Paths:"]')).click({ force: true });
  await page().locator('.cerebro-popup-item', { hasText: 'Select…' }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.playground-values__field:focus').waitFor();
  await page().keyboard.type('other.txt');
  await page().keyboard.press('ControlOrMeta+Enter');
  await expect.poll(subjects, HOST).toEqual(['On main']);
  // In the tree: other.txt unchecked, file.txt checked.
  await (await inToolbar('.cerebro-toolbar-dropdown[aria-label^="Paths:"]')).click({ force: true });
  await page().locator('.cerebro-popup-item', { hasText: 'Select in Tree…' }).waitFor();
  await page().keyboard.press('ArrowDown');
  await page().keyboard.press('Enter');
  const box = (name: string) => page().locator(`.playground-paths input[aria-label="${name}"]`);
  await box('other.txt').waitFor(HOST);
  await box('other.txt').click({ force: true });
  await box('file.txt').click({ force: true });
  await page().locator('.cerebro-dialog__button--primary').click({ force: true });
  // The merge leaves file.txt as the side has it: git simplifies it away.
  await expect.poll(subjects, HOST).toEqual(['After refresh', 'Later', 'On the side', 'First']);
  await (await inToolbar('[aria-label="Clear Paths"]')).click({ force: true });
  await expect.poll(subjects, HOST).toHaveLength(7);
});
