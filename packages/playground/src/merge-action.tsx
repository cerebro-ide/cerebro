// How Pull and Merge go on once git has run, as IntelliJ's `GitMergeAction` (read from its source):
// how it went, why it failed in its words, and at conflicts, the Conflicts dialog, then the merge
// committed.

import { resolveConflicts } from './conflicts.js';
import type { Host } from './environments.js';
import { notifications } from './notifications.js';
import { refreshAll } from './shelf.js';

/** The host's `git.pull` and `git.merge`. */
type Merged =
  { kind: 'merged'; files: number; commits: number } | { kind: 'conflicts'; resume: unknown };

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** Says how it went, as IntelliJ's `GitMergeAction` does. */
function reportMerged(merged: { files: number; commits: number }): void {
  notifications.notify({
    title:
      merged.commits === 0
        ? 'All files are up to date'
        : `${plural(merged.files, 'file')} updated in ${plural(merged.commits, 'commit')}`,
  });
}

/** Says why it failed, in IntelliJ's words where it has its own. */
function reportFailed(action: string, error: Error): void {
  const message = error.message;
  const untracked = /untracked working tree files would be overwritten/.test(message);
  const local = !untracked && /would be overwritten by merge/.test(message);
  notifications.notify({
    title: untracked
      ? `Untracked Files Prevent ${action}`
      : local
        ? `Git ${action} Failed`
        : `Git ${action} failed`,
    content: local
      ? `Your local changes will be overwritten by ${action.toLowerCase()}.\nCommit, stash, or revert them to proceed.`
      : message,
    type: 'error',
    display: 'sticky',
  });
}

/**
 * Runs `action` (Pull or Merge) with `run`, which asks the host, then goes on as IntelliJ's: how it
 * went; at conflicts, the Conflicts dialog, and the merge committed once none is left, unless
 * `commit` is false (--no-commit). What fails is said, in its words.
 */
export async function mergeAction(
  host: Host,
  worktree: string,
  action: string,
  run: () => Promise<unknown>,
  commit: boolean,
): Promise<void> {
  try {
    const merged = (await run()) as Merged;
    if (merged.kind === 'merged') {
      reportMerged(merged);
      return;
    }
    if (!(await resolveConflicts(worktree))) {
      notifications.notify({
        title: '',
        content: 'There are pending unresolved conflicts.',
        type: 'warning',
        display: 'sticky',
        actions: [
          {
            label: 'Resolve…',
            run: () => {
              void resolveConflicts(worktree).then(() => refreshAll(worktree));
            },
          },
        ],
      });
      return;
    }
    if (!commit) return;
    reportMerged(
      (await host.request('git.continueUpdate', { path: worktree, resume: merged.resume })) as {
        files: number;
        commits: number;
      },
    );
  } catch (error) {
    reportFailed(action, error as Error);
  }
}
