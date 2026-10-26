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
  /** Quits and starts the app again with the same data, as a user restarting it. */
  restart(): Promise<void>;
  close(): Promise<void>;
}

async function start(data: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: data },
  });
  const page = await app.firstWindow();
  // Fail fast: a missing element is a failure, not something to wait 30 seconds for.
  page.setDefaultTimeout(5000);
  await page.waitForSelector('.cerebro-toolbar');
  return { app, page };
}

export async function launch(): Promise<Running> {
  const data = await mkdtemp(join(tmpdir(), 'cerebro-e2e-'));
  const messages: string[] = [];
  const listen = (page: Page) => {
    page.on('console', (message) => messages.push(message.text()));
  };
  const first = await start(data);
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
      await running.page.waitForSelector('.cerebro-toolbar');
    },
    async restart() {
      await running.app.close();
      const next = await start(data);
      listen(next.page);
      running.app = next.app;
      running.page = next.page;
    },
    async close() {
      await running.app.close();
      await rm(data, { recursive: true, force: true });
    },
  };
  return running;
}
