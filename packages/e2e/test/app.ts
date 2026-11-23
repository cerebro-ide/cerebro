// Launching the built desktop app for a test file: a throwaway data folder each time, so tests never
// touch the user's settings, and a fresh page for each test. Each run of the app records a
// Playwright trace (screenshots, the page's DOM, each action and what it waited for) into
// packages/e2e/traces/, which CI keeps when the tests fail: open one with
// `npx playwright show-trace <file>`.

import { execFileSync, type ChildProcess } from 'node:child_process';
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

/**
 * Runs a step of closing, saying which it was if it's still running after 20 s: closing once ran
 * past the hook's 60 s, all of host.test's tests passed (a local run, 2026-11-16), and which step
 * held it up isn't known (the backlog).
 */
async function closing(step: string, run: () => Promise<void>): Promise<void> {
  const timer = setTimeout(() => {
    report(`Slow: ${step} still running after 20 s`);
  }, 20_000);
  try {
    await run();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Each app's process, kept from its launch: Playwright's `process()` throws once it has seen the
 * app close (measured: quit.test on Windows in CI).
 */
const processes = new WeakMap<ElectronApplication, ChildProcess>();

/** A process the app started, by its id and its program's name. */
export interface Child {
  pid: number;
  name: string;
}

/**
 * The processes under `pid`, its children and theirs: from Windows' process table (CIM), else
 * `ps`'s. Its hosts among them, which outlive the app's own process as they finish (measured on
 * Linux: the host and its terminal's process ran on 500 ms after the app had exited).
 */
export function processesUnder(pid: number): Child[] {
  // On Windows a process keeps its parent's id after that parent ends, and the id may then be
  // another's (Microsoft's Win32_Process docs): a child is one started after its parent.
  const rows =
    process.platform === 'win32'
      ? execFileSync('powershell', [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.Ticks) $($_.Name)" }',
        ])
      : execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm=']);
  const table = rows
    .toString()
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [id, parent, ...rest] = line.trim().split(/\s+/);
      const windows = process.platform === 'win32';
      return {
        pid: Number(id),
        parent: Number(parent),
        born: windows ? Number(rest[0]) : 0,
        name: (windows ? rest.slice(1) : rest).join(' '),
      };
    });
  const born = new Map(table.map((row) => [row.pid, row.born]));
  const under = new Map<number, Child>();
  for (let grew = true; grew;) {
    grew = false;
    for (const row of table) {
      const parentBorn = born.get(row.parent) ?? 0;
      if (
        (row.parent === pid || under.has(row.parent)) &&
        !under.has(row.pid) &&
        row.pid !== pid &&
        row.born >= parentBorn
      ) {
        under.set(row.pid, { pid: row.pid, name: row.name });
        grew = true;
      }
    }
  }
  return [...under.values()];
}

/** Whether a process runs: signal 0 only asks (Node's `process.kill`, on Windows too). */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Resolves once none of `pids` runs. Until then a folder one runs in can't be removed on Windows
 * (EPERM, quit.test in CI, 2026-11-23). Fails after `within`, naming those left.
 */
export async function ended(children: readonly Child[], within = 15_000): Promise<void> {
  const start = performance.now();
  for (;;) {
    const left = children.filter((child) => running(child.pid));
    if (left.length === 0) return;
    if (performance.now() - start > within) {
      const named = left.map((child) => `${child.name} (${String(child.pid)})`).join(', ');
      throw new Error(`The app's processes still run after it quit: ${named}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Saves the app's trace, named for the test file, and closes the app, unless it has quit. */
async function stop(app: ElectronApplication): Promise<void> {
  // A test that quits it (quit.test): there's nothing left to trace or close.
  const child = processes.get(app);
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const under = processesUnder(child.pid as number);
  const file = basename(expect.getState().testPath ?? 'e2e', '.ts');
  const path = join(TRACES, `${file}-${String(++runs)}.zip`);
  await closing(`saving the trace ${path}`, () => app.context().tracing.stop({ path }));
  await closing('closing the app', () => app.close());
  // Its hosts finish after it: what they run in is removed once they have.
  await closing("the app's processes ending", () => ended(under));
}

/** Runs an action by its name, from Find Action. */
export async function findAction(page: Page, name: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+A');
  await page.keyboard.type(name);
  try {
    await page
      .locator('.cerebro-popup-item', { hasText: new RegExp(`^${name}`) })
      .first()
      .click();
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
  await shown(running.app, window);
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
 * Waits for `page`'s window to be on screen. The app shows a window at Electron's `ready-to-show`,
 * once its page has painted; until then the page makes no animation frames, and Playwright's click
 * waits for an element to be "stable" over frames. Measured under xvfb in CI (#202, 2026-11-12):
 * the first launch of a run showed its window 1.7 s and 4.6 s after the page had loaded, with no
 * frames meanwhile; trial clicks failed until it showed, and passed from then on. Later launches
 * showed it within 50 ms. Background throttling off made no difference.
 */
export async function shown(app: ElectronApplication, page: Page): Promise<void> {
  const window = await app.browserWindow(page);
  // Its type, as much as is used here: the tests don't depend on Electron's own.
  type Shown = { isVisible(): boolean; once(event: 'show', listener: () => void): void };
  await window.evaluate(
    (w: Shown) =>
      new Promise<void>((resolve) => {
        if (w.isVisible()) resolve();
        else w.once('show', resolve);
      }),
  );
}

/**
 * Installed in every page: says on the console when its window is resized or loses focus, either
 * of which closes a popup (ui-popup): a forced click on a popup's item failed as "not visible" in CI
 * (#181, 2026-11-11), which is what Playwright says of an element no longer in the page.
 */
function watchWindow(): void {
  const page = window as unknown as { windowWatched?: boolean };
  if (page.windowWatched) return;
  page.windowWatched = true;
  window.addEventListener('resize', () => {
    console.warn(`Window: resized to ${String(innerWidth)}x${String(innerHeight)}`);
  });
  window.addEventListener('blur', () => {
    console.warn('Window: lost focus');
  });
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
  processes.set(app, app.process());
  await app.context().tracing.start({ screenshots: true, snapshots: true });
  await app.context().addInitScript(watchWindow);
  const page = await app.firstWindow();
  // The first window may have loaded before the script was added.
  await page.evaluate(watchWindow).catch(() => undefined);
  // Fail fast: a missing element is a failure, not something to wait 30 seconds for.
  page.setDefaultTimeout(5000);
  // But a window to be ready: the first start of a run took over 5 s on macOS and on Windows in CI
  // (#179, 2026-11-11), the others 0.2–0.9 s (their traces). Why is in the backlog; how long it
  // took is said when it's slow.
  const asked = performance.now();
  await page.waitForSelector(READY, { timeout: 30_000 });
  await shown(app, page);
  const took = performance.now() - asked;
  if (took > 2000) report(`The window took ${String(Math.round(took))} ms to be ready and shown`);
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
  /** Each window's resizes and lost focus (`watchWindow`), by window and time. */
  const seen: string[] = [];
  const listen = ({ app, page }: { app: ElectronApplication; page: Page }) => {
    page.on('console', (message) => messages.push(message.text()));
    const watch = (window: Page, name: string) => {
      window.on('console', (message) => {
        const text = message.text();
        if (text.startsWith('Window: ')) {
          seen.push(`${text} (${name}, ${new Date().toISOString().slice(11, 23)})`);
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
      for (const line of [...reported, ...seen]) report(line);
      await rm(data, { recursive: true, force: true });
    },
  };
  return running;
}
