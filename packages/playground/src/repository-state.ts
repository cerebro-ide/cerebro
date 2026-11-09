// The repository's state, as IntelliJ's GitRepository keeps it: the merge or rebase under way,
// whether files are in conflict, and a merge's message. The Git menu shows Commit Merge, Abort
// Merge, the Rebase menu and Resolve Conflicts… by it, and the Commit window starts with a
// merge's message. The active worktree's is read every few seconds and as the window gets the
// focus, as the Commit window reads its changes, and after Cerebro's own git changes.

import { ObservableMap } from '@cerebro-ide/reactive';
import { active, hostFor, projectOf } from './environments.js';

/** The host's `git.state`. */
export interface RepositoryState {
  operation?: 'merge' | 'rebase';
  conflicts: boolean;
  message?: string;
}

/** How often the active worktree's state is read, as the Commit window's changes are. */
export const STATE_MS = 2000;

const NONE: RepositoryState = { conflicts: false };
const states = new ObservableMap<string, RepositoryState>();

/** A worktree's state, as last read: nothing under way until it has been. */
export function stateOf(worktree: string): RepositoryState {
  return states.get(worktree) ?? NONE;
}

/** Reads a worktree's state again, if it's a git one with a host; set only if it changed. */
export async function readState(worktree: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host || projectOf(worktree)?.git === false) return;
  const state = (await host.request('git.state', { path: worktree })) as RepositoryState;
  if (JSON.stringify(state) !== JSON.stringify(states.get(worktree))) states.set(worktree, state);
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
