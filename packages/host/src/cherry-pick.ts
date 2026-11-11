// The Log's Cherry-Pick, as IntelliJ's (`GitCherryPickProcess`, `GitApplyChangesProcess`, read
// from its source): `git cherry-pick` of a commit, which may stop at conflicts; one whose changes
// are already here skipped, as IntelliJ's default (`EmptyCherryPickResolutionStrategy.SKIP`).

import type { Git } from './git.js';

/** How a cherry-pick went: committed, skipped as empty, or stopped at conflicts. */
export type CherryPicked = 'picked' | 'empty' | 'conflicts';

/** Git's own: no prompt, and no editor for its message, which is the commit's, as IntelliJ's. */
const PICKING = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };

/**
 * Cherry-picks `hash` onto HEAD. With `suffix`, its message says where from ("(cherry picked from
 * commit …)", git's `-x`), as IntelliJ's does for a commit on a protected remote branch.
 * Measured (git 2.43): an empty pick fails, CHERRY_PICK_HEAD there and no file unmerged; local
 * changes or untracked files in the way fail with nothing begun.
 */
export async function cherryPick(
  worktree: string,
  hash: string,
  suffix: boolean,
  run: Git,
): Promise<CherryPicked> {
  try {
    await run(worktree, ['cherry-pick', ...(suffix ? ['-x'] : []), hash], PICKING);
    return 'picked';
  } catch (error) {
    return stopped(worktree, error, run);
  }
}

/** Why a pick, or its `--continue`, stopped: at conflicts, or empty (then skipped); else its error. */
async function stopped(worktree: string, error: unknown, run: Git): Promise<CherryPicked> {
  const picking = await run(worktree, ['rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD']).then(
    () => true,
    () => false,
  );
  if (!picking) throw error;
  if ((await run(worktree, ['ls-files', '-u'])) !== '') return 'conflicts';
  await run(worktree, ['cherry-pick', '--skip'], PICKING);
  return 'empty';
}

/** Whether one of `branches` (`origin/main`) on a remote holds `hash`: IntelliJ's "published". */
export async function onRemoteBranch(
  worktree: string,
  hash: string,
  branches: (name: string) => boolean,
  run: Git,
): Promise<boolean> {
  const names = await run(worktree, [
    'for-each-ref',
    '--format=%(refname:lstrip=3)',
    `--contains=${hash}`,
    'refs/remotes',
  ]);
  return names.split('\n').some((name) => name !== '' && name !== 'HEAD' && branches(name));
}

/**
 * IntelliJ's Continue Cherry-Pick, and the pick carried on once its conflicts are resolved: the
 * commit made with its own message and author (git's `--continue`).
 */
export async function continueCherryPick(worktree: string, run: Git): Promise<CherryPicked> {
  try {
    await run(worktree, ['cherry-pick', '--continue'], PICKING);
    return 'picked';
  } catch (error) {
    return stopped(worktree, error, run);
  }
}
