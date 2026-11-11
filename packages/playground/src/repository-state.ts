// The repository's state, as IntelliJ's GitRepository keeps it: the merge, rebase or cherry-pick
// under way, whether files are in conflict, a merge's message, and whether there are remotes. The
// Git menu shows Commit Merge, Abort Merge, the Rebase menu, Continue and Abort Cherry-Pick and
// Resolve Conflicts… by it, Fetch is off without remotes, and the Commit window starts with a
// merge's message. The active worktree's is read every few seconds and as the window gets the
// focus, as the Commit window reads its changes, and after Cerebro's own git changes.

import { ObservableMap } from '@cerebro-ide/reactive';
import { active, hostFor, projectOf } from './environments.js';

/** The host's `git.state`. */
export interface RepositoryState {
  operation?: 'merge' | 'rebase' | 'cherry-pick';
  conflicts: boolean;
  message?: string;
  /** Whether it has any remote: unknown (undefined) until read. */
  remotes?: boolean;
}

/** How often the active worktree's state is read, as the Commit window's changes are. */
export const STATE_MS = 2000;

const NONE: RepositoryState = { conflicts: false };
const states = new ObservableMap<string, RepositoryState>();

/** A worktree's state, as last read: nothing under way until it has been. */
export function stateOf(worktree: string): RepositoryState {
  return states.get(worktree) ?? NONE;
}

/** Each worktree's read under way, and the one asked for while it runs. */
const running = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();

function read(worktree: string): Promise<void> {
  queued.delete(worktree);
  const now = (async () => {
    const host = hostFor(worktree);
    if (!host || projectOf(worktree)?.git === false) return;
    const state = (await host.request('git.state', { path: worktree })) as RepositoryState;
    if (JSON.stringify(state) !== JSON.stringify(states.get(worktree))) states.set(worktree, state);
  })().finally(() => running.delete(worktree));
  running.set(worktree, now);
  return now;
}

/**
 * Reads a worktree's state again, if it's a git one with a host; set only if it changed. Asked
 * while a read runs, one more follows it, for all asked meanwhile: each read starts four git
 * processes, and the editing e2e test sends a focus event every 5 ms.
 */
export function readState(worktree: string): Promise<void> {
  const waiting = queued.get(worktree);
  if (waiting) return waiting;
  const before = running.get(worktree);
  if (!before) return read(worktree);
  const next = before.catch(() => undefined).then(() => read(worktree));
  queued.set(worktree, next);
  return next;
}

/** Reads the active worktree's state now, every few seconds after, and as the window gets the focus. */
export function watchState(): void {
  const read = () => {
    const env = active();
    if (!env) return;
    readState(env.id).catch((error: unknown) => {
      console.error('Reading the repository’s state failed', error);
    });
  };
  read();
  setInterval(read, STATE_MS);
  window.addEventListener('focus', read);
}
