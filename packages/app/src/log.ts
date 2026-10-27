// A log of what goes wrong in a window's page: its errors, a load that fails, a preload that throws,
// a page that crashes. It's appended to a file in the app's data folder, so a failure seen once
// leaves evidence behind.

import { appendFileSync } from 'node:fs';
import type { WebContents } from 'electron';

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

/** Logs a page's errors, failed loads, preload errors and crashes to `file`. */
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
  contents.on('render-process-gone', (_event, { reason, exitCode }) => {
    log(`page gone: ${reason} (exit code ${String(exitCode)})`);
  });
}
