// A folder's files, for Go to File and the index: git's list in a repository; outside one (a
// folder opened without git), ripgrep's, which skips what `.gitignore` and `.ignore` files name as
// git would (`--no-require-git`), and lists hidden files, as git's list does.

import { execFile } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import { git as runGit, listFiles, type Git } from './git.js';

/** Whether git failed because the folder isn't in a repository. */
export function notARepository(error: unknown): boolean {
  return error instanceof Error && /not a git repository/i.test(error.message);
}

/** The files ripgrep finds in a folder, relative to it, `/`-separated, sorted. */
export function filesByRipgrep(folder: string, rg = rgPath): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      rg,
      ['--files', '--no-require-git', '--hidden', '--glob', '!.git', '--null'],
      { cwd: folder, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // Exit 1: no files at all.
        if (error && error.code !== 1) reject(new Error(stderr.trim() || error.message));
        else
          resolve(
            stdout
              .split('\0')
              .filter(Boolean)
              .map((p) => p.replaceAll('\\', '/'))
              .sort(),
          );
      },
    );
  });
}

/** A folder's files: git's list in a repository, ripgrep's outside one. */
export async function folderFiles(
  folder: string,
  run: Git = runGit,
  rg = rgPath,
): Promise<string[]> {
  try {
    return await listFiles(folder, run);
  } catch (error) {
    if (!notARepository(error)) throw error;
    return filesByRipgrep(folder, rg);
  }
}
