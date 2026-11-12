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

/**
 * Whether local branch `branch` has commits that remote branch `of` (`origin/main`) hasn't, as
 * IntelliJ's `checkLocalHasMoreCommits` asks before checking `of` out into it. By their full names,
 * which can't be taken for options.
 */
export async function hasCommitsNotIn(
  worktree: string,
  branch: string,
  of: string,
  run: Git,
): Promise<boolean> {
  const count = await run(worktree, [
    'rev-list',
    '--count',
    `refs/remotes/${of}..refs/heads/${branch}`,
  ]);
  return Number(count.trim()) > 0;
}

/**
 * Checks out a branch, tag or commit with HEAD detached at it, as IntelliJ's Checkout Tag or
 * Revision… (`git checkout ref^0` there, for gits older than `--detach`). A reference can't start
 * with "-" (git's `check-ref-format`, and no hash does): git would take it for an option, and its
 * `--end-of-options` isn't taken by checkout (measured, git 2.43).
 */
export async function checkoutDetached(
  worktree: string,
  reference: string,
  run: Git,
): Promise<void> {
  if (reference.startsWith('-')) throw new Error(`Not a reference: ${reference}`);
  await run(worktree, ['checkout', '--detach', reference, '--']);
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

/**
 * A branch deleted: where it was, to restore it; whether commits only it had were dropped; and the
 * remote branch it tracked (`origin/x`), if that's there and no other local branch tracks it, as
 * IntelliJ's `GitDeleteBranchOperation` offers Delete Tracked Branch then.
 */
export interface Deleted {
  hash: string;
  unmerged: boolean;
  tracked?: string;
}

const REMOTES = 'refs/remotes/';

/** The remote branch a local branch tracks, if it's there and the branch alone tracks it. */
async function trackedAlone(worktree: string, name: string, run: Git) {
  const refs = (
    await run(worktree, [
      'for-each-ref',
      '--format=%(refname)%09%(upstream)',
      'refs/heads',
      REMOTES,
    ])
  )
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string]);
  const own = refs.find(([ref]) => ref === `refs/heads/${name}`)?.[1] ?? '';
  const there = refs.some(([ref]) => ref === own);
  const others = refs.some(([ref, upstream]) => upstream === own && ref !== `refs/heads/${name}`);
  return own.startsWith(REMOTES) && there && !others ? own.slice(REMOTES.length) : undefined;
}

/**
 * Deletes a local branch, as IntelliJ's: `git branch -d`, and if git says it isn't fully merged,
 * `-D` all the same, IntelliJ then saying its commits were discarded.
 */
export async function deleteBranch(worktree: string, name: string, run: Git): Promise<Deleted> {
  const hash = (await run(worktree, ['rev-parse', '--verify', `refs/heads/${name}`])).trim();
  const tracked = await trackedAlone(worktree, name, run);
  let unmerged = false;
  try {
    await run(worktree, ['branch', '--delete', name]);
  } catch (error) {
    if (!/not fully merged/.test((error as Error).message)) throw error;
    await run(worktree, ['branch', '--delete', '--force', name]);
    unmerged = true;
  }
  return tracked === undefined ? { hash, unmerged } : { hash, unmerged, tracked };
}

/**
 * Deletes a remote branch (`origin/x`) where it is, as IntelliJ's `GitDeleteRemoteBranchOperation`:
 * a push of nothing to it, with the remote commands' git (`remote`); if the remote has it no more,
 * the remote's branches here are pruned instead.
 */
export async function deleteRemoteBranch(
  worktree: string,
  name: string,
  remote: Git,
): Promise<void> {
  const slash = name.indexOf('/');
  const remoteName = name.slice(0, slash);
  const branch = name.slice(slash + 1);
  const quiet = { GIT_TERMINAL_PROMPT: '0' };
  try {
    await remote(
      worktree,
      ['push', '--end-of-options', remoteName, `:refs/heads/${branch}`],
      quiet,
    );
  } catch (error) {
    if (!(error as Error).message.includes('remote ref does not exist')) throw error;
    await remote(worktree, ['remote', 'prune', '--end-of-options', remoteName], quiet);
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
  return rebase(worktree, { options: [], upstream: onto }, run);
}

/** The options Git → Rebase… offers, IntelliJ's `REBASE_FLAGS` but --interactive and --root. */
export const REBASE_OPTIONS = [
  '--rebase-merges',
  '--keep-empty',
  '--update-refs',
  '--autosquash',
  '--no-autosquash',
] as const;

export interface RebaseParams {
  options: readonly (typeof REBASE_OPTIONS)[number][];
  /** `--onto`'s new base, if given. */
  onto?: string;
  /** The upstream (with `--onto`, the old base); every commit of the branch (`--root`) if none. */
  upstream?: string;
  /** The branch switched to first, if not the current one. */
  branch?: string;
}

/**
 * Git → Rebase…: IntelliJ's `git rebase [options] [--onto <new base>] (<upstream> | --root)
 * [<branch>]`, local changes stashed and put back as `rebaseOnto`'s.
 */
export function rebase(worktree: string, params: RebaseParams, run: Git): Promise<BranchResult> {
  return changing(
    worktree,
    [
      'rebase',
      '--autostash',
      ...params.options,
      ...(params.onto === undefined ? [] : ['--onto', params.onto]),
      params.upstream ?? '--root',
      ...(params.branch === undefined ? [] : [params.branch]),
    ],
    run,
  );
}
