import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  abortOperation,
  applyCommit,
  continueApplying,
  git,
  listConflicts,
  onRemoteBranch,
  operation,
  repositoryState,
} from '../src/index.js';

describe('cherry-pick and revert, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-apply-changes-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  const write = (cwd: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  };
  const commit = (cwd: string, message: string) => {
    run(cwd, 'add', '-A');
    run(cwd, 'commit', '-qm', message);
    return run(cwd, 'rev-parse', 'HEAD');
  };
  let repos = 0;
  /** `side` changed `a.txt` (as `main` did too) then added `b.txt`; `main` is checked out. */
  const repository = () => {
    const repo = join(root, `r${String(++repos)}`);
    run(root, 'init', '-q', '-b', 'main', repo);
    run(repo, 'config', 'core.autocrlf', 'false');
    run(repo, 'config', 'user.name', 'me');
    run(repo, 'config', 'user.email', 'me@t');
    write(repo, { 'a.txt': 'base\n' });
    commit(repo, 'base');
    run(repo, 'checkout', '-q', '-b', 'side');
    write(repo, { 'a.txt': 'side\n' });
    run(repo, 'add', '-A');
    run(repo, '-c', 'user.name=Them', 'commit', '-qm', 'side change');
    const changed = run(repo, 'rev-parse', 'HEAD');
    write(repo, { 'b.txt': 'b\n' });
    const added = commit(repo, 'add b');
    run(repo, 'checkout', '-q', 'main');
    write(repo, { 'a.txt': 'mainline\n' });
    commit(repo, 'main change');
    return { repo, changed, added };
  };
  const subjects = (repo: string) => run(repo, 'log', '--format=%s').split('\n');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('picks a commit, with its message; says where from when asked; skips it once it’s here', async () => {
    const { repo, added } = repository();
    expect(await applyCommit(repo, 'cherry-pick', added, false, git)).toBe('picked');
    expect(subjects(repo)).toEqual(['add b', 'main change', 'base']);
    expect(run(repo, 'log', '-1', '--format=%B')).toBe('add b');
    // Its changes already here: skipped, nothing under way after.
    expect(await applyCommit(repo, 'cherry-pick', added, false, git)).toBe('empty');
    expect(subjects(repo)).toHaveLength(3);
    expect(await operation(repo, git)).toBeUndefined();
    run(repo, 'reset', '-q', '--hard', 'HEAD~1');
    expect(await applyCommit(repo, 'cherry-pick', added, true, git)).toBe('picked');
    expect(run(repo, 'log', '-1', '--format=%B')).toBe(
      `add b\n\n(cherry picked from commit ${added})`,
    );
  });

  it('stops at conflicts, named for the Conflicts dialog; continues with its author, or aborts', async () => {
    const { repo, changed } = repository();
    expect(await applyCommit(repo, 'cherry-pick', changed, false, git)).toBe('conflicts');
    expect(await operation(repo, git)).toBe('cherry-pick');
    expect((await repositoryState(repo, git)).operation).toBe('cherry-pick');
    expect(await listConflicts(repo, git)).toEqual({
      operation: 'cherry-pick',
      files: [{ path: 'a.txt', yours: 'modified', theirs: 'modified' }],
      commit: { hash: changed.slice(0, 7), author: 'Them', message: 'side change' },
    });
    // Still in conflict: it stops again.
    expect(await continueApplying(repo, 'cherry-pick', git)).toBe('conflicts');
    write(repo, { 'a.txt': 'resolved\n' });
    run(repo, 'add', 'a.txt');
    expect(await continueApplying(repo, 'cherry-pick', git)).toBe('picked');
    expect(run(repo, 'log', '-1', '--format=%s|%an')).toBe('side change|Them');
    expect(await operation(repo, git)).toBeUndefined();
    // Aborted: back to where it was.
    run(repo, 'reset', '-q', '--hard', 'HEAD~1');
    expect(await applyCommit(repo, 'cherry-pick', changed, false, git)).toBe('conflicts');
    await abortOperation(repo, 'cherry-pick', git);
    expect(await operation(repo, git)).toBeUndefined();
    expect(subjects(repo)).toEqual(['main change', 'base']);
  });

  it('skips a pick its conflicts resolved to nothing', async () => {
    const { repo, changed } = repository();
    expect(await applyCommit(repo, 'cherry-pick', changed, false, git)).toBe('conflicts');
    run(repo, 'checkout', '--ours', 'a.txt');
    run(repo, 'add', 'a.txt');
    expect(await continueApplying(repo, 'cherry-pick', git)).toBe('empty');
    expect(await operation(repo, git)).toBeUndefined();
    expect(subjects(repo)).toEqual(['main change', 'base']);
  });

  it('fails as git does when local changes or untracked files are in the way', async () => {
    const { repo, changed, added } = repository();
    write(repo, { 'a.txt': 'dirty\n' });
    await expect(applyCommit(repo, 'cherry-pick', changed, false, git)).rejects.toThrow(
      /local changes to the following files would be overwritten/,
    );
    run(repo, 'checkout', '-q', 'a.txt');
    write(repo, { 'b.txt': 'mine\n' });
    await expect(applyCommit(repo, 'cherry-pick', added, false, git)).rejects.toThrow(
      /untracked working tree files would be overwritten/,
    );
    expect(await operation(repo, git)).toBeUndefined();
  });

  it('reverts a commit with git’s message; says when it’s undone already', async () => {
    const { repo } = repository();
    write(repo, { 'c.txt': 'c\n' });
    const added = commit(repo, 'add c');
    expect(await applyCommit(repo, 'revert', added, false, git)).toBe('picked');
    expect(run(repo, 'log', '-1', '--format=%B')).toBe(
      `Revert "add c"\n\nThis reverts commit ${added}.`,
    );
    // Undone already: git commits nothing, and nothing is left under way.
    expect(await applyCommit(repo, 'revert', added, false, git)).toBe('empty');
    expect(await operation(repo, git)).toBeUndefined();
  });

  it('stops a revert at conflicts, named for the Conflicts dialog; continues, skips or aborts it', async () => {
    const { repo } = repository();
    const changed = run(repo, 'rev-parse', 'HEAD');
    write(repo, { 'a.txt': 'again\n' });
    commit(repo, 'change again');
    expect(await applyCommit(repo, 'revert', changed, false, git)).toBe('conflicts');
    expect(await operation(repo, git)).toBe('revert');
    expect(await listConflicts(repo, git)).toEqual({
      operation: 'revert',
      files: [{ path: 'a.txt', yours: 'modified', theirs: 'modified' }],
      commit: { hash: changed.slice(0, 7), author: 'me', message: 'main change' },
    });
    write(repo, { 'a.txt': 'base\n' });
    run(repo, 'add', 'a.txt');
    expect(await continueApplying(repo, 'revert', git)).toBe('picked');
    expect(run(repo, 'log', '-1', '--format=%s')).toBe('Revert "main change"');
    // Resolved to what's there: nothing to commit, skipped.
    run(repo, 'reset', '-q', '--hard', 'HEAD~1');
    expect(await applyCommit(repo, 'revert', changed, false, git)).toBe('conflicts');
    run(repo, 'checkout', '--ours', 'a.txt');
    run(repo, 'add', 'a.txt');
    expect(await continueApplying(repo, 'revert', git)).toBe('empty');
    expect(await operation(repo, git)).toBeUndefined();
    expect(await applyCommit(repo, 'revert', changed, false, git)).toBe('conflicts');
    await abortOperation(repo, 'revert', git);
    expect(await operation(repo, git)).toBeUndefined();
    expect(subjects(repo)[0]).toBe('change again');
  });

  it('fails a revert as git does when local changes are in the way', async () => {
    const { repo } = repository();
    write(repo, { 'a.txt': 'dirty\n' });
    await expect(applyCommit(repo, 'revert', 'HEAD', false, git)).rejects.toThrow(
      /local changes to the following files would be overwritten/,
    );
  });

  it('knows a commit is on a remote’s branch: IntelliJ’s published', async () => {
    const { repo, changed, added } = repository();
    run(repo, 'update-ref', 'refs/remotes/origin/main', changed);
    run(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const main = (name: string) => name === 'main';
    expect(await onRemoteBranch(repo, changed, main, git)).toBe(true);
    expect(await onRemoteBranch(repo, added, main, git)).toBe(false);
    expect(await onRemoteBranch(repo, changed, () => false, git)).toBe(false);
    // A remote's HEAD isn't a branch of its own.
    expect(await onRemoteBranch(repo, changed, (n) => n === 'HEAD', git)).toBe(false);
  });
});
