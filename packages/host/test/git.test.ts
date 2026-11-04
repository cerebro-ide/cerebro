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
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  addWorktree,
  commit,
  committedText,
  git,
  type Git,
  listChanges,
  listFiles,
  ignoredAmong,
  listIgnored,
  listWorktrees,
  lastMessage,
  log,
  parseLog,
  parseNameStatus,
  parseStatus,
  parseWorktrees,
  removeWorktree,
  rollback,
} from '../src/index.js';

describe('parseLog', () => {
  it('reads a commit per record: its parents, refs and subject, which may hold commas', () => {
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
        ) + record('a', '', 'Bo', 'b@x', '5', '', 'first'),
      ),
    ).toEqual([
      {
        hash: 'b',
        parents: ['a', 'c'],
        author: 'Ann',
        email: 'a@x',
        time: 10_000,
        subject: 'x, y',
        refs: ['HEAD -> refs/heads/main', 'tag: refs/tags/v1'],
      },
      {
        hash: 'a',
        parents: [],
        author: 'Bo',
        email: 'b@x',
        time: 5000,
        subject: 'first',
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
    commitAt(2, 'on side');
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
    expect(first).toMatchObject({
      parents: [],
      author: 't',
      email: 't@t',
      time: 1_700_000_001_000,
      refs: [],
    });
    expect((await log(history, 1, 2)).map((c) => c.subject)).toEqual(['on main', 'on side']);
    await expect(log(join(root, 'none'), 0, 1)).rejects.toThrow();
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

  it('gives no last message before the first commit', async () => {
    const empty = join(root, 'empty');
    run(root, 'init', '-q', empty);
    expect(await lastMessage(empty)).toBe('');
  });
});
