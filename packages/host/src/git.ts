// Git, through its command line: the host runs next to the repos, so git is local to them.

import { execFile } from 'node:child_process';
import type { Writable } from 'node:stream';
import { timed } from './slow.js';

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

/**
 * Git's optional locks off: reading (`git status`) doesn't refresh and write the index as it goes,
 * under a lock that makes a stash or commit run meanwhile fail ("Unable to create
 * '.git/index.lock': File exists"; git's documentation of GIT_OPTIONAL_LOCKS). The Commit window
 * reads the changes every few seconds.
 */
const NO_OPTIONAL_LOCKS = { GIT_OPTIONAL_LOCKS: '0' };

/** Git failing: its error output as the message, and its output, where some commands say why. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message);
  }
}

export const git: Git = (cwd, args, env, input) =>
  timed(`git ${args.join(' ')} in ${cwd}`, async () =>
    (await execute(cwd, args, env, input)).toString('utf8'),
  );

/** Runs git in `cwd`, giving its output as bytes: a file's at a commit, which may not be text. */
export type GitBytes = (cwd: string, args: readonly string[]) => Promise<Uint8Array>;

export const gitBytes: GitBytes = (cwd, args) =>
  timed(`git ${args.join(' ')} in ${cwd}`, () => execute(cwd, args));

