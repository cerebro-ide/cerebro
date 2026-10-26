// A worktree's view of the shared index: each source file's path and the blob hash of its content.
// Committed or staged content has its hash from git's index; files changed in the working tree, and
// untracked ones git doesn't ignore, are hashed as git would store them, so their content is
// parsed too. Only blobs the index hasn't seen are parsed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobIndex } from './blob-index.js';
import { languageOf } from './languages.js';

/** Runs git with `args` in `cwd`, resolving with its output. */
export type Git = (cwd: string, args: readonly string[]) => Promise<string>;

export interface IndexedWorktree {
  /** Source file paths, relative and `/`-separated, to their blob hashes. */
  files: Map<string, string>;
  /** How many blobs were parsed this time; the rest were in the index already. */
  parsed: number;
}

/** Splits git's NUL-separated output. */
const entries = (output: string) => output.split('\0').filter(Boolean);

/** Hashes files as git would store them, a batch of paths at a time. */
async function hashFiles(worktree: string, paths: readonly string[], git: Git) {
  const hashes = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const batch = paths.slice(i, i + 500);
    const output = await git(worktree, ['hash-object', '--', ...batch]);
    output
      .split('\n')
      .filter(Boolean)
      .forEach((hash, j) => hashes.set(batch[j] as string, hash.trim()));
  }
  return hashes;
}

/** Told how far indexing has got: files done of the total, as each batch is parsed. */
export type Progress = (done: number, total: number) => void;

/** Files parsed between progress reports, and between yields to other work. */
export const BATCH = 200;

/**
 * Indexes a worktree's source files, parsing only the contents the index doesn't have. Every
 * BATCH files it reports progress and yields, so other requests (and the host's other work) aren't
 * held up by a large first indexing.
 */
export async function indexWorktree(
  index: BlobIndex,
  worktree: string,
  git: Git,
  progress?: Progress,
): Promise<IndexedWorktree> {
  const files = new Map<string, string>();
  // `<mode> <blob> <stage>\t<path>`; symbolic links (120000) aren't files to parse.
  for (const entry of entries(await git(worktree, ['ls-files', '-s', '-z']))) {
    const tab = entry.indexOf('\t');
    const [mode, blob] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    if (mode !== '120000' && languageOf(path)) files.set(path, blob as string);
  }
  const deleted = entries(await git(worktree, ['ls-files', '-d', '-z']));
  for (const path of deleted) files.delete(path);
  const changed = [
    ...entries(await git(worktree, ['ls-files', '-m', '-z'])),
    ...entries(await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'])),
  ].filter((path) => languageOf(path) && !deleted.includes(path));
  for (const [path, hash] of await hashFiles(worktree, changed, git)) files.set(path, hash);
  let parsed = 0;
  let done = 0;
  for (const [path, blob] of files) {
    const added = index.add(
      blob,
      () => readFileSync(join(worktree, path), 'utf8'),
      languageOf(path) as NonNullable<ReturnType<typeof languageOf>>,
    );
    if (added) parsed++;
    if (++done % BATCH === 0) {
      progress?.(done, files.size);
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  progress?.(files.size, files.size);
  return { files, parsed };
}
