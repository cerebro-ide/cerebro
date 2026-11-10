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
  new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      [...args],
      { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...NO_OPTIONAL_LOCKS, ...env } },
      (error, stdout, stderr) => {
        if (error) reject(new GitError(stderr.trim() || error.message, stdout));
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

/** The changes from one commit to another, renames found. */
export async function listChangesBetween(
  worktree: string,
  from: string,
  to: string,
  run: Git = git,
): Promise<Change[]> {
  return parseNameStatus(await run(worktree, ['diff', '--name-status', '-z', '-M', from, to]));
}

/** Git's empty tree: what changes made before any commit are compared with. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

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
  // Unset, git config fails.
  const config = (key: string) =>
    run(worktree, ['config', key]).then(
      (v) => v.trim(),
      () => '',
    );
  const me = { name: await config('user.name'), email: await config('user.email') };
  return { authors, me: me.name === '' && me.email === '' ? undefined : me };
}

/** A local or remote branch, for the Log's branches. */
export interface Branch {
  /** In full: `refs/heads/main`, `refs/remotes/origin/main`. */
  ref: string;
  /** The commit it's at. */
  hash: string;
  /** Checked out in this worktree. */
  current: boolean;
}

/** The repository's local and remote branches, but not a remote's HEAD, which names another. */
export async function listBranches(worktree: string, run: Git = git): Promise<Branch[]> {
  const output = await run(worktree, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(HEAD)%09%(symref)',
    'refs/heads',
    'refs/remotes',
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t') as [string, string, string, string])
    .filter(([, , , symref]) => symref === '')
    .map(([ref, hash, head]) => ({ ref, hash, current: head === '*' }));
}

/** The checked-out branch, the remotes, and the branch's upstream: where a pull comes from. */
export interface Tracking {
  /** Undefined when HEAD is detached. */
  branch: string | undefined;
  remotes: string[];
  upstream: { remote: string; branch: string } | undefined;
}

export async function tracking(worktree: string, run: Git = git): Promise<Tracking> {
  const remotes = (await run(worktree, ['remote'])).split('\n').filter(Boolean);
  let branch: string;
  try {
    branch = (await run(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
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
): Promise<Outgoing> {
  const { branch, remotes, upstream: tracked } = await tracking(worktree, run);
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
    await readLog(worktree, [...DETAILS, 'HEAD', '--not', ...base, '--'], run),
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
): Promise<Pushed> {
  const out = await outgoing(worktree, run, to && { remote: to.remote, target: to.target });
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
    try {
      lines = (
        await run(
          worktree,
          [
            // A line per ref, on its output: the tags it made there ("*" and "[new tag]").
            'push',
            '--porcelain',
            ...(setUpstream ? ['--set-upstream'] : []),
            ...(tags === undefined ? [] : [tags === 'all' ? '--tags' : '--follow-tags']),
            ...(lease === undefined ? [] : [`--force-with-lease=refs/heads/${target}:${lease}`]),
            '--end-of-options',
            out.remote,
            `HEAD:refs/heads/${target}`,
          ],
          { GIT_TERMINAL_PROMPT: '0' },
        )
      ).split('\n');
    } catch (error) {
      // The refs it couldn't push ("!", with "[rejected]") are on its output, not in its message.
      const refused = error instanceof GitError ? refusedRefs(error.output) : [];
      if (refused.length === 0) throw error;
      throw new Error([...refused, (error as GitError).message].join('\n'), { cause: error });
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
