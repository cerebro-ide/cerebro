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
  commit: mac ? 'Meta+K' : 'Control+K',
  push: mac ? 'Meta+Shift+K' : 'Control+Shift+K',
  update: mac ? 'Meta+T' : 'Control+T',
  amend: mac ? 'Control+Alt+M' : 'Alt+M',
  darkTheme: 'Control+Backquote',
  undo: mac ? 'Meta+Z' : 'Control+Z',
  quickDocumentation: mac ? 'F1' : 'Control+Q',
  parameterInfo: mac ? 'Meta+P' : 'Control+P',
  fileStructure: mac ? 'Meta+F12' : 'Control+F12',
  // The letter as a keyboard sends it with Ctrl+Alt held, not Playwright's `L` (a claim): with Ctrl
  // and Alt, CodeMirror finds a key on Windows by the letter only (AltGr's there), measured.
  reformat: mac ? 'Meta+Alt+l' : 'Control+Alt+l',
  // By the key: Playwright then sends `_` and `+` with Shift held, as a keyboard does.
  collapseAll: mac ? 'Meta+Shift+Minus' : 'Control+Shift+Minus',
  expandAll: mac ? 'Meta+Shift+Equal' : 'Control+Shift+Equal',
  prettier: mac ? 'Meta+Alt+Shift+P' : 'Control+Alt+Shift+P',
  zoomOut: mac ? 'Meta+Minus' : 'Control+Minus',
} as const;

let runs = 0;

/** Saves the app's trace, named for the test file, and closes the app. */
async function stop(app: ElectronApplication): Promise<void> {
  const file = basename(expect.getState().testPath ?? 'e2e', '.ts');
  await app.context().tracing.stop({ path: join(TRACES, `${file}-${String(++runs)}.zip`) });
  await app.close();
}

/** Runs an action by its name, from Find Action. */
export async function findAction(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+A');
  await page.keyboard.type(name);
  await page
    .locator('.cerebro-popup-item', { hasText: new RegExp(`^${name}`) })
    .first()
    .click({ force: true });
}

export interface Running {
  app: ElectronApplication;
  page: Page;
  /** The page's console messages since the last reset. */
  messages: string[];
  /** What the app and its hosts wrote on their standard error (the hosts' slow git, say). */
  output: string[];
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
  const output: string[] = [];
  const listen = ({ app, page }: { app: ElectronApplication; page: Page }) => {
    page.on('console', (message) => messages.push(message.text()));
    app.process().stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  };
  const first = await start(data, env);
  listen(first);
  const running: Running = {
    ...first,
    messages,
    output,
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
      listen(next);
      running.app = next.app;
      running.page = next.page;
    },
    async close() {
      await stop(running.app);
      // What was slow or held up, from any test of the file: a stall's cause (the backlog).
      const reported = output
        .join('')
        .split('\n')
        .filter((line) => /^(Slow|Blocked): /.test(line));
      if (reported.length > 0) console.log(reported.join('\n'));
      await rm(data, { recursive: true, force: true });
    },
  };
  return running;
}
