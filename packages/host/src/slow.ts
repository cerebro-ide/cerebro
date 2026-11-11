// What's slow in the host, on its standard error. The app has stalled for tens of seconds in CI
// now and then, a commit or a pull done long after it was asked for, with nothing to show where
// (the backlog): this says whether git took the time, or the host's own work held it up.

/** Longer than this, and git's command is reported. */
export const SLOW_GIT_MS = 5000;
/** Longer than this between the event loop's turns, and it's reported as held up. */
export const BLOCKED_MS = 2000;

type Log = (message: string) => void;
const stderr: Log = (message) => {
  console.error(message);
};

/** Runs `task`, reporting it as `what` if it took longer than `SLOW_GIT_MS`. */
export async function timed<T>(
  what: string,
  task: () => Promise<T>,
  log: Log = stderr,
  now: () => number = () => performance.now(),
): Promise<T> {
  const start = now();
  try {
    return await task();
  } finally {
    const took = now() - start;
    if (took > SLOW_GIT_MS) log(`Slow: ${what} took ${String(Math.round(took))} ms`);
  }
}

/**
 * Reports the event loop held up: a timer every `every` ms that ran more than `BLOCKED_MS` late.
 * Returns what stops it.
 */
export function watchEventLoop(
  log: Log = stderr,
  now: () => number = () => performance.now(),
  every = 500,
): () => void {
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const late = at - last - every;
    if (late > BLOCKED_MS)
      log(`Blocked: the host's event loop was held up ${String(Math.round(late))} ms`);
    last = at;
  }, every);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
