// IntelliJ's protected branches (`GitProtectedBranches.kt`, read from its source): a commit on a
// remote's branch whose name there is protected (`main` of `origin/main`) is published, so Undo
// Commit won't take it back, and Cherry-Pick says where its commit came from.

import type { Git } from './git.js';

/**
 * The first branch on a remote (`origin/main`) holding `hash` whose name there (`main`) is one of
 * `branches`, as IntelliJ's `findProtectedRemoteBranch`; undefined if there's none.
 */
export async function protectedBranchHolding(
  worktree: string,
  hash: string,
  branches: (name: string) => boolean,
  run: Git,
): Promise<string | undefined> {
  const names = await run(worktree, [
    'for-each-ref',
    '--format=%(refname:lstrip=2)',
    `--contains=${hash}`,
    'refs/remotes',
  ]);
  return names.split('\n').find((name) => {
    const branch = name.slice(name.indexOf('/') + 1);
    // A remote's HEAD isn't a branch of its own.
    return name !== '' && branch !== 'HEAD' && branches(branch);
  });
}
