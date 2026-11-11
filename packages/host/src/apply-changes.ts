// The Log's Cherry-Pick and Revert Commit, as IntelliJ's (`GitApplyChangesProcess`, its
// `GitCherryPickProcess` and `GitRevertProcess`, read from its source): `git cherry-pick` or
// `git revert` of a commit, which may stop at conflicts; one whose changes are already here (or
// already undone) is skipped, as IntelliJ's default (`EmptyCherryPickResolutionStrategy.SKIP`).

import { GitError, type Git } from './git.js';

/** What applies a commit's changes: picks them, or undoes them. */
export type Applying = 'cherry-pick' | 'revert';

/** How it went: committed, skipped as empty, or stopped at conflicts. */
export type Applied = 'picked' | 'empty' | 'conflicts';

/** Git's own: no prompt, and no editor for its message, which is git's, as IntelliJ's. */
const APPLYING = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };

/** The file git keeps while each is under way. */
const HEAD: Record<Applying, string> = { 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD' };

/**
 * Applies `hash` onto HEAD: picks it (with `suffix`, its message saying where from, git's `-x`, as
 * IntelliJ's does for a commit on a protected remote branch), or reverts it. Measured (git 2.43):
 * an empty pick fails, CHERRY_PICK_HEAD there and no file unmerged; an empty revert fails saying
 * "nothing to commit", with no REVERT_HEAD; local changes or untracked files in the way fail with
 * nothing begun.
 */
export async function applyCommit(
  worktree: string,
  how: Applying,
  hash: string,
  suffix: boolean,
  run: Git,
): Promise<Applied> {
  try {
    await run(worktree, [how, ...(suffix ? ['-x'] : []), hash], APPLYING);
    return 'picked';
  } catch (error) {
    return stopped(worktree, how, error, run);
  }
}

/** Why it, or its `--continue`, stopped: at conflicts, or empty (then skipped); else its error. */
async function stopped(
  worktree: string,
  how: Applying,
  error: unknown,
  run: Git,
): Promise<Applied> {
  const under = await run(worktree, ['rev-parse', '--verify', '--quiet', HEAD[how]]).then(
    () => true,
    () => false,
  );
  if (!under) {
    // IntelliJ's `GitRevertProcess.isEmptyCommit`: git's own words.
    if (error instanceof GitError && /nothing (to commit|added to commit)/.test(error.output)) {
      return 'empty';
    }
    throw error;
  }
  if ((await run(worktree, ['ls-files', '-u'])) !== '') return 'conflicts';
  await run(worktree, [how, '--skip'], APPLYING);
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
 * IntelliJ's Continue Cherry-Pick, and a pick or revert carried on once its conflicts are
 * resolved: the commit made with git's message (`--continue`), a pick's with its author.
 */
export async function continueApplying(
  worktree: string,
  how: Applying,
  run: Git,
): Promise<Applied> {
  try {
    await run(worktree, [how, '--continue'], APPLYING);
    return 'picked';
  } catch (error) {
    return stopped(worktree, how, error, run);
  }
}
