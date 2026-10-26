// Git, through its command line: the host runs next to the repos, so git is local to them.

import { execFile } from 'node:child_process';

export interface Worktree {
  /** The worktree's folder, absolute. */
  path: string;
  /** The checked-out commit; undefined for a bare repository. */
  head: string | undefined;
  /** The branch checked out (`main`, not `refs/heads/main`); undefined when detached or bare. */
  branch: string | undefined;
  /** The repository's main worktree: the first git lists. */
  main: boolean;
  bare: boolean;
}

/** Runs git with `args` in `cwd`, resolving with its output. */
export type Git = (cwd: string, args: readonly string[]) => Promise<string>;

export const git: Git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });

/** Reads `git worktree list --porcelain`: a block of lines per worktree, blank-line separated. */
export function parseWorktrees(porcelain: string): Worktree[] {
  return porcelain
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter(Boolean))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines, index) => {
      const value = (key: string) =>
        lines.find((l) => l.startsWith(`${key} `))?.slice(key.length + 1);
      const branch = value('branch');
      return {
        path: (value('worktree') as string).trim(),
        head: value('HEAD'),
        branch: branch?.replace(/^refs\/heads\//, ''),
        main: index === 0,
        bare: lines.includes('bare'),
      };
    });
}

/** The worktrees of the repository `repo` is in. */
export async function listWorktrees(repo: string, run: Git = git): Promise<Worktree[]> {
  return parseWorktrees(await run(repo, ['worktree', 'list', '--porcelain']));
}

export interface NewWorktree {
  /** Where the worktree goes: a folder that doesn't exist yet. */
  path: string;
  /** The branch to check out there. */
  branch: string;
  /** Create the branch, from `from` (default: the current commit), rather than use an existing one. */
  create?: boolean;
  from?: string;
}

/** Adds a worktree to the repository `repo` is in; resolves with the worktrees after. */
export async function addWorktree(
  repo: string,
  worktree: NewWorktree,
  run: Git = git,
): Promise<Worktree[]> {
  const args = worktree.create
    ? [
        'worktree',
        'add',
        '-b',
        worktree.branch,
        worktree.path,
        ...(worktree.from ? [worktree.from] : []),
      ]
    : ['worktree', 'add', worktree.path, worktree.branch];
  await run(repo, args);
  return listWorktrees(repo, run);
}

/**
 * Removes a worktree; git refuses one with changes unless `force`, and never removes the main one.
 * Resolves with the worktrees after.
 */
export async function removeWorktree(
  repo: string,
  path: string,
  force = false,
  run: Git = git,
): Promise<Worktree[]> {
  await run(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), path]);
  return listWorktrees(repo, run);
}

/**
 * A worktree's files, relative to it: tracked ones and untracked ones git doesn't ignore, as
 * `/`-separated paths, sorted. What Go to File searches.
 */
export async function listFiles(worktree: string, run: Git = git): Promise<string[]> {
  const output = await run(worktree, [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  // A file deleted but not yet staged is still listed as cached once, and as nothing else.
  return [...new Set(output.split('\0').filter(Boolean))].sort();
}
