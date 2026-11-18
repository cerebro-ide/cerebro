// Quitting end to end: closing the app's last window ends its process, as IntelliJ's (on macOS, the
// last project's window shows the Welcome window first, and closing that quits).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, it } from 'vitest';
import { launch, shown, type Running } from './app.js';

let running: Running;
// The real path: on Windows, the temporary folder can come with an 8.3 short name.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-e2e-quit-')));
const repo = join(root, 'project');

beforeAll(async () => {
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'README.md'), '# project');
  running = await launch({ CEREBRO_REPO: repo, CEREBRO_LANGUAGE_SERVERS: '' });
});

afterAll(async () => {
  await running.close();
  rmSync(root, { recursive: true, force: true });
});

/** Closes the app's one window as its title bar's close button does. */
const closeWindow = () =>
  running.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });

it('quits when its last window closes', { timeout: 30_000 }, async () => {
  const process = running.app.process();
  const exited = new Promise<void>((resolve) => {
    process.once('exit', () => {
      resolve();
    });
  });
  if (globalThis.process.platform === 'darwin') {
    const welcome = running.app.waitForEvent('window');
    await closeWindow();
    const page = await welcome;
    await shown(running.app, page);
    await page.locator('.playground-welcome').waitFor();
  }
  await closeWindow();
  await exited;
});
