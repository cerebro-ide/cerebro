import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  addWorktree,
  commit,
  bytesAt,
  git,
  type Git,
  listChanges,
  listMergedChanges,
  listFiles,
  ignoredAmong,
  listIgnored,
  listWorktrees,
  lastMessage,
  listBranches,
  recentCheckouts,
  hashesIn,
  exclusiveAuthors,
  listAuthors,
  log,
  type LogCommit,
  type LogFilter,
  parseLog,
  rewriteParents,
  parseNameStatus,
  parseStatus,
  parseWorktrees,
  removeWorktree,
  rollback,
  trackedFiles,
} from '../src/index.js';

/** A file's text in the last commit; empty if it isn't in it. */
async function committedText(worktree: string, path: string): Promise<string> {
  const bytes = await bytesAt(worktree, 'HEAD', path);
  return bytes === undefined ? '' : new TextDecoder().decode(bytes);
}

describe('parseLog', () => {
  it('reads a commit per record: its parents, refs, subject (which may hold commas) and body', () => {
    const record = (...fields: string[]) => `${fields.join('\x1f')}\0`;
    expect(
      parseLog(
        record(
          'b',
          'a c',
          'Ann',
          'a@x',
          '10',
          'HEAD -> refs/heads/main, tag: refs/tags/v1',
          'x, y',
          'Why.\n\nMore\x1fstill.\n',
        ) + record('a', '', 'Bo', 'b@x', '5', '', 'first', ''),
      ),
    ).toEqual([
      {
        hash: 'b',
        parents: ['a', 'c'],
        author: 'Ann',
        email: 'a@x',
        time: 10_000,
        subject: 'x, y',
        body: 'Why.\n\nMore\x1fstill.',
        refs: ['HEAD -> refs/heads/main', 'tag: refs/tags/v1'],
      },
      {
        hash: 'a',
        parents: [],
        author: 'Bo',
        email: 'b@x',
        time: 5000,
        subject: 'first',
        body: '',
        refs: [],
      },
    ]);
  });
});

describe('parseWorktrees', () => {
  it('reads each worktree: path, commit, branch, and which is the main one', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/feat/x',
      'locked',
      '',
      'worktree /repo-detached',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktrees(porcelain)).toEqual([
      { path: '/repo', head: '1'.repeat(40), branch: 'main', main: true, bare: false },
      { path: '/repo-feature', head: '2'.repeat(40), branch: 'feat/x', main: false, bare: false },
      { path: '/repo-detached', head: '3'.repeat(40), branch: undefined, main: false, bare: false },
    ]);
  });

  it('reads a bare repository, Windows line endings, and nothing', () => {
    expect(parseWorktrees('worktree C:/repo.git\r\nbare\r\n\r\n')).toEqual([
      { path: 'C:/repo.git', head: undefined, branch: undefined, main: true, bare: true },
    ]);
    expect(parseWorktrees('')).toEqual([]);
    expect(parseWorktrees('garbage\n\n')).toEqual([]);
  });
});

describe('parseStatus', () => {
  it('reads each change, staged or not, sorted by path', () => {
    const output = [
      ' M b.ts',
      'M  a.ts',
      'MM c.ts',
      'A  new.ts',
      'AM newer.ts',
      ' D gone.ts',
      'D  removed.ts',
      'R  moved.ts',
      'old.ts',
      'C  copy.ts',
      'a.ts',
      '?? untracked dir/x.ts',
      '',
    ].join('\0');
    expect(parseStatus(output)).toEqual([
      { path: 'a.ts', status: 'modified' },
      { path: 'b.ts', status: 'modified' },
      { path: 'c.ts', status: 'modified' },
      { path: 'copy.ts', status: 'added' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'moved.ts', status: 'renamed', from: 'old.ts' },
      { path: 'new.ts', status: 'added' },
      { path: 'newer.ts', status: 'added' },
      { path: 'removed.ts', status: 'deleted' },
      { path: 'untracked dir/x.ts', status: 'untracked' },
    ]);
    expect(parseStatus('')).toEqual([]);
  });

  it('reads files in conflict, each way git lists them', () => {
    const codes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];
    const output = codes.map((code) => `${code} ${code}.ts`).join('\0');
    expect(parseStatus(output).map((c) => c.status)).toEqual(codes.map(() => 'conflict'));
  });
});

describe('parseNameStatus', () => {
  it('reads each change between two commits, sorted by path', () => {
    const output = [
      'M',
      'b.ts',
      'A',
      'new.ts',
      'D',
      'gone.ts',
      'R087',
      'old.ts',
      'moved.ts',
      'C100',
      'a.ts',
      'copy.ts',
      'T',
      'link',
      '',
    ].join('\0');
    expect(parseNameStatus(output)).toEqual([
      { path: 'b.ts', status: 'modified' },
      { path: 'copy.ts', status: 'added' },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'link', status: 'modified' },
      { path: 'moved.ts', status: 'renamed', from: 'old.ts' },
      { path: 'new.ts', status: 'added' },
    ]);
    expect(parseNameStatus('')).toEqual([]);
  });
});

const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};