const execute = (
  cwd: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
  input?: string,
) =>
  new Promise<Buffer>((resolve, reject) => {
    const child = execFile(
      'git',
      [...args],
      {
        cwd,
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...NO_OPTIONAL_LOCKS, ...env },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new GitError(stderr.toString('utf8').trim() || error.message, stdout.toString('utf8')),
          );
        } else resolve(stdout);
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
  /** `conflict`: unmerged, a merge's or a rebase's conflict not yet resolved. */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';
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
    // Unmerged, as git's documentation of the short format lists them: either side U, or both
    // added or both deleted.
    else if (x === 'U' || y === 'U' || (x === y && (x === 'A' || x === 'D'))) {
      changes.push({ path, status: 'conflict' });
    } else if (x === 'D' || y === 'D') changes.push({ path, status: 'deleted' });
    else if (x === 'A') changes.push({ path, status: 'added' });
    else changes.push({ path, status: 'modified' });
  }
  // A path is listed once.
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Which of `files` (from the worktree's top) git tracks: the Commit window's unsaved edits are
 * changes only in those, not in a file git ignores.
 */
export async function trackedFiles(
  worktree: string,
  files: readonly string[],
  run: Git = git,
): Promise<string[]> {
  if (files.length === 0) return [];
  const out = await run(worktree, ['ls-files', '-z', '--', ...files]);
  return out.split('\0').filter((file) => file !== '');
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
 * Commits the changes named, as they are in the worktree, and nothing else staged: what else the
 * user staged stays staged. As IntelliJ's: it stages the files to commit, commits, and puts back
 * what was staged besides (GitCheckinEnvironment). `git commit --only` does that in one step, given
 * the paths (a renamed file's both); an untracked file is added first, since `--only` takes only
 * paths git knows (measured). With `amend`, the last commit is replaced; with no changes too, to
 * change only its message. During a merge, git won't commit some paths alone ("cannot do a partial
 * commit during a merge", measured): as IntelliJ's `GitResetAddStagingAreaStateManager`, what's
 * staged besides is unstaged, the paths staged, the whole index committed, which makes the merge
 * commit, and what was unstaged staged again.
 */
export async function commit(
  worktree: string,
  changes: readonly Change[],
  message: string,
  amend: boolean,
  run: Git = git,
): Promise<void> {
  // Paths as they are, not patterns: a file named `*.ts` is just that file.
  const literal = { GIT_LITERAL_PATHSPECS: '1' };
  const merging = await run(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).then(
    () => true,
    () => false,
  );
  if (merging && (await run(worktree, ['ls-files', '-u'])) !== '') {
    // IntelliJ's words, which are git's too, before its hints.
    throw new Error('Committing is not possible because you have unmerged files.');
  }
  const untracked = changes.filter((c) => c.status === 'untracked').map((c) => c.path);
  if (untracked.length > 0) await run(worktree, ['add', '--', ...untracked], literal);
  const paths = changes.flatMap((c) => (c.from === undefined ? [c.path] : [c.from, c.path]));
  const besides = merging
    ? (await run(worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z']))
        .split('\0')
        .filter((path) => path !== '' && !paths.includes(path))
    : [];
  if (besides.length > 0) await run(worktree, ['reset', '-q', '--', ...besides], literal);
  try {
    await run(
      worktree,
      [
        'commit',
        merging ? '--include' : '--only',
        '--file=-',
        ...(amend ? ['--amend'] : []),
        '--',
        ...paths,
      ],
      literal,
      message,
    );
  } catch (error) {
    // Not committed (a hook refused, say): what was untracked is again.
    if (untracked.length > 0) {
      await run(worktree, ['rm', '--cached', '--quiet', '--', ...untracked], literal);
    }
    throw error;
  } finally {
    if (besides.length > 0) await run(worktree, ['add', '-A', '--', ...besides], literal);
  }
}

/** The last commit's whole message, for amending it; empty if there's no commit yet. */
export async function lastMessage(worktree: string, run: Git = git): Promise<string> {
  try {
    return (await run(worktree, ['log', '-1', '--format=%B'])).trimEnd();
  } catch {
    return '';
  }
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

/** The changes from one commit to another, or to the files as they are; renames found. */
export async function listChangesBetween(
  worktree: string,
  from: string,
  to: string | undefined,
  run: Git = git,
): Promise<Change[]> {
  const between = to === undefined ? [from] : [from, to];
  return parseNameStatus(await run(worktree, ['diff', '--name-status', '-z', '-M', ...between]));
}

/**
 * A merge's changes as IntelliJ lists them (`VcsStatusMerger`): only the files it changes against
 * every one of its `parents`, a rename by its new path. Each is as against the first parent,
 * unless they differ: a delete against any is a delete; a rename from different paths, or changes
 * of different kinds, a change.
 */
export async function listMergedChanges(
  worktree: string,
  parents: readonly string[],
  merge: string,
  run: Git = git,
): Promise<Change[]> {
  const each = await Promise.all(
    parents.map(async (parent) => {
      const changes = await listChangesBetween(worktree, parent, merge, run);
      return new Map(changes.map((change) => [change.path, change]));
    }),
  );
  const [first, ...others] = each as [Map<string, Change>, ...Map<string, Change>[]];
  return [...first.values()].flatMap((change): Change[] => {
    const all = [change, ...others.map((changes) => changes.get(change.path))];
    if (all.includes(undefined)) return [];
    const statuses = new Set(all.map((c) => (c as Change).status));
    const { path } = change;
    if (statuses.size > 1)
      return [{ path, status: statuses.has('deleted') ? 'deleted' : 'modified' }];
    const sources = new Set(all.map((c) => (c as Change).from));
    return [sources.size > 1 ? { path, status: 'modified' } : change];
  });
}

/** Git's empty tree: what changes made before any commit are compared with. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A file's bytes at a commit; undefined if it isn't in it (or there's no such commit yet). */
export async function bytesAt(
  worktree: string,
  commit: string,
  path: string,
  run: GitBytes = gitBytes,
): Promise<Uint8Array | undefined> {
  try {
    return await run(worktree, ['show', `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}

/** A commit, as the Git tool window's Log lists it. */
export interface LogCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** When it was authored, in milliseconds since the epoch. */
  time: number;
  subject: string;
  /** Its message after the subject, without the blank line between; empty if there's none. */
  body: string;
  /** The refs at it, as git names them in full (`refs/heads/main`, `HEAD`, `tag: refs/tags/v1`). */
  refs: string[];
}

/** The fields of a commit in `git log`'s output, a unit separator between them. */
const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%D', '%s', '%b'].join('%x1f');

/** Reads `git log -z` in LOG_FORMAT: a commit per NUL-ended record. */
export function parseLog(output: string): LogCommit[] {
  return output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [hash, parents, author, email, time, refs, subject, ...body] = record.split('\x1f') as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        ...string[],
      ];
      return {
        hash,
        parents: parents === '' ? [] : parents.split(' '),
        author,
        email,
        time: Number(time) * 1000,
        subject,
        // The body last: a unit separator in it is its own.
        body: body.join('\x1f').trimEnd(),
        refs: refs === '' ? [] : refs.split(', '),
      };
    });
}

/** Every branch, remote branch and tag, and HEAD: the Log's commits when no branch is chosen. */
const ALL = ['--branches', '--remotes', '--tags', 'HEAD'];

/** The commits to list: the branches given (refs in full, or HEAD), else all. */
const revisions = (branches?: readonly string[]) =>
  branches ? ['--end-of-options', ...branches] : ALL;

/** A commit's details, newest first with each after its children, as the Log lists them. */
const DETAILS = ['-z', '--date-order', '--decorate=full', `--format=${LOG_FORMAT}`];

/** Runs `git log`, after `config` (`-c` options); nothing in a repository with no commits yet. */
async function readLog(
  worktree: string,
  args: readonly string[],
  run: Git,
  input?: string,
  config: readonly string[] = [],
) {
  try {
    return await run(worktree, [...config, 'log', ...args], undefined, input);
  } catch (error) {
    // HEAD names a branch with no commits yet.
    if (/bad revision 'HEAD'/.test((error as Error).message)) return '';
    throw error;
  }
}

/** Each commit's parents, the commits in the Log's order (a commit before its parents). */
async function ancestry(worktree: string, revs: readonly string[], run: Git) {
  const output = await readLog(
    worktree,
    ['-z', '--date-order', '--format=%H%x1f%P', ...revs, '--'],
    run,
  );
  return new Map(
    output
      .split('\0')
      .filter((record) => record !== '')
      .map((record) => {
        const [hash, parents] = record.split('\x1f') as [string, string];
        return [hash, parents === '' ? [] : parents.split(' ')];
      }),
  );
}

/** What the Log's text filter asks for, as IntelliJ's: in commits' messages, or their hashes. */
export interface TextFilter {
  text: string;
  regex: boolean;
  matchCase: boolean;
}

/** What the Log's filters ask for, beyond the branches: each that's given narrows it. */
export interface LogFilter {
  text?: TextFilter;
  /** The authors exactly, `Name <email>`: the User filter's, as the page resolves them. */
  authors?: readonly string[];
  /** Made after or before these times, in milliseconds: the Date filter's. */
  after?: number;
  before?: number;
  /** Files and folders, from the worktree: the Paths filter's. Only the commits that change them. */
  paths?: readonly string[];
}

/** An author exactly, as an extended regular expression: IntelliJ's UserNameRegex. */
const exactly = (author: string) =>
  `^${author.replaceAll('\\', '\\\\').replace(/[.^$*+\-?()[\]{}|]/g, '\\$&')}$`;

/**
 * Git's options for a filter's text, authors, dates and paths, as IntelliJ's GitLogProvider gives
 * them.
 */
function filterOptions(filter: LogFilter): string[] {
  const { text, authors } = filter;
  // Without text, as with Regex: the authors are matched as expressions, in any case.
  const regex = text?.regex ?? true;
  const seconds = (time: number) => `@${String(Math.floor(time / 1000))}`;
  return [
    ...(text ? [`--grep=${text.text}`] : []),
    regex ? '--extended-regexp' : '--fixed-strings',
    ...(text?.matchCase ? [] : ['--regexp-ignore-case']),
    ...(authors && regex ? [`--author=${authors.map(exactly).join('|')}`] : []),
    ...(authors && !regex ? authors.map((author) => `--author=${author}`) : []),
    ...(filter.after === undefined ? [] : [`--after=${seconds(filter.after)}`]),
    ...(filter.before === undefined ? [] : [`--before=${seconds(filter.before)}`]),
    ...(filter.paths ? ['--full-history', '--simplify-merges'] : []),
  ];
}

/** The pathspecs after `--`: the paths as they're named, not as patterns. */
const pathspecs = (filter: LogFilter) => (filter.paths ?? []).map((path) => `:(literal)${path}`);

/** The hashes a filter's text is, as IntelliJ reads it: 7 to 64 hex digits each; else none. */
export function hashesIn(text: string): string[] | undefined {
  const words = text.split(/[\s,;]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => /^[a-fA-F0-9]{7,64}$/.test(word))
    ? words
    : undefined;
}

const unique = (hashes: readonly string[]) => [...new Set(hashes)];

/**
 * The commits listed, each one's parents the nearest of its ancestors among them: the graph of a
 * filtered log joins what it shows, where git gives the parents it hides.
 */
export function rewriteParents(
  commits: readonly LogCommit[],
  parents: ReadonlyMap<string, readonly string[]>,
): LogCommit[] {
  const shown = new Set(commits.map((commit) => commit.hash));
  // For each commit not shown: the shown ones nearest below it.
  const nearest = new Map<string, string[]>();
  const below = (hash: string) => (shown.has(hash) ? [hash] : (nearest.get(hash) ?? []));
  // Parents come after their children: from the last, each one's parents are done before it.
  for (const [hash, its] of [...parents].reverse()) {
    if (!shown.has(hash)) nearest.set(hash, unique(its.flatMap(below)));
  }
  return commits.map((commit) => ({ ...commit, parents: unique(commit.parents.flatMap(below)) }));
}

/**
 * The commits a text filter matches, as IntelliJ's: hashes find their commits, and the commits
 * whose messages name them, in any branch; if none, their text is searched for as any other. Text
 * is searched for in the messages of the commits listed.
 */
async function filtered(
  worktree: string,
  branches: readonly string[] | undefined,
  filter: LogFilter,
  run: Git,
): Promise<LogCommit[]> {
  const words = filter.text && hashesIn(filter.text.text);
  if (words) {
    const all = await ancestry(worktree, ALL, run);
    const prefixes = words.map((word) => word.toLowerCase());
    const hashes = [...all.keys()].filter((hash) => prefixes.some((p) => hash.startsWith(p)));
    const named =
      hashes.length === 0
        ? []
        : parseLog(
            await readLog(worktree, [...DETAILS, '--no-walk', '--stdin'], run, hashes.join('\n')),
          );
    const naming = parseLog(
      await readLog(
        worktree,
        [
          ...DETAILS,
          ...words.map((word) => `--grep=${word}`),
          '--fixed-strings',
          '--regexp-ignore-case',
          ...ALL,
          '--',
        ],
        run,
      ),
    );
    const found = new Map([...named, ...naming].map((commit) => [commit.hash, commit]));
    if (found.size > 0) {
      const order = [...all.keys()];
      return rewriteParents(
        order.flatMap((hash) => found.get(hash) ?? []),
        all,
      );
    }
  }
  // No author is known by the names asked for: none of the commits are theirs.
  if (filter.authors?.length === 0) return [];
  const revs = revisions(branches);
  const commits = parseLog(
    await readLog(
      worktree,
      [...DETAILS, ...filterOptions(filter), ...revs, '--', ...pathspecs(filter)],
      run,
      undefined,
      // The authors as written in the commits, as IntelliJ asks for them: not as a mailmap has them.
      filter.authors ? ['-c', 'log.mailmap=false'] : [],
    ),
  );
  return rewriteParents(commits, await ancestry(worktree, revs, run));
}

/**
 * The commits of every branch, remote branch and tag, and HEAD, as IntelliJ's Log shows them
 * (Branch: All), newest first with each after its children (`--date-order`); `max` of them after
 * the first `skip`. None in a repository with no commits yet. Cerebro's own refs aren't among them.
 * Given `branches` (refs in full, or HEAD), only theirs: the Log's Branch filter. Given a `filter`,
 * those it matches: the whole history is read for each page, to join the graph (a claim that it's
 * quick enough).
 */
export async function log(
  worktree: string,
  skip: number,
  max: number,
  run: Git = git,
  branches?: readonly string[],
  filter?: LogFilter,
): Promise<LogCommit[]> {
  if (filter) return (await filtered(worktree, branches, filter, run)).slice(skip, skip + max);
  return parseLog(
    await readLog(
      worktree,
      [
        ...DETAILS,
        `--skip=${String(skip)}`,
        `--max-count=${String(max)}`,
        ...revisions(branches),
        '--',
      ],
      run,
    ),
  );
}

/** A commit's author, or the user git commits as. */
export interface Author {
  name: string;
  email: string;
}

/**
 * The authors of the commits of every branch, remote branch and tag, each once, as git has them;
 * and the user git commits as (`user.name`, `user.email`), if it's set: the User filter's "me".
 */
export async function listAuthors(
  worktree: string,
  run: Git = git,
): Promise<{ authors: Author[]; me: Author | undefined }> {
  const output = await readLog(worktree, ['--format=%an%x1f%ae', ...ALL, '--'], run, undefined, [
    '-c',
    'log.mailmap=false',
  ]);
  const authors = [...new Set(output.split('\n').filter(Boolean))].map((line) => {
    const [name, email] = line.split('\x1f') as [string, string];
    return { name, email };
  });
  return { authors, me: await whoAmI(worktree, run) };
}

/** The user git commits as (`user.name`, `user.email`), if it's set: the User filter's "me". */
async function whoAmI(worktree: string, run: Git): Promise<Author | undefined> {
  // Unset, git config fails.
  const config = (key: string) =>
    run(worktree, ['config', key]).then(
      (v) => v.trim(),
      () => '',
    );
  const me = { name: await config('user.name'), email: await config('user.email') };
  return me.name === '' && me.email === '' ? undefined : me;
}

/**
 * Show My Branches' (IntelliJ's `BranchesDashboardUtil.checkIsMyBranchesSynchronously`): each
 * local and remote branch's exclusive commits' authors, each once, and who "me" is. A branch's
 * exclusive commits are IntelliJ's (`exclusiveCommits`, `exclusiveNodes`), in the Log's graph (all
 * the refs, as the Log has them): its head's, and below it each commit whose children all are,
 * that's no other branch's head.
 */
export async function exclusiveAuthors(
  worktree: string,
  run: Git = git,
): Promise<{ branches: Record<string, Author[]>; me: Author | undefined }> {
  const [branches, output, me] = await Promise.all([
    listBranches(worktree, run),
    readLog(
      worktree,
      ['-z', '--date-order', '--format=%H%x1f%P%x1f%an%x1f%ae', ...ALL, '--'],
      run,
      undefined,
      ['-c', 'log.mailmap=false'],
    ),
    whoAmI(worktree, run),
  ]);
  // In the Log's order: a commit's children before it.
  const commits = output
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const [hash, parents, name, email] = record.split('\x1f') as [string, string, string, string];
      return { hash, parents: parents === '' ? [] : parents.split(' '), author: { name, email } };
    });
  const index = new Map(commits.map((commit, i) => [commit.hash, i]));
  const children = commits.map((): number[] => []);
  commits.forEach((commit, i) => {
    for (const parent of commit.parents)
      (children[index.get(parent) as number] as number[]).push(i);
  });
  const heads = new Set(branches.map((branch) => branch.hash));
  const exclusive = (start: number) => {
    const found = new Set<number>();
    const next = new Set([start]);
    for (let i = start; next.size > 0; i++) {
      if (!next.delete(i)) continue;
      const isHead = i !== start && heads.has((commits[i] as (typeof commits)[number]).hash);
      if (isHead || !(children[i] as number[]).every((child) => found.has(child))) continue;
      found.add(i);
      // Every parent is in the Log (a shallow clone's oldest commits show none: measured).
      for (const parent of (commits[i] as (typeof commits)[number]).parents) {
        next.add(index.get(parent) as number);
      }
    }
    return found;
  };
  const authorsOf = (start: number) => {
    const unique = new Map<string, Author>();
    for (const i of exclusive(start)) {
      const { author } = commits[i] as (typeof commits)[number];
      unique.set(`${author.name}\x1f${author.email}`, author);
    }
    return [...unique.values()];
  };
  return {
    branches: Object.fromEntries(
      // Every branch's head is in the Log.
      branches.map((branch) => [branch.ref, authorsOf(index.get(branch.hash) as number)]),
    ),
    me,
  };
}

/** A local or remote branch, for the Log's branches. */
export interface Branch {
  /** In full: `refs/heads/main`, `refs/remotes/origin/main`. */
  ref: string;
  /** The commit it's at. */
  hash: string;
  /** Checked out in this worktree. */
  current: boolean;
  /** The branch a local one tracks, in full (`refs/remotes/origin/main`), if any. */
  upstream?: string;
}

/** The repository's local and remote branches, but not a remote's HEAD, which names another. */
export async function listBranches(worktree: string, run: Git = git): Promise<Branch[]> {
  const output = await run(worktree, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(HEAD)%09%(symref)%09%(upstream)',
    'refs/heads',
    'refs/remotes',
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string, string, string, string])
    .filter(([, , , symref]) => symref === '')
    .map(([ref, hash, head, , upstream]) => ({
      ref,
      hash,
      current: head === '*',
      ...(upstream === '' ? {} : { upstream }),
    }));
}

/** How many of the reflog's checkouts are read for them (IntelliJ's registry default). */
const RECENT_CHECKOUTS = 50;

/**
 * What was checked out last, the latest first, each once, as IntelliJ's Recent branches
 * (GitRecentCheckoutBranches): what each of the reflog's last 50 checkouts moved to. That's a
 * branch's name, or `HEAD` or a commit's hash for a detached HEAD: the caller keeps its branches.
 */
export async function recentCheckouts(worktree: string, run: Git = git): Promise<string[]> {
  // None before the first commit, whose HEAD's reflog git can't read (measured, git 2.43: "your
  // current branch 'main' does not have any commits yet").
  try {
    await run(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  } catch {
    return [];
  }
  const output = await run(worktree, [
    'reflog',
    '--max-count',
    String(RECENT_CHECKOUTS),
    '--grep-reflog',
    'checkout:',
    '--format=%gs',
  ]);
  const names = output.split('\n').flatMap((line) => {
    // `checkout: moving from main to feature`, as `git checkout` and `git switch` write it.
    const to = line.lastIndexOf(' to ');
    return to > 0 ? [line.slice(to + ' to '.length)] : [];
  });
  return [...new Set(names)];
}

/** The checked-out branch, the remotes, and the branch's upstream: where a pull comes from. */
export interface Tracking {
  /** Undefined when HEAD is detached. */
  branch: string | undefined;
  remotes: string[];
  upstream: { remote: string; branch: string } | undefined;
}

export async function tracking(
  worktree: string,
  run: Git = git,
  /** A local branch's, if not the one checked out. */
  source?: string,
): Promise<Tracking> {
  const remotes = (await run(worktree, ['remote'])).split('\n').filter(Boolean);
  let branch: string;
  try {
    branch = source ?? (await run(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return { branch: undefined, remotes, upstream: undefined };
  }
  const [remote = '', ref = ''] = (
    await run(worktree, [
      'for-each-ref',
      '--format=%(upstream:remotename)%09%(upstream:remoteref)',
      `refs/heads/${branch}`,
    ])
  )
    .trim()
    .split('\t');
  return {
    branch,
    remotes,
    upstream: remote === '' ? undefined : { remote, branch: ref.replace(/^refs\/heads\//, '') },
  };
}

/** What a push sends: a local branch, or the one checked out. */
const pushedHead = (source: string | undefined) =>
  source === undefined ? 'HEAD' : `refs/heads/${source}`;

/** Where a push goes: a remote, and a branch there. */
export interface PushTarget {
  remote: string;
  target: string;
}

/**
 * What a push of the checked-out branch sends, as IntelliJ's Push dialog shows it: where to (the
 * target asked for, else its upstream, else the branch of the same name on `origin`, or on the only
 * remote), and the commits that aren't there yet, newest first.
 */
export interface Outgoing {
  /** The branch checked out (`main`); undefined when HEAD is detached. */
  branch: string | undefined;
  /** The remote it goes to; undefined when there's none. */
  remote: string | undefined;
  /** The branch there (`main`). */
  target: string | undefined;
  /** Whether the target doesn't exist yet: the push makes it. */
  isNew: boolean;
  commits: LogCommit[];
  /** The repository's remotes, by name. */
  remotes: string[];
  /** The branch's upstream, if it has one. */
  upstream: PushTarget | undefined;
}

export async function outgoing(
  worktree: string,
  run: Git = git,
  to?: PushTarget,
  upTo?: string,
  /** The local branch pushed, as the branches popup's Push gives it; the one checked out if not. */
  source?: string,
): Promise<Outgoing> {
  const { branch, remotes, upstream: tracked } = await tracking(worktree, run, source);
  const head = pushedHead(source);
  // The Log's Push All up to Here…: a commit of the branch's, the ones after it not sent.
  if (upTo !== undefined && branch !== undefined) {
    await run(worktree, ['merge-base', '--is-ancestor', upTo, head]).catch(() => {
      throw new Error('The commit is not in the current branch');
    });
  }
  const nothing = { remote: undefined, target: undefined, isNew: false, commits: [], remotes };
  if (branch === undefined) return { branch, ...nothing, upstream: undefined };
  const upstream = tracked && { remote: tracked.remote, target: tracked.branch };
  // IntelliJ's `getDefaultOrFirstRemote`: origin, else the first.
  const fallback = remotes.includes('origin') ? 'origin' : remotes[0];
  const { remote, target } = to ?? upstream ?? { remote: fallback, target: branch };
  if (remote === undefined) return { branch, ...nothing, upstream };
  if (!remotes.includes(remote)) throw new Error(`There’s no remote named ${remote}`);
  const there = `refs/remotes/${remote}/${target}`;
  const isNew = !(await listBranches(worktree, run)).some((b) => b.ref === there);
  // A new branch sends what no branch of the remote has.
  const base = isNew ? [`--remotes=${remote}`] : [there];
  const commits = parseLog(
    await readLog(worktree, [...DETAILS, upTo ?? head, '--not', ...base, '--'], run),
  );
  return { branch, remote, target, isNew, commits, remotes, upstream };
}

/**
 * Whether a remote's URL answers, as IntelliJ's Define Remote checks before adding it: `git
 * ls-remote`, which fails with git's words. Never in a terminal (see `push`).
 */
export async function checkRemote(worktree: string, url: string, run: Git = git): Promise<void> {
  await run(worktree, ['ls-remote', '--heads', '--end-of-options', url], {
    GIT_TERMINAL_PROMPT: '0',
  });
}

/** Adds a remote, and fetches it when asked (IntelliJ's Define Remote's Fetch remote). */
export async function addRemote(
  worktree: string,
  remote: { name: string; url: string; fetch: boolean },
  run: Git = git,
): Promise<void> {
  await run(worktree, ['remote', 'add', '--end-of-options', remote.name, remote.url]);
  if (remote.fetch) {
    await run(worktree, ['fetch', '--quiet', '--end-of-options', remote.name], {
      GIT_TERMINAL_PROMPT: '0',
    });
  }
}

/** A remote, by its name and its first URL, as IntelliJ's Git Remotes dialog lists it. */
export interface Remote {
  name: string;
  url: string;
}

/** The remotes, origin first and then by name, as IntelliJ's `sortedRemotes`. */
export async function listRemotes(worktree: string, run: Git = git): Promise<Remote[]> {
  const names = (await run(worktree, ['remote'])).split('\n').filter(Boolean);
  const remotes = await Promise.all(
    names.map(async (name) => ({
      name,
      // Its first URL, as IntelliJ's: `get-url` gives it, rewritten by `insteadOf` as git uses it.
      url: (await run(worktree, ['remote', 'get-url', '--end-of-options', name])).trim(),
    })),
  );
  // Names are unique: never equal.
  const rank = (r: Remote) => (r.name === 'origin' ? '' : `.${r.name}`);
  return remotes.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
}

/** Removes a remote, and its remote-tracking branches with it (git's). */
export async function removeRemote(worktree: string, name: string, run: Git = git): Promise<void> {
  await run(worktree, ['remote', 'remove', '--end-of-options', name]);
}

/**
 * Changes a remote, as IntelliJ's `changeRemote`: renamed if its name changed, then its URL set if
 * that changed; fetched after when asked (Define Remote's Fetch remote).
 */
export async function changeRemote(
  worktree: string,
  from: Remote,
  to: Remote & { fetch: boolean },
  run: Git = git,
): Promise<void> {
  if (to.name !== from.name) {
    await run(worktree, ['remote', 'rename', '--end-of-options', from.name, to.name]);
  }
  if (to.url !== from.url) {
    await run(worktree, ['remote', 'set-url', '--end-of-options', to.name, to.url]);
  }
  if (to.fetch) {
    await run(worktree, ['fetch', '--quiet', '--end-of-options', to.name], {
      GIT_TERMINAL_PROMPT: '0',
    });
  }
}

/**
 * Why a push will be rejected, as IntelliJ's `PushDivergence`: the remote's branch has commits the
 * branch hasn't (`diverged`, counted), or has commits not fetched yet, which only a fetch can count
 * (`fetchRequired`). `lease` is where a force push expects the remote's branch to be.
 */
export type PushDivergence =
  | { kind: 'diverged'; remoteCommits: number; lease: string }
  | { kind: 'fetchRequired'; lease: string };

/**
 * Whether the push of the checked-out branch to `to` has diverged from the remote, as IntelliJ's
 * `GitPushDivergenceDetector`: not for a branch the push makes. With `checkRemote`, the remote is
 * asked where its branch is (`git ls-remote`, never in a terminal); without it, or when
 * it can't be asked, where it was last fetched is taken. Undefined when nothing stands in the way,
 * or when the branch is behind it (a push sends nothing then).
 */
export async function divergence(
  worktree: string,
  to: PushTarget,
  checkRemote: boolean,
  run: Git = git,
): Promise<PushDivergence | undefined> {
  const tracked = await hashOf(worktree, `refs/remotes/${to.remote}/${to.target}`, run);
  if (tracked === undefined) return undefined;
  let remote = tracked;
  if (checkRemote) {
    try {
      const line = await run(
        worktree,
        ['ls-remote', '--end-of-options', to.remote, `refs/heads/${to.target}`],
        { GIT_TERMINAL_PROMPT: '0' },
      );
      const asked = line.split('\t')[0]?.trim();
      // Gone from the remote: the push makes it again.
      if (!asked) return undefined;
      remote = asked;
    } catch {
      // Not asked: where it was last fetched.
    }
  }
  if (remote !== tracked && (await hashOf(worktree, `${remote}^{commit}`, run)) === undefined) {
    // Only a fetch can count them; a force push expects where it was fetched, and is rejected.
    return { kind: 'fetchRequired', lease: tracked };
  }
  const counts = await run(worktree, ['rev-list', '--left-right', '--count', `HEAD...${remote}`]);
  const [outgoing = 0, remoteOnly = 0] = counts.trim().split('\t').map(Number);
  if (outgoing === 0 || remoteOnly === 0) return undefined;
  return { kind: 'diverged', remoteCommits: remoteOnly, lease: remote };
}

/** The commit a ref or revision names, or undefined when there's none. */
async function hashOf(worktree: string, rev: string, run: Git): Promise<string | undefined> {
  try {
    return (
      await run(worktree, ['rev-parse', '--verify', '--quiet', '--end-of-options', rev])
    ).trim();
  } catch {
    return undefined;
  }
}

/**
 * Fetches the push's target branch, as IntelliJ's Fetch in the Push dialog
 * (`GitPushDivergenceDetector.fetchTarget`), so its commits can be counted. Fails with git's words.
 */
export async function fetchTarget(worktree: string, to: PushTarget, run: Git = git): Promise<void> {
  await run(
    worktree,
    [
      'fetch',
      '--quiet',
      '--end-of-options',
      to.remote,
      `+refs/heads/${to.target}:refs/remotes/${to.remote}/${to.target}`,
    ],
    { GIT_TERMINAL_PROMPT: '0' },
  );
}

/**
 * How a push went: the commits sent, where to, whether it made the branch there or replaced what
 * was there (a force push's), and its tags.
 */
export interface Pushed {
  commits: number;
  remote: string;
  target: string;
  isNew: boolean;
  /** Whether it replaced the remote's commits: a force push that wasn't a fast-forward. */
  forced: boolean;
  /** The tags it made there. */
  tags: string[];
}

/**
 * Which tags a push sends, as IntelliJ's `GitPushTagMode`: all of them (`--tags`), or the
 * annotated ones on the branch pushed (`--follow-tags`, its Current Branch).
 */
export type PushTags = 'all' | 'follow';

/**
 * Pushes the checked-out branch where `outgoing` says (to `to`, if given). It becomes the branch's
 * upstream as IntelliJ's (`GitPushTarget.shouldSetUpstream`): when the push makes the target and the
 * branch has no upstream yet ("New & Upstream"), or when asked (its Set upstream). Tags go too when
 * asked, even with nothing else to send; the ones it made there are named. Git never asks for a
 * password in a terminal, which nobody would see: the host's `run` asks the page (askpass.ts), and
 * without it git fails instead, unless a credential helper answers. Fails with git's words, which
 * say when the push was rejected (`[rejected]`).
 */
export async function push(
  worktree: string,
  run: Git = git,
  to?: PushTarget & { setUpstream?: boolean; tags?: PushTags; force?: { lease?: string } },
  upTo?: string,
  source?: string,
): Promise<Pushed> {
  const out = await outgoing(
    worktree,
    run,
    to && { remote: to.remote, target: to.target },
    upTo,
    source,
  );
  if (out.branch === undefined) throw new Error('No branch is checked out');
  if (out.remote === undefined) throw new Error('The repository has no remote');
  const target = out.target as string;
  const setUpstream = (out.isNew && out.upstream === undefined) || to?.setUpstream === true;
  const tags = to?.tags;
  const force = to?.force;
  let lines: string[] = [];
  if (out.commits.length > 0 || out.isNew || setUpstream || tags !== undefined || force) {
    // A force push expects the remote's branch where it was seen, else where it was fetched, else
    // that there's none (IntelliJ's `git.use.push.force.with.lease`, on by default).
    const lease =
      force &&
      (force.lease ?? (await hashOf(worktree, `refs/remotes/${out.remote}/${target}`, run)) ?? '');
    // A line per ref, on its output: the tags it made there ("*" and "[new tag]").
    lines = await porcelainPush(worktree, run, [
      ...(setUpstream && upTo === undefined ? ['--set-upstream'] : []),
      ...(tags === undefined ? [] : [tags === 'all' ? '--tags' : '--follow-tags']),
      ...(lease === undefined ? [] : [`--force-with-lease=refs/heads/${target}:${lease}`]),
      '--end-of-options',
      out.remote,
      `${upTo ?? pushedHead(source)}:refs/heads/${target}`,
    ]);
    // A commit pushed, not a branch: git sets no upstream for it (measured, git 2.43), so it's
    // set after, the push having made the remote's branch here.
    if (setUpstream && upTo !== undefined) {
      await run(worktree, [
        'branch',
        `--set-upstream-to=${out.remote}/${target}`,
        '--end-of-options',
        out.branch,
      ]);
    }
  }
  const made = lines.flatMap((line) => /^\*\trefs\/tags\/([^:]+):/.exec(line)?.[1] ?? []);
  // "+", a forced update.
  const forced = lines.some((line) => line.startsWith('+\t'));
  return {
    commits: out.commits.length,
    remote: out.remote,
    target,
    isNew: out.isNew,
    forced,
    tags: made,
  };
}

/** The refs `git push --porcelain` couldn't push, as it says them. */
const refusedRefs = (output: string) => output.split('\n').filter((line) => line.startsWith('!\t'));

/**
 * `git push --porcelain` with `args`, without asking in a terminal: its lines, a line per ref. When
 * it fails, the refs it couldn't push ("!", with "[rejected]"), which are on its output, not in its
 * message, are put first in the error's.
 */
export async function porcelainPush(
  worktree: string,
  run: Git,
  args: readonly string[],
): Promise<string[]> {
  try {
    return (
      await run(worktree, ['push', '--porcelain', ...args], { GIT_TERMINAL_PROMPT: '0' })
    ).split('\n');
  } catch (error) {
    const refused = error instanceof GitError ? refusedRefs(error.output) : [];
    if (refused.length === 0) throw error;
    throw new Error([...refused, (error as GitError).message].join('\n'), { cause: error });
  }
}
