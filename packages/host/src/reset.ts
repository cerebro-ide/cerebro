// Git → Reset HEAD… and the Log's Reset Current Branch to Here…, as IntelliJ's (`GitResetHead`,
// `GitResetDialog`, `GitResetAction`, `GitResetOperation`, read from its source): `git reset` of
// the current branch to a commit, Mixed, Soft, Hard, or (the Log's) Keep.

import type { Git } from './git.js';

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
