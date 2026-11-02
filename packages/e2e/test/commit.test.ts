// Committing from the Commit tool window end to end: what goes in, the message, Commit and Amend.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-commit-')));
const repo = join(root, 'project');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
/** Someone to commit as: a test machine may have no one set. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

const page = () => running.page;
const message = () => page().locator('.playground-commit__message');
const row = (key: string) => page().locator(`.cerebro-tree-row[data-key$="${key}"]`);

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

it('shows the Commit tool window with the message focused, and says what a commit lacks', async () => {
  await page().keyboard.press(KEYS.commit);
  await expect
    .poll(() => message().evaluate((field) => field === document.activeElement))
    .toBe(true);
  await row('changes:b.ts').waitFor();
  await page().keyboard.press('Control+Enter');
  await expect
    .poll(() => page().locator('.playground-commit__error').textContent())
    .toBe('Specify commit message');
  // Typing clears it.
  await page().keyboard.type('x');
  await page().locator('.playground-commit__error').waitFor({ state: 'detached' });
  await page().keyboard.press('Backspace');
});

it('commits the files put in, tracked ones unless taken out, untracked ones once put in', async () => {
  const include = (key: string) => row(key).locator('.playground-changes__include');
  expect(await include('changes:a.ts').isChecked()).toBe(true);
  expect(await include('unversioned:new.ts').isChecked()).toBe(false);
  // b.ts taken out with its checkbox; new.ts put in with Space on its row.
  await include('changes:b.ts').click();
  expect(await include('changes:b.ts').isChecked()).toBe(false);
  await row('unversioned:new.ts').click();
  await page().keyboard.press('Space');
  await expect.poll(() => include('unversioned:new.ts').isChecked()).toBe(true);
  // The Changes group is partly in.
  expect(
    await page()
      .locator('.cerebro-tree-row', { has: page().locator('.playground-changes__group--changes') })
      .locator('.playground-changes__include')
      .evaluate((box) => (box as HTMLInputElement).indeterminate),
  ).toBe(true);
  await message().click();
  await page().keyboard.type('Change a, add new');
  await page().keyboard.press('Control+Enter');
  await expect.poll(() => git('log', '-1', '--format=%s')).toBe('Change a, add new\n');
  expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('a.ts\nnew.ts\n');
  expect(git('status', '--porcelain')).toBe(' M b.ts\n');
  // The list follows, and the message is cleared for the next.
  await row('changes:a.ts').waitFor({ state: 'detached' });
  expect(await message().inputValue()).toBe('');
});

it('amends the last commit, its message put in to edit', async () => {
  await message().click();
  await page().keyboard.press(KEYS.amend);
  await expect.poll(() => message().inputValue()).toBe('Change a, add new');
  await page().keyboard.press('ControlOrMeta+a');
  await page().keyboard.type('Reworded');
  // Only the message: b.ts taken out before stays out.
  await page().locator('.playground-commit .cerebro-dialog__button--primary').click();
  await expect.poll(() => git('log', '--format=%s')).toBe('Reworded\nFirst\n');
  expect(git('status', '--porcelain')).toBe(' M b.ts\n');
  expect(await page().locator('.playground-commit__amend input').isChecked()).toBe(false);
});
