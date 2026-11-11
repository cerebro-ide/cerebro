import { describe, expect, it, vi } from 'vitest';
import { BLOCKED_MS, SLOW_GIT_MS, timed, watchEventLoop } from '../src/slow.js';

describe('what’s slow in the host', () => {
  it('reports a task that took longer than git should, failed or not', async () => {
    const log = vi.fn();
    let time = 0;
    const now = () => time;
    expect(await timed('quick', () => Promise.resolve(1), log, now)).toBe(1);
    expect(log).not.toHaveBeenCalled();
    const slow = () => {
      time += SLOW_GIT_MS + 1;
      return Promise.reject(new Error('no'));
    };
    await expect(timed('git commit in /r', slow, log, now)).rejects.toThrow('no');
    expect(log).toHaveBeenCalledWith(`Slow: git commit in /r took ${String(SLOW_GIT_MS + 1)} ms`);
  });

  it('reports the event loop held up, until stopped', () => {
    vi.useFakeTimers();
    const log = vi.fn();
    let time = 0;
    const stop = watchEventLoop(log, () => time, 500);
    time = 500;
    vi.advanceTimersByTime(500);
    expect(log).not.toHaveBeenCalled();
    time = 1000 + BLOCKED_MS + 1;
    vi.advanceTimersByTime(500);
    expect(log).toHaveBeenCalledWith(
      `Blocked: the host's event loop was held up ${String(BLOCKED_MS + 1)} ms`,
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
        time = SLOW_GIT_MS * 2;
        return Promise.resolve();
      },
      undefined,
      () => time,
    );
    expect(error).toHaveBeenCalledWith(`Slow: slow took ${String(SLOW_GIT_MS * 2)} ms`);
    vi.useFakeTimers();
    watchEventLoop()();
    vi.useRealTimers();
    await timed('quick', () => Promise.resolve());
    error.mockRestore();
  });
});
