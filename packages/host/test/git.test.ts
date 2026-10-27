import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  addWorktree,
  committedText,
  git,
  type Git,
  listChanges,
  listFiles,
  ignoredAmong,
  listIgnored,
  listWorktrees,
  parseNameStatus,
  parseStatus,
  parseWorktrees,
  removeWorktree,
  rollback,
} from '../src/index.js';

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

describe('with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-')));
  const repo = join(root, 'repo');
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a');
  run(repo, 'add', '.');
  run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  run(repo, 'worktree', 'add', '-q', '-b', 'feature', join(root, 'feature'));

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
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
});
