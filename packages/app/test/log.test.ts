import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { logPage, writeLog } from '../src/log.js';

type Listener = (...args: unknown[]) => void;

const logFile = () => join(mkdtempSync(join(tmpdir(), 'cerebro-log-')), 'pages.log');

/** A page that remembers its listeners, so a test can fire its events. */
function fakePage() {
  const listeners = new Map<string, Listener>();
  const contents = {
    id: 7,
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
    },
  };
  const fire = (event: string, ...args: unknown[]) => {
    (listeners.get(event) as Listener)(...args);
  };
  return { contents: contents as unknown as WebContents, fire };
}

describe('writeLog', () => {
  it('appends a line with the time and the page', () => {
    const file = logFile();
    writeLog(file, '1', 'one', new Date('2026-10-27T10:00:00Z'));
    writeLog(file, '2', 'two', new Date('2026-10-27T10:00:01Z'));
    expect(readFileSync(file, 'utf8')).toBe(
      '2026-10-27T10:00:00.000Z [1] one\n2026-10-27T10:00:01.000Z [2] two\n',
    );
  });

  it('never fails, saying when it can’t write', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeLog(join(logFile(), 'no', 'such', 'folder'), '1', 'lost');
    expect(error).toHaveBeenCalledWith('Could not write to the log', expect.any(Error));
    error.mockRestore();
  });
});

describe('logPage', () => {
  it('logs a page’s errors, failed loads, preload errors and crashes', () => {
    const file = logFile();
    const { contents, fire } = fakePage();
    logPage(contents, file);
    fire('console-message', { level: 'info', message: 'fine', sourceId: 'a.js', lineNumber: 1 });
    fire('console-message', {
      level: 'error',
      message: 'Uncaught boom',
      sourceId: 'b.js',
      lineNumber: 2,
    });
    fire('did-fail-load', {}, -3, 'ERR_ABORTED', 'file:///frame.html', false);
    fire('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///index.html', true);
    const error = new Error('no preload');
    error.stack = 'Error: no preload\n    at preload.cjs:1';
    fire('preload-error', {}, '/preload.cjs', error);
    fire('preload-error', {}, '/preload.cjs', { message: 'no stack' });
    fire('render-process-gone', {}, { reason: 'oom', exitCode: 9 });
    const lines = readFileSync(file, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => line.replace(/^\S+ /, ''));
    expect(lines).toEqual([
      '[7] error: Uncaught boom (b.js:2)',
      '[7] load failed: file:///index.html: ERR_FILE_NOT_FOUND (-6)',
      '[7] preload failed: /preload.cjs: Error: no preload',
      '    at preload.cjs:1',
      '[7] preload failed: /preload.cjs: no stack',
      '[7] page gone: oom (exit code 9)',
    ]);
  });
});
