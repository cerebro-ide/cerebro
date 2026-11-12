// The Commit tool window end to end: what goes in, the message, Commit and Amend, Commit and Push;
// going from a diff to the file with F4, and to the list's other files; logging in to push; Update Project, its conflicts resolved;
// Fetch and Pull; and Merge.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { gitServer, hasHttpBackend } from '../../host/test/git-server.js';
import { diffWindow, findAction, KEYS, launch, type Running } from './app.js';

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
/** What the window and the repository show, printed when a test fails: CI's log is all there is. */
async function seen(): Promise<void> {
  console.log('Dialogs:', await page().locator('.cerebro-dialog').allTextContents());
  console.log('Balloons:', await page().locator('.cerebro-balloon').allTextContents());
  console.log('Message:', await message().inputValue());
  // Why Commit didn't, if it said, and what it would have committed: the rows, those put in.
  console.log('Commit error:', await page().locator('.playground-commit__error').allTextContents());
  const rows = page().locator('.cerebro-tree-row');
  console.log(
    'Rows:',
    await rows.evaluateAll((all) =>
      all.map((row) => {
        const box = row.querySelector('.playground-changes__include');
        const put = box instanceof HTMLInputElement ? (box.checked ? '[x] ' : '[ ] ') : '';
        return put + row.textContent;
      }),
    ),
  );
  // The items shown: hidden tasks' text is there too, and `textContent` took it.
  console.log('Status bar:', await page().locator('.cerebro-statusbar').innerText());
  console.log('Log:', git('log', '--oneline', '--graph', '-4'));
  console.log('Status:', git('status'));
  console.log('Console:', running.messages);
}

/** How long `done` takes to hold after a test gave up on it, up to a minute: slow, or stuck. */
async function measure(done: () => boolean | Promise<boolean>): Promise<void> {
  const start = performance.now();
  while (!(await done()) && performance.now() - start < 60_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(
    (await done())
      ? `Done ${String(Math.round(performance.now() - start))} ms after the test gave up`
      : 'Still not done a minute after the test gave up',
  );
  // The hosts' slow git and held-up event loop, if any: where the time went.
  console.log('Standard error:', running.output.join(''));
}
/** Runs an action by its name, from Find Action. */
const action = (name: string) => findAction(page(), name);

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
  // The host's git, which on Windows has taken longer than a second (CI, 2026-11-12: the next
  // test found the commit made, and the message cleared as it typed into it).
  await expect
    .poll(() => git('log', '-1', '--format=%s'), { timeout: 15_000 })
    .toBe('Change a, add new\n');
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
  await expect.poll(() => git('log', '--format=%s'), { timeout: 15_000 }).toBe('Reworded\nFirst\n');
  expect(git('status', '--porcelain')).toBe(' M b.ts\n');
  // Turned off once the host replies, which can be after git's log shows the commit (Windows).
  await expect
    .poll(() => page().locator('.playground-commit__amend input').isChecked())
    .toBe(false);
});

/** The diff window the F4 and F7 tests share. */
let diff: Page;

it('goes from a diff to the file with F4, where the caret is, from either side', async () => {
  // The committed first line becomes two.
  writeFileSync(join(repo, 'shape.ts'), '// Shapes, longer\n// and more.\nexport class Shape {}\n');
  await row('changes:shape.ts').click();
  diff = await diffWindow(running, () => page().keyboard.press('ControlOrMeta+d'));
  const side = (n: 0 | 1) => diff.locator('.cerebro-editor-diff .cm-editor').nth(n);
  const shown = () => page().locator('.cerebro-editor-code:visible .cm-activeLine').textContent();
  // From the left, the committed text: the line after the change, one further down in the file.
  await side(0).locator('.cm-line', { hasText: 'export class Shape {}' }).click();
  await diff.keyboard.press('F4');
  await expect
    .poll(() => page().locator('.cerebro-editor-tab--active').textContent())
    .toBe('shape.ts');
  await expect.poll(shown).toBe('export class Shape {}');
  // From the right: the line itself, back in the diff's window.
  await diff.bringToFront();
  await side(1).locator('.cm-line', { hasText: '// and more.' }).click();
  await diff.keyboard.press('F4');
  await expect.poll(shown).toBe('// and more.');
});

