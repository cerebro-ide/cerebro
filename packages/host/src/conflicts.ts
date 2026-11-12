// Merge conflicts, as IntelliJ's git4idea resolves them (`GitMergeProvider`, `GitMergeUtil`,
// `GitConflictResolver`, `GitMerger`, `GitRebaser`, read from its source): the unmerged files and
// what each side did to them, their three versions, accepting a side or a merged text, and
// carrying on with the merge or rebase once none is left. Yours and theirs are as IntelliJ shows
// them: during a rebase, git's sides swapped, yours being the commit replayed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Git } from './git.js';

/** What a side did to a conflicted file. */
export type ConflictSide = 'modified' | 'deleted';

export interface ConflictedFile {
  path: string;
  yours: ConflictSide;
  theirs: ConflictSide;
}

/** What's under way. */
export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

export interface Conflicts {
  operation: Operation | undefined;
  files: ConflictedFile[];
  /** The current branch: during a rebase, the one rebased. */
  yours?: string;
  /** The branch merged, or rebased onto. */
  theirs?: string;
  /** During a rebase: where onto, and the commit replayed; during a cherry-pick or a revert, its commit. */
  onto?: string;
  commit?: { hash: string; author: string; message: string };
}

/** A conflicted file's versions: undefined for a side that deleted it, empty for no base. */
export type Revisions =
  | { binary: false; base: string; yours: string | undefined; theirs: string | undefined }
  | { binary: true };

/** Whether a file in the repository's git folder is there: a merge's or a rebase's state. */
async function gitFile(worktree: string, name: string, run: Git): Promise<string | undefined> {
  const path = resolve(worktree, (await run(worktree, ['rev-parse', '--git-path', name])).trim());
  return existsSync(path) ? path : undefined;
}

/** The rebase's folder, if one is under way: an interactive one's, or an older `am`'s. */
async function rebaseFolder(worktree: string, run: Git): Promise<string | undefined> {
  return (await gitFile(worktree, 'rebase-merge', run)) ?? gitFile(worktree, 'rebase-apply', run);
}

/** The merge, rebase, cherry-pick or revert under way, if any. */
export async function operation(worktree: string, run: Git): Promise<Operation | undefined> {
  if (await rebaseFolder(worktree, run)) return 'rebase';
  if (await gitFile(worktree, 'MERGE_HEAD', run)) return 'merge';
  if (await gitFile(worktree, 'CHERRY_PICK_HEAD', run)) return 'cherry-pick';
  return (await gitFile(worktree, 'REVERT_HEAD', run)) ? 'revert' : undefined;
}

/** A commit's short hash, author and message, as the Conflicts dialog names it. */
async function commitOf(worktree: string, revision: string, run: Git) {
  const [hash, author, message] = (
    await run(worktree, ['log', '-1', '--format=%h%x00%an%x00%B', revision])
  ).split('\0') as [string, string, string];
  return { hash, author, message: message.trim() };
}

/** Whether git's sides are swapped for IntelliJ's yours and theirs (`isReverseRoot`). */
const reversed = (op: Operation | undefined) => op === 'rebase';

/** The one branch that points at a commit, as IntelliJ names it; undefined for none or several. */
async function branchAt(worktree: string, commit: string, run: Git): Promise<string | undefined> {
  const names = (
    await run(worktree, [
      'for-each-ref',
      '--format=%(refname:short)',
      `--points-at=${commit}`,
      'refs/heads',
      'refs/remotes',
    ])
  )
    .split('\n')
    .filter(Boolean);
  return names.length === 1 ? names[0] : undefined;
}

/** The unmerged files, by `git ls-files -u` (sorted): stage 2 is git's ours, 3 its theirs. */
async function unmerged(worktree: string, op: Operation | undefined, run: Git) {
  const stages = new Map<string, Set<string>>();
  for (const entry of (await run(worktree, ['ls-files', '-u', '-z'])).split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab < 0) continue;
    const path = entry.slice(tab + 1);
    const stage = entry.slice(0, tab).split(' ')[2] as string;
    stages.set(path, (stages.get(path) ?? new Set()).add(stage));
  }
  const side = (present: boolean): ConflictSide => (present ? 'modified' : 'deleted');
  return [...stages].map(([path, has]): ConflictedFile => {
    const ours = side(has.has('2'));
    const theirs = side(has.has('3'));
    return reversed(op) ? { path, yours: theirs, theirs: ours } : { path, yours: ours, theirs };
  });
}

