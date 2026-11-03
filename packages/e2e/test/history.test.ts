// Local History end to end: a file's versions, saved and changed outside the app, shown with what
// changed them; reverting to one; and a label put.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { KEYS, launch, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-history-')));
const repo = join(root, 'project');
const file = join(repo, 'a.ts');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
/** Through the host, which runs git: longer than `expect.poll`'s second (rule "End-to-end"). */
const HOST = { timeout: 15_000 };

const page = () => running.page;
/** A file's text, with LF line ends: git may check files out with CRLF. */
const disk = () => readFileSync(file, 'utf8').replace(/\r/g, '');
const button = (text: string) => page().locator('.cerebro-dialog__button', { hasText: text });

/** The versions Show History lists: their labels. */
const labels = () =>
  page().locator('.playground-history__revision .playground-history__label').allTextContents();

/** Runs a Local History command from the editor's context menu. */
async function fromEditor(command: string): Promise<void> {
  await page().locator('.cm-content').first().click({ button: 'right' });
  await page().locator('.cerebro-menu-item', { hasText: 'Local History' }).hover();
  await page().locator('.cerebro-menu-item', { hasText: command }).click();
}

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(file, 'first\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'First');
  running = await launch({ CEREBRO_REPO: repo, CEREBRO_LANGUAGE_SERVERS: '' });
  await page().keyboard.press(KEYS.goToFile);
  await page().keyboard.type('a.ts');
  await page().locator('.cerebro-popup-item', { hasText: 'a.ts' }).waitFor();
  await page().keyboard.press('Enter');
  await page().locator('.cm-line').first().click();
  await page().keyboard.press('End');
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('lists a file’s versions with what changed them, and reverts to one', async () => {
  // Saved: recorded after the file as found.
  await page().keyboard.type('x');
  await page().keyboard.press('ControlOrMeta+s');
  await expect.poll(disk, HOST).toBe('firstx\n');
  // Changed outside the app: recorded when Show History opens.
  writeFileSync(file, 'outside\n');
  await expect.poll(() => page().locator('.cm-line').first().textContent(), HOST).toBe('outside');
  await fromEditor('Show History');
  await expect.poll(labels, HOST).toEqual(expect.arrayContaining(['External change']));
  const all = await labels();
  expect(all[0]).toBe('External change');
  // The first: the file as found.
  await page().locator('.playground-history__revision').last().click();
  await page().locator('.playground-history__diff .cerebro-editor-diff').waitFor();
  await button('Revert').click();
  await expect.poll(disk, HOST).toBe('first\n');
  await expect.poll(() => page().locator('.cm-line').first().textContent(), HOST).toBe('first');
  // Reverting is recorded too.
  await fromEditor('Show History');
  await expect.poll(async () => (await labels())[0], HOST).toBe('Revert');
  await button('Close').click();
});

it('puts a label, listed first in bold', async () => {
  await fromEditor('Put Label');
  await page().keyboard.type('Before the refactoring');
  await button('OK').click();
  await fromEditor('Show History');
  await expect.poll(async () => (await labels())[0], HOST).toBe('Before the refactoring');
  expect(await page().locator('.playground-history__label--put').first().textContent()).toBe(
    'Before the refactoring',
  );
  await button('Close').click();
});
