import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_MS } from '@cerebro-ide/host/slow';
import { allowCallStacks, logPage, watchPage, writeLog } from '../src/log.js';

type Listener = (...args: unknown[]) => void;

const logFile = () => join(mkdtempSync(join(tmpdir(), 'cerebro-log-')), 'pages.log');

/** A page that remembers its listeners, so a test can fire its events. */
function fakePage() {
  const listeners = new Map<string, Listener>();
  const contents = {
    id: 7,
    once: vi.fn(),
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

describe('watchPage', () => {
  /** A page that answers when told to, and was running `stack` meanwhile. */
  function page(stack: string | undefined) {
    const answers: ((value: unknown) => void)[] = [];
    const failures: ((error: unknown) => void)[] = [];
    let ready: (() => void) | undefined;
    let destroyed: (() => void) | undefined;
    const contents = {
      once: (event: string, listener: () => void) => {
        if (event === 'dom-ready') ready = listener;
        else destroyed = listener;
      },
      executeJavaScript: vi.fn(
        () =>
          new Promise((resolve, reject) => {
            answers.push(resolve);
            failures.push(reject);
          }),
      ),
      isDestroyed: vi.fn(() => false),
      mainFrame: { collectJavaScriptCallStack: () => Promise.resolve(stack) },
    };
    return {
      contents,
      watch: (log: (text: string) => void, now: () => number) => {
        watchPage(contents as unknown as WebContents, log, now, 1000);
      },
      ready: () => ready?.(),
      destroy: () => {
        contents.isDestroyed.mockReturnValue(true);
        destroyed?.();
      },
      answer: () => answers.at(-1)?.(0),
      fail: () => failures.at(-1)?.(new Error('reloaded')),
    };
  }

  it('asks a loaded page every second, and logs one held up, what it ran, and when it answered', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let time = 0;
    const one = page('\n    at spin (main.js:3)\n    at run (main.js:9)');
    one.watch(log, () => time);
    expect(one.contents.executeJavaScript).not.toHaveBeenCalled();
    one.ready();
    expect(one.contents.executeJavaScript).toHaveBeenCalledTimes(1);
    // Answered at once: nothing to say, and asked again a second later.
    one.answer();
    time = 1000;
    await vi.advanceTimersByTimeAsync(1000);
    expect(one.contents.executeJavaScript).toHaveBeenCalledTimes(2);
    // Held up: said once it's late, with what it was running, and how late it answered.
    await vi.advanceTimersByTimeAsync(BLOCKED_MS);
    time = 1000 + BLOCKED_MS + 500;
    one.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(log.mock.calls.map(([text]) => text as string)).toEqual([
      `held up over ${String(BLOCKED_MS)} ms`,
      'was running: at spin (main.js:3); at run (main.js:9)',
      `answered after ${String(BLOCKED_MS + 500)} ms`,
    ]);
    // A failed answer (a reload) is asked again; once the page is gone, never.
    await vi.advanceTimersByTimeAsync(1000);
    one.fail();
    await vi.advanceTimersByTimeAsync(1000);
    expect(one.contents.executeJavaScript).toHaveBeenCalledTimes(4);
    one.answer();
    await vi.advanceTimersByTimeAsync(0);
    one.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(one.contents.executeJavaScript).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('stops asking a page destroyed while it was asked, and says when what it ran is unknown', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const one = page(undefined);
    one.watch(log, () => 0);
    one.ready();
    await vi.advanceTimersByTimeAsync(BLOCKED_MS);
    expect(log).toHaveBeenLastCalledWith('was running: unknown');
    one.destroy();
    one.answer();
    await vi.advanceTimersByTimeAsync(5000);
    expect(one.contents.executeJavaScript).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('logs a page held up on the standard error too, as logPage watches it', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const file = logFile();
    const one = page('at spin (main.js:3)');
    logPage({ ...one.contents, id: 7, on: vi.fn() } as unknown as WebContents, file);
    one.ready();
    await vi.advanceTimersByTimeAsync(BLOCKED_MS);
    expect(error).toHaveBeenCalledWith(`Blocked: page 7 held up over ${String(BLOCKED_MS)} ms`);
    expect(readFileSync(file, 'utf8')).toContain('[7] was running: at spin (main.js:3)');
    one.destroy();
    one.answer();
    error.mockRestore();
    vi.useRealTimers();
  });
});

describe('allowCallStacks', () => {
  it('opts every page in to having what it runs collected, its headers kept', () => {
    let listener: ((details: unknown, callback: (response: unknown) => void) => void) | undefined;
    const session = {
      webRequest: {
        onHeadersReceived: (l: typeof listener) => {
          listener = l;
        },
      },
    };
    allowCallStacks(session as unknown as Session);
    const callback = vi.fn();
    listener?.({ responseHeaders: { 'Content-Type': ['text/html'] } }, callback);
    expect(callback).toHaveBeenCalledWith({
      responseHeaders: {
        'Content-Type': ['text/html'],
        'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
      },
    });
  });
});
