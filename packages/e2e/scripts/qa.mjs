// Runs the built app for a look at it, outside the tests: on a new repository with one commit (or
// --repo), with a throwaway data folder, at a fixed size. Run alone, it saves a screenshot, prints
// the page's console errors, and quits; a script can import `launch` and drive the page instead.
//
//   node packages/e2e/scripts/qa.mjs [--repo <path>] [--out <folder>] [--wait <ms>]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const APP = fileURLToPath(new URL('../../app', import.meta.url));

/** A new repository with a README, committed. */
function newRepository() {
  const repo = mkdtempSync(join(tmpdir(), 'cerebro-qa-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '# QA\n');
  git('add', '.');
  git('-c', 'user.name=qa', '-c', 'user.email=qa@qa', 'commit', '-qm', 'first');
  return repo;
}

/** Starts the app; `errors` collects the page's console errors. */
export async function launch({ repo = newRepository(), width = 1600, height = 1000 } = {}) {
  const data = mkdtempSync(join(tmpdir(), 'cerebro-qa-data-'));
  // Screenshots at one pixel per CSS pixel, whatever the display's scale.
  writeFileSync(join(data, 'display.json'), JSON.stringify({ scale: '1' }));
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: data, CEREBRO_REPO: repo },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForSelector('.cerebro-toolbar');
  return {
    app,
    page,
    repo,
    errors,
    async close() {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at < 0 ? undefined : process.argv[at + 1];
  };
  const repo = option('repo');
  const out = option('out') ?? process.cwd();
  const running = await launch(repo === undefined ? {} : { repo });
  await running.page.waitForTimeout(Number(option('wait') ?? 3000));
  const shot = join(out, 'qa.png');
  await running.page.screenshot({ path: shot });
  console.log(`Screenshot: ${shot}`);
  console.log(
    running.errors.length === 0
      ? 'No console errors.'
      : `Console errors:\n${running.errors.join('\n')}`,
  );
  await running.close();
}
