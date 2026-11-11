// Git → Fetch, Git → Pull… and Git → Merge…, as IntelliJ's (`GitFetchSupportImpl`, `GitImpl.fetch`,
// `GitPull`, `GitMerge`, `GitMergeAction`, read from its source). Fetch fetches every remote,
// pruning what's gone there. Pull runs `git pull` from a remote's branch, and Merge `git merge` of a
// branch, with the options chosen in their dialogs; both go on as IntelliJ's `GitMergeAction`. A
// pull with `--rebase` goes through Update Project instead (`update.ts`), as IntelliJ's does.

import { operation } from './conflicts.js';
import type { Git } from './git.js';
import type { HashRange, Resume } from './update.js';

/** How a fetch went: the remote-tracking branches pruned, and each remote that failed, why. */
export interface Fetched {
  pruned: string[];
  failed: { remote: string; error: string }[];
}

/** The remote-tracking branches of a remote, short (`origin/main`). */
async function trackingBranches(worktree: string, remote: string, run: Git): Promise<string[]> {
  const output = await run(worktree, [
    'for-each-ref',
    // Not `:short`, which gives the remote's HEAD as `origin` (measured).
    '--format=%(refname:lstrip=2)',
    `refs/remotes/${remote}/`,
  ]);
  return output.split('\n').filter((b) => b !== '' && b !== `${remote}/HEAD`);
}

/**
 * Fetches every remote, as IntelliJ's Fetch (`fetchAllRemotes`), with `--prune`; or `only` that
 * one, as its Pull dialog's fetch. `remote` runs git's remote commands. A remote that fails doesn't
 * stop the others.
 */
export async function fetchAll(
  worktree: string,
  run: Git,
  remote: Git,
  only?: string,
): Promise<Fetched> {
  const remotes =
    only === undefined ? (await run(worktree, ['remote'])).split('\n').filter(Boolean) : [only];
  const fetched: Fetched = { pruned: [], failed: [] };
  for (const name of remotes) {
    const before = await trackingBranches(worktree, name, run);
    try {
      await remote(worktree, ['fetch', '--prune', '--quiet', '--end-of-options', name], {
        GIT_TERMINAL_PROMPT: '0',
      });
    } catch (error) {
      fetched.failed.push({ remote: name, error: (error as Error).message });
      continue;
    }
    const after = new Set(await trackingBranches(worktree, name, run));
    fetched.pruned.push(...before.filter((b) => !after.has(b)));
  }
  return fetched;
}

/** The Pull dialog's options, as IntelliJ's `GitPullOption` (but `--rebase`, which updates). */
export const PULL_OPTIONS = ['--ff-only', '--no-ff', '--squash', '--no-commit', '--no-verify'];

/**
 * How a pull or a merge went: the files it changed and the commits it brought (none: up to date),
 * as Update Project counts them; with `--squash` or `--no-commit`, the files are those the merge
 * staged. HEAD before and after, if it moved (View commits', which IntelliJ offers only for a merge
 * committed). Or stopped at conflicts, the merge under way, with what `continueUpdate` needs to
 * commit it after.
 */
export type Merged =
  | { kind: 'merged'; files: number; commits: number; range?: HashRange }
  | { kind: 'conflicts'; resume: Resume };

/** Lines of git's output. */
const lines = (output: string) => output.split('\n').filter(Boolean);

/**
 * Runs a pull or a merge (`go`), then says how it went, as IntelliJ's `GitMergeAction`: `theirs` is
 * what was merged, read after, for the commits it brought. Fails with git's words (local changes in
 * the way among them).
 */
async function merging(
  worktree: string,
  theirs: string,
  go: () => Promise<unknown>,
  run: Git,
): Promise<Merged> {
  const before = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  /** The commits it brought: those merged that weren't here. */
  const brought = async () =>
    Number((await run(worktree, ['rev-list', '--count', `${before}..${theirs}`])).trim());
  try {
    await go();
  } catch (error) {
    if ((await operation(worktree, run)) !== 'merge') throw error;
    return { kind: 'conflicts', resume: { method: 'merge', before, commits: await brought() } };
  }
  const commits = await brought();
  // The index against what was there: what was merged, committed or not.
  const files = lines(await run(worktree, ['diff', '--cached', '--name-only', before])).length;
  const after = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  return after === before
    ? { kind: 'merged', files, commits }
    : { kind: 'merged', files, commits, range: { start: before, end: after } };
}

/** Git's merge's own environment: no prompt, and no editor for its message (git's), as IntelliJ's. */
const MERGING = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };

/** Pulls `branch` from `remote` into the checked-out branch, as IntelliJ's Pull: `git pull --no-stat`. */
export function pull(
  worktree: string,
  from: { remote: string; branch: string; options: readonly string[] },
  run: Git,
  remote: Git,
): Promise<Merged> {
  return merging(
    worktree,
    'FETCH_HEAD',
    () =>
      remote(
        worktree,
        // A merge, said so: git (2.27 on) won't pull divergent branches until told how.
        [
          'pull',
          '--no-rebase',
          '--no-stat',
          ...from.options,
          '-v',
          '--end-of-options',
          from.remote,
          from.branch,
        ],
        MERGING,
      ),
    run,
  );
}

/** The Merge dialog's options, as IntelliJ's `GitMergeOption` (but `-m`, which comes with its text). */
export const MERGE_OPTIONS = [
  '--no-ff',
  '--ff-only',
  '--squash',
  '--no-commit',
  '--no-verify',
  '--allow-unrelated-histories',
];

/**
 * Merges `branch` (a local branch, or a remote one: `origin/main`) into the checked-out branch, as
 * IntelliJ's Merge: `git merge` with the options chosen, and the commit's message when one's given.
 */
export function merge(
  worktree: string,
  what: { branch: string; options: readonly string[]; message?: string },
  run: Git,
): Promise<Merged> {
  const message = what.message?.trim() ?? '';
  return merging(
    worktree,
    what.branch,
    () =>
      run(
        worktree,
        [
          'merge',
          ...what.options,
          ...(message === '' ? [] : ['-m', message]),
          '--end-of-options',
          what.branch,
        ],
        MERGING,
      ),
    run,
  );
}

/**
 * The branches not merged into the one checked out, local and remote (`refs/heads/x`,
 * `refs/remotes/origin/x`), but symbolic ones (`origin/HEAD`): the Merge dialog says the others are
 * merged already, as IntelliJ's.
 */
export async function unmerged(worktree: string, run: Git): Promise<string[]> {
  const output = await run(worktree, [
    'branch',
    '--all',
    '--format=%(refname) [%(symref)]',
    // Last: it takes the next argument as the commit to compare with (measured).
    '--no-merged',
  ]);
  return lines(output)
    .filter((line) => line.endsWith(' []'))
    .map((line) => line.slice(0, -' []'.length));
}
