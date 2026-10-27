// Launching the built desktop app for a test file: a throwaway data folder each time, so tests never
// touch the user's settings, and a fresh page for each test. Each run of the app records a
// Playwright trace (screenshots, the page's DOM, each action and what it waited for) into
// packages/e2e/traces/, which CI keeps when the tests fail: open one with
// `npx playwright show-trace <file>`.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';
import { expect } from 'vitest';

/** The app's package, which Electron runs. */
export const APP = fileURLToPath(new URL('../../app', import.meta.url));
const TRACES = fileURLToPath(new URL('../traces', import.meta.url));

/**
 * The keys of the default keymap, IntelliJ's for the system the tests run on, where they differ
 * between macOS and the others (decision "Ready-made keymaps").
 */
const mac = process.platform === 'darwin';
export const KEYS = {
  settings: mac ? 'Meta+Comma' : 'Control+Alt+S',
  goToFile: mac ? 'Meta+Shift+O' : 'Control+Shift+N',
  goToSymbol: mac ? 'Meta+Alt+O' : 'Control+Alt+Shift+N',
  groupByDirectory: mac ? 'Control+P' : 'Control+Alt+P',
  darkTheme: 'Control+Backquote',
} as const;

let runs = 0;

/** Saves the app's trace, named for the test file, and closes the app. */
async function stop(app: ElectronApplication): Promise<void> {
  const file = basename(expect.getState().testPath ?? 'e2e', '.ts');
  await app.context().tracing.stop({ path: join(TRACES, `${file}-${String(++runs)}.zip`) });
  await app.close();
}

export interface Running {
  app: ElectronApplication;
  page: Page;
  /** The page's console messages since the last reset. */
  messages: string[];
  /** Clears what the page saved and reloads it, for a test to start fresh. */
  reset(): Promise<void>;
  /** Quits and starts the app again with the same data, as a user restarting it. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

/** What shows once a window is ready: the main toolbar, or the Welcome window. */
const READY = '.cerebro-toolbar, .playground-welcome';

async function start(
  data: string,
  env: Record<string, string>,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: data, ...env },
  });
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  const page = await app.firstWindow();
  // Fail fast: a missing element is a failure, not something to wait 30 seconds for.
  page.setDefaultTimeout(5000);
  await page.waitForSelector(READY);
  return { app, page };
}

/**
 * Launches the app; `env` adds to its environment (such as CEREBRO_REPO, the repository to open).
 * Without CEREBRO_REPO it opens the projects open when it last quit, else the Welcome window.
 */
export async function launch(env: Record<string, string> = {}): Promise<Running> {
  const data = await mkdtemp(join(tmpdir(), 'cerebro-e2e-'));
  const messages: string[] = [];
  const listen = (page: Page) => {
    page.on('console', (message) => messages.push(message.text()));
  };
  const first = await start(data, env);
  listen(first.page);
  const running: Running = {
    ...first,
    messages,
    async reset() {
      await running.page.evaluate(() => {
        localStorage.clear();
      });
      messages.length = 0;
      await running.page.reload();
      await running.page.waitForSelector(READY);
    },
    async restart() {
      await stop(running.app);
      const next = await start(data, env);
      listen(next.page);
      running.app = next.app;
      running.page = next.page;
    },
    async close() {
      await stop(running.app);
      await rm(data, { recursive: true, force: true });
    },
  };
  return running;
}
