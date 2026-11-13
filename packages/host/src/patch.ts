// Create Patch…, as IntelliJ's (`CreatePatchCommitExecutor`, `PatchWriter`, `UnifiedDiffWriter`,
// read from its source): what a commit changed, in files or all of them, as a patch whose paths
// are relative to a base path, reversed or not, under the commit's message. Its diff is git's,
// which IntelliJ's own writer follows ("diff --git" headers, "a/" and "b/" paths, binaries as
// git's), with the message first as IntelliJ writes it.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import type { Git } from './git.js';

export interface PatchOptions {
  /** The folder the patch's paths are relative to: the repository's, a folder in it, or above it. */
  base: string;
  /** The patch undoing the changes instead. */
  reverse: boolean;
  /** Written first, as IntelliJ's "Subject: [PATCH] …" header, if any. */
  message?: string;
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
 * The patch of what `from..to` changed in `paths` (all of them, if none), its paths relative to
 * `options.base`. A base in the repository keeps to what's under it (git's `--relative`), so
 * changes outside it aren't in the patch, which the dialog doesn't allow; a base above the
 * repository prefixes its paths with the folders between.
 */
export async function createPatch(
  worktree: string,
  range: { from: string; to: string },
  paths: readonly string[],
  options: PatchOptions,
  run: Git,
): Promise<string> {
  const where = (): string[] => {
    const inside = between(worktree, options.base);
    if (!outside(inside)) return inside === '' ? [] : [`--relative=${inside}`];
    const above = between(options.base, worktree);
    if (outside(above)) throw new Error(`${options.base} holds none of the repository`);
    return [`--src-prefix=a/${above}/`, `--dst-prefix=b/${above}/`];
  };
  const diff = await run(worktree, [
    'diff',
    '--binary',
    '-M',
    '--no-color',
    '--no-ext-diff',
    ...where(),
    // Reversed from `to` to `from`, not with `-R`, which swaps the "a/" and "b/" too (measured).
    ...(options.reverse ? [range.to, range.from] : [range.from, range.to]),
    '--',
    ...paths,
  ]);
  return messageHeader(options.message) + diff;
}

/** Writes a patch to `file`, making its folders first, as IntelliJ's `PatchWriter`. */
export async function writePatch(file: string, patch: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, patch);
}
