// Git → Reset HEAD… and the Log's Reset Current Branch to Here…, as IntelliJ's (`GitResetHead`,
// `GitResetDialog`, `GitResetAction`, `GitResetOperation`, read from its source): `git reset` of
// the current branch to a commit, Mixed, Soft, Hard, or (the Log's) Keep. And the Log's Undo
// Commit… (`GitUncommitAction`), a Soft reset to HEAD's parent.

import type { Git } from './git.js';
import { protectedBranchHolding } from './protected-branches.js';

export type ResetMode = 'mixed' | 'soft' | 'hard' | 'keep';

/** Resets HEAD: IntelliJ's `git reset --<mode> [<commit>] --`, HEAD when no commit is given. */
export async function resetHead(
  worktree: string,
  mode: ResetMode,
  commit: string | undefined,
  run: Git,
): Promise<void> {
  await run(worktree, ['reset', `--${mode}`, ...(commit === undefined ? [] : [commit]), '--']);
}

/**
 * Undoes HEAD's commit, `hash`, its changes kept staged (`reset --soft` to its first parent), as
 * IntelliJ's Undo Commit; unless it's on a protected branch of a remote (`branches` names them),
 * whose name (`origin/main`) is returned, nothing done.
 */
export async function undoCommit(
  worktree: string,
  hash: string,
  branches: (name: string) => boolean,
  run: Git,
): Promise<string | null> {
  // IntelliJ's own check, against a Log read before HEAD moved.
  if ((await run(worktree, ['rev-parse', 'HEAD'])) !== (await run(worktree, ['rev-parse', hash]))) {
    throw new Error('The selected commit is not the last in the current branch');
  }
  const pushed = await protectedBranchHolding(worktree, hash, branches, run);
  if (pushed !== undefined) return pushed;
  await resetHead(worktree, 'soft', `${hash}^`, run);
  return null;
}
