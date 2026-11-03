// The shelf and the stash end to end: Shelve Changes… from the Commit window's menu, the Shelf tab,
// a shelved file's diff, Unshelve…; Stash Changes…, the Stash tab's Pop, and Unstash Changes….

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-shelf-')));
const repo = join(root, 'project');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
/** Someone to stash as: a test machine may have no one set. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

const page = () => running.page;
const row = (key: string) => page().locator(`.cerebro-tree-row[data-key$="${key}"]`);
const tab = (id: string) => page().locator(`.cerebro-tool-tab[data-tab="${id}"]`);
const button = (text: string) => page().locator('.cerebro-dialog__button', { hasText: text });
/** A file's text, with LF line ends: git may check files out with CRLF. */
const read = (file: string) => readFileSync(join(repo, file), 'utf8').replace(/\r/g, '');
/** Git's status, without the line ends Windows may give. */
const status = () => git('status', '--porcelain', '--untracked-files=all');
/** Through the host, which runs git: longer than `expect.poll`'s second (rule "End-to-end"). */
const HOST = { timeout: 15_000 };

/** Runs an action by its name, from Find Action. */
async function action(name: string): Promise<void> {
  await page().keyboard.press('ControlOrMeta+Shift+A');
  await page().keyboard.type(name);
  await page()
    .locator('.cerebro-popup-item', { hasText: new RegExp(`^${name}`) })
    .first()
    .click({ force: true });
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.ts'), 'a\n');
  writeFileSync(join(repo, 'b.ts'), 'b\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'First');
  writeFileSync(join(repo, 'a.ts'), 'a changed\n');
  writeFileSync(join(repo, 'b.ts'), 'b changed\n');
  writeFileSync(join(repo, 'new.ts'), 'new\n');
  running = await launch({ CEREBRO_REPO: repo, CEREBRO_LANGUAGE_SERVERS: '', ...IDENTITY });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('shelves the file chosen, shows it in the Shelf tab with its diff, and unshelves it', async () => {
  await page().keyboard.press(KEYS.commit);
  await row('changes:a.ts').click({ button: 'right' });
  await page().locator('.cerebro-menu-item', { hasText: 'Shelve Changes' }).click();
  // The file right-clicked starts checked, the others not.
  const box = (file: string) =>
    page()
      .locator('.cerebro-dialog .playground-rollback__option', { hasText: file })
      .locator('input');
  expect(await box('a.ts').isChecked()).toBe(true);
  expect(await box('b.ts').isChecked()).toBe(false);
  expect(await button('Shelve Changes').isDisabled()).toBe(true);
  await page().keyboard.type('Aside');
  await button('Shelve Changes').click();
  await expect.poll(status, HOST).toBe(' M b.ts\n?? new.ts\n');
  expect(read('a.ts')).toBe('a\n');
  // The Shelf tab, after Commit; its list opens to the file, whose diff opens.
  await tab('shelf').click();
  const shelf = page().locator('.cerebro-tree-row', { hasText: 'Aside' });
  await shelf.click();
  await page().keyboard.press('ArrowRight');
  await row(':a.ts').click();
  await page().keyboard.press('Enter');
  await page().locator('.cerebro-editor-tab[data-tab^="diff@"][data-tab$=":a.ts"]').waitFor();
  // Unshelved: the change is back, and the tab goes with the last list.
  await shelf.click();
  await page().keyboard.press('ControlOrMeta+Shift+U');
  await button('Unshelve').click();
  await expect.poll(() => read('a.ts'), HOST).toBe('a changed\n');
  await tab('shelf').waitFor({ state: 'detached' });
  await row('changes:a.ts').waitFor();
});

it('stashes with a message and untracked files, and pops it from the Stash tab', async () => {
  await action('Stash Changes');
  await page().keyboard.type('Mine');
  await page().locator('.cerebro-dialog label', { hasText: 'Include untracked' }).click();
  await button('Create Stash').click();
  await expect.poll(status, HOST).toBe('');
  expect(git('stash', 'list', '--format=%gs')).toBe('On main: Mine\n');
  await tab('stash').click();
  await page()
    .locator('.cerebro-tree-row', { hasText: 'On main: Mine' })
    .click({ button: 'right' });
  await page().locator('.cerebro-menu-item', { hasText: 'Pop' }).click();
  await expect.poll(status, HOST).toBe(' M a.ts\n M b.ts\n?? new.ts\n');
  expect(git('stash', 'list')).toBe('');
  await tab('stash').waitFor({ state: 'detached' });
});

it('unstashes the stash chosen, popping it', async () => {
  git('stash', 'push', '-q', '-m', 'First');
  writeFileSync(join(repo, 'a.ts'), 'a again\n');
  git('stash', 'push', '-q', '-m', 'Second');
  await action('Unstash Changes');
  await page().locator('.cerebro-dialog label', { hasText: 'On main: First' }).click();
  await button('Pop Stash').click();
  await expect.poll(() => git('stash', 'list', '--format=%gs'), HOST).toBe('On main: Second\n');
  expect(read('b.ts')).toBe('b changed\n');
});
