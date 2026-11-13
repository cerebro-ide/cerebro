// The Log's commit editing, as IntelliJ's (`GitCommitEditingActionBase`, read from its source),
// for a commit of the current branch not on a protected branch of a remote: Edit Commit Message…
// (`GitRewordAction`, `GitInMemoryRewordOperation`), and Drop Commit (`GitDropLogAction`,
// `InMemoryRebaseOperations.drop`, `GitInMemoryInteractiveRebaseProcess`). Both IntelliJ's
// in-memory way, which it tries first: the commits made again (`commit-tree`, each one's author
// kept) from the one edited to HEAD, and the branch moved to the last. IntelliJ falls back on an
// interactive rebase where that fails (a merge between the commit and HEAD, a conflict); Cerebro
// says why instead. After, as IntelliJ's, notes are copied to the commits made again and the
// `post-rewrite` hook is run.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operation } from './conflicts.js';
import type { Git, GitError } from './git.js';
import { protectedBranchHolding } from './protected-branches.js';

/** IntelliJ's names of what's under way, in "Cannot drop during …". */
const DURING = {
  rebase: 'rebase',
  merge: 'merge',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
} as const;

/** The commit editing operations, by IntelliJ's names in its words ("Cannot reword during …"). */
export type Editing = 'reword' | 'drop';

/**
 * Whether `hash` can be edited, as IntelliJ checks before it asks anything: HEAD's commit then, to
 * check it hasn't moved when it's done (`{ head }`), or IntelliJ's words for why not
 * (`{ refused }`): not in the current branch, on a protected branch of a remote (`branches` names
 * them), or something under way, though a rebase allows rewording HEAD's commit.
 */