it('goes to the next change with F7 and back with Shift+F7, from the first to start with', async () => {
  writeFileSync(
    join(repo, 'shape.ts'),
    '// Shapes, longer\n// and more.\nexport class Shape {}\n// added\n',
  );
  const shown = () => page().locator('.cerebro-editor-code:visible .cm-activeLine').textContent();
  // The file's tab, left by the test before, has the change once the watcher's told it.
  await expect
    .poll(() => page().locator('.cerebro-editor-code:visible .cm-line').allTextContents(), {
      timeout: 15_000,
    })
    .toContain('// added');
  // The diff's window, with the focus back, reads the diff again: the caret at the first change.
  // (The event, as the Log's test sends it: a window brought to the front may not tell its page.)
  await diff.bringToFront();
  await diff.evaluate(() => window.dispatchEvent(new Event('focus')));
  const right = diff.locator('.cerebro-editor-diff .cm-diff-b');
  await expect
    .poll(() => right.locator('.cm-line').allTextContents(), { timeout: 15_000 })
    .toContain('// added');
  await right.locator('.cm-content').focus();
  await diff.keyboard.press('F7');
  await diff.keyboard.press('F4');
  await expect.poll(shown).toBe('// added');
  // From the last, Shift+F7 goes back to the first.
  await diff.bringToFront();
  await right.locator('.cm-line', { hasText: '// added' }).click();
  await diff.keyboard.press('Shift+F7');
  await diff.keyboard.press('F4');
  await expect.poll(shown).toBe('// Shapes, longer');
});

it('compares the previous file of its list, as IntelliJ’s diff window', async () => {
  // The Changes group's files: b.ts, then shape.ts.
  await diff.bringToFront();
  const count = diff.locator('.playground-diff-window__count');
  await expect.poll(() => count.textContent()).toBe('2/2');
  await diff.locator('[data-command="diff.previousFile"]').click();
  await expect.poll(() => diff.title()).toBe('b.ts');
  expect(await count.textContent()).toBe('1/2');
  const right = diff.locator('.cerebro-editor-diff .cm-diff-b');
  await expect
    .poll(() => right.locator('.cm-line').allTextContents(), { timeout: 15_000 })
    .toContain('b changed');
  await diff.close();
});

it('moves a diff from its window to a tab and back, from its Settings, as IntelliJ’s', async () => {
  await row('changes:shape.ts').click();
  const window = await diffWindow(running, () => page().keyboard.press('ControlOrMeta+d'));
  const choose = async (where: Page, label: string) => {
    await where.locator('[data-menu="diff/settings"]:visible').click();
    await where.locator('.cerebro-menu [role^="menuitem"]', { hasText: label }).click();
  };
  const closed = window.waitForEvent('close');
  await choose(window, 'Show Diff in Editor Tab');
  await closed;
  // In the project's window, as a tab, in front.
  const tab = page().locator('.cerebro-editor-group--active .cerebro-editor-diff');
  await tab.waitFor({ timeout: 15_000 });
  expect(await page().locator('.cerebro-editor-tab--active').textContent()).toBe('shape.ts');
  // Back: the tab goes, a window shows it.
  const back = await diffWindow(running, () => choose(page(), 'Show Diff in Separate Window'));
  expect(await back.title()).toBe('shape.ts');
  await expect.poll(() => tab.count()).toBe(0);
  await back.close();
});