describe('a merge’s changes, of what git lists against each parent', () => {
  /** Git listing, against each parent in turn, what's given for it. */
  const listing =
    (...each: string[]): Git =>
    (_cwd, args) =>
      Promise.resolve(each[['p1', 'p2'].indexOf(args.at(-2) as string)] as string);

  it('keeps a change as it is against the first parent where all agree', async () => {
    const run = listing('R100\0old\0new\0A\0added\0', 'R100\0old\0new\0A\0added\0');
    expect(await listMergedChanges('/r', ['p1', 'p2'], 'm', run)).toEqual([
      { path: 'added', status: 'added' },
      { path: 'new', status: 'renamed', from: 'old' },
    ]);
  });

  it('makes a delete of a delete against any, and a change of other kinds or renames', async () => {
    const run = listing(
      'D\0gone\0M\0mixed\0R100\0old\0new\0',
      'M\0gone\0A\0mixed\0R100\0older\0new\0',
    );
    expect(await listMergedChanges('/r', ['p1', 'p2'], 'm', run)).toEqual([
      { path: 'gone', status: 'deleted' },
      { path: 'mixed', status: 'modified' },
      { path: 'new', status: 'modified' },
    ]);
  });
});

describe('with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-')));
  const repo = join(root, 'repo');
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  /** Git, as someone to commit as: a test machine may have no one set. */
  const as: Git = (cwd, args, env, input) => git(cwd, args, { ...env, ...IDENTITY }, input);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a');
  run(repo, 'add', '.');
  run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  run(repo, 'worktree', 'add', '-q', '-b', 'feature', join(root, 'feature'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists a merge’s changes as IntelliJ: only the files changed against every parent', async () => {
    const merging = join(root, 'merging');
    execFileSync('git', ['init', '-q', '-b', 'main', merging]);
    const write = (file: string, text: string) => {
      writeFileSync(join(merging, file), text);
    };
    const commitAll = (message: string) => {
      run(merging, 'add', '-A');
      run(merging, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
      return run(merging, 'rev-parse', 'HEAD').trim();
    };
    for (const file of ['both.txt', 'ours.txt', 'theirs.txt']) write(file, `${file}\n`);
    commitAll('base');
    run(merging, 'checkout', '-q', '-b', 'side');
    write('both.txt', 'side\n');
    write('theirs.txt', 'side\n');
    const side = commitAll('side');
    run(merging, 'checkout', '-q', 'main');
    write('both.txt', 'main\n');
    write('ours.txt', 'main\n');
    const main = commitAll('main');
    // The conflict in both.txt resolved as neither had it.
    run(merging, 'merge', '-q', side, '-m', 'merge', '-X', 'ours');
    write('both.txt', 'resolved\n');
    run(merging, 'add', 'both.txt');
    run(
      merging,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--amend',
      '--no-edit',
    );
    const merge = run(merging, 'rev-parse', 'HEAD').trim();
    expect(await listMergedChanges(merging, [main, side], merge)).toEqual([
      { path: 'both.txt', status: 'modified' },
    ]);
    expect(await listMergedChanges(merging, [main], merge)).toEqual([
      { path: 'both.txt', status: 'modified' },
      { path: 'theirs.txt', status: 'modified' },
    ]);
  });

  it('lists the log: every branch, remote and tag, and HEAD, newest first, a page at a time', async () => {
    const history = join(root, 'history');
    execFileSync('git', ['init', '-q', '-b', 'main', history]);
    const at = (n: number) => ({
      ...IDENTITY,
      GIT_AUTHOR_DATE: `${String(1_700_000_000 + n)} +0000`,
    });
    const gitAt = (n: number, ...args: string[]) =>
      execFileSync('git', args, {
        cwd: history,
        env: { ...process.env, ...at(n), GIT_COMMITTER_DATE: `${String(1_700_000_000 + n)} +0000` },
      });
    const commitAt = (n: number, message: string) =>
      gitAt(n, 'commit', '-q', '--allow-empty', '-m', message);
    expect(await log(history, 0, 10)).toEqual([]);
    commitAt(1, 'first');
    run(history, 'checkout', '-q', '-b', 'side');
    commitAt(2, 'on side\n\nWhy it was made.\n\nAnd more.');
    run(history, 'checkout', '-q', 'main');
    commitAt(3, 'on main');
    gitAt(4, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    run(history, 'tag', 'v1', 'side');
    // Cerebro's own refs aren't listed.
    commitAt(5, 'kept');
    run(history, 'update-ref', 'refs/worktree/cerebro/kept', 'HEAD');
    run(history, 'reset', '-q', '--hard', 'HEAD~1');
    const commits = await log(history, 0, 10);
    expect(commits.map((c) => c.subject)).toEqual([
      "Merge branch 'side'",
      'on main',
      'on side',
      'first',
    ]);
    const [merge, , side, first] = commits as [
      (typeof commits)[0],
      unknown,
      (typeof commits)[0],
      (typeof commits)[0],
    ];
    expect(merge.parents).toHaveLength(2);
    expect(merge.refs).toEqual(['HEAD -> refs/heads/main']);
    expect(side.refs).toEqual(['tag: refs/tags/v1', 'refs/heads/side']);
    expect(side.body).toBe('Why it was made.\n\nAnd more.');
    expect(first).toMatchObject({
      parents: [],
      author: 't',
      email: 't@t',
      time: 1_700_000_001_000,
      body: '',
      refs: [],
    });
    expect((await log(history, 1, 2)).map((c) => c.subject)).toEqual(['on main', 'on side']);
    // A branch's alone, as the Branch filter asks; a branch named as an option is a name.
    expect((await log(history, 0, 10, git, ['refs/heads/side'])).map((c) => c.subject)).toEqual([
      'on side',
      'first',
    ]);
    await expect(log(history, 0, 10, git, ['--all'])).rejects.toThrow(/--all/);
    await expect(log(join(root, 'none'), 0, 1)).rejects.toThrow();
    // The branches: local and remote, the one checked out marked; not a remote's HEAD.
    run(history, 'update-ref', 'refs/remotes/origin/main', 'main');
    run(history, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const hash = (ref: string) => run(history, 'rev-parse', ref).trim();
    // And the branch a local one tracks.
    run(history, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    run(history, 'config', 'branch.main.remote', 'origin');
    run(history, 'config', 'branch.main.merge', 'refs/heads/main');
    expect(await listBranches(history)).toEqual([
      {
        ref: 'refs/heads/main',
        hash: hash('main'),
        current: true,
        upstream: 'refs/remotes/origin/main',
      },
      { ref: 'refs/heads/side', hash: hash('side'), current: false },
      { ref: 'refs/remotes/origin/main', hash: hash('main'), current: false },
    ]);
  });

  it('lists what was checked out last, the latest first, each once, as IntelliJ’s Recent', async () => {
    const recent = join(root, 'recent');
    execFileSync('git', ['init', '-q', '-b', 'main', recent]);
    // None before the first commit, which git has no reflog to read of (measured, git 2.43).
    expect(await recentCheckouts(recent)).toEqual([]);
    run(
      recent,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'One',
    );
    expect(await recentCheckouts(recent)).toEqual([]);
    run(recent, 'checkout', '-q', '-b', 'feat/a');
    run(recent, 'checkout', '-q', 'main');
    run(recent, 'checkout', '-q', '--detach', 'HEAD');
    run(recent, 'checkout', '-q', 'feat/a');
    run(recent, 'switch', '-q', 'main');
    // A detached HEAD's, too: the caller keeps the branches.
    expect(await recentCheckouts(recent)).toEqual(['main', 'feat/a', 'HEAD']);
    // A line that isn't a move is passed over, as IntelliJ's.
    expect(await recentCheckouts('/w', () => Promise.resolve('checkout: elsewhere\n'))).toEqual([]);
  });

  it('lays the log out by date, topologically or by first parents, with or without merges, as IntelliJ’s Graph Options', async () => {
    const graphs = join(root, 'graphs');
    execFileSync('git', ['init', '-q', '-b', 'main', graphs]);
    const commitAt = (n: number, message: string, args: string[]) =>
      execFileSync('git', [...args, '-q', '-m', message], {
        cwd: graphs,
        env: {
          ...process.env,
          ...IDENTITY,
          GIT_AUTHOR_DATE: `${String(1_700_000_000 + n)} +0000`,
          GIT_COMMITTER_DATE: `${String(1_700_000_000 + n)} +0000`,
        },
      });
    // A, then B on side and C on main, merged as M.
    commitAt(1, 'A', ['commit', '--allow-empty']);
    run(graphs, 'checkout', '-q', '-b', 'side');
    commitAt(2, 'B', ['commit', '--allow-empty']);
    run(graphs, 'checkout', '-q', 'main');
    commitAt(3, 'C', ['commit', '--allow-empty']);
    commitAt(4, 'M', ['merge', '--no-ff', 'side']);
    const hash = (ref: string) => run(graphs, 'rev-parse', ref).trim();
    const [a, b, c] = [hash('main~2'), hash('side'), hash('main~1')];
    const shown = (commits: LogCommit[]) =>
      commits.map((commit) => [commit.subject, commit.parents.length, commit.joins]);
    expect(shown(await log(graphs, 0, 10, git))).toEqual([
      ['M', 2, undefined],
      ['C', 1, undefined],
      ['B', 1, undefined],
      ['A', 0, undefined],
    ]);
    // A branch's commits together, below the merge that brings them in.
    expect(
      (await log(graphs, 0, 10, git, undefined, undefined, 'topological')).map((c) => c.subject),
    ).toEqual(['M', 'B', 'C', 'A']);
    // Each joined to its first parent alone; side's head still listed, as a ref's.
    expect(shown(await log(graphs, 0, 10, git, undefined, undefined, 'firstParent'))).toEqual([
      ['M', 2, [c]],
      ['C', 1, [a]],
      ['B', 1, [a]],
      ['A', 0, []],
    ]);
    // Filtered too: joined down first parents.
    const some = { text: { text: 'M|B|A', regex: true, matchCase: true } };
    expect(shown(await log(graphs, 0, 10, git, undefined, some, 'firstParent'))).toEqual([
      ['M', 2, [a]],
      ['B', 1, [a]],
      ['A', 0, []],
    ]);
    expect(shown(await log(graphs, 0, 10, git, undefined, some))).toEqual([
      ['M', 2, [a, b]],
      ['B', 1, [a]],
      ['A', 0, []],
    ]);
    // No merges: those below one joined across it.
    expect(shown(await log(graphs, 0, 10, git, undefined, { noMerges: true }))).toEqual([
      ['C', 1, [a]],
      ['B', 1, [a]],
      ['A', 0, []],
    ]);
  });

  it('filters the log by text, as IntelliJ’s, its graph joined across what it hides', async () => {
    const texts = join(root, 'texts');
    execFileSync('git', ['init', '-q', '-b', 'main', texts]);
    const commitAt = (n: number, message: string) =>
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', message], {
        cwd: texts,
        env: {
          ...process.env,
          ...IDENTITY,
          GIT_AUTHOR_DATE: `${String(1_700_000_000 + n)} +0000`,
          GIT_COMMITTER_DATE: `${String(1_700_000_000 + n)} +0000`,
        },
      });
    const subjects = (commits: { subject: string }[]) => commits.map((c) => c.subject);
    const text = (t: string, options: { regex?: boolean; matchCase?: boolean } = {}) => ({
      text: { text: t, regex: options.regex ?? false, matchCase: options.matchCase ?? false },
    });
    expect(await log(texts, 0, 10, git, undefined, text('Fix'))).toEqual([]);
    commitAt(1, 'Fix the start');
    commitAt(2, 'between');
    const between = run(texts, 'rev-parse', 'HEAD').trim();
    commitAt(3, 'fix (the end)');
    run(texts, 'checkout', '-q', '-b', 'side', 'HEAD~2');
    commitAt(4, `fix aside, after ${between.slice(0, 7)}`);
    run(texts, 'checkout', '-q', 'main');
    const hash = (ref: string) => run(texts, 'rev-parse', ref).trim();
    // Any case, as typed; those shown are joined to the nearest of them, their parents their own.
    const fixes = await log(texts, 0, 10, git, undefined, text('fix'));
    expect(subjects(fixes)).toEqual([
      'fix aside, after ' + between.slice(0, 7),
      'fix (the end)',
      'Fix the start',
    ]);
    expect(fixes.map((c) => c.joins)).toEqual([[hash('main~2')], [hash('main~2')], []]);
    expect(fixes.map((c) => c.parents)).toEqual([[hash('main~2')], [between], []]);
    expect(subjects(await log(texts, 1, 1, git, undefined, text('fix')))).toEqual([
      'fix (the end)',
    ]);
    expect(
      subjects(await log(texts, 0, 10, git, undefined, text('fix', { matchCase: true }))),
    ).toEqual(['fix aside, after ' + between.slice(0, 7), 'fix (the end)']);
    // A regular expression, or the text as it is.
    expect(
      subjects(await log(texts, 0, 10, git, undefined, text('^fix \\(', { regex: true }))),
    ).toEqual(['fix (the end)']);
    expect(subjects(await log(texts, 0, 10, git, undefined, text('(the')))).toEqual([
      'fix (the end)',
    ]);
    await expect(
      log(texts, 0, 10, git, undefined, text('(the', { regex: true })),
    ).rejects.toThrow();
    // Of the branches chosen.
    expect(subjects(await log(texts, 0, 10, git, ['refs/heads/main'], text('fix')))).toEqual([
      'fix (the end)',
      'Fix the start',
    ]);
    // Hashes find their commits, and those naming them, in any branch; any case, a prefix will do.
    expect(
      subjects(
        await log(texts, 0, 10, git, ['refs/heads/main'], text(between.slice(0, 7).toUpperCase())),
      ),
    ).toEqual(['fix aside, after ' + between.slice(0, 7), 'between']);
    expect(
      subjects(await log(texts, 0, 10, git, undefined, text(`${hash('main~2')}, ${hash('main')}`))),
    ).toEqual(['fix (the end)', 'Fix the start']);
    // Hex that's no commit's: the messages naming it, else what the text finds.
    commitAt(5, 'add cafe1234');
    expect(subjects(await log(texts, 0, 10, git, undefined, text('cafe1234')))).toEqual([
      'add cafe1234',
    ]);
    expect(await log(texts, 0, 10, git, undefined, text('beefbeef'))).toEqual([]);
  });

  it('filters the log by authors exactly, as written, and by date', async () => {
    const people = join(root, 'people');
    execFileSync('git', ['init', '-q', '-b', 'main', people]);
    writeFileSync(join(people, '.mailmap'), 'Ann Other <ann@x> <a.n+1@x>\n');
    run(people, 'add', '.');
    const commitAs = (n: number, name: string, email: string) =>
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `by ${name} ${String(n)}`], {
        cwd: people,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: email,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: email,
          GIT_AUTHOR_DATE: `${String(1_700_000_000 + n * 1000)} +0000`,
          GIT_COMMITTER_DATE: `${String(1_700_000_000 + n * 1000)} +0000`,
        },
      });
    commitAs(1, 'Ann', 'a.n+1@x');
    commitAs(2, 'Bob (B)', 'bob@x');
    commitAs(3, 'Annie', 'annie@x');
    commitAs(4, 'Bob (B)', 'bob@x');
    const subjects = async (filter: LogFilter) =>
      (await log(people, 0, 10, git, undefined, filter)).map((c) => c.subject);
    // Exactly, not by a name's start; as written, not as the mailmap has them; characters a
    // regular expression would read are themselves.
    expect(await subjects({ authors: ['Ann <a.n+1@x>'] })).toEqual(['by Ann 1']);
    expect(await subjects({ authors: ['bob (b) <BOB@x>', 'Annie <annie@x>'] })).toEqual([
      'by Bob (B) 4',
      'by Annie 3',
      'by Bob (B) 2',
    ]);
    // With text as typed, the authors are too; with Match Case, in their case.
    const typed = { text: 'by', regex: false, matchCase: true };
    expect(await subjects({ text: typed, authors: ['Ann <a.n+1@x>'] })).toEqual(['by Ann 1']);
    expect(await subjects({ text: typed, authors: ['ann <a.n+1@x>'] })).toEqual([]);
    // None known by the names asked for: none.
    expect(await subjects({ authors: [] })).toEqual([]);
    // After or before a time, or between.
    const at = (n: number) => (1_700_000_000 + n * 1000) * 1000;
    expect(await subjects({ after: at(3) - 1 })).toEqual(['by Bob (B) 4', 'by Annie 3']);
    expect(await subjects({ before: at(2) + 1 })).toEqual(['by Bob (B) 2', 'by Ann 1']);
    expect(await subjects({ after: at(2) - 1, before: at(3) + 1 })).toEqual([
      'by Annie 3',
      'by Bob (B) 2',
    ]);
    // The authors, each once, and who commits here: none, until it's set.
    const { authors } = await listAuthors(people);
    expect(authors).toEqual([
      { name: 'Bob (B)', email: 'bob@x' },
      { name: 'Annie', email: 'annie@x' },
      { name: 'Ann', email: 'a.n+1@x' },
    ]);
    const isolated: Git = (cwd, args, env, input) =>
      git(
        cwd,
        args,
        { ...env, GIT_CONFIG_GLOBAL: join(root, 'none'), GIT_CONFIG_NOSYSTEM: '1' },
        input,
      );
    expect((await listAuthors(people, isolated)).me).toBeUndefined();
    run(people, 'config', 'user.email', 'me@x');
    expect((await listAuthors(people, isolated)).me).toEqual({ name: '', email: 'me@x' });
  });

  it('finds each branch’s exclusive commits’ authors, as IntelliJ’s Show My Branches', async () => {
    const mine = join(root, 'mine');
    execFileSync('git', ['init', '-q', '-b', 'main', mine]);
    let n = 0;
    const commitAs = (name: string) => {
      n += 1;
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', `${name} ${String(n)}`], {
        cwd: mine,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: name,
          GIT_AUTHOR_EMAIL: `${name}@x`,
          GIT_COMMITTER_NAME: name,
          GIT_COMMITTER_EMAIL: `${name}@x`,
          GIT_AUTHOR_DATE: `${String(1_700_000_000 + n * 1000)} +0000`,
          GIT_COMMITTER_DATE: `${String(1_700_000_000 + n * 1000)} +0000`,
        },
      });
    };
    const branch = (name: string, at: string) => {
      run(mine, 'checkout', '-q', '-b', name, at);
    };
    commitAs('me');
    commitAs('me');
    branch('mine', 'main~1');
    commitAs('me');
    commitAs('me');
    branch('theirs', 'main~1');
    commitAs('ann');
    branch('mixed', 'main~1');
    commitAs('me');
    commitAs('ann');
    // At a commit with children elsewhere: none of its own.
    branch('behind', 'main~1');
    // A tag's commit is the Log's too: below it, not mine alone.
    branch('tagged', 'main~1');
    commitAs('me');
    commitAs('me');
    run(mine, 'tag', 'v1');
    run(mine, 'checkout', '-q', '-B', 'tagged', 'HEAD~1');
    run(mine, 'config', 'user.name', 'me');
    run(mine, 'config', 'user.email', 'me@x');
    const me = { name: 'me', email: 'me@x' };
    const ann = { name: 'ann', email: 'ann@x' };
    expect(await exclusiveAuthors(mine)).toEqual({
      branches: {
        'refs/heads/behind': [],
        'refs/heads/main': [me],
        'refs/heads/mine': [me],
        'refs/heads/mixed': [ann, me],
        'refs/heads/tagged': [],
        'refs/heads/theirs': [ann],
      },
      me,
    });
    // A shallow clone's oldest commit, whose parent it doesn't have.
    const shallow = join(root, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth=1', '--branch=mine', `file://${mine}`, shallow]);
    expect((await exclusiveAuthors(shallow)).branches).toEqual({
      'refs/heads/mine': [me],
      'refs/remotes/origin/mine': [me],
    });
  });

  it('filters the log by paths, files or folders, as named, through a merge', async () => {
    const tree = join(root, 'paths');
    execFileSync('git', ['init', '-q', '-b', 'main', tree]);
    /** Git, as a user: none is set on CI's runners. */
    const as = (...args: string[]) =>
      run(tree, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args);
    const change = (file: string, message: string) => {
      mkdirSync(dirname(join(tree, file)), { recursive: true });
      writeFileSync(join(tree, file), `${message}\n`);
      run(tree, 'add', '.');
      as('commit', '-qm', message);
    };
    change('a.txt', 'a');
    change('src/b.ts', 'b');
    change('[ab].txt', 'brackets');
    run(tree, 'checkout', '-qb', 'side');
    change('src/c.ts', 'c on the side');
    run(tree, 'checkout', '-q', 'main');
    change('a.txt', 'a again');
    as('merge', '-q', '--no-ff', '-m', 'merge', 'side');
    const found = async (paths: string[]) =>
      (await log(tree, 0, 10, git, undefined, { paths })).map((c) => c.subject);
    expect(await found(['a.txt'])).toEqual(['a again', 'a']);
    // A folder, with its slash or without; the merge that brings it a change is simplified away.
    expect(await found(['src/'])).toEqual(['c on the side', 'b']);
    expect(await found(['src'])).toEqual(['c on the side', 'b']);
    // As named, not as a pattern: the brackets are the file's name.
    expect(await found(['[ab].txt'])).toEqual(['brackets']);
    // The merge joins changes to both: it's kept.
    expect(await found(['a.txt', 'src/c.ts'])).toEqual(['merge', 'a again', 'c on the side', 'a']);
    // The graph joins what's shown: the side's change comes after b.
    const commits = await log(tree, 0, 10, git, undefined, { paths: ['src'] });
    expect(commits[0]?.parents).toEqual([commits[1]?.hash]);
  });

  it('joins a filtered log’s commits to their nearest ancestors shown, through merges', () => {
    const commit = (hash: string, parents: string[]) => ({
      hash,
      parents,
      author: '',
      email: '',
      time: 0,
      subject: hash,
      body: '',
      refs: [],
    });
    // m merges b and c, both from a; only m and a are shown, and a's parent isn't known. Each
    // keeps its own parents, for its files and the actions on it.
    const parents = new Map([
      ['m', ['b', 'c']],
      ['b', ['a']],
      ['c', ['a']],
      ['a', ['z']],
    ]);
    expect(rewriteParents([commit('m', ['b', 'c']), commit('a', ['z'])], parents)).toEqual([
      { ...commit('m', ['b', 'c']), joins: ['a'] },
      { ...commit('a', ['z']), joins: [] },
    ]);
    // A commit the ancestry didn't read (its branch moved between the two reads) joins through
    // its own parents.
    expect(rewriteParents([commit('n', ['a']), commit('a', [])], new Map())).toEqual([
      { ...commit('n', ['a']), joins: ['a'] },
      { ...commit('a', []), joins: [] },
    ]);
  });

  it('reads hashes as IntelliJ does: 7 to 64 hex digits, between spaces, commas or semicolons', () => {
    expect(hashesIn('abc1234, DEF5678;0123456 ')).toEqual(['abc1234', 'DEF5678', '0123456']);
    expect(hashesIn('abc123')).toBeUndefined();
    expect(hashesIn('abc1234 fix')).toBeUndefined();
    expect(hashesIn('  ')).toBeUndefined();
  });

  it('reads the changes without writing the index, which would lock out a stash run meanwhile', async () => {
    const quiet = join(root, 'quiet');
    execFileSync('git', ['init', '-q', '-b', 'main', quiet]);
    writeFileSync(join(quiet, 'a.txt'), 'a');
    run(quiet, 'add', '.');
    run(quiet, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
    // The file's times change, its text doesn't: refreshing the index would write it, under a lock.
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(quiet, 'a.txt'), later, later);
    const index = readFileSync(join(quiet, '.git', 'index'));
    expect(await listChanges(quiet)).toEqual([]);
    expect(readFileSync(join(quiet, '.git', 'index')).equals(index)).toBe(true);
  });

  it('gives a file’s bytes at a commit as they are, binary too; nothing for one not there', async () => {
    const binary = join(root, 'binary');
    execFileSync('git', ['init', '-q', '-b', 'main', binary]);
    // Not text: NULs, and bytes UTF-8 would replace.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0xfe, 0x0a, 0x80]);
    writeFileSync(join(binary, 'p.png'), png);
    run(binary, 'add', '.');
    run(binary, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
    expect([...((await bytesAt(binary, 'HEAD', 'p.png')) ?? [])]).toEqual([...png]);
    expect(await bytesAt(binary, 'HEAD', 'gone.png')).toBeUndefined();
  });

  it('says which of the files given git tracks, so an edit not saved yet can show as changed', async () => {
    const files = join(root, 'tracked');
    execFileSync('git', ['init', '-q', '-b', 'main', files]);
    mkdirSync(join(files, 'src'));
    writeFileSync(join(files, 'src', 'a.ts'), 'a');
    run(files, 'add', '.');
    run(files, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
    writeFileSync(join(files, 'new.ts'), 'n');
    expect(await trackedFiles(files, ['src/a.ts', 'new.ts', 'gone.ts'])).toEqual(['src/a.ts']);
    expect(await trackedFiles(files, [])).toEqual([]);
  });

  it('lists a repository’s worktrees, from any of them', async () => {
    for (const from of [repo, join(root, 'feature')]) {
      const worktrees = await listWorktrees(from);
      expect(worktrees.map((w) => [w.path, w.branch, w.main])).toEqual([
        [repo, 'main', true],
        [join(root, 'feature'), 'feature', false],
      ]);
    }
  });

  it('adds worktrees, on a new branch or an existing one, and removes them', async () => {
    const created = await addWorktree(repo, {
      path: join(root, 'fix'),
      branch: 'fix/one',
      create: true,
      from: 'main',
    });
    expect(created.map((w) => w.branch)).toEqual(['main', 'feature', 'fix/one']);
    run(repo, 'branch', 'spare');
    const existing = await addWorktree(repo, { path: join(root, 'spare'), branch: 'spare' });
    expect(existing.at(-1)).toMatchObject({ path: join(root, 'spare'), branch: 'spare' });
    const afterRemove = await removeWorktree(repo, join(root, 'spare'));
    expect(afterRemove.map((w) => w.branch)).toEqual(['main', 'feature', 'fix/one']);
    await addWorktree(repo, { path: join(root, 'head'), branch: 'from-head', create: true });
    await removeWorktree(repo, join(root, 'head'));
  });

  it('refuses to remove a worktree with changes unless forced, and the main one', async () => {
    const path = join(root, 'dirty');
    await addWorktree(repo, { path, branch: 'dirty', create: true });
    writeFileSync(join(path, 'a.txt'), 'changed');
    await expect(removeWorktree(repo, path)).rejects.toThrow(/modified or untracked/);
    const after = await removeWorktree(repo, path, true);
    expect(after.some((w) => w.path === path)).toBe(false);
    await expect(removeWorktree(repo, repo, true)).rejects.toThrow(/main working tree/);
  });

  it('lists a worktree’s files, tracked and untracked, without ignored ones', async () => {
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'new file.ts'), '');
    writeFileSync(join(repo, '.gitignore'), 'build/\n');
    mkdirSync(join(repo, 'build'));
    writeFileSync(join(repo, 'build', 'out.js'), '');
    expect(await listFiles(repo)).toEqual(['.gitignore', 'a.txt', 'src/new file.ts']);
  });

  it('fails with git’s message outside a repository, or without git’s own message', async () => {
    await expect(git(root, ['worktree', 'list'])).rejects.toThrow(/not a git repository/);
    await expect(git(join(root, 'missing'), ['status'])).rejects.toThrow(/ENOENT|spawn/);
  });

  it('lists a worktree’s changes, and reads a file as last committed', async () => {
    const path = join(root, 'changes');
    await addWorktree(repo, { path, branch: 'changes', create: true });
    writeFileSync(join(path, 'a.txt'), 'changed');
    writeFileSync(join(path, 'b.txt'), 'new');
    run(path, 'mv', 'a.txt', 'c.txt');
    expect(await listChanges(path)).toEqual([
      { path: 'b.txt', status: 'untracked' },
      { path: 'c.txt', status: 'renamed', from: 'a.txt' },
    ]);
    expect(await committedText(path, 'a.txt')).toBe('a');
    expect(await committedText(path, 'b.txt')).toBe('');
  });

  it('lists ignored files, a folder ignored whole as one entry', async () => {
    const path = join(root, 'ignored');
    await addWorktree(repo, { path, branch: 'ignored', create: true });
    writeFileSync(join(path, '.gitignore'), 'out/\n*.log\n');
    mkdirSync(join(path, 'out'));
    writeFileSync(join(path, 'out', 'a.js'), '');
    writeFileSync(join(path, 'out', 'b.js'), '');
    writeFileSync(join(path, 'debug.log'), '');
    writeFileSync(join(path, 'kept.ts'), '');
    expect(await listIgnored(path)).toEqual(['debug.log', 'out/']);
  });

  it('says which of a folder’s entries are ignored, inside an ignored folder too', async () => {
    const path = join(root, 'ignored-among');
    await addWorktree(repo, { path, branch: 'ignored-among', create: true });
    writeFileSync(join(path, '.gitignore'), 'out/\n*.log\n');
    mkdirSync(join(path, 'out', 'deep'), { recursive: true });
    writeFileSync(join(path, 'out', 'deep', 'a.js'), '');
    writeFileSync(join(path, 'debug.log'), '');
    writeFileSync(join(path, 'kept.ts'), '');
    expect(await ignoredAmong(path, ['out', 'debug.log', 'kept.ts', '.gitignore'])).toEqual(
      new Set(['out', 'debug.log']),
    );
    expect(await ignoredAmong(join(path, 'out', 'deep'), ['a.js'])).toEqual(new Set(['a.js']));
    // None of them: git exits with 1.
    expect(await ignoredAmong(path, ['kept.ts'])).toEqual(new Set());
    // Outside a repository: none.
    expect(await ignoredAmong(tmpdir(), ['x'])).toEqual(new Set());
  });

  it('fails, without an unhandled error, when git exits without reading its input', async () => {
    // Outside a repository git stops at once: writing 10 MB to it then fails (EPIPE), which was
    // thrown as an uncaught exception.
    await expect(
      git(tmpdir(), ['check-ignore', '-z', '--stdin'], undefined, 'x'.repeat(10_000_000)),
    ).rejects.toThrow();
  });

  it('asks git nothing about no names', async () => {
    const run = vi.fn<Git>();
    expect(await ignoredAmong('/repo', [], run)).toEqual(new Set());
    expect(run).not.toHaveBeenCalled();
  });

  it('rolls changes back: modified, deleted, renamed, and added, kept or deleted', async () => {
    const path = join(root, 'rollback');
    await addWorktree(repo, { path, branch: 'rollback', create: true });
    writeFileSync(join(path, 'b.txt'), 'b');
    writeFileSync(join(path, 'c.txt'), 'c');
    run(path, 'add', '.');
    run(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    writeFileSync(join(path, 'a.txt'), 'changed');
    rmSync(join(path, 'b.txt'));
    run(path, 'mv', 'c.txt', 'd.txt');
    writeFileSync(join(path, 'new.txt'), 'new');
    writeFileSync(join(path, 'kept.txt'), 'kept');
    run(path, 'add', 'new.txt', 'kept.txt');
    writeFileSync(join(path, 'loose.txt'), 'untracked');
    const changes = await listChanges(path);
    const pick = (...names: string[]) => changes.filter((c) => names.includes(c.path));
    await rollback(path, pick('a.txt', 'b.txt', 'd.txt', 'new.txt', 'loose.txt'), true);
    expect(await listChanges(path)).toEqual([
      { path: 'kept.txt', status: 'added' },
      { path: 'loose.txt', status: 'untracked' },
    ]);
    expect(readFileSync(join(path, 'a.txt'), 'utf8')).toBe('a');
    expect(existsSync(join(path, 'b.txt')) && existsSync(join(path, 'c.txt'))).toBe(true);
    expect(existsSync(join(path, 'new.txt'))).toBe(false);
    // An added file whose copy is kept: unstaged, so untracked.
    await rollback(path, pick('kept.txt'), false);
    expect(await listChanges(path)).toEqual([
      { path: 'kept.txt', status: 'untracked' },
      { path: 'loose.txt', status: 'untracked' },
    ]);
    // Nothing to roll back: git isn't run.
    await rollback(path, [], false);
  });

  it('commits the files named, as they are, leaving what else was staged staged', async () => {
    const path = join(root, 'commit');
    await addWorktree(repo, { path, branch: 'commit', create: true });
    writeFileSync(join(path, 'b.txt'), 'b');
    writeFileSync(join(path, 'c.txt'), 'c');
    writeFileSync(join(path, 'd.txt'), 'd');
    writeFileSync(join(path, 'e.txt'), 'e');
    run(path, 'add', '.');
    run(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'more');
    // Modified, staged and then changed again; deleted, staged and not; renamed; new, with a name
    // that's a pattern; and another, staged, that isn't committed.
    writeFileSync(join(path, 'a.txt'), 'staged');
    run(path, 'add', 'a.txt');
    writeFileSync(join(path, 'a.txt'), 'changed');
    run(path, 'rm', '-q', 'b.txt');
    rmSync(join(path, 'c.txt'));
    run(path, 'mv', 'd.txt', 'moved.txt');
    writeFileSync(join(path, '*.txt'), 'new');
    writeFileSync(join(path, 'staged.txt'), 'staged');
    run(path, 'add', 'staged.txt');
    writeFileSync(join(path, 'e.txt'), 'not committed');
    const named = ['a.txt', 'b.txt', 'c.txt', 'moved.txt', '*.txt'];
    const changes = (await listChanges(path)).filter((c) => named.includes(c.path));
    await commit(path, changes, 'Commit them\n\nAll of them.', false, as);
    expect(await listChanges(path)).toEqual([
      { path: 'e.txt', status: 'modified' },
      { path: 'staged.txt', status: 'added' },
    ]);
    expect(run(path, 'diff', '--cached', '--name-only')).toBe('staged.txt\n');
    expect(await committedText(path, 'a.txt')).toBe('changed');
    expect(await committedText(path, '*.txt')).toBe('new');
    expect(await committedText(path, 'moved.txt')).toBe('d');
    expect(await committedText(path, 'd.txt')).toBe('');
    expect(await lastMessage(path)).toBe('Commit them\n\nAll of them.');
    // Amended, with no files: only its message changes, and what's staged stays out.
    await commit(path, [], 'Reworded', true, as);
    expect(await lastMessage(path)).toBe('Reworded');
    expect(run(path, 'log', '--format=%s', '-2')).toBe('Reworded\nmore\n');
    expect(await listChanges(path)).toHaveLength(2);
  });

  it('leaves an untracked file untracked when its commit fails', async () => {
    const path = join(root, 'commit-fails');
    await addWorktree(repo, { path, branch: 'commit-fails', create: true });
    writeFileSync(join(path, 'new.txt'), 'new');
    const changes = await listChanges(path);
    // An empty message: git refuses it.
    await expect(commit(path, changes, '', false, as)).rejects.toThrow();
    expect(await listChanges(path)).toEqual([{ path: 'new.txt', status: 'untracked' }]);
    // Nothing was added: nothing to take back.
    await expect(commit(path, [], '', true, as)).rejects.toThrow();
  });

  it('commits a merge, as IntelliJ’s, what was staged besides staged again', async () => {
    const path = join(root, 'commit-merge');
    await addWorktree(repo, { path, branch: 'commit-merge', create: true });
    const commitAll = (subject: string) => {
      run(path, 'add', '.');
      run(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', subject);
    };
    writeFileSync(join(path, 'm1.txt'), 'base');
    writeFileSync(join(path, 'm2.txt'), 'base');
    writeFileSync(join(path, 'm3.txt'), 'base');
    commitAll('base');
    run(path, 'checkout', '-qb', 'commit-merge-theirs');
    writeFileSync(join(path, 'm1.txt'), 'theirs');
    writeFileSync(join(path, 'm2.txt'), 'theirs');
    writeFileSync(join(path, 'm3.txt'), 'theirs');
    commitAll('theirs');
    run(path, 'checkout', '-q', 'commit-merge');
    writeFileSync(join(path, 'm1.txt'), 'mine');
    commitAll('mine');
    // m1 in conflict, m2 and m3 merged and staged: no commit until m1 is resolved.
    expect(() =>
      run(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', '-q', 'commit-merge-theirs'),
    ).toThrow();
    const pick = async (...names: string[]) =>
      (await listChanges(path)).filter((c) => names.includes(c.path));
    await expect(commit(path, await pick('m2.txt'), 'Merged', false, as)).rejects.toThrow(
      'Committing is not possible because you have unmerged files.',
    );
    writeFileSync(join(path, 'm1.txt'), 'resolved');
    run(path, 'add', 'm1.txt');
    writeFileSync(join(path, 'loose.txt'), 'new');
    // m3 left out: unstaged for the commit, staged again after.
    await commit(path, await pick('m1.txt', 'm2.txt', 'loose.txt'), 'Merged', false, as);
    expect(run(path, 'log', '-1', '--format=%s %p').split(' ')).toHaveLength(3);
    expect(await committedText(path, 'm1.txt')).toBe('resolved');
    expect(await committedText(path, 'm2.txt')).toBe('theirs');
    expect(await committedText(path, 'm3.txt')).toBe('base');
    expect(await committedText(path, 'loose.txt')).toBe('new');
    expect(run(path, 'diff', '--cached', '--name-only')).toBe('m3.txt\n');
  });

  it('stages again what it unstaged when a merge’s commit fails', async () => {
    const path = join(root, 'commit-merge-fails');
    await addWorktree(repo, { path, branch: 'commit-merge-fails', create: true });
    run(path, 'checkout', '-qb', 'commit-merge-fails-theirs');
    writeFileSync(join(path, 'f1.txt'), 'theirs');
    writeFileSync(join(path, 'f2.txt'), 'theirs');
    run(path, 'add', '.');
    run(path, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'theirs');
    run(path, 'checkout', '-q', 'commit-merge-fails');
    run(
      path,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'merge',
      '-q',
      '--no-commit',
      '--no-ff',
      'commit-merge-fails-theirs',
    );
    const changes = (await listChanges(path)).filter((c) => c.path === 'f1.txt');
    // An empty message: git refuses it.
    await expect(commit(path, changes, '', false, as)).rejects.toThrow();
    expect(run(path, 'diff', '--cached', '--name-only')).toBe('f1.txt\nf2.txt\n');
  });

  it('gives no last message before the first commit', async () => {
    const empty = join(root, 'empty');
    run(root, 'init', '-q', empty);
    expect(await lastMessage(empty)).toBe('');
  });
});
