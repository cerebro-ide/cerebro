// IntelliJ's Annotate with Git Blame (`GitAnnotationProvider`, `GitFileAnnotation`, read from its
// source): who last changed each line of a file, and when, from `git blame --porcelain`. The text
// blamed is the editor's, given on git's input (`--contents -`): lines changed since the last
// commit have no commit, as IntelliJ shows none for them.

import type { Git } from './git.js';

/** A commit that last changed some line. */
export interface BlameCommit {
  hash: string;
  author: string;
  email: string;
  /** The author's date, in ms, as IntelliJ shows by default. */
  time: number;
  /** The committer's date, in ms: IntelliJ's Show Commit Timestamp. */
  committed: number;
  /** Its whole message, for the tooltip. */
  message: string;
  /** The file's path in it, when it was elsewhere then. */
  path?: string;
  /** The commit before that changed the file, and its path there: none where it was added. */
  previous?: { hash: string; path: string };
}

/** IntelliJ's Options on an annotation (`GitVcsApplicationSettings`, `GitAnnotationProvider`). */
export interface BlameOptions {
  /** `-w`: on by default in IntelliJ. */
  ignoreWhitespace: boolean;
  /** Lines moved or copied: within the file (`-M`), across files too (`-C`), or not looked for. */
  movements: (typeof MOVEMENTS)[number];
}

/** How far moved lines are followed: not, within the file, or across files too. */
export const MOVEMENTS = ['none', 'within', 'across'] as const;

export interface Blame {
  /** Each line's commit, by its hash; null for a line changed since the last commit. */
  lines: (string | null)[];
  /** The commits, newest first. */
  commits: BlameCommit[];
}

/** What git says changed a line not yet committed: no commit. */
const UNCOMMITTED = /^0+$/;

/** `git blame --porcelain`'s output: each line's commit, and each commit as first described. */
export function parseBlame(
  porcelain: string,
  path: string,
): { lines: (string | null)[]; commits: Map<string, Omit<BlameCommit, 'message'>> } {
  const lines: (string | null)[] = [];
  const commits = new Map<string, Omit<BlameCommit, 'message'>>();
  let current: Omit<BlameCommit, 'message'> | undefined;
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('\t')) {
      // The line itself: after its header.
      continue;
    }
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)/.exec(line);
    if (header) {
      const hash = header[1] as string;
      const number = Number(header[2]) - 1;
      const committed = !UNCOMMITTED.test(hash);
      lines[number] = committed ? hash : null;
      current = commits.get(hash);
      if (!current && committed) {
        current = { hash, author: '', email: '', time: 0, committed: 0 };
        commits.set(hash, current);
      }
      if (!committed) current = undefined;
      continue;
    }
    if (!current) continue;
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? '' : line.slice(space + 1);
    if (key === 'author') current.author = value;
    else if (key === 'author-mail') current.email = value.replace(/^<|>$/g, '');
    else if (key === 'author-time') current.time = Number(value) * 1000;
    else if (key === 'committer-time') current.committed = Number(value) * 1000;
    else if (key === 'filename' && value !== path) current.path = value;
    else if (key === 'previous') {
      const at = value.indexOf(' ');
      current.previous = { hash: value.slice(0, at), path: value.slice(at + 1) };
    }
  }
  return { lines, commits };
}

/**
 * Blames a file's text, as the editor has it, against the worktree's last commit: as IntelliJ's,
 * `git blame --porcelain -l -t --encoding=UTF-8`, with its options. Each commit's whole message is
 * read after.
 */
export async function blame(
  worktree: string,
  path: string,
  text: string,
  run: Git,
  options: BlameOptions = { ignoreWhitespace: true, movements: 'none' },
): Promise<Blame> {
  const output = await run(
    worktree,
    [
      'blame',
      '--porcelain',
      '-l',
      '-t',
      '--encoding=UTF-8',
      ...(options.ignoreWhitespace ? ['-w'] : []),
      ...({ none: [], within: ['-M'], across: ['-C'] } as const)[options.movements],
      '--contents',
      '-',
      '--',
      path,
    ],
    undefined,
    text,
  );
  const { lines, commits } = parseBlame(output, path);
  const messages = new Map<string, string>();
  if (commits.size > 0) {
    const log = await run(worktree, [
      'log',
      '--no-walk=unsorted',
      '--format=%H%x00%B%x00',
      ...commits.keys(),
    ]);
    const parts = log.split('\0');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      messages.set((parts[i] as string).trim(), (parts[i + 1] as string).trim());
    }
  }
  return {
    lines,
    commits: [...commits.values()]
      .map((commit) => ({ ...commit, message: messages.get(commit.hash) as string }))
      .sort((a, b) => b.time - a.time),
  };
}
