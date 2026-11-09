// The Commit tool window end to end: what goes in, the message, Commit and Amend, Commit and Push;
// going from a diff to the file with F4; logging in to push; and Update Project, its conflicts resolved.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { gitServer, hasHttpBackend } from '../../host/test/git-server.js';
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
  writeFileSync(join(repo, 'shape.ts'), '// Shapes.\nexport class Shape {}\n');
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
  // Turned off once the host replies, which can be after git's log shows the commit (Windows).
  await expect
    .poll(() => page().locator('.playground-commit__amend input').isChecked())
    .toBe(false);
});

it('goes from a diff to the file with F4, where the caret is, from either side', async () => {
  // The committed first line becomes two.
  writeFileSync(join(repo, 'shape.ts'), '// Shapes, longer\n// and more.\nexport class Shape {}\n');
  await row('changes:shape.ts').click();
  await page().keyboard.press('ControlOrMeta+d');
  const side = (n: 0 | 1) => page().locator('.cerebro-editor-diff .cm-mergeViewEditor').nth(n);
  const shown = () => page().locator('.cerebro-editor-code:visible .cm-activeLine').textContent();
  // From the left, the committed text: the line after the change, one further down in the file.
  await side(0).locator('.cm-line', { hasText: 'export class Shape {}' }).click();
  await page().keyboard.press('F4');
  await expect
    .poll(() => page().locator('.cerebro-editor-tab--active').textContent())
    .toBe('shape.ts');
  await expect.poll(shown).toBe('export class Shape {}');
  // From the right: the line itself. The diff is read again as its tab shows.
  await page().locator('.cerebro-editor-tab[data-tab="diff:shape.ts"]').click();
  await side(1).locator('.cm-line', { hasText: '// and more.' }).click();
  await page().keyboard.press('F4');
  await expect.poll(shown).toBe('// and more.');
});

it('commits and pushes, with Commit and Push…, to the branch’s upstream', async () => {
  const remote = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');
  await message().click();
  await page().keyboard.type('Push it');
  await page().locator('.playground-commit button', { hasText: 'Commit and Push…' }).click();
  const shown = page().locator('.cerebro-dialog');
  await expect
    .poll(() => shown.locator('.playground-push__target').textContent())
    .toBe('main→origin:main');
  expect(await shown.locator('.playground-push__commit').allTextContents()).toEqual(['Push it']);
  await shown.locator('.cerebro-dialog__button', { hasText: 'Push' }).click();
  await expect
    .poll(
      () =>
        execFileSync('git', ['log', '-1', '--format=%s', 'main'], {
          cwd: remote,
          encoding: 'utf8',
        }),
      {
        timeout: 15_000,
      },
    )
    .toBe('Push it\n');
  await expect
    .poll(() => page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents())
    .toContain('Pushed 1 commit to origin/main');
});

// Git for Windows and macOS's git have git's HTTP backend; a git without it can't serve the test.
it.skipIf(!hasHttpBackend())('logs in to push over HTTP, and keeps the password', async () => {
  // The remote, now behind a login.
  const { url, server } = await gitServer(root, 'ido', 'secret');
  git('remote', 'set-url', 'origin', `${url}/remote.git`);
  const push = async (subject: string) => {
    writeFileSync(join(repo, 'pushed.txt'), subject);
    git('add', 'pushed.txt');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', subject);
    await page().keyboard.press(KEYS.push);
    const dialog = page().locator('.cerebro-dialog', { has: page().locator('.playground-push') });
    await expect
      .poll(() => dialog.locator('.playground-push__commit').allTextContents(), {
        timeout: 15_000,
      })
      .toEqual([subject]);
    await dialog.locator('.cerebro-dialog__button', { hasText: 'Push' }).click();
  };
  const pushed = () =>
    execFileSync('git', ['log', '-1', '--format=%s', 'main'], {
      cwd: join(root, 'remote.git'),
      encoding: 'utf8',
    });
  await push('Logged in');
  const login = page().locator('.cerebro-dialog', { hasText: 'Log In to' });
  await login.waitFor({ timeout: 15_000 });
  await page().keyboard.type('ido');
  await login.locator('input[type=password]').fill('secret');
  await login.locator('.cerebro-dialog__button', { hasText: 'Log In' }).click();
  await expect.poll(pushed, { timeout: 15_000 }).toBe('Logged in\n');
  // The remote has it before git is done (seen on Windows in CI): Push waits for the push to end.
  await expect
    .poll(() => page().locator('.cerebro-statusbar').getByText('Pushing…').isVisible(), {
      timeout: 15_000,
    })
    .toBe(false);
  // Again: the login and password kept answer, unasked.
  await push('Kept');
  await expect.poll(pushed, { timeout: 15_000 }).toBe('Kept\n');
  expect(await login.count()).toBe(0);
  server.close();
});