export async function editCheck(
  worktree: string,
  hash: string,
  editing: Editing,
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
  if (op !== undefined && !(op === 'rebase' && isHead && editing === 'reword')) {
    return { refused: `Cannot ${editing} during ${DURING[op]}` };
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

/** Makes a commit again: its tree and author, on `parents`, with `message`; its new hash. */
type Remake = (
  commit: Pick<Commit, 'tree' | 'author'>,
  parents: readonly string[],
  message: string,
) => Promise<string>;

/**
 * Makes commits again (`commit-tree`), signed where `commit.gpgSign` is set, as IntelliJ's
 * `GitObjectRepository.commitTree`: `commit-tree` doesn't read it (measured, git 2.43).
 */
async function remaking(worktree: string, run: Git): Promise<Remake> {
  const sign = await run(worktree, ['config', '--bool', 'commit.gpgSign']).then(
    (out) => out.trim() === 'true',
    () => false,
  );
  return async (commit, parents, message) => {
    const args = [
      'commit-tree',
      ...(sign ? ['--gpg-sign'] : []),
      commit.tree,
      ...parents.flatMap((p) => ['-p', p]),
      '-F',
      '-',
    ];
    return (await run(worktree, args, commit.author, message)).trim();
  };
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
 * Told which commits were made again from which (old, then new), as a rebase tells, as IntelliJ's
 * in-memory operations after one (`copyNotesForRewrite`, `runPostRewriteHook`): their notes copied
 * (`notes copy --for-rewrite=rebase`, which git does only where `notes.rewriteRef` is set), and the
 * `post-rewrite` hook run with "rebase" (`hook run`, the pairs given as its input through a file, as
 * `--to-stdin` takes them; none is fine). The edit is done by then: a failure is logged, as
 * IntelliJ's.
 */
async function rewritten(
  worktree: string,
  pairs: readonly (readonly [string, string])[],
  run: Git,
): Promise<void> {
  if (pairs.length === 0) return;
  const lines = pairs.map(([before, after]) => `${before} ${after}\n`).join('');
  await run(worktree, ['notes', 'copy', '--for-rewrite=rebase'], {}, lines).catch(
    (error: unknown) => {
      console.error('Copying the notes after a commit edit failed', error);
    },
  );
  const folder = await mkdtemp(join(tmpdir(), 'cerebro-rewrite-'));
  try {
    const input = join(folder, 'rewritten');
    await writeFile(input, lines);
    await run(worktree, [
      'hook',
      'run',
      '--ignore-missing',
      `--to-stdin=${input}`,
      'post-rewrite',
      '--',
      'rebase',
    ]);
  } catch (error) {
    console.error('The post-rewrite hook after a commit edit failed', error);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** HEAD's commit as it was checked, or IntelliJ's words when it has moved since. */
async function stillAt(worktree: string, head: string, run: Git): Promise<void> {
  if ((await run(worktree, ['rev-parse', 'HEAD'])).trim() !== head) throw moved();
}

const moved = () => new Error('HEAD moved during the commit editing operation');

/**
 * The commits after `target` up to `head`, oldest first, each with one parent, as IntelliJ's
 * `findCommitsRange`; throws in IntelliJ's words at a merge.
 */
async function laterCommits(
  worktree: string,
  target: string,
  head: string,
  run: Git,
): Promise<string[]> {
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
  return later;
}

/**
 * Gives `hash` `message`, as IntelliJ's `GitInMemoryRewordOperation`; `head` is HEAD's commit when
 * it was checked (`editCheck`), and nothing's done if HEAD has moved since. Each commit from
 * `hash` to HEAD is made again, the branch (or a detached HEAD) moved to the last; the working tree
 * and the index stay as they are. Gives the commit's new hash, and HEAD's. Throws, nothing changed,
 * if a merge or the first commit is between them, in IntelliJ's words.
 */
export async function reword(
  worktree: string,
  hash: string,
  message: string,
  head: string,
  run: Git,
): Promise<{ commit: string; head: string }> {
  await stillAt(worktree, head, run);
  const target = (await run(worktree, ['rev-parse', hash])).trim();
  const later = await laterCommits(worktree, target, head, run);
  const original = await read(worktree, target, run);
  const remake = await remaking(worktree, run);
  const reworded = await remake(original, original.parents, await cleanUp(worktree, message, run));
  const pairs: [string, string][] = [[target, reworded]];
  let made = reworded;
  for (const hash of later) {
    const commit = await read(worktree, hash, run);
    made = await remake(commit, [made], commit.message);
    pairs.push([hash, made]);
  }
  // Moved only from where it was checked: `update-ref` refuses if HEAD has moved meanwhile.
  try {
    await run(worktree, ['update-ref', '-m', `reword ${target} by Cerebro`, 'HEAD', made, head]);
  } catch {
    throw moved();
  }
  await rewritten(worktree, pairs, run);
  return { commit: reworded, head: made };
}

/** Git's empty tree, the first commit's parent's, as it were. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Drops `hash`, as IntelliJ's in-memory Drop Commits: each later commit's changes applied on what
 * comes before it now (`git merge-tree`, three-way, as IntelliJ's `rebaseCommit`), made again with
 * its message and author, and one left with no changes of its own dropped too (`--empty=drop`).
 * Then the branch is reset to the last, keeping local changes (`reset --keep`, which refuses where
 * they'd be lost, in git's words). `head` is HEAD's commit when it was checked (`editCheck`): if
 * it has moved, or a later commit's changes conflict, nothing's changed, and git's words say why.
 * Gives HEAD's new commit.
 */
export async function drop(
  worktree: string,
  hash: string,
  head: string,
  run: Git,
): Promise<string> {
  await stillAt(worktree, head, run);
  const target = (await run(worktree, ['rev-parse', hash])).trim();
  const later = await laterCommits(worktree, target, head, run);
  let base = (await read(worktree, target, run)).parents[0];
  let tree = base === undefined ? EMPTY_TREE : (await read(worktree, base, run)).tree;
  const remake = await remaking(worktree, run);
  const pairs: [string, string][] = [];
  for (const hash of later) {
    const commit = await read(worktree, hash, run);
    // `merge-tree` takes commits: the empty tree's, for nothing before.
    const ours = base ?? (await run(worktree, ['commit-tree', EMPTY_TREE, '-m', 'empty'])).trim();
    const merged = await run(worktree, [
      'merge-tree',
      '--write-tree',
      `--merge-base=${commit.parents[0] as string}`,
      ours,
      hash,
    ]).catch((error: unknown) => {
      // Its tree, the conflicted files, then a blank line before what it says of them.
      const output = (error as GitError).output;
      throw new Error(output.slice(output.indexOf('\n\n') + 2).trim());
    });
    const made = merged.trim();
    if (made !== tree) {
      tree = made;
      base = await remake({ ...commit, tree }, base === undefined ? [] : [base], commit.message);
    }
    // Left with no changes, it's become the commit before it, as in IntelliJ's rebase.
    if (base !== undefined) pairs.push([hash, base]);
  }
  // As IntelliJ's in-memory rebase, an empty commit where none's left.
  base ??= await remake({ tree: EMPTY_TREE, author: {} }, [], '');
  await stillAt(worktree, head, run);
  await run(worktree, ['reset', '--keep', base], {
    GIT_REFLOG_ACTION: `drop ${target} by Cerebro`,
  });
  await rewritten(worktree, pairs, run);
  return base;
}

/**
 * Undoes an edit that moved HEAD from `before` to `after`, as IntelliJ's notification's Undo
 * (`GitCommitEditingOperationResult.Complete`): refused in its words (`{ refused }`) once HEAD has
 * moved, or the first commit made is on a protected branch of a remote (`branches` names them);
 * otherwise HEAD reset to `before`, keeping local changes (`reset --keep`, which refuses, in git's
 * words, where they'd be lost).
 */
export async function undoEdit(
  worktree: string,
  before: string,
  after: string,
  branches: (name: string) => boolean,
  run: Git,
): Promise<{ refused: string } | null> {
  if ((await run(worktree, ['rev-parse', 'HEAD'])).trim() !== after) {
    return { refused: 'Repository has already been changed' };
  }
  // The commits made, oldest first: none where HEAD's was dropped.
  const [first] = (await run(worktree, ['rev-list', '--reverse', `${before}..${after}`]))
    .split('\n')
    .filter((line) => line !== '');
  const pushed =
    first === undefined ? undefined : await protectedBranchHolding(worktree, first, branches, run);
  if (pushed !== undefined) {
    return {
      refused: `Commits from current branch have already been pushed to protected branch ${pushed}`,
    };
  }
  await run(worktree, ['reset', '--keep', before]);
  return null;
}