it('edits the file from its diff window, as its document, as IntelliJ’s', async () => {
  await row('changes:shape.ts').click();
  const window = await diffWindow(running, () => page().keyboard.press('ControlOrMeta+d'));
  const right = window.locator('.cerebro-editor-diff .cm-diff-b');
  await right.locator('.cm-line', { hasText: '// added' }).click();
  await window.keyboard.press('End');
  await window.keyboard.type(' typed');
  // The file's tab, in the project's window, has it: one document.
  const tab = () => page().locator('.cerebro-editor-code:visible .cm-line').allTextContents();
  await expect.poll(tab, { timeout: 15_000 }).toContain('// added typed');
  // Taken back in the diff: the file as it was.
  for (let i = 0; i < ' typed'.length; i++) await window.keyboard.press('Backspace');
  await expect.poll(tab, { timeout: 15_000 }).toContain('// added');
  expect(await tab()).not.toContain('// added typed');
  await window.close();
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
  // The host's git first: once later than poll's 1 s on Windows in CI (#180, 2026-11-11).
  await expect
    .poll(() => shown.locator('.playground-push__target').textContent(), { timeout: 15_000 })
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
  const { url, server, requests } = await gitServer(root, 'ido', 'secret');
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
  try {
    await login.waitFor({ timeout: 15_000 });
  } catch (error) {
    // Not asked in time on macOS in CI, once (#233, 2026-11-12), and Push stayed busy for the
    // tests after: what was seen, whether git reached the server, and whether it asked later.
    await seen();
    console.log('Requests:', requests);
    await measure(() => login.isVisible());
    console.log('Requests by then:', requests);
    throw error;
  }
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
  const pushing = () => page().locator('.cerebro-statusbar').getByText('Pushing…').isVisible();
  console.log('Pushing… once the remote has it:', await pushing());
  // Push is off until it ends, and the next test pushes. Not the measured cause of that test's
  // failures on Windows (see the backlog): it had ended when the remote had it, in the run after.
  await expect.poll(pushing, { timeout: 15_000 }).toBe(false);
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
    console.log('Status bar:', await page().locator('.cerebro-statusbar').innerText());
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
  // View Commits: the Git window's Log, with the commit it brought alone.
  await page()
    .locator('.cerebro-balloon', { hasText: '1 file updated in 1 commit' })
    .locator('.cerebro-notification__action', { hasText: 'View Commits' })
    .click();
  await expect
    .poll(() => page().locator('.playground-log__message').allTextContents(), { timeout: 15_000 })
    .toEqual(['Theirs']);
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

it('commits a merge started elsewhere, resolved from the Commit window, with git’s message', async () => {
  // A branch that changed a.ts as this one did: merged in a terminal, it stops at a conflict.
  const commitAs = (...args: string[]) => git('-c', 'user.name=t', '-c', 'user.email=t@t', ...args);
  git('checkout', '-qb', 'side');
  writeFileSync(join(repo, 'a.ts'), 'a side\n');
  commitAs('commit', '-qm', 'Side to a', '--', 'a.ts');
  git('checkout', '-q', 'main');
  writeFileSync(join(repo, 'a.ts'), 'a main\n');
  commitAs('commit', '-qm', 'Main to a', '--', 'a.ts');
  expect(() => commitAs('merge', 'side')).toThrow();
  await page().keyboard.press(KEYS.commit);
  const conflicts = page().locator('.cerebro-tree-row', { hasText: 'Merge Conflicts' });
  await conflicts.waitFor({ timeout: 15_000 });
  await conflicts.locator('.playground-link', { hasText: 'Resolve' }).click();
  const dialog = page().locator('.cerebro-dialog', {
    hasText: 'Merging branch side into branch main',
  });
  await dialog.locator('.cerebro-dialog__button', { hasText: 'Accept Theirs' }).click();
  await dialog.waitFor({ state: 'detached' });
  // The merge's message, as git wrote it, to commit with.
  await expect
    .poll(() => message().inputValue(), { timeout: 15_000 })
    .toBe("Merge branch 'side'\n\n# Conflicts:\n#\ta.ts\n");
  // And the resolved file in the list, put in: the message can come first (it's read from git's
  // state, the list apart), and Commit with nothing put in says "Select files to commit", as
  // IntelliJ's (seen on Windows and macOS in CI, 2026-11-11).
  await expect
    .poll(() => row('changes:a.ts').locator('.playground-changes__include').isChecked(), {
      timeout: 15_000,
    })
    .toBe(true);
  await message().click();
  await page().keyboard.press('Control+Enter');
  try {
    await expect
      .poll(() => git('log', '-1', '--format=%s %p').trim().split(' ').length, { timeout: 15_000 })
      .toBe(5);
  } catch (error) {
    // Not committed in time on Windows in CI (#161, #162, 2026-11-11): what was seen.
    await seen();
    await measure(() => git('log', '-1', '--format=%p').trim().includes(' '));
    throw error;
  }
  expect(git('log', '-1', '--format=%s')).toBe("Merge branch 'side'\n");
  expect(git('show', 'HEAD:a.ts')).toBe('a side\n');
});

it('fetches every remote, then pulls a branch of one from Git → Pull…, as IntelliJ’s', async () => {
  // Another clone's branch, pushed: not here until fetched.
  const other = join(root, 'other');
  const inOther = (...args: string[]) => execFileSync('git', args, { cwd: other });
  inOther('checkout', '-qb', 'feature');
  writeFileSync(join(other, 'pulled.txt'), 'Pulled');
  inOther('add', 'pulled.txt');
  inOther('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'Pulled');
  inOther('push', '-q', 'origin', 'feature');
  const titles = () =>
    page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents();
  await action('Fetch');
  await expect.poll(titles, { timeout: 15_000 }).toContain('Fetch successful');
  expect(git('branch', '-r', '--format=%(refname:short)')).toContain('origin/feature');
  await action('Pull');
  const dialog = page().locator('.cerebro-dialog', {
    has: page().locator('.playground-git-command'),
  });
  await dialog.waitFor();
  expect(await dialog.locator('.cerebro-dialog__title').textContent()).toBe('Pull to main');
  await dialog.locator('.playground-git-branch__field').fill('feature');
  await dialog.locator('.cerebro-dialog__button', { hasText: 'Pull' }).click();
  try {
    await expect
      .poll(() => git('log', '-1', '--format=%s'), { timeout: 15_000 })
      .toMatch(/^Merge branch 'feature' of /);
  } catch (error) {
    // Not pulled in time on Windows in CI twice (#161, #162, 2026-11-11), after the test before
    // failed: what was seen.
    await seen();
    await measure(() => git('log', '-1', '--format=%s').startsWith("Merge branch 'feature' of "));
    throw error;
  }
  expect(git('show', 'HEAD:pulled.txt')).toBe('Pulled');
  await expect.poll(titles, { timeout: 15_000 }).toContain('1 file updated in 1 commit');
});

it('merges a branch from Git → Merge…, with the options chosen, as IntelliJ’s', async () => {
  const commitAs = (...args: string[]) => git('-c', 'user.name=t', '-c', 'user.email=t@t', ...args);
  git('checkout', '-qb', 'topic');
  writeFileSync(join(repo, 'topic.txt'), 'Topic');
  git('add', 'topic.txt');
  commitAs('commit', '-qm', 'Topic');
  git('checkout', '-q', 'main');
  await action('Merge');
  const dialog = page().locator('.cerebro-dialog', { hasText: 'git merge' });
  await dialog.waitFor();
  expect(await dialog.locator('.cerebro-dialog__title').textContent()).toBe('Merge into main');
  await dialog.locator('.playground-git-branch__field').fill('topic');
  // A merge commit, though it could fast-forward.
  await dialog.locator('button', { hasText: 'Modify options' }).click();
  await page().locator('.cerebro-popup-item', { hasText: 'Create a merge commit even if' }).click();
  await page().keyboard.press('Escape');
  await dialog.locator('.cerebro-dialog__button', { hasText: 'Merge' }).click();
  await expect
    .poll(() => git('log', '-1', '--format=%s'), { timeout: 15_000 })
    .toBe("Merge branch 'topic'\n");
  await expect
    .poll(() => page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents(), {
      timeout: 15_000,
    })
    .toContain('1 file updated in 1 commit');
});

it('rebases the branch onto another from Git → Rebase…, as IntelliJ’s', async () => {
  const commitAs = (...args: string[]) => git('-c', 'user.name=t', '-c', 'user.email=t@t', ...args);
  git('checkout', '-qb', 'base');
  writeFileSync(join(repo, 'base.txt'), 'Base');
  git('add', 'base.txt');
  commitAs('commit', '-qm', 'Base');
  git('checkout', '-q', 'main');
  writeFileSync(join(repo, 'mine.txt'), 'Mine');
  git('add', 'mine.txt');
  commitAs('commit', '-qm', 'Mine');
  await action('Rebase');
  const dialog = page().locator('.cerebro-dialog', { hasText: 'git rebase' });
  await dialog.waitFor();
  expect(await dialog.locator('.cerebro-dialog__title').textContent()).toBe('Rebase');
  await dialog.locator('input[aria-label="Base"]').fill('base');
  await dialog.locator('.cerebro-dialog__button', { hasText: /^Rebase$/ }).click();
  const titles = () =>
    page().locator('.cerebro-balloon .cerebro-notification__title').allTextContents();
  try {
    await expect.poll(titles, { timeout: 15_000 }).toContain('Rebase successful');
  } catch (error) {
    await seen();
    throw error;
  }
  // On top of base: its commit under main's.
  expect(git('log', '-1', '--format=%s')).toBe('Mine\n');
  expect(() => git('merge-base', '--is-ancestor', 'base', 'HEAD')).not.toThrow();
});
