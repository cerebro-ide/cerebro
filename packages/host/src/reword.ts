// The Log's Edit Commit Message…, as IntelliJ's (`GitRewordAction`, `GitCommitEditingActionBase`,
// `GitSingleCommitEditingAction`, `GitInMemoryRewordOperation`, `GitObjectRepository`, read from
// its source): a commit of the current branch, not on a protected branch of a remote, given a new
// message without touching the working tree or the index. As IntelliJ's in-memory way, which it
// tries first: the commit made again with the new message (`commit-tree`, its tree, parents and
// author kept), each later one made again on it, and the branch moved to the last. IntelliJ falls
// back on an interactive rebase where that fails (a merge between the commit and HEAD); Cerebro
// says why instead.

import { operation } from './conflicts.js';
import type { Git } from './git.js';
import { protectedBranchHolding } from './protected-branches.js';

/** IntelliJ's names of what's under way, in "Cannot reword during …". */
const DURING = {
  rebase: 'rebase',
  merge: 'merge',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
} as const;

/**
 * Whether `hash`'s message can be edited, as IntelliJ checks before its dialog: HEAD's commit then,
 * to check it hasn't moved when the message is given (`{ head }`), or IntelliJ's words for why not
 * (`{ refused }`): not in the current branch, on a protected branch of a remote (`branches` names
 * them), or something under way, though a rebase allows HEAD's commit.
 */
export async function rewordCheck(
  worktree: string,
  hash: string,
  branches: (name: string) => boolean,
  run: Git,
): Promise<{ head: string } | { refused: string }> {
  const head = (await run(worktree, ['rev-parse', 'HEAD'])).trim();
  const inHead = await run(worktree, ['merge-base', '--is-ancestor', hash, head]).then(
    () => true,
    () => false,
  );
  if (!inHead) return { refused: 'The commit is not in the current branch' };
  const pushed = await protectedBranchHolding(worktree, hash, branches, run);
  if (pushed !== undefined) {
    return { refused: `The commit is already pushed to protected branch '${pushed}'` };
  }
  const op = await operation(worktree, run);
  const isHead = (await run(worktree, ['rev-parse', hash])).trim() === head;
  if (op !== undefined && !(op === 'rebase' && isHead)) {
    return { refused: `Cannot reword during ${DURING[op]}` };
  }
  return { head };
}

/** A commit as git keeps it: what `commit-tree` needs to make it again. */
interface Commit {
  tree: string;
  parents: string[];
  /** Its author's name, email and date, as `GIT_AUTHOR_*` take them. */
  author: Record<string, string>;
  message: string;
}

/** Reads a commit's object (`cat-file commit`): its headers, then its message after a blank line. */
async function read(worktree: string, hash: string, run: Git): Promise<Commit> {
  const object = await run(worktree, ['cat-file', 'commit', hash]);
  const end = object.indexOf('\n\n');
  const headers = object.slice(0, end).split('\n');
  const value = (name: string) =>
    headers
      .filter((line) => line.startsWith(`${name} `))
      .map((line) => line.slice(name.length + 1));
  // "Name <email> 1700000000 +0200"
  const author = value('author')[0] as string;
  const open = author.lastIndexOf(' <');
  const close = author.lastIndexOf('> ');
  return {
    tree: value('tree')[0] as string,
    parents: value('parent'),
    author: {
      GIT_AUTHOR_NAME: author.slice(0, open),
      GIT_AUTHOR_EMAIL: author.slice(open + 2, close),
      GIT_AUTHOR_DATE: author.slice(close + 2),
    },
    message: object.slice(end + 2),
  };
}

/** Makes a commit again (`commit-tree`), on `parents`, with `message`; its new hash. */
async function remake(
  worktree: string,
  commit: Commit,
  parents: readonly string[],
  message: string,
  run: Git,
): Promise<string> {
  const args = ['commit-tree', commit.tree, ...parents.flatMap((p) => ['-p', p]), '-F', '-'];
  return (await run(worktree, args, commit.author, message)).trim();
}

/**
 * The message as `git commit` would keep it, as IntelliJ's `GitCommitMessageFormatter` does, since
 * `commit-tree` doesn't: by `commit.cleanup`, nothing done for `verbatim`, comments dropped too for
 * `strip`, otherwise git's `whitespace` (blank lines at either end and trailing blanks dropped).
 */
async function cleanUp(worktree: string, message: string, run: Git): Promise<string> {
  const mode = await run(worktree, ['config', 'commit.cleanup']).then(
    (out) => out.trim(),
    () => 'default',
  );
  if (mode === 'verbatim') return message;
  return run(
    worktree,
    ['stripspace', ...(mode === 'strip' ? ['--strip-comments'] : [])],
    {},
    message,
  );
}

/**
 * Gives `hash` `message`, as IntelliJ's `GitInMemoryRewordOperation`; `head` is HEAD's commit when
 * it was checked (`rewordCheck`), and nothing's done if HEAD has moved since. Each commit from
 * `hash` to HEAD is made again, the branch (or a detached HEAD) moved to the last; the working tree
 * and the index stay as they are. Throws, nothing changed, if a merge or the first commit is
 * between them, in IntelliJ's words.
 */
export async function reword(
  worktree: string,
  hash: string,
  message: string,
  head: string,
  run: Git,
): Promise<void> {
  const moved = () => new Error('HEAD moved during the commit editing operation');
  if ((await run(worktree, ['rev-parse', 'HEAD'])).trim() !== head) throw moved();
  const target = (await run(worktree, ['rev-parse', hash])).trim();
  // From HEAD back to the commit, each with one parent, as IntelliJ's `findCommitsRange`.
  const parentsOf = new Map(
    (await run(worktree, ['rev-list', '--parents', head, `^${target}`]))
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => {
        const [commit, ...parents] = line.split(' ') as [string, ...string[]];
        return [commit, parents];
      }),
  );
  const later: string[] = [];
  for (let at = head; at !== target;) {
    const parents = parentsOf.get(at);
    // Past the history they share: not in HEAD, as checked first unless HEAD moved meanwhile.
    if (parents === undefined) throw new Error('The commit is not in the current branch');
    if (parents.length !== 1) throw new Error(`Commit ${at} has ${String(parents.length)} parents`);
    later.unshift(at);
    at = parents[0] as string;
  }
  const original = await read(worktree, target, run);
  let made = await remake(
    worktree,
    original,
    original.parents,
    await cleanUp(worktree, message, run),
    run,
  );
  for (const hash of later) {
    const commit = await read(worktree, hash, run);
    made = await remake(worktree, commit, [made], commit.message, run);
  }
  // Moved only from where it was checked: `update-ref` refuses if HEAD has moved meanwhile.
  try {
    await run(worktree, ['update-ref', '-m', `reword ${target} by Cerebro`, 'HEAD', made, head]);
  } catch {
    throw moved();
  }
}
