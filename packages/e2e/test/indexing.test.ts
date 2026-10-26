// The index warms up when a worktree opens, with its progress in the status bar.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { launch, type Running } from './app.js';

let running: Running;
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-index-')));
const repo = join(root, 'big');
const FILES = 3000;

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  for (let i = 0; i < FILES; i++) {
    writeFileSync(
      join(repo, `module${String(i)}.ts`),
      `export class Module${String(i)} { run() { return ${String(i)}; } }\n`,
    );
  }
  running = await launch({ CEREBRO_REPO: repo });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

it('indexes the worktree as it opens, counting in the status bar, until it’s done', async () => {
  const status = running.page.locator('.cerebro-statusbar');
  // Seen while it runs: how many of the files are done.
  await status.getByText(/Indexing… [\d,]+ \/ 3,000/).waitFor({ timeout: 20_000 });
  await status.getByText('Indexed').waitFor({ timeout: 30_000 });
  // Ready before anyone searched: the first search is answered at once.
  await running.page.keyboard.press('ControlOrMeta+Alt+Shift+N');
  await running.page.keyboard.type('Module2999');
  await running.page.locator('.cerebro-popup-item', { hasText: 'Module2999' }).waitFor();
  expect(await running.page.locator('.cerebro-popup-item__label').allTextContents()).toEqual([
    'Module2999',
  ]);
});