/** The conflicted files, and what's being merged, for the Conflicts dialog. */
export async function listConflicts(worktree: string, run: Git): Promise<Conflicts> {
  const op = await operation(worktree, run);
  const files = await unmerged(worktree, op, run);
  if (op === 'merge') {
    const conflicts: Conflicts = { operation: op, files };
    const branch = await run(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(
      () => '',
    );
    if (branch.trim()) conflicts.yours = branch.trim();
    // As IntelliJ: the name git gave it in the merge's message, quoted on its first line.
    const message = await gitFile(worktree, 'MERGE_MSG', run);
    const name =
      message && /'([^']+)'/.exec(readFileSync(message, 'utf8').split('\n', 1)[0] as string);
    conflicts.theirs =
      name?.[1] ?? (await run(worktree, ['rev-parse', '--short', 'MERGE_HEAD'])).trim();
    return conflicts;
  }
  if (op === 'rebase') {
    const folder = (await rebaseFolder(worktree, run)) as string;
    // Both kinds of rebase keep these (measured).
    const read = (name: string) => readFileSync(resolve(folder, name), 'utf8').trim();
    const conflicts: Conflicts = { operation: op, files };
    const head = read('head-name').replace(/^refs\/heads\//, '');
    if (head && head !== 'detached HEAD') conflicts.yours = head;
    const onto = read('onto');
    conflicts.onto = (await run(worktree, ['rev-parse', '--short', onto])).trim();
    const branch = await branchAt(worktree, onto, run);
    if (branch) conflicts.theirs = branch;
    // Stopped at conflicts, git names the commit replayed REBASE_HEAD.
    conflicts.commit = await commitOf(worktree, 'REBASE_HEAD', run);
    return conflicts;
  }
  if (op === 'cherry-pick' || op === 'revert') {
    const head = op === 'revert' ? 'REVERT_HEAD' : 'CHERRY_PICK_HEAD';
    return { operation: op, files, commit: await commitOf(worktree, head, run) };
  }
  return { operation: op, files };
}

/** A stage's text, undefined when the side has none. */
const stage = (worktree: string, n: 1 | 2 | 3, path: string, run: Git) =>
  run(worktree, ['show', `:${String(n)}:${path}`]).catch(() => undefined);

/** A conflicted file's base, yours and theirs, as IntelliJ's merge window shows them. */
export async function mergeRevisions(worktree: string, path: string, run: Git): Promise<Revisions> {
  const op = await operation(worktree, run);
  const [base, ours, theirs] = await Promise.all([
    stage(worktree, 1, path, run),
    stage(worktree, 2, path, run),
    stage(worktree, 3, path, run),
  ]);
  if ([base, ours, theirs].some((text) => text?.includes('\0'))) return { binary: true };
  // Added on both sides, there's no base: all of it is in conflict (Cerebro's choice; IntelliJ
  // takes the file with git's markers as the base).
  const sides = reversed(op) ? { yours: theirs, theirs: ours } : { yours: ours, theirs };
  return { binary: false, base: base ?? '', ...sides };
}

/** Marks files resolved: added as they are, or removed where they're gone. */
async function markResolved(worktree: string, keep: string[], gone: string[], run: Git) {
  const literal = { GIT_LITERAL_PATHSPECS: '1' };
  if (keep.length > 0) await run(worktree, ['add', '--', ...keep], literal);
  if (gone.length > 0) await run(worktree, ['rm', '--quiet', '--', ...gone], literal);
}

/**
 * Resolves files with one side's version, as IntelliJ's Accept Yours and Accept Theirs: the side's
 * text checked out, or the file removed where that side deleted it.
 */
