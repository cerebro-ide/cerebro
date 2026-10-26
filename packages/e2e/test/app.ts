// Launching the built desktop app for a test file: a throwaway data folder each time, so tests never
// touch the user's settings, and a fresh page for each test.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const APP = fileURLToPath(new URL('../../app', import.meta.url));

export interface Running {
  app: ElectronApplication;
  page: Page;
  /** The page's console messages since the last reset. */
  messages: string[];
  /** Clears what the page saved and reloads it, for a test to start fresh. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Launches the app; `env` adds to its environment (such as CEREBRO_REPO, the repository to open). */
export async function launch(env: Record<string, string> = {}): Promise<Running> {
  const data = await mkdtemp(join(tmpdir(), 'cerebro-e2e-'));
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: data, ...env },
  });
  const page = await app.firstWindow();
  // Fail fast: a missing element is a failure, not something to wait 30 seconds for.
  page.setDefaultTimeout(5000);
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  await page.waitForSelector('.cerebro-toolbar');
  return {
    app,
    page,
    messages,
    async reset() {
      await page.evaluate(() => {
        localStorage.clear();
      });
      messages.length = 0;
      await page.reload();
      await page.waitForSelector('.cerebro-toolbar');
    },
    async close() {
      await app.close();
      await rm(data, { recursive: true, force: true });
    },
  };
}
