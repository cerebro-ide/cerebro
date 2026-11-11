// Git → Reset HEAD…, as IntelliJ's (`GitResetHead` and `GitResetDialog`, read from its source):
// `git reset` of the current branch to a commit, Mixed, Soft or Hard.

import type { Git } from './git.js';

export type ResetMode = 'mixed' | 'soft' | 'hard';

/** Resets HEAD: IntelliJ's `git reset --<mode> [<commit>] --`, HEAD when no commit is given. */
export async function resetHead(
  worktree: string,
  mode: ResetMode,
  commit: string | undefined,
  run: Git,
): Promise<void> {
  await run(worktree, ['reset', `--${mode}`, ...(commit === undefined ? [] : [commit]), '--']);
}
