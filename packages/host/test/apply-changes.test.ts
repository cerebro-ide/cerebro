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
import { afterAll, describe, expect, it } from 'vitest';
import {
  abortOperation,
  applyChanges,
  applyCommit,
  continueApplying,
  getVersion,
  git,
  gitBytes,
  listConflicts,
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

  it('reverts a commit’s files named, uncommitted, a rename as one, the rest as they were', async () => {
    const { repo } = repository();
    write(repo, { 'a.txt': 'one\ntwo\nthree\nfour\nfive\n', 'b.txt': 'b\n', 'old.txt': 'moved\n' });
    const before = commit(repo, 'before');
    write(repo, { 'a.txt': 'one\ntwo\nTHREE\nfour\nfive\n', 'b.txt': 'B\n', 'new.txt': 'new\n' });
    run(repo, 'mv', 'old.txt', 'moved.txt');
    const after = commit(repo, 'after');
    // Lines added above it since: still undone, where its lines are now.
    write(repo, { 'a.txt': 'zero\none\ntwo\nTHREE\nfour\nfive\n' });
    await applyChanges(
      repo,
      { from: before, to: after },
      ['a.txt', 'new.txt', 'old.txt', 'moved.txt'],
      true,
      git,
    );
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('zero\none\ntwo\nthree\nfour\nfive\n');
    const status = run(repo, 'status', '--porcelain', '--untracked-files=all');
    expect(
      status
        .split('\n')
        .map((line) => line.trim())
        .sort(),
    ).toEqual(['?? old.txt', 'D moved.txt', 'D new.txt', 'M a.txt']);
    expect(run(repo, 'diff', '--', 'a.txt')).toContain('-THREE\n+three');
    // b.txt, not named: as it was, and nothing committed.
    expect(run(repo, 'show', 'HEAD:b.txt')).toBe('B');
    expect(subjects(repo)[0]).toBe('after');
  });

  it('cherry-picks a commit’s files named onto the files as they are, uncommitted', async () => {
    const { repo } = repository();
    write(repo, { 'a.txt': 'one\ntwo\nthree\nfour\nfive\n' });
    const before = commit(repo, 'before');
    run(repo, 'checkout', '-q', '-b', 'other');
    write(repo, { 'a.txt': 'one\ntwo\nTHREE\nfour\nfive\n', 'b.txt': 'B\n' });
    const after = commit(repo, 'after');
    run(repo, 'checkout', '-q', 'main');
    // Lines added above it here: still applied, where its lines are.
    write(repo, { 'a.txt': 'zero\none\ntwo\nthree\nfour\nfive\n' });
    await applyChanges(repo, { from: before, to: after }, ['a.txt'], false, git);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('zero\none\ntwo\nTHREE\nfour\nfive\n');
    // b.txt, not named, as it was; nothing committed.
    expect(run(repo, 'status', '--porcelain')).toBe('M a.txt');
    expect(subjects(repo)[0]).toBe('before');
  });

  it('changes nothing when a file changed since where the commit did', async () => {
    const { repo } = repository();
    const before = run(repo, 'rev-parse', 'HEAD');
    write(repo, { 'a.txt': 'again\n' });
    const after = commit(repo, 'again');
    write(repo, { 'a.txt': 'mine\n' });
    await expect(
      applyChanges(repo, { from: before, to: after }, ['a.txt'], true, git),
    ).rejects.toThrow(/patch does not apply/);
    expect(run(repo, 'diff', '--', 'a.txt')).toContain('+mine');
    // A file the commit didn't change: nothing to undo.
    await applyChanges(repo, { from: before, to: after }, ['b.txt'], true, git);
  });

  it('gets a file as a commit has it, or deletes it where the commit hasn’t it', async () => {
    const { repo } = repository();
    mkdirSync(join(repo, 'src'));
    write(repo, { 'a.txt': 'then a\n', 'src/c.txt': 'then\n' });
    const then = commit(repo, 'then');
    write(repo, { 'a.txt': 'mine\n' });
    rmSync(join(repo, 'src'), { recursive: true });
    // Over a local change, and into a folder that's gone: as the commit has them, unstaged.
    await getVersion(repo, then, 'a.txt', git, gitBytes);
    await getVersion(repo, then, 'src/c.txt', git, gitBytes);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('then a\n');
    expect(readFileSync(join(repo, 'src/c.txt'), 'utf8')).toBe('then\n');
    expect(run(repo, 'status', '--porcelain')).toBe('');
    // Not in the commit: deleted.
    write(repo, { 'new.txt': 'new\n' });
    await getVersion(repo, then, 'new.txt', git, gitBytes);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
    // A commit git can't read: it fails, and the file stays.
    write(repo, { 'a.txt': 'kept\n' });
    await expect(getVersion(repo, 'deadbeef', 'a.txt', git, gitBytes)).rejects.toThrow();
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('kept\n');
  });
});
