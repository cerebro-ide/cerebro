// Git → Fetch and Git → Pull…, as IntelliJ's (`GitFetchSupportImpl`, `GitImpl.fetch`, `GitPull`,
// `GitMergeAction`, read from its source). Fetch fetches every remote, pruning what's gone there;
// Pull runs `git pull` from a remote's branch with the options chosen in its dialog. A pull with
// `--rebase` goes through Update Project instead (`update.ts`), as IntelliJ's does.

import { operation } from './conflicts.js';
import type { Git } from './git.js';

/** How a fetch went: the remote-tracking branches pruned, and each remote that failed, why. */
export interface Fetched {
  pruned: string[];
  failed: { remote: string; error: string }[];
}

/** The remote-tracking branches of a remote, short (`origin/main`). */
async function trackingBranches(worktree: string, remote: string, run: Git): Promise<string[]> {
  const output = await run(worktree, [
    'for-each-ref',
    '--format=%(refname:short)',
    `refs/remotes/${remote}/`,
  ]);
  return output.split('\n').filter((b) => b !== '' && b !== `${remote}/HEAD`);
}

/**
 * Fetches every remote, as IntelliJ's Fetch (`fetchAllRemotes`), with `--prune`; `remote` runs
 * git's remote commands. A remote that fails doesn't stop the others.
 */
export async function fetchAll(worktree: string, run: Git, remote: Git): Promise<Fetched> {
  const remotes = (await run(worktree, ['remote'])).split('\n').filter(Boolean);
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
 * How a pull went: stopped at conflicts, the merge under way; or the files it changed and the
 * commits it brought (none of either: up to date). With `--squash` or `--no-commit`, the files are
 * those the merge staged, its commit not made.
 */
export type Pulled = { kind: 'conflicts' } | { kind: 'pulled'; files: number; commits: number };

/** Lines of git's output. */
const lines = (output: string) => output.split('\n').filter(Boolean);

/**
 * Pulls `branch` from `remote` into the checked-out branch, as IntelliJ's Pull: `git pull --no-stat`
 * with the options chosen. Fails with git's words (local changes in the way among them).
 */
export async function pull(
  worktree: string,
  from: { remote: string; branch: string; options: readonly string[] },
  run: Git,
  remote: Git,
): Promise<Pulled> {
  const before = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  try {
    await remote(
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
      // No editor for the merge's message: git's, as IntelliJ's.
      { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
    );
  } catch (error) {
    if ((await operation(worktree, run)) === 'merge') return { kind: 'conflicts' };
    throw error;
  }
  const commits = Number((await run(worktree, ['rev-list', '--count', `${before}..HEAD`])).trim());
  // The index against what was there: what was merged, committed or not.
  const files = lines(await run(worktree, ['diff', '--cached', '--name-only', before])).length;
  return { kind: 'pulled', files, commits };
}
