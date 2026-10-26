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

/** A changed file in a worktree, against its last commit. */
export interface Change {
  /** Relative to the worktree, `/`-separated. */
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  /** A renamed file's path before. */
  from?: string;
}

/**
 * Reads `git status --porcelain=v1 -z`: an entry per file, `XY path`, X the index's status and Y
 * the worktree's; a rename's or copy's entry is followed by the path it came from.
 */
export function parseStatus(output: string): Change[] {
  const fields = output.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i] as string;
    if (entry.length < 4) continue;
    const x = entry[0] as string;
    const y = entry[1] as string;
    const path = entry.slice(3);
    if (x === 'R' || x === 'C') {
      const from = fields[++i] as string;
      changes.push(x === 'R' ? { path, status: 'renamed', from } : { path, status: 'added' });
    } else if (x === '?') changes.push({ path, status: 'untracked' });
    else if (x === 'D' || y === 'D') changes.push({ path, status: 'deleted' });
    else if (x === 'A') changes.push({ path, status: 'added' });
    else changes.push({ path, status: 'modified' });
  }
  // A path is listed once.
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The worktree's changes against its last commit, staged or not, untracked files included. */
export async function listChanges(worktree: string, run: Git = git): Promise<Change[]> {
  return parseStatus(
    await run(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
}

/** A file's text in the worktree's last commit; empty if it isn't in it (or there's none yet). */
export async function committedText(
  worktree: string,
  path: string,
  run: Git = git,
): Promise<string> {
  try {
    return await run(worktree, ['show', `HEAD:${path}`]);
  } catch {
    return '';
  }
}
