// Git, through its command line: the host runs next to the repos, so git is local to them.

import { execFile } from 'node:child_process';
import type { Writable } from 'node:stream';

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

/**
 * Runs git with `args` in `cwd`, `env` added to its environment and `input` on its standard input,
 * resolving with its output.
 */
export type Git = (
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
  input?: string,
) => Promise<string>;

export const git: Git = (cwd, args, env, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024, ...(env ? { env: { ...process.env, ...env } } : {}) },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolve(stdout);
      },
    );
    const stdin = child.stdin as Writable;
    // Git may exit without reading it (outside a repository): the exit is what's reported.
    stdin.on('error', () => undefined);
    stdin.end(input);
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

/**
 * The worktree's files git ignores; a folder ignored as a whole is one entry, ending in `/`
 * (`node_modules/`), not every file in it.
 */
export async function listIgnored(worktree: string, run: Git = git): Promise<string[]> {
  const output = await run(worktree, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z',
  ]);
  return output
    .split('\0')
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : 1));
}

/**
 * Which of a folder's entries git ignores, by name: those in an ignored folder too, but not files
 * git tracks. None outside a repository.
 */
export async function ignoredAmong(
  folder: string,
  names: readonly string[],
  run: Git = git,
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  try {
    // On its input, NUL-separated (`-z`), so names are never quoted, nor too many for a command line.
    const output = await run(
      folder,
      ['check-ignore', '-z', '--stdin'],
      undefined,
      names.join('\0'),
    );
    return new Set(output.split('\0').filter(Boolean));
  } catch {
    // It exits with 1 when none is ignored (measured), and fails outside a repository.
    return new Set();
  }
}

/**
 * Undoes changes, staged or not, back to the last commit: a modified or deleted file comes back as
 * committed, a renamed one goes back to its old name. An added file is unstaged; its copy on disk
 * is deleted too, if `deleteAdded`, else it stays, untracked. Untracked files aren't touched.
 */
export async function rollback(
  worktree: string,
  changes: readonly Change[],
  deleteAdded: boolean,
  run: Git = git,
): Promise<void> {
  const kept = changes.filter((c) => c.status === 'added' && !deleteAdded).map((c) => c.path);
  // Measured: restoring from HEAD, staged and in the worktree, brings a modified, deleted or
  // renamed file (given both its paths) back, and deletes an added one.
  const restored = changes
    .filter((c) => c.status !== 'untracked' && !kept.includes(c.path))
    .flatMap((c) => (c.from === undefined ? [c.path] : [c.from, c.path]));
  if (restored.length > 0) {
    await run(worktree, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restored]);
  }
  if (kept.length > 0) await run(worktree, ['restore', '--staged', '--', ...kept]);
}

/**
 * Reads `git diff --name-status -z`: a status letter (with a similarity score for a rename or a
 * copy), then the path, or the path before and after.
 */
export function parseNameStatus(output: string): Change[] {
  const fields = output.split('\0');
  const changes: Change[] = [];
  for (let i = 0; i < fields.length - 1; i++) {
    const letter = (fields[i] as string).charAt(0);
    if (letter === 'R' || letter === 'C') {
      const from = fields[++i] as string;
      const path = fields[++i] as string;
      changes.push(letter === 'R' ? { path, status: 'renamed', from } : { path, status: 'added' });
      continue;
    }
    const path = fields[++i] as string;
    const status = letter === 'A' ? 'added' : letter === 'D' ? 'deleted' : 'modified';
    changes.push({ path, status });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** The changes from one commit to another, renames found. */
export async function listChangesBetween(
  worktree: string,
  from: string,
  to: string,
  run: Git = git,
): Promise<Change[]> {
  return parseNameStatus(await run(worktree, ['diff', '--name-status', '-z', '-M', from, to]));
}

/** A file's text at a commit; empty if it isn't in it (or there's no such commit yet). */
export async function textAt(
  worktree: string,
  commit: string,
  path: string,
  run: Git = git,
): Promise<string> {
  try {
    return await run(worktree, ['show', `${commit}:${path}`]);
  } catch {
    return '';
  }
}

/** A file's text in the worktree's last commit; empty if it isn't in it (or there's none yet). */
export function committedText(worktree: string, path: string, run: Git = git): Promise<string> {
  return textAt(worktree, 'HEAD', path, run);
}
