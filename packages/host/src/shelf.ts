// Putting uncommitted changes aside and back, as IntelliJ's shelf and git's stash.
//
// The shelf is IntelliJ's own (it keeps patches in the project's folder); here each shelved list is
// a commit, kept by a ref in the worktree's own namespace (refs/worktree/), so git keeps it and
// other worktrees don't see it: the last commit's files, with the shelved ones as they were, made
// through a temporary index (the real one is untouched). Shelving takes the files back to their
// last commit; unshelving applies the difference again, as a patch.
//
// The stash is git's (`git stash`), as IntelliJ's Stash and Unstash Changes run it.

import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_TREE, rollback, type Change, type Git } from './git.js';

/** Where a worktree's shelved lists are kept, a ref each. */
export const SHELF = 'refs/worktree/cerebro/shelf/';

/** Shelved lists are commits; git wants a name for them, whoever the user is. */
const IDENTITY = ['-c', 'user.name=Cerebro', '-c', 'user.email=cerebro@localhost'];

/** Paths as they are, not patterns: a file named `*.ts` is just that file. */
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

export interface Shelf {
  /** Its ref, under SHELF. */
  id: string;
  /** The commit holding the shelved files, and what they're compared with: the last commit then. */
  commit: string;
  base: string;
  /** What it was named when shelved. */
  message: string;
  /** When it was shelved, in milliseconds. */
  time: number;
}

/** A stash, as `git stash list` gives it. */
export interface Stash {
  /** `stash@{0}`, the latest. */
  ref: string;
  /** Its commit, and the commit it was made on: its changes are between the two. */
  hash: string;
  parent: string;
  /** Git's line for it: "On main: message", or "WIP on main: …" without one. */
  message: string;
  time: number;
}

let indexes = 0;
let shelves = 0;

/** The worktree's last commit; undefined before the first. */
async function head(worktree: string, run: Git): Promise<string | undefined> {
  try {
    return (await run(worktree, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    return undefined;
  }
}

/**
 * Shelves the changes named, as IntelliJ's Shelve Changes: they're kept, under `message`, and the
 * files go back to their last commit; added and untracked ones are deleted. Resolves with the new
 * shelved list's id.
 */
export async function shelve(
  worktree: string,
  changes: readonly Change[],
  message: string,
  run: Git,
  now: () => number = Date.now,
): Promise<string> {
  const base = await head(worktree, run);
  const temp = join(tmpdir(), `cerebro-shelf-${String(process.pid)}-${String(++indexes)}`);
  try {
    const env = { GIT_INDEX_FILE: temp, ...LITERAL };
    if (base !== undefined) await run(worktree, ['read-tree', base], env);
    const paths = changes.flatMap((c) => (c.from === undefined ? [c.path] : [c.from, c.path]));
    await run(worktree, ['add', '--all', '--', ...paths], env);
    const tree = (await run(worktree, ['write-tree'], env)).trim();
    const parents = base === undefined ? [] : ['-p', base];
    const commit = (
      await run(worktree, [...IDENTITY, 'commit-tree', tree, ...parents, '-m', message])
    ).trim();
    const id = `${String(now())}-${String(++shelves)}`;
    await run(worktree, ['update-ref', `${SHELF}${id}`, commit]);
    await rollback(
      worktree,
      changes.filter((c) => c.status !== 'untracked'),
      true,
      run,
    );
    await Promise.all(
      changes
        .filter((c) => c.status === 'untracked')
        .map((c) => rm(join(worktree, c.path), { force: true })),
    );
    return id;
  } finally {
    await rm(temp, { force: true });
  }
}

/** The worktree's shelved lists, the latest first. */
export async function listShelves(worktree: string, run: Git): Promise<Shelf[]> {
  const output = await run(worktree, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(parent)%09%(subject)',
    SHELF,
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, commit, parent, message] = line.split('\t') as [string, string, string, string];
      const id = ref.slice(SHELF.length);
      return { id, commit, base: parent || EMPTY_TREE, message, time: Number(id.split('-')[0]) };
    })
    .sort((a, b) => b.time - a.time);
}

/** A shelved list, by its id; an error if there's none. */
async function shelfOf(worktree: string, id: string, run: Git): Promise<Shelf> {
  const shelf = (await listShelves(worktree, run)).find((s) => s.id === id);
  if (!shelf) throw new Error(`No shelved changes ${id}`);
  return shelf;
}

/**
 * Unshelves a list, as IntelliJ's Unshelve: its changes are applied to the files as they are, where
 * their lines are, and it leaves the shelf. If they don't apply (a file changed since in the same place), nothing is
 * changed and it stays shelved.
 */
export async function unshelve(worktree: string, id: string, run: Git): Promise<void> {
  const shelf = await shelfOf(worktree, id, run);
  const patch = await run(worktree, ['diff', '--binary', '-M', shelf.base, shelf.commit]);
  // With one line around a hunk if all of them don't match, so it applies where its lines moved
  // to: git anchors a hunk at line 1 to the file's start until it drops some, as IntelliJ's
  // applier finds them elsewhere. A five-line file's hunk, two lines before its change and two
  // after, failed with `-C2` once a line was added above it, and applies with `-C1` (measured, git
  // 2.43), as the Log's Revert Selected Changes.
  if (patch !== '') await run(worktree, ['apply', '-C1', '-'], undefined, patch);
  await deleteShelf(worktree, id, run);
}

/** Deletes a shelved list. */
export async function deleteShelf(worktree: string, id: string, run: Git): Promise<void> {
  await shelfOf(worktree, id, run);
  await run(worktree, ['update-ref', '-d', `${SHELF}${id}`]);
}

/** The worktree's stashes, the latest first; none before the first commit. */
export async function listStashes(worktree: string, run: Git): Promise<Stash[]> {
  let output: string;
  try {
    output = await run(worktree, ['stash', 'list', '-z', '--format=%gd%x1f%H%x1f%P%x1f%ct%x1f%gs']);
  } catch {
    return [];
  }
  return output
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [ref, hash, parents, time, message] = record.split('\x1f') as [
        string,
        string,
        string,
        string,
        string,
      ];
      return {
        ref,
        hash,
        parent: parents.split(' ')[0] as string,
        message,
        time: Number(time) * 1000,
      };
    });
}

/** Stashes the worktree's changes, as IntelliJ's Stash dialog: Keep index, Include untracked. */
export async function stash(
  worktree: string,
  message: string,
  options: { keepIndex: boolean; includeUntracked: boolean },
  run: Git,
): Promise<void> {
  await run(worktree, [
    'stash',
    'push',
    ...(options.keepIndex ? ['--keep-index'] : []),
    ...(options.includeUntracked ? ['--include-untracked'] : []),
    ...(message === '' ? [] : ['-m', message]),
  ]);
}

/** Applies a stash, as IntelliJ's Unstash dialog: Pop stash drops it after; Reinstate index. */
export async function unstash(
  worktree: string,
  ref: string,
  options: { pop: boolean; reinstateIndex: boolean },
  run: Git,
): Promise<void> {
  await run(worktree, [
    'stash',
    options.pop ? 'pop' : 'apply',
    ...(options.reinstateIndex ? ['--index'] : []),
    ref,
  ]);
}

/** Drops a stash. */
export async function dropStash(worktree: string, ref: string, run: Git): Promise<void> {
  await run(worktree, ['stash', 'drop', ref]);
}

/** Drops every stash. */
export async function clearStashes(worktree: string, run: Git): Promise<void> {
  await run(worktree, ['stash', 'clear']);
}