export async function acceptSide(
  worktree: string,
  paths: readonly string[],
  side: 'yours' | 'theirs',
  run: Git,
): Promise<void> {
  const op = await operation(worktree, run);
  const named = new Set(paths);
  const files = (await unmerged(worktree, op, run)).filter((f) => named.has(f.path));
  const keep = files.filter((f) => f[side] === 'modified').map((f) => f.path);
  const gone = files.filter((f) => f[side] === 'deleted').map((f) => f.path);
  // Git's own side: the other one during a rebase.
  const ours = (side === 'yours') !== reversed(op);
  if (keep.length > 0) {
    await run(worktree, ['checkout', ours ? '--ours' : '--theirs', '--', ...keep], {
      GIT_LITERAL_PATHSPECS: '1',
    });
  }
  await markResolved(worktree, keep, gone, run);
}

/** Resolves a file with the text merged in IntelliJ's merge window. */
export async function resolveWith(
  worktree: string,
  path: string,
  text: string,
  run: Git,
): Promise<void> {
  // Only a file in conflict: nothing else is written, inside the worktree or out of it.
  const op = await operation(worktree, run);
  if (!(await unmerged(worktree, op, run)).some((f) => f.path === path)) {
    throw new Error(`${path} isn't in conflict`);
  }
  writeFileSync(resolve(worktree, path), text);
  await markResolved(worktree, [path], [], run);
}

/** What the Git menu and the Commit window show of the repository's state, as IntelliJ's. */
export interface RepositoryState {
  operation: Operation | undefined;
  /** Whether any file is in conflict: Resolve Conflicts… shows only then. */
  conflicts: boolean;
  /** During a merge, git's message for it, which the Commit window starts with. */
  message?: string;
  /** Whether the repository has any remote: IntelliJ's Fetch is disabled without. */
  remotes: boolean;
}

/**
 * The merge or rebase under way, whether files are in conflict, a merge's message, and whether
 * there are remotes.
 */
export async function repositoryState(worktree: string, run: Git): Promise<RepositoryState> {
  const op = await operation(worktree, run);
  const state: RepositoryState = {
    operation: op,
    conflicts: (await run(worktree, ['ls-files', '-u'])) !== '',
    remotes: (await run(worktree, ['remote'])) !== '',
  };
  // As IntelliJ's `GitMergeCommitMessageReader`, as git wrote it, its comments kept.
  const message = op === 'merge' ? await gitFile(worktree, 'MERGE_MSG', run) : undefined;
  if (message) state.message = readFileSync(message, 'utf8');
  return state;
}

/** A rebase carried on, `--continue` or `--skip`: whether conflicts stopped it again. */
async function rebaseOn(worktree: string, how: string, run: Git): Promise<'done' | 'conflicts'> {
  try {
    // Each commit with its message as it was, as IntelliJ's continue, which edits none.
    await run(worktree, ['rebase', how], { GIT_EDITOR: 'true' });
  } catch (error) {
    if ((await unmerged(worktree, 'rebase', run)).length > 0) return 'conflicts';
    throw error;
  }
  return 'done';
}

/**
 * Carries on once no conflict is left, as IntelliJ after its Conflicts dialog: the merge committed
 * with git's message (`GitMerger.mergeCommit`), or the rebase continued, which may stop at the next
 * commit's conflicts. Says whether conflicts stopped it.
 */
export async function continueOperation(worktree: string, run: Git): Promise<'done' | 'conflicts'> {
  const op = await operation(worktree, run);
  if (op === 'merge') {
    const message = (await gitFile(worktree, 'MERGE_MSG', run)) as string;
    await run(worktree, ['commit', '-F', message]);
    return 'done';
  }
  return op === 'rebase' ? rebaseOn(worktree, '--continue', run) : 'done';
}

/** IntelliJ's Skip Commit: the rebase goes on without the commit it stopped at. */
export function skipCommit(worktree: string, run: Git): Promise<'done' | 'conflicts'> {
  return rebaseOn(worktree, '--skip', run);
}

/** IntelliJ's Abort Merge and Abort Rebase: back to where it started, by git's `--abort`. */
export async function abortOperation(worktree: string, op: Operation, run: Git): Promise<void> {
  await run(worktree, [op, '--abort']);
}
