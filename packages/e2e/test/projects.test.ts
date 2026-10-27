// Projects end to end: the Welcome window with no project, opening a folder from it or from a
// project's window (as more tabs, or in the active project's place), a folder without git, closing
// a project, and the projects open at quit reopening. The system's folder dialog is replaced, in the main process, by
// one that answers with the folder a test sets.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-projects-')));
const repo = join(root, 'repository');
const plain = join(root, 'plain');
const other = join(root, 'other');

/** Makes the system's folder dialog answer with `path`, as if the user had chosen it. */
async function choose(path: string): Promise<void> {
  await running.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
  }, path);
}

/** The app's windows' titles, once they have them. */
const titles = () => Promise.all(running.app.windows().map((w) => w.title()));

/** Runs File → Open… through Search Everywhere. */
async function openFromMenu(page: Page): Promise<void> {
  await page.locator('.cerebro-toolbar [data-command="search.everywhere"]').click();
  await page.keyboard.type('Open');
  await page.locator('.cerebro-popup-item', { hasText: /^Open…/ }).click();
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'README.md'), '# repository');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
    cwd: repo,
  });
  mkdirSync(join(plain, 'docs'), { recursive: true });
  writeFileSync(join(plain, 'docs', 'notes.txt'), 'notes');
  mkdirSync(other);
  writeFileSync(join(other, 'other.txt'), 'other');
  // No CEREBRO_REPO: a first start, with nothing to reopen.
  running = await launch({ CEREBRO_REPO: '' });
});

afterAll(async () => {
  await running.close();
});

it('shows the Welcome window with no project, and opens a folder from it in its place', async () => {
  const page = running.page;
  await page.locator('.playground-welcome__empty').waitFor();
  await choose(repo);
  const opened = running.app.waitForEvent('window');
  await page.locator('.playground-welcome button', { hasText: 'Open' }).click();
  const project = await opened;
  await project.locator('.cerebro-toolbar').waitFor();
  await expect.poll(titles).toEqual(['repository']);
  // The repository's files, not the samples.
  await project.locator('.cerebro-tree-row', { hasText: 'README.md' }).waitFor();
  running.page = project;
});

/** The environment tabs' labels. */
const tabs = (page: Page) =>
  page.locator('.cerebro-env-tab .cerebro-env-tab__label').allTextContents();

/** Opens a folder from the window's File → Open…, answering the dialog asking where. */
async function openIn(page: Page, path: string, where: 'This Window' | 'New Window') {
  await choose(path);
  await openFromMenu(page);
  const dialog = page.locator('.cerebro-dialog', { hasText: 'Where would you like to open' });
  await dialog.locator('button', { hasText: where }).click();
}

/** Runs File → Close Project through Search Everywhere. */
async function closeProject(page: Page): Promise<void> {
  await page.locator('.cerebro-toolbar [data-command="search.everywhere"]').click();
  await page.keyboard.type('Close Project');
  await page.locator('.cerebro-popup-item', { hasText: 'Close Project' }).click();
}

it('asks where to open another project: New Window adds it as tabs, with a host of its own', async () => {
  const page = running.page;
  await openIn(page, plain, 'New Window');
  // The window keeps its project, and shows the other's files, through the other's host.
  await page.locator('.cerebro-tree-row', { hasText: 'docs' }).waitFor({ timeout: 15_000 });
  await expect.poll(titles).toEqual(['plain']);
  expect(await tabs(page)).toEqual(['repository', 'plain']);
  // Without git: no branch selector, and the Commit window says why it's empty.
  expect(await page.locator('.cerebro-toolbar-dropdown[aria-label="Branch"]').count()).toBe(0);
  await page.locator('.cerebro-stripe-button[data-id="commit"]').click();
  await page.locator('.playground-project__empty', { hasText: 'Not a git repository' }).waitFor();
  await page.locator('.cerebro-stripe-button[data-id="project"]').click();
  // The Project popup lists the window's projects, and shows one when chosen.
  await page.locator('[aria-label^="Project:"]').click();
  await expect
    .poll(() => page.locator('.cerebro-popup-item .cerebro-popup-item__label').allTextContents())
    .toEqual(['Open…', 'repository', 'plain']);
  await page.locator('.cerebro-popup-item', { hasText: 'repository' }).click();
  await page.locator('.cerebro-tree-row', { hasText: 'README.md' }).waitFor();
  await expect.poll(titles).toEqual(['repository']);
});

it('reopens the projects open when the app quit, in their window', async () => {
  await running.restart();
  await expect.poll(() => tabs(running.page), { timeout: 15_000 }).toHaveLength(2);
  expect(running.app.windows()).toHaveLength(1);
});

it('opens a project in This Window in the active project’s place', async () => {
  const page = running.page;
  await page.locator('.cerebro-env-tab', { hasText: 'plain' }).click();
  await expect.poll(titles).toEqual(['plain']);
  await openIn(page, other, 'This Window');
  await page.locator('.cerebro-tree-row', { hasText: 'other.txt' }).waitFor({ timeout: 15_000 });
  await expect.poll(titles).toEqual(['other']);
  // In plain's place: its tab, and the same window.
  expect(await tabs(page)).toEqual(['repository', 'other']);
  expect(running.app.windows()).toHaveLength(1);
});

it('closes one of a window’s projects: its tabs go, the window stays', async () => {
  const page = running.page;
  await closeProject(page);
  await expect.poll(titles).toEqual(['repository']);
  // One environment: the tabs hide.
  await expect.poll(() => page.locator('.cerebro-env-tabs').isHidden()).toBe(true);
  await page.locator('.cerebro-tree-row', { hasText: 'README.md' }).waitFor();
});

it('closes the window with its last project, and shows the Welcome window', async () => {
  const welcome = running.app.waitForEvent('window');
  await closeProject(running.page);
  const page = await welcome;
  await page.locator('.playground-welcome').waitFor();
  await expect.poll(titles).toEqual(['Welcome to Cerebro']);
  // The recent projects, the latest first.
  await expect
    .poll(() => page.locator('.playground-welcome__name').allTextContents())
    .toEqual(['other', 'plain', 'repository']);
  running.page = page;
});
