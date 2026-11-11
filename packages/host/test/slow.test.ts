import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_MS, SLOW_MS, TimedConnection, timed, watchEventLoop } from '../src/slow.js';

describe('what’s slow in the host', () => {
  it('reports a task that took longer than git should, failed or not', async () => {
    const log = vi.fn();
    let time = 0;
    const now = () => time;
    expect(await timed('quick', () => Promise.resolve(1), log, now)).toBe(1);
    expect(log).not.toHaveBeenCalled();
    const slow = () => {
      time += SLOW_MS + 1;
      return Promise.reject(new Error('no'));
    };
    await expect(timed('git commit in /r', slow, log, now)).rejects.toThrow('no');
    expect(log).toHaveBeenCalledWith(`Slow: git commit in /r took ${String(SLOW_MS + 1)} ms`);
  });

  it('reports a task still going once it’s slow, so one that never ends is seen', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let finish: (() => void) | undefined;
    const task = timed(
      'git commit in /r',
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      log,
      () => 0,
    );
    vi.advanceTimersByTime(SLOW_MS - 1);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledWith(
      `Slow: git commit in /r still going after ${String(SLOW_MS)} ms`,
    );
    finish?.();
    await task;
    // Done quickly: no word once it's passed.
    await timed(
      'quick',
      () => Promise.resolve(),
      log,
      () => 0,
    );
    vi.advanceTimersByTime(SLOW_MS);
    expect(log).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('reports an event loop held up, whose, until stopped', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let time = 0;
    const stop = watchEventLoop("the app's", log, () => time, 500);
    time = 500;
    vi.advanceTimersByTime(500);
    expect(log).not.toHaveBeenCalled();
    time = 1000 + BLOCKED_MS + 1;
    vi.advanceTimersByTime(500);
    expect(log).toHaveBeenCalledWith(
      `Blocked: the app's event loop was held up ${String(BLOCKED_MS + 1)} ms`,
    );
    stop();
    time += 10_000;
    vi.advanceTimersByTime(500);
    expect(log).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('says it on the standard error by default', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let time = 0;
    await timed(
      'slow',
      () => {
        time = SLOW_MS * 2;
        return Promise.resolve();
      },
      undefined,
      () => time,
    );
    expect(error).toHaveBeenCalledWith(`Slow: slow took ${String(SLOW_MS * 2)} ms`);
    vi.useFakeTimers();
    watchEventLoop("the host's")();
    vi.useRealTimers();
    await timed('quick', () => Promise.resolve());
    new TimedConnection(() => undefined).onRequest('quick', () => 1);
    error.mockRestore();
  });

  it('reports a request answered slowly, with its method, its answer as it was', async () => {
    const log = vi.fn();
    let time = 0;
    const sent: unknown[] = [];
    const connection = new TimedConnection(
      (line) => sent.push(JSON.parse(line)),
      log,
      () => time,
    );
    connection.onRequest('git.commit', (params) => {
      time = SLOW_MS + 1;
      return params;
    });
    connection.onRequest('quick', () => 'done');
    connection.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'quick' }));
    // Answered before the slow one moves the clock.
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    connection.receive(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'git.commit', params: 'x' }),
    );
    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent).toEqual([
      { jsonrpc: '2.0', id: 1, result: 'done' },
      { jsonrpc: '2.0', id: 2, result: 'x' },
    ]);
    expect(log.mock.calls).toEqual([[`Slow: request git.commit took ${String(SLOW_MS + 1)} ms`]]);
  });
});
