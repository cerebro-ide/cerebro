// Update Project, as IntelliJ's `GitUpdateProcess` (read from its source): the upstream's remote is
// fetched, then the upstream merged into the checked-out branch or the branch rebased on it. Local
// changes in the way are saved first (shelved or stashed, IntelliJ's Save changes) and put back
// after. Conflicts are left to git: the merge or rebase stays under way, and what was saved stays
// saved, as IntelliJ leaves it when its Conflicts dialog is closed.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listChanges, type Change, type Git } from './git.js';
import { shelve, stash, unshelve, unstash } from './shelf.js';

/** How the branch takes the upstream's commits, as IntelliJ's Update Type. */
export type UpdateMethod = 'merge' | 'rebase';

/** Where local changes in the way go meanwhile, as IntelliJ's Save changes. */
export type SaveChanges = 'shelve' | 'stash';

/** How an update went. */
export type Updated =
  /** A merge or rebase under way, or files unmerged: IntelliJ doesn't update then. */
  | { kind: 'unfinished'; state: 'merge' | 'rebase' | 'unmerged' }
  | { kind: 'detached' }
  | { kind: 'noUpstream'; branch: string }
  /** The upstream has nothing the branch hasn't. */
  | { kind: 'nothing' }
  /**
   * Updated: the files it changed and the commits it brought; whether local changes saved were put
   * back (true when none were saved).
   */
  | { kind: 'updated'; files: number; commits: number; restored: boolean }
  /** Stopped at conflicts; local changes saved stay saved. */
  | { kind: 'conflicts'; method: UpdateMethod; saved: boolean };

/** The message local changes are saved under, as IntelliJ's (`stash.changes.message.with.date`). */
export function savedMessage(at: Date): string {
  return `Uncommitted changes before Update at ${at.toLocaleString()}`;
}

/** Whether a file in the repository's git folder is there: a merge's or a rebase's state. */
async function hasGitFile(worktree: string, name: string, run: Git): Promise<boolean> {
  return existsSync(
    resolve(worktree, (await run(worktree, ['rev-parse', '--git-path', name])).trim()),
  );
}

/** What stops an update before it starts, as IntelliJ's `isUpdateNotReady`. */
async function unfinished(
  worktree: string,
  run: Git,
): Promise<'merge' | 'rebase' | 'unmerged' | undefined> {
  if (
    (await hasGitFile(worktree, 'rebase-merge', run)) ||
    (await hasGitFile(worktree, 'rebase-apply', run))
  )
    return 'rebase';
  if (await hasGitFile(worktree, 'MERGE_HEAD', run)) return 'merge';
  const unmerged = await run(worktree, ['diff', '--name-only', '--diff-filter=U']);
  return unmerged.trim() === '' ? undefined : 'unmerged';
}

/** Lines of git's output. */
const lines = (output: string) => output.split('\n').filter(Boolean);

/**
 * Whether local changes would be in the way, as IntelliJ's `isSaveNeeded`: always for a rebase; for
 * a merge, when the index has changes, or a file changed here was changed upstream too.
 */
async function inTheWay(
  worktree: string,
  method: UpdateMethod,
  changes: Change[],
  run: Git,
): Promise<boolean> {
  if (changes.length === 0) return false;
  if (method === 'rebase') return true;
  if (lines(await run(worktree, ['diff', '--cached', '--name-only'])).length > 0) return true;
  const upstream = new Set(
    lines(await run(worktree, ['diff', '--name-only', 'HEAD...@{upstream}'])),
  );
  return changes.some(
    (c) => upstream.has(c.path) || (c.from !== undefined && upstream.has(c.from)),
  );
}

/** Saves the changes in the way; resolves with a way to put them back, which says if it did. */
async function save(
  worktree: string,
  changes: Change[],
  how: SaveChanges,
  message: string,
  run: Git,
): Promise<() => Promise<boolean>> {
  const restored = (put: Promise<void>) =>
    put.then(
      () => true,
      () => false,
    );
  if (how === 'shelve') {
    const id = await shelve(worktree, changes, message, run);
    return () => restored(unshelve(worktree, id, run));
  }
  await stash(worktree, message, { keepIndex: false, includeUntracked: false }, run);
  return () => restored(unstash(worktree, 'stash@{0}', { pop: true, reinstateIndex: true }, run));
}

/** Updates the checked-out branch from its upstream; `remote` runs git's remote commands. */
export async function update(
  worktree: string,
  options: { method: UpdateMethod; save: SaveChanges; now?: Date },
  run: Git,
  remote: Git,
): Promise<Updated> {
  const state = await unfinished(worktree, run);
  if (state) return { kind: 'unfinished', state };
  let branch: string;
  try {
    branch = (await run(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return { kind: 'detached' };
  }
  const upstreamRemote = (
    await run(worktree, ['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`])
  ).trim();
  if (upstreamRemote === '') return { kind: 'noUpstream', branch };
  // As IntelliJ's: the upstream's remote, all of it.
  await remote(worktree, ['fetch', '--quiet', '--end-of-options', upstreamRemote], {
    GIT_TERMINAL_PROMPT: '0',
  });
  const commits = Number(
    (await run(worktree, ['rev-list', '--count', 'HEAD..@{upstream}'])).trim(),
  );
  if (commits === 0) return { kind: 'nothing' };
  const before = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  // Untracked files aren't local changes to IntelliJ: they stay where they are.
  const changes = (await listChanges(worktree, run)).filter((c) => c.status !== 'untracked');
  // A rebase with local changes tries a fast-forward first, which needs nothing saved
  // (IntelliJ's `tryFastForwardMergeForRebaseUpdaters`).
  const fastForward =
    options.method === 'rebase' &&
    changes.length > 0 &&
    (await run(worktree, ['merge', '--ff-only', '@{upstream}']).then(
      () => true,
      () => false,
    ));
  let restore: (() => Promise<boolean>) | undefined;
  if (!fastForward) {
    if (await inTheWay(worktree, options.method, changes, run)) {
      const message = savedMessage(options.now ?? new Date());
      restore = await save(worktree, changes, options.save, message, run);
    }
    try {
      await run(
        worktree,
        options.method === 'merge'
          ? ['merge', '--no-stat', '-v', '@{upstream}']
          : ['rebase', '@{upstream}'],
      );
    } catch (error) {
      if ((await unfinished(worktree, run)) !== undefined) {
        return { kind: 'conflicts', method: options.method, saved: restore !== undefined };
      }
      // Nothing changed (local changes or untracked files git won't overwrite): they go back.
      await restore?.();
      throw error;
    }
  }
  const files = lines(await run(worktree, ['diff', '--name-only', `${before}..HEAD`])).length;
  const restored = restore ? await restore() : true;
  return { kind: 'updated', files, commits, restored };
}
