import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { git, listWorktrees, parseWorktrees } from '../src/index.js';

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

  it('fails with git’s message outside a repository, or without git’s own message', async () => {
    await expect(git(root, ['worktree', 'list'])).rejects.toThrow(/not a git repository/);
    await expect(git(join(root, 'missing'), ['status'])).rejects.toThrow(/ENOENT|spawn/);
  });
});
