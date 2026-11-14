// Create Patch…, as IntelliJ's (`CreatePatchCommitExecutor`, `PatchWriter`, `UnifiedDiffWriter`,
// read from its source): what a commit changed, or the working tree's changes, in files or all of
// them, as a patch whose paths are relative to a base path, reversed or not, under a message. Its diff is git's,
// which IntelliJ's own writer follows ("diff --git" headers, "a/" and "b/" paths, binaries as
// git's), with the message first as IntelliJ writes it.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Git } from './git.js';

export interface PatchOptions {
  /** The folder the patch's paths are relative to: the repository's, a folder in it, or above it. */
  base: string;
  /** The patch undoing the changes instead. */
  reverse: boolean;
  /** Written first, as IntelliJ's "Subject: [PATCH] …" header, if any. */
  message?: string;
  /** Untracked files among the working tree's changes, in the patch as new files. */
  untracked?: readonly string[];
}

/** IntelliJ's header for a commit message (`writeCommitMessageHeader`): none for no message. */
export function messageHeader(message: string | undefined): string {
  const text = message?.trim() ?? '';
  return text === '' ? '' : `Subject: [PATCH] ${text}\n---\n`;
}

/** A path from `from` to `to` with forward slashes, as git takes it; `''` for the same folder. */
function between(from: string, to: string): string {
  return relative(from, to).split(sep).join('/');
}

/** Whether a relative path leads out of its folder: up, or to another drive (Windows). */
const outside = (path: string) => path === '..' || path.startsWith('../') || isAbsolute(path);

/**
 * The patch of what `from..to` changed in `paths` (all of them, if none), or without `to`, the
 * working tree's changes since `from`; its paths relative to `options.base`. A base in the
 * repository keeps to what's under it (git's `--relative`), so changes outside it aren't in the
 * patch, which the dialog doesn't allow; a base above the repository prefixes its paths with the
 * folders between. Untracked files are in it as new files: marked to be added (`add -N`) in a copy
 * of the index, which git's diff is given, so the repository's own index isn't touched (measured,
 * git 2.43).
 */
export async function createPatch(
  worktree: string,
  range: { from: string; to?: string | undefined },
  paths: readonly string[],
  options: PatchOptions,
  run: Git,
): Promise<string> {
  // The paths' folder: below the repository's (`--relative`), or the folders above it as prefixes.
  const inside = between(worktree, options.base);
  let folder = '';
  if (outside(inside)) {
    const above = between(options.base, worktree);
    if (outside(above)) throw new Error(`${options.base} holds none of the repository`);
    folder = `${above}/`;
  }
  const working = range.to === undefined;
  // The working tree's side has no name to put first: reversed, it's `-R`, which swaps the "a/"
  // and "b/" too, so they're given swapped (measured, git 2.43). A commit's is from `to` to `from`.
  const swapped = working && options.reverse;
  const [src, dst] = swapped ? ['b/', 'a/'] : ['a/', 'b/'];
  const ends = working
    ? [range.from]
    : options.reverse
      ? [range.to as string, range.from]
      : [range.from, range.to as string];
  const args = [
    'diff',
    '--binary',
    '-M',
    '--no-color',
    '--no-ext-diff',
    ...(swapped ? ['-R'] : []),
    ...(inside === '' || folder !== '' ? [] : [`--relative=${inside}`]),
    ...(folder === '' && !swapped
      ? []
      : [`--src-prefix=${src}${folder}`, `--dst-prefix=${dst}${folder}`]),
    ...ends,
    '--',
    ...paths,
  ];
  const untracked = working ? (options.untracked ?? []) : [];
  if (untracked.length === 0) return messageHeader(options.message) + (await run(worktree, args));
  const temporary = await mkdtemp(join(tmpdir(), 'cerebro-patch-'));
  try {
    const env = { GIT_INDEX_FILE: join(temporary, 'index') };
    const index = (await run(worktree, ['rev-parse', '--git-path', 'index'])).trim();
    // A repository with nothing added yet has no index (measured): the copy starts empty. The
    // copy keeps the index's times: git takes a file whose size and time in seconds match its
    // entry as unchanged unless the index is no older than it ("racy git"), so a copy made later
    // hid a change to the same size in the second of the checkout (measured, git 2.43).
    const original = resolve(worktree, index);
    if (existsSync(original)) {
      await copyFile(original, env.GIT_INDEX_FILE);
      const { atime, mtime } = await stat(original);
      await utimes(env.GIT_INDEX_FILE, atime, mtime);
    }
    await run(worktree, ['add', '-N', '--', ...untracked], env);
    return messageHeader(options.message) + (await run(worktree, args, env));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Writes a patch to `file`, making its folders first, as IntelliJ's `PatchWriter`. */
export async function writePatch(file: string, patch: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, patch);
}
