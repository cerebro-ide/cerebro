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
  try {
    await page
      .locator('.cerebro-popup-item', { hasText: new RegExp(`^${name}`) })
      .first()
      .click({ force: true });
  } catch (error) {
    // Not found once, after a diff window closed (shelf.test, the whole run): what was shown.
    console.log(
      `Find Action without "${name}":`,
      await page.evaluate(() => ({
        field: document.querySelector<HTMLInputElement>('.cerebro-popup input')?.value,
        items: [...document.querySelectorAll('.cerebro-popup-item')].map((i) => i.textContent),
        focused: document.activeElement?.className,
        hasFocus: document.hasFocus(),
      })),
    );
    throw error;
  }
}

/**
 * The diff window `open` opens (a diff opens in a window of its own), once it shows the diff, read
 * through the host. Its console goes with the app's.
 */
export async function diffWindow(running: Running, open: () => Promise<void>): Promise<Page> {
  const [window] = await Promise.all([running.app.waitForEvent('window'), open()]);
  window.setDefaultTimeout(5000);
  window.on('console', (message) => running.messages.push(message.text()));
  await window.locator('.cerebro-editor-diff').waitFor({ timeout: 15_000 });
  return window;
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

/**
 * Installed in every page: says on the console when no animation frame came for over a second, the
 * page's visibility and focus then. Playwright's click waits for an element to be "stable" over
 * frames, and under xvfb in CI some clicks waited forever (testing.md): this is to see whether the
 * page stopped making frames then, and why. And when the window is resized or loses focus, either
 * of which closes a popup (ui-popup): a forced click on a popup's item failed as "not visible" in CI
 * (#181, 2026-11-11), which is what Playwright says of an element no longer in the page.
 */
function watchFrames(): void {
  const page = window as unknown as { framesWatched?: boolean };
  if (page.framesWatched) return;
  page.framesWatched = true;
  let last = performance.now();
  let stalled = false;
  const frame = () => {
    const now = performance.now();
    if (stalled) {
      console.warn(`Frames: again after ${String(Math.round(now - last))} ms`);
      stalled = false;
    }
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.addEventListener('resize', () => {
    console.warn(`Window: resized to ${String(innerWidth)}x${String(innerHeight)}`);
  });
  window.addEventListener('blur', () => {
    console.warn('Window: lost focus');
  });
  setInterval(() => {
    const gap = performance.now() - last;
    if (stalled || gap < 1000) return;
    stalled = true;
    console.warn(
      `Frames: none for ${String(Math.round(gap))} ms, ${document.visibilityState}, ` +
        (document.hasFocus() ? 'focused' : 'not focused'),
    );
  }, 250);
}

/**
 * Says what the harness measured, on the standard error itself: Vitest shows a test's console only
 * when it fails (measured: a passing file's `console.log` didn't show), and these are wanted from
 * every run, a stall's cause being in the runs that passed too.
 */
function report(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function start(
  data: string,
  env: Record<string, string>,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: [APP],
    env: { ...process.env, CEREBRO_USER_DATA: data, ...env },
  });
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  await app.context().addInitScript(watchFrames);
  const page = await app.firstWindow();
  // The first window may have loaded before the script was added.
  await page.evaluate(watchFrames).catch(() => undefined);
  // Fail fast: a missing element is a failure, not something to wait 30 seconds for.
  page.setDefaultTimeout(5000);
  // But a window to be ready: the first start of a run took over 5 s on macOS and on Windows in CI
  // (#179, 2026-11-11), the others 0.2–0.9 s (their traces). Why is in the backlog; how long it
  // took is said when it's slow.
  const asked = performance.now();
  await page.waitForSelector(READY, { timeout: 30_000 });
  const took = performance.now() - asked;
  if (took > 2000) report(`The window took ${String(Math.round(took))} ms to be ready`);
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
  /** Each window's frames that stopped coming, resizes and lost focus (`watchFrames`), by window and time. */
  const frames: string[] = [];
  const listen = ({ app, page }: { app: ElectronApplication; page: Page }) => {
    page.on('console', (message) => messages.push(message.text()));
    const watch = (window: Page, name: string) => {
      window.on('console', (message) => {
        const text = message.text();
        if (/^(Frames|Window): /.test(text)) {
          frames.push(`${text} (${name}, ${new Date().toISOString().slice(11, 23)})`);
        }
      });
    };
    watch(page, 'the first window');
    app.on('window', (window) => {
      watch(window, window.url().replace(/^.*#/, '#').slice(0, 40));
    });
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
      for (const line of [...reported, ...frames]) report(line);
      await rm(data, { recursive: true, force: true });
    },
  };
  return running;
}
