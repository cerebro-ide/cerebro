// A log of what goes wrong in a window's page: its errors, a load that fails, a preload that throws,
// a page that crashes, a page that stops answering (and what it was running). It's appended to a file in the app's data folder, so a failure seen once
// leaves evidence behind.

import { appendFileSync } from 'node:fs';
import type { Session, WebContents } from 'electron';
import { BLOCKED_MS } from '@cerebro-ide/host/slow';

/** The log's file name, in the app's data folder. */
export const PAGE_LOG = 'pages.log';

/** Appends a line to the log, with the time and the page it's about; never fails. */
export function writeLog(file: string, page: string, text: string, now = new Date()): void {
  try {
    appendFileSync(file, `${now.toISOString()} [${page}] ${text}\n`);
  } catch (error) {
    console.error('Could not write to the log', error);
  }
}

/**
 * Logs a page's errors, failed loads, preload errors and crashes to `file`; and a page held up
 * (`watchPage`), on the standard error too, as the hosts' held-up event loops are.
 */
export function logPage(contents: WebContents, file: string): void {
  const page = String(contents.id);
  const log = (text: string) => {
    writeLog(file, page, text);
  };
  contents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level === 'error') log(`error: ${message} (${sourceId}:${String(lineNumber)})`);
  });
  contents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame) log(`load failed: ${url}: ${description} (${String(code)})`);
  });
  contents.on('preload-error', (_event, path, error) => {
    log(`preload failed: ${path}: ${error.stack ?? error.message}`);
  });
  // Held up, on the standard error too, as the hosts' event loops are.
  watchPage(contents, (text) => {
    log(text);
    console.error(`Blocked: page ${page} ${text}`);
  });
  contents.on('render-process-gone', (_event, { reason, exitCode }) => {
    log(`page gone: ${reason} (exit code ${String(exitCode)})`);
  });
}

/**
 * Asks a page for an answer every `every` ms, once it's loaded, and logs one that took longer than
 * `BLOCKED_MS`, with what it was running then: a stall's cause (the backlog). Electron's own
 * `unresponsive` never came for a page kept busy 55 s with a click waiting (measured on Linux).
 */
export function watchPage(
  contents: WebContents,
  log: (text: string) => void,
  now: () => number = () => performance.now(),
  every = 1000,
): void {
  let next: NodeJS.Timeout | undefined;
  const ask = () => {
    const start = now();
    const late = setTimeout(() => {
      log(`held up over ${String(BLOCKED_MS)} ms`);
      // Never settles if no script runs: the page was waiting, not busy.
      void contents.mainFrame.collectJavaScriptCallStack().then((stack) => {
        // On one line, as each line said is.
        const frames = stack
          ?.trim()
          .split(/\s*\n\s*/)
          .join('; ');
        log(`was running: ${frames || 'unknown'}`);
      });
    }, BLOCKED_MS);
    void contents
      .executeJavaScript('0')
      .catch(() => undefined)
      .then(() => {
        clearTimeout(late);
        const took = now() - start;
        if (took > BLOCKED_MS) log(`answered after ${String(Math.round(took))} ms`);
        if (!contents.isDestroyed()) next = setTimeout(ask, every);
      });
  };
  contents.once('dom-ready', ask);
  contents.once('destroyed', () => {
    clearTimeout(next);
  });
}

/**
 * Lets the main process collect what a page is running (`collectJavaScriptCallStack`): Chromium
 * gives it only for pages that opt in, with this header (its refusal says so, measured), and the
 * feature `start()` turns on.
 */
export function allowCallStacks(session: Session): void {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
      },
    });
  });
}
