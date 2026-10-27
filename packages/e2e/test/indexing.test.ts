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
// Paths as git writes them, with `/` on every OS.
const gitPath = (...parts: string[]) => join(...parts).replaceAll('\\', '/');

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

it('indexes the worktree as it opens, so the first search is answered at once', async () => {
  const status = running.page.locator('.cerebro-statusbar');
  await status.getByText('Indexed').waitFor({ timeout: 30_000 });
  // Ready before anyone searched.
  await running.page.keyboard.press('ControlOrMeta+Alt+Shift+N');
  await running.page.keyboard.type('Module2999');
  await running.page.locator('.cerebro-popup-item', { hasText: 'Module2999' }).waitFor();
  expect(await running.page.locator('.cerebro-popup-item__label').allTextContents()).toEqual([
    'Module2999',
  ]);
  await running.page.keyboard.press('Escape');
});

it('counts in the status bar while it indexes', async () => {
  // Every text the status bar shows, recorded as it changes: a run over 3,000 small files can
  // start and finish between two looks at the page (it failed that way in CI on Linux and macOS).
  await running.page.evaluate(() => {
    const bar = document.querySelector('.cerebro-statusbar') as Element;
    const seen: string[] = [];
    (window as { statusTexts?: string[] }).statusTexts = seen;
    new MutationObserver(() => seen.push(bar.textContent)).observe(bar, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  // Indexed again, the same way the page asks, once the last indexing is no longer reused.
  await expect
    .poll(
      () =>
        running.page.evaluate(async (worktree) => {
          const { cerebro, statusTexts } = window as unknown as {
            cerebro: {
              project: { current(): Promise<{ path: string }[]> };
              host: {
                request(project: string, method: string, params: unknown): Promise<unknown>;
              };
            };
            statusTexts: string[];
          };
          const [project] = await cerebro.project.current();
          await cerebro.host.request(project?.path ?? '', 'index.warm', { worktree });
          return statusTexts.some((text) => /Indexing… [\d,]+ \/ 3,000/.test(text));
        }, gitPath(repo)),
      { timeout: 20_000, interval: 500 },
    )
    .toBe(true);
  await running.page.locator('.cerebro-statusbar').getByText('Indexed').waitFor();
});
