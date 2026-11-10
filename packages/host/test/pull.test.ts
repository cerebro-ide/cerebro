import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { fetchAll, git, pull, tracking } from '../src/index.js';

describe('fetching and pulling, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-pull-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const commit = (cwd: string, message: string, file = `${message}.txt`, text = message) => {
    writeFileSync(join(cwd, file), text);
    run(cwd, 'add', '.');
    run(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
  };
  /** A repository whose `main` tracks `origin/main`, and another clone that pushes there. */
  let clones = 0;
  const cloned = () => {
    const name = `r${String(++clones)}`;
    const remote = join(root, `${name}.git`);
    const repo = join(root, name);
    const other = join(root, `${name}-other`);
    run(root, 'init', '-q', '--bare', '-b', 'main', remote);
    run(root, 'init', '-q', '-b', 'main', repo);
    run(repo, 'config', 'core.autocrlf', 'false');
    // Someone the merges commit as (CI's git has no one).
    run(repo, 'config', 'user.name', 't');
    run(repo, 'config', 'user.email', 't@t');
    commit(repo, 'first', 'shared.txt', 'one\n');
    run(repo, 'remote', 'add', 'origin', remote);
    run(repo, 'push', '-q', '-u', 'origin', 'main');
    run(root, 'clone', '-q', '-c', 'core.autocrlf=false', remote, other);
    /** A commit pushed from the other clone, to `branch`. */
    const upstream = (message: string, file?: string, text?: string, branch = 'main') => {
      commit(other, message, file, text);
      run(other, 'push', '-q', 'origin', `HEAD:${branch}`);
    };
    return { repo, other, upstream };
  };
  const from = (...options: string[]) => ({ remote: 'origin', branch: 'main', options });
  const subjects = (repo: string) => run(repo, 'log', '--format=%s').trim().split('\n');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fetches every remote with the remote commands’ git, saying what was pruned', async () => {
    const { repo, other, upstream } = cloned();
    upstream('gone', undefined, undefined, 'gone');
    upstream('kept', undefined, undefined, 'kept');
    expect(await fetchAll(repo, git, git)).toEqual({ pruned: [], failed: [] });
    run(other, 'push', '-q', 'origin', '--delete', 'gone');
    const remote = vi.fn(git);
    expect(await fetchAll(repo, git, remote)).toEqual({ pruned: ['origin/gone'], failed: [] });
    expect(remote.mock.calls[0]?.[1]).toContain('fetch');
    expect(run(repo, 'branch', '-r', '--format=%(refname:short)').trim().split('\n')).toEqual([
      'origin/kept',
      'origin/main',
    ]);
  });

  it('says which remote failed and why, the others fetched', async () => {
    const { repo, upstream } = cloned();
    run(repo, 'remote', 'add', 'broken', join(root, 'missing.git'));
    upstream('theirs');
    const fetched = await fetchAll(repo, git, git);
    expect(fetched.failed.map((f) => f.remote)).toEqual(['broken']);
    expect(fetched.failed[0]?.error).toMatch(/does not appear to be a git repository/);
    expect(run(repo, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('theirs');
  });

  it('says where a pull comes from: the branch, the remotes and its upstream', async () => {
    const { repo } = cloned();
    expect(await tracking(repo, git)).toEqual({
      branch: 'main',
      remotes: ['origin'],
      upstream: { remote: 'origin', branch: 'main' },
    });
    run(repo, 'checkout', '-q', '-b', 'alone');
    expect((await tracking(repo, git)).upstream).toBeUndefined();
    run(repo, 'checkout', '-q', '--detach');
    expect(await tracking(repo, git)).toEqual({
      branch: undefined,
      remotes: ['origin'],
      upstream: undefined,
    });
  });

  it('pulls with the remote commands’ git, merging, counting what it brought', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    upstream('more');
    commit(repo, 'mine');
    const remote = vi.fn(git);
    expect(await pull(repo, from(), git, remote)).toEqual({ kind: 'pulled', files: 2, commits: 2 });
    expect(remote.mock.calls[0]?.[1]).toEqual([
      'pull',
      '--no-rebase',
      '--no-stat',
      '-v',
      '--end-of-options',
      'origin',
      'main',
    ]);
    expect(subjects(repo)[0]).toMatch(/^Merge branch 'main'/);
    expect(await pull(repo, from(), git, git)).toEqual({ kind: 'pulled', files: 0, commits: 0 });
  });

  it('pulls with the options chosen: squashed, its files staged, no commit', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    commit(repo, 'mine');
    expect(await pull(repo, from('--squash'), git, git)).toEqual({
      kind: 'pulled',
      files: 1,
      commits: 1,
    });
    expect(run(repo, 'diff', '--cached', '--name-only').trim()).toBe('theirs.txt');
  });

  it('fails in git’s words: not a fast-forward when asked for one, local changes in the way', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'shared.txt', 'theirs\n');
    commit(repo, 'mine');
    await expect(pull(repo, from('--ff-only'), git, git)).rejects.toThrow(/fast-forward/i);
    run(repo, 'reset', '-q', '--hard', 'HEAD~1');
    writeFileSync(join(repo, 'shared.txt'), 'mine\n');
    await expect(pull(repo, from(), git, git)).rejects.toThrow(/would be overwritten/);
  });

  it('stops at conflicts, the merge under way', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'shared.txt', 'theirs\n');
    commit(repo, 'mine', 'shared.txt', 'mine\n');
    const before = run(repo, 'rev-parse', 'HEAD').trim();
    expect(await pull(repo, from(), git, git)).toEqual({
      kind: 'conflicts',
      resume: { method: 'merge', before, commits: 1 },
    });
    expect(run(repo, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('shared.txt');
  });
});
