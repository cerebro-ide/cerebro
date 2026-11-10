import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkout,
  continueOperation,
  createBranch,
  deleteBranch,
  git,
  mergeBranch,
  rebaseOnto,
  renameBranch,
  restoreBranch,
} from '../src/index.js';

describe('branch operations, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-branches-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const commit = (cwd: string, message: string, file = `${message}.txt`, text = message) => {
    writeFileSync(join(cwd, file), text);
    run(cwd, 'add', '.');
    run(cwd, 'commit', '-qm', message);
  };
  /** A repository on `main`, and `side` from its first commit, each with a commit of its own. */
  let repos = 0;
  const repository = () => {
    const repo = join(root, `r${String(++repos)}`);
    run(root, 'init', '-q', '-b', 'main', repo);
    run(repo, 'config', 'core.autocrlf', 'false');
    // Someone the merges commit as (CI's git has no one).
    run(repo, 'config', 'user.name', 't');
    run(repo, 'config', 'user.email', 't@t');
    commit(repo, 'first', 'shared.txt', 'one\n');
    run(repo, 'branch', 'side');
    commit(repo, 'main');
    run(repo, 'checkout', '-q', 'side');
    commit(repo, 'side');
    run(repo, 'checkout', '-q', 'main');
    return repo;
  };
  const current = (repo: string) => run(repo, 'branch', '--show-current').trim();
  const subjects = (repo: string) => run(repo, 'log', '--format=%s').trim().split('\n');
  const read = (repo: string, file: string) => readFileSync(join(repo, file), 'utf8');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('checks out a local branch; a remote one as a local branch tracking it', async () => {
    const repo = repository();
    const clone = join(root, 'clone');
    run(root, 'clone', '-q', repo, clone);
    await checkout(repo, 'side', false, git);
    expect(current(repo)).toBe('side');
    await checkout(clone, 'origin/side', true, git);
    expect(current(clone)).toBe('side');
    expect(run(clone, 'rev-parse', '--abbrev-ref', 'side@{upstream}').trim()).toBe('origin/side');
  });

  it('fails a checkout in git’s words when local changes are in the way', async () => {
    const repo = repository();
    commit(repo, 'shared on main', 'shared.txt', 'main\n');
    writeFileSync(join(repo, 'shared.txt'), 'mine\n');
    await expect(checkout(repo, 'side', false, git)).rejects.toThrow(/would be overwritten/);
    expect(current(repo)).toBe('main');
  });

  it('makes a branch from HEAD or another, checked out or not, over one of its name if asked', async () => {
    const repo = repository();
    await createBranch(repo, { name: 'feature', checkout: true, overwrite: false }, git);
    expect(current(repo)).toBe('feature');
    expect(run(repo, 'rev-parse', 'feature').trim()).toBe(run(repo, 'rev-parse', 'main').trim());
    await createBranch(
      repo,
      { name: 'from-side', from: 'side', checkout: false, overwrite: false },
      git,
    );
    expect(current(repo)).toBe('feature');
    expect(run(repo, 'rev-parse', 'from-side').trim()).toBe(run(repo, 'rev-parse', 'side').trim());
    await expect(
      createBranch(repo, { name: 'side', checkout: false, overwrite: false }, git),
    ).rejects.toThrow(/already exists/);
    await createBranch(repo, { name: 'side', from: 'main', checkout: false, overwrite: true }, git);
    expect(run(repo, 'rev-parse', 'side').trim()).toBe(run(repo, 'rev-parse', 'main').trim());
    await createBranch(
      repo,
      { name: 'from-side', from: 'main', checkout: true, overwrite: true },
      git,
    );
    expect(current(repo)).toBe('from-side');
    expect(run(repo, 'rev-parse', 'HEAD').trim()).toBe(run(repo, 'rev-parse', 'main').trim());
  });

  it('renames a branch', async () => {
    const repo = repository();
    await renameBranch(repo, 'side', 'other', git);
    expect(run(repo, 'branch', '--format=%(refname:short)').trim().split('\n')).toEqual([
      'main',
      'other',
    ]);
  });

  it('deletes a branch, an unmerged one too, saying so; restores it where it was', async () => {
    const repo = repository();
    const tip = run(repo, 'rev-parse', 'side').trim();
    expect(await deleteBranch(repo, 'side', git)).toEqual({ hash: tip, unmerged: true });
    await restoreBranch(repo, 'side', tip, git);
    expect(run(repo, 'rev-parse', 'side').trim()).toBe(tip);
    run(repo, 'branch', 'merged');
    expect((await deleteBranch(repo, 'merged', git)).unmerged).toBe(false);
    // The branch checked out: git's words.
    await expect(deleteBranch(repo, 'main', git)).rejects.toThrow(/cannot delete branch 'main'/i);
  });

  it('merges a branch into the current one, or says it was up to date', async () => {
    const repo = repository();
    expect(await mergeBranch(repo, 'side', git)).toBe('done');
    expect(subjects(repo)[0]).toBe("Merge branch 'side'");
    expect(await mergeBranch(repo, 'side', git)).toBe('upToDate');
  });

  it('stops a merge at conflicts, under way; fails one local changes are in the way of', async () => {
    const repo = repository();
    commit(repo, 'shared on main', 'shared.txt', 'main\n');
    run(repo, 'checkout', '-q', 'side');
    commit(repo, 'shared on side', 'shared.txt', 'side\n');
    run(repo, 'checkout', '-q', 'main');
    writeFileSync(join(repo, 'shared.txt'), 'mine\n');
    await expect(mergeBranch(repo, 'side', git)).rejects.toThrow(/would be overwritten/);
    run(repo, 'checkout', '--', 'shared.txt');
    expect(await mergeBranch(repo, 'side', git)).toBe('conflicts');
    expect(run(repo, 'diff', '--name-only', '--diff-filter=U').trim()).toBe('shared.txt');
  });

  it('rebases the current branch onto another, local changes put back after', async () => {
    const repo = repository();
    writeFileSync(join(repo, 'shared.txt'), 'mine\n');
    expect(await rebaseOnto(repo, 'side', git)).toBe('done');
    expect(subjects(repo)).toEqual(['main', 'side', 'first']);
    expect(read(repo, 'shared.txt')).toBe('mine\n');
    expect(await rebaseOnto(repo, 'side', git)).toBe('upToDate');
  });

  it('stops a rebase at conflicts, local changes back once it’s continued', async () => {
    const repo = repository();
    commit(repo, 'shared on main', 'shared.txt', 'main\n');
    run(repo, 'checkout', '-q', 'side');
    commit(repo, 'shared on side', 'shared.txt', 'side\n');
    run(repo, 'checkout', '-q', 'main');
    writeFileSync(join(repo, 'main.txt'), 'mine');
    expect(await rebaseOnto(repo, 'side', git)).toBe('conflicts');
    writeFileSync(join(repo, 'shared.txt'), 'both\n');
    run(repo, 'add', 'shared.txt');
    expect(await continueOperation(repo, git)).toBe('done');
    expect(subjects(repo)).toEqual(['shared on main', 'main', 'shared on side', 'side', 'first']);
    expect(read(repo, 'main.txt')).toBe('mine');
  });

  it('fails a rebase onto what isn’t there in git’s words', async () => {
    const repo = repository();
    await expect(rebaseOnto(repo, 'missing', git)).rejects.toThrow(/missing/);
  });
});
