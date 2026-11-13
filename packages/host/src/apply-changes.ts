// The Log's Cherry-Pick and Revert Commit, as IntelliJ's (`GitApplyChangesProcess`, its
// `GitCherryPickProcess` and `GitRevertProcess`, read from its source): `git cherry-pick` or
// `git revert` of a commit, which may stop at conflicts; one whose changes are already here (or
// already undone) is skipped, as IntelliJ's default (`EmptyCherryPickResolutionStrategy.SKIP`).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GitError, type Git, type GitBytes } from './git.js';

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

/**
 * Applies what `from..to` changed in `paths` to the files as they are, uncommitted, or undoes it
 * (`reverse`): IntelliJ's Cherry-Pick Selected Changes and Revert Selected Changes
 * (`RevertCommittedStuffAbstractAction`, read from its source), which apply the changes' patch, or
 * the patch reversed. A rename needs both its paths, to be applied as one. With one line
 * around a hunk if all of them don't match, so it applies where its lines moved to: a hunk at line 1
 * with two lines before its change stays anchored to the file's start with `-C2` (measured, git
 * 2.43), and applies with `-C1`. If it doesn't apply, nothing is changed.
 */
export async function applyChanges(
  worktree: string,
  range: { from: string; to: string },
  paths: readonly string[],
  reverse: boolean,
  run: Git,
): Promise<void> {
  const patch = await run(worktree, [
    'diff',
    '--binary',
    '-M',
    range.from,
    range.to,
    '--',
    ...paths,
  ]);
  if (patch === '') return;
  await run(worktree, ['apply', ...(reverse ? ['-R'] : []), '-C1', '-'], undefined, patch);
}

/**
 * The file in the working tree as `hash` has it, or deleted where `hash` hasn't it: IntelliJ's Get
 * from Revision in the Log (`GetVersionFromRepositoryActionProvider` and `GetVersionAction`, read
 * from their source), which writes the change's after-version, or deletes the file. Whether the
 * commit has it is asked first, so a commit git can't read fails rather than deleting the file.
 */
export async function getVersion(
  worktree: string,
  hash: string,
  path: string,
  run: Git,
  runBytes: GitBytes,
): Promise<void> {
  const file = join(worktree, path);
  const listed = await run(worktree, ['ls-tree', '--name-only', hash, '--', path]);
  if (listed.trim() === '') {
    await rm(file, { force: true });
    return;
  }
  const bytes = await runBytes(worktree, ['show', `${hash}:${path}`]);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
