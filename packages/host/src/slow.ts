// What's slow, on the standard error. The app has stalled for tens of seconds in CI now and then, a
// commit or a pull done long after it was asked for, with nothing to show where (the backlog): this
// says whether git took the time, a request in the host, the way to the host and back, or an event
// loop held up (the host's or the app's).

import { Connection, type RequestHandler } from '@cerebro-ide/protocol';

/** Longer than this, and git's command or the request is reported. */
export const SLOW_MS = 5000;
/** Longer than this between the event loop's turns, and it's reported as held up. */
export const BLOCKED_MS = 2000;

type Log = (message: string) => void;
const stderr: Log = (message) => {
  console.error(message);
};

/** Runs `task`, reporting it as `what` if it took longer than `SLOW_MS`. */
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
    if (took > SLOW_MS) log(`Slow: ${what} took ${String(Math.round(took))} ms`);
  }
}

/**
 * Reports `whose` event loop held up: a timer every `every` ms that ran more than `BLOCKED_MS`
 * late. Returns what stops it.
 */
export function watchEventLoop(
  whose: string,
  log: Log = stderr,
  now: () => number = () => performance.now(),
  every = 500,
): () => void {
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const late = at - last - every;
    if (late > BLOCKED_MS)
      log(`Blocked: ${whose} event loop was held up ${String(Math.round(late))} ms`);
    last = at;
  }, every);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}

/** A connection that reports each request it answers that took longer than `SLOW_MS`. */
export class TimedConnection extends Connection {
  constructor(
    send: (line: string) => void,
    private readonly log: Log = stderr,
    private readonly now: () => number = () => performance.now(),
  ) {
    super(send);
  }

  override onRequest(method: string, handler: RequestHandler): void {
    super.onRequest(method, (params, token) =>
      timed(
        `request ${method}`,
        // A handler that throws as it's called fails the request, as the connection's own.
        () => Promise.resolve().then(() => handler(params, token)),
        this.log,
        this.now,
      ),
    );
  }
}