it('says why a push failed in git’s words alone', async () => {
  git('remote', 'set-url', 'origin', join(root, 'missing.git'));
  writeFileSync(join(repo, 'pushed.txt'), 'Nowhere');
  git('add', 'pushed.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'Nowhere');
  await page().keyboard.press(KEYS.push);
  const dialog = page().locator('.cerebro-dialog', { has: page().locator('.playground-push') });
  try {
    await expect
      .poll(() => dialog.locator('.playground-push__commit').allTextContents(), {
        timeout: 15_000,
      })
      .toContain('Nowhere');
  } catch (error) {
    // Failed once on Windows in CI (2026-11-09), the dialog's commits empty: what was seen.
    console.log('Dialogs:', await page().locator('.cerebro-dialog').allTextContents());
    console.log('Balloons:', await page().locator('.cerebro-balloon').allTextContents());
    console.log('Log:', git('log', '--oneline', '-3', 'HEAD', '@{upstream}'));
    throw error;
  }
  await dialog.locator('.cerebro-dialog__button', { hasText: 'Push' }).click();
  const failed = page().locator('.cerebro-balloon', { hasText: 'Push failed' });
  await failed.waitFor({ timeout: 15_000 });
  // Not Electron's "Error invoking remote method 'cerebro:host:request': …" in front.
  expect(await failed.locator('.cerebro-notification__content').textContent()).toMatch(/^fatal: /);
});

it('updates the project from the upstream, after asking how, as IntelliJ’s', async () => {
  // An upstream where the branch is, and another clone's commit there.
  const upstream = join(root, 'update.git');
  const other = join(root, 'other');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream]);
  git('push', '-q', upstream, 'main');
  git('remote', 'set-url', 'origin', upstream);
  git('fetch', '-q', 'origin');
  execFileSync('git', ['clone', '-q', upstream, other]);
  writeFileSync(join(other, 'theirs.txt'), 'Theirs');
  const inOther = (...args: string[]) => execFileSync('git', args, { cwd: other });
  inOther('add', 'theirs.txt');
  inOther('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'Theirs');
  inOther('push', '-q', 'origin', 'main');
  await page().keyboard.press(KEYS.update);
  const dialog = page().locator('.cerebro-dialog', { hasText: 'Update Project' });
  await dialog.waitFor();
  expect(await dialog.locator('label').allTextContents()).toEqual([
    'Merge',
    'Rebase',
    "Don't show again",
  ]);
  await dialog.locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
  await expect.poll(() => git('log', '-1', '--format=%s'), { timeout: 15_000 }).toBe('Theirs\n');
  await expect
    .poll(() => page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents(), {
      timeout: 15_000,
    })
    .toContain('1 file updated in 1 commit');
});

it('at conflicts, shows the Conflicts dialog and the merge window, then commits the merge', async () => {
  // The same line changed here and in the other clone, both committed.
  const other = join(root, 'other');
  const inOther = (...args: string[]) => execFileSync('git', args, { cwd: other });
  inOther('pull', '-q', '--no-rebase');
  writeFileSync(join(other, 'a.ts'), 'a theirs\n');
  inOther('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'Theirs to a');
  inOther('push', '-q', 'origin', 'main');
  writeFileSync(join(repo, 'a.ts'), 'a mine\n');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'Mine to a', '--', 'a.ts');
  await page().keyboard.press(KEYS.update);
  const update = page().locator('.cerebro-dialog', { hasText: 'Update Project' });
  await update.locator('.cerebro-dialog__button', { hasText: 'OK' }).click();
  const conflicts = page().locator('.cerebro-dialog', { hasText: 'Merge conflicts detected' });
  await conflicts.waitFor({ timeout: 15_000 });
  expect(await conflicts.locator('.playground-conflicts__row').allTextContents()).toEqual([
    'a.tsModifiedModified',
  ]);
  await conflicts.locator('.cerebro-dialog__button', { hasText: 'Merge…' }).click();
  const merge = page().locator('.cerebro-dialog', { hasText: 'Merge Revisions for' });
  await merge.waitFor();
  expect(await merge.locator('.playground-merge__left').textContent()).toBe(
    'No changes, 1 conflict',
  );
  await merge.locator('.cerebro-dialog__button', { hasText: 'Accept Left' }).click();
  // None left: the update goes on, and commits the merge.
  await expect
    .poll(() => git('log', '-1', '--format=%s'), { timeout: 15_000 })
    .toBe("Merge remote-tracking branch 'origin/main'\n");
  expect(git('show', 'HEAD:a.ts')).toBe('a mine\n');
  // Mine kept: no file differs from before the update.
  await expect
    .poll(() => page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents(), {
      timeout: 15_000,
    })
    .toContain('0 files updated in 1 commit');
});
