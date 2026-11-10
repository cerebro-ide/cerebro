// Branch operations, as IntelliJ's branches popup does them (`GitBrancher`, `GitCheckoutOperation`,
// `GitCheckoutNewBranchOperation`, `GitMergeOperation`, `GitRebaseProcess`,
// `GitRenameBranchOperation`, `GitDeleteBranchOperation`, read from its source): checking out a
// branch, a new one or a remote one; merging a branch into the current one, or rebasing the current
// one onto it; renaming and deleting one. A merge or rebase that stops at conflicts stays under way,
// for the Conflicts dialog and then `continueOperation`.

import { operation } from './conflicts.js';
import type { Git } from './git.js';

/** Checks out a local branch; a remote one (`origin/x`) as a new local branch tracking it. */
export async function checkout(
  worktree: string,
  branch: string,
  remote: boolean,
  run: Git,
): Promise<void> {
  await run(worktree, remote ? ['checkout', '--track', branch] : ['checkout', branch, '--']);
}

export interface NewBranch {
  name: string;
  /** Where it starts: a branch, or HEAD when undefined. */
  from?: string;
  /** Checked out once made, as IntelliJ's Checkout branch (on by default there). */
  checkout: boolean;
  /** Made over an existing one of the same name, as IntelliJ's Overwrite existing branch. */
  overwrite: boolean;
}

/** Makes a branch, and checks it out if asked. */
export async function createBranch(worktree: string, branch: NewBranch, run: Git): Promise<void> {
  const from = branch.from ?? 'HEAD';
  await run(
    worktree,
    branch.checkout
      ? ['checkout', branch.overwrite ? '-B' : '-b', branch.name, from]
      : ['branch', ...(branch.overwrite ? ['--force'] : []), branch.name, from],
  );
}

/** Renames a local branch. */
export async function renameBranch(
  worktree: string,
  from: string,
  to: string,
  run: Git,
): Promise<void> {
  await run(worktree, ['branch', '--move', from, to]);
}

/** A branch deleted: where it was, to restore it; whether commits only it had were dropped. */
export interface Deleted {
  hash: string;
  unmerged: boolean;
}

/**
 * Deletes a local branch, as IntelliJ's: `git branch -d`, and if git says it isn't fully merged,
 * `-D` all the same, IntelliJ then saying its commits were discarded.
 */
export async function deleteBranch(worktree: string, name: string, run: Git): Promise<Deleted> {
  const hash = (await run(worktree, ['rev-parse', '--verify', `refs/heads/${name}`])).trim();
  try {
    await run(worktree, ['branch', '--delete', name]);
    return { hash, unmerged: false };
  } catch (error) {
    if (!/not fully merged/.test((error as Error).message)) throw error;
    await run(worktree, ['branch', '--delete', '--force', name]);
    return { hash, unmerged: true };
  }
}

/** IntelliJ's Restore, after a branch was deleted: made again where it was. */
export async function restoreBranch(
  worktree: string,
  name: string,
  hash: string,
  run: Git,
): Promise<void> {
  await run(worktree, ['branch', name, hash]);
}

/** How a merge or a rebase went: done, nothing to do, or stopped at conflicts. */
export type BranchResult = 'done' | 'upToDate' | 'conflicts';

/** Runs a merge or rebase, telling a stop at conflicts from a failure. */
async function changing(worktree: string, args: string[], run: Git): Promise<BranchResult> {
  const before = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  try {
    await run(worktree, args, { GIT_EDITOR: 'true' });
  } catch (error) {
    // Stopped at conflicts, under way: anything else changed nothing, and says why in git's words.
    if ((await operation(worktree, run)) !== undefined) return 'conflicts';
    throw error;
  }
  return (await run(worktree, ['rev-parse', 'HEAD'])).trim() === before ? 'upToDate' : 'done';
}

/** IntelliJ's Merge into Current: the branch merged into the one checked out, with git's message. */
export function mergeBranch(worktree: string, branch: string, run: Git): Promise<BranchResult> {
  return changing(worktree, ['merge', '--no-edit', branch], run);
}

/**
 * IntelliJ's Rebase Current onto Selected. Local changes are stashed first and put back when it's
 * over, at its end or after its conflicts (git's `--autostash`), as IntelliJ saves them for a
 * rebase.
 */
export function rebaseOnto(worktree: string, onto: string, run: Git): Promise<BranchResult> {
  return changing(worktree, ['rebase', '--autostash', onto], run);
}
