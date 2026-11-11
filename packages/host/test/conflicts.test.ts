import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  abortOperation,
  acceptSide,
  continueOperation,
  git,
  listConflicts,
  mergeRevisions,
  operation,
  repositoryState,
  resolveWith,
  skipCommit,
} from '../src/index.js';

describe('merge conflicts, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-conflicts-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const tryRun = (cwd: string, ...args: string[]) => {
    try {
      run(cwd, ...args);
    } catch {
      // Stopped at conflicts, as meant.
    }
  };
  const write = (cwd: string, files: Record<string, string>) => {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  };
  const commit = (cwd: string, message: string) => {
    run(cwd, 'add', '-A');
    run(cwd, 'commit', '-qm', message);
  };
  /**
   * A repository whose `feature` and `main` both changed `f.txt` and `g.txt` since `base`; `main`
   * deleted `del.txt`, which `feature` changed.
   */
  let repos = 0;
  const diverged = () => {
    const repo = join(root, `r${String(++repos)}`);
    run(root, 'init', '-q', '-b', 'main', repo);
    run(repo, 'config', 'core.autocrlf', 'false');
    run(repo, 'config', 'user.name', 't');
    run(repo, 'config', 'user.email', 't@t');
    write(repo, { 'f.txt': 'a\nb\nc\n', 'g.txt': 'x\n', 'del.txt': 'd\n' });
    commit(repo, 'base');
    run(repo, 'checkout', '-q', '-b', 'feature');
    write(repo, { 'f.txt': 'a\nB-feature\nc\n', 'g.txt': 'y\n', 'del.txt': 'changed\n' });
    commit(repo, 'feat');
    run(repo, 'checkout', '-q', 'main');
    write(repo, { 'f.txt': 'a\nB-main\nc\n', 'g.txt': 'z\n' });
    run(repo, 'rm', '-q', 'del.txt');
    commit(repo, 'main change');
    return repo;
  };
  const merging = () => {
    const repo = diverged();
    tryRun(repo, 'merge', 'feature');
    return repo;
  };
  const rebasing = (...options: string[]) => {
    const repo = diverged();
    run(repo, 'checkout', '-q', 'feature');
    tryRun(repo, 'rebase', ...options, 'main');
    return repo;
  };
  const read = (repo: string, file: string) => readFileSync(join(repo, file), 'utf8');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists a merge’s conflicts, with the branches merged', async () => {
    const repo = merging();
    expect(await listConflicts(repo, git)).toEqual({
      operation: 'merge',
      yours: 'main',
      theirs: 'feature',
      files: [
        { path: 'del.txt', yours: 'deleted', theirs: 'modified' },
        { path: 'f.txt', yours: 'modified', theirs: 'modified' },
        { path: 'g.txt', yours: 'modified', theirs: 'modified' },
      ],
    });
  });

  it('names a merge without a branch: no yours, theirs as git’s message has it, or its commit', async () => {
    const repo = diverged();
    run(repo, 'checkout', '-q', '--detach');
    tryRun(repo, 'merge', 'feature');
    const conflicts = await listConflicts(repo, git);
    expect(conflicts).toMatchObject({ operation: 'merge', theirs: 'feature' });
    expect(conflicts).not.toHaveProperty('yours');
    rmSync(join(repo, '.git', 'MERGE_MSG'));
    const merged = run(repo, 'rev-parse', '--short', 'feature').trim();
    expect(await listConflicts(repo, git)).toMatchObject({ theirs: merged });
  });

  it('lists a rebase’s, its sides swapped as IntelliJ’s, with the commit replayed', async () => {
    const repo = rebasing();
    const onto = run(repo, 'rev-parse', '--short', 'main').trim();
    const conflicts = await listConflicts(repo, git);
    expect(conflicts).toMatchObject({
      operation: 'rebase',
      yours: 'feature',
      theirs: 'main',
      onto,
      commit: { author: 't', message: 'feat' },
    });
    expect(conflicts.files[0]).toEqual({ path: 'del.txt', yours: 'modified', theirs: 'deleted' });
  });

  it('lists an older rebase’s, and none of a branch where several branches point', async () => {
    const repo = diverged();
    run(repo, 'branch', 'twin', 'main');
    run(repo, 'checkout', '-q', '--detach', 'feature');
    tryRun(repo, 'rebase', '--apply', 'main');
    const conflicts = await listConflicts(repo, git);
    expect(conflicts.operation).toBe('rebase');
    expect(conflicts).not.toHaveProperty('yours');
    expect(conflicts).not.toHaveProperty('theirs');
    expect(conflicts.onto).toBe(run(repo, 'rev-parse', '--short', 'main').trim());
  });

  it('lists unmerged files with nothing under way: a stash that didn’t go back', async () => {
    const repo = diverged();
    write(repo, { 'f.txt': 'stashed\n' });
    run(repo, 'stash', '-q');
    write(repo, { 'f.txt': 'committed\n' });
    commit(repo, 'mine');
    tryRun(repo, 'stash', 'pop', '-q');
    expect(await operation(repo, git)).toBeUndefined();
    expect(await listConflicts(repo, git)).toEqual({
      operation: undefined,
      files: [{ path: 'f.txt', yours: 'modified', theirs: 'modified' }],
    });
  });

  it('gives a file’s three versions, the sides swapped during a rebase', async () => {
    expect(await mergeRevisions(merging(), 'f.txt', git)).toEqual({
      binary: false,
      base: 'a\nb\nc\n',
      yours: 'a\nB-main\nc\n',
      theirs: 'a\nB-feature\nc\n',
    });
    const repo = rebasing();
    expect(await mergeRevisions(repo, 'f.txt', git)).toEqual({
      binary: false,
      base: 'a\nb\nc\n',
      yours: 'a\nB-feature\nc\n',
      theirs: 'a\nB-main\nc\n',
    });
    expect(await mergeRevisions(repo, 'del.txt', git)).toEqual({
      binary: false,
      base: 'd\n',
      yours: 'changed\n',
      theirs: undefined,
    });
  });

  it('gives no base for a file both sides added, and nothing to merge in a binary one', async () => {
    const repo = diverged();
    run(repo, 'checkout', '-q', 'feature');
    write(repo, { 'new.txt': 'feature’s\n', 'bin.dat': 'a\0b' });
    commit(repo, 'added here');
    run(repo, 'checkout', '-q', 'main');
    write(repo, { 'new.txt': 'main’s\n', 'bin.dat': 'a\0c' });
    commit(repo, 'added there');
    tryRun(repo, 'merge', 'feature');
    expect(await mergeRevisions(repo, 'new.txt', git)).toEqual({
      binary: false,
      base: '',
      yours: 'main’s\n',
      theirs: 'feature’s\n',
    });
    expect(await mergeRevisions(repo, 'bin.dat', git)).toEqual({ binary: true });
  });

  it('accepts a side: its text, or the file gone where it deleted it', async () => {
    const repo = merging();
    await acceptSide(repo, ['f.txt', 'del.txt'], 'yours', git);
    expect(read(repo, 'f.txt')).toBe('a\nB-main\nc\n');
    expect(run(repo, 'status', '--porcelain')).toBe('UU g.txt\n');
    await acceptSide(repo, ['g.txt'], 'theirs', git);
    expect(read(repo, 'g.txt')).toBe('y\n');
    expect((await listConflicts(repo, git)).files).toEqual([]);
    // During a rebase, yours is the commit replayed: git's theirs.
    const rebased = rebasing();
    await acceptSide(rebased, ['f.txt', 'del.txt'], 'yours', git);
    expect(read(rebased, 'f.txt')).toBe('a\nB-feature\nc\n');
    expect(read(rebased, 'del.txt')).toBe('changed\n');
    await acceptSide(rebased, ['g.txt'], 'theirs', git);
    expect(read(rebased, 'g.txt')).toBe('z\n');
    expect((await listConflicts(rebased, git)).files).toEqual([]);
    // Theirs deleted it, so accepting theirs only removes it.
    const gone = rebasing();
    await acceptSide(gone, ['del.txt'], 'theirs', git);
    expect(run(gone, 'status', '--porcelain', '--', 'del.txt')).toBe('');
  });

  it('resolves a file with the text merged', async () => {
    const repo = merging();
    await resolveWith(repo, 'f.txt', 'a\nboth\nc\n', git);
    expect(read(repo, 'f.txt')).toBe('a\nboth\nc\n');
    await expect(resolveWith(repo, '../outside.txt', 'x', git)).rejects.toThrow(
      /isn't in conflict/,
    );
    await expect(resolveWith(repo, 'f.txt', 'again', git)).rejects.toThrow(/isn't in conflict/);
    expect(run(repo, 'diff', '--cached', '--name-only')).toContain('f.txt');
    expect((await listConflicts(repo, git)).files.map((f) => f.path)).toEqual(['del.txt', 'g.txt']);
  });

  it('commits the merge with git’s message, or continues the rebase', async () => {
    const repo = merging();
    await acceptSide(repo, ['f.txt', 'g.txt', 'del.txt'], 'theirs', git);
    expect(await continueOperation(repo, git)).toBe('done');
    expect(run(repo, 'log', '-1', '--format=%s').trim()).toBe("Merge branch 'feature'");
    expect(await operation(repo, git)).toBeUndefined();
    const rebased = rebasing();
    await acceptSide(rebased, ['f.txt', 'g.txt', 'del.txt'], 'yours', git);
    expect(await continueOperation(rebased, git)).toBe('done');
    expect(run(rebased, 'log', '--format=%s').trim().split('\n')).toEqual([
      'feat',
      'main change',
      'base',
    ]);
    // With nothing under way, there's nothing to do.
    expect(await continueOperation(rebased, git)).toBe('done');
  });

  it('says what’s under way, whether files are in conflict, and a merge’s message', async () => {
    const repo = merging();
    expect(await repositoryState(repo, git)).toEqual({
      operation: 'merge',
      conflicts: true,
      message: "Merge branch 'feature'\n\n# Conflicts:\n#\tdel.txt\n#\tf.txt\n#\tg.txt\n",
      remotes: false,
    });
    await acceptSide(repo, ['f.txt', 'g.txt', 'del.txt'], 'yours', git);
    expect(await repositoryState(repo, git)).toMatchObject({
      operation: 'merge',
      conflicts: false,
    });
    expect(await repositoryState(rebasing(), git)).toEqual({
      operation: 'rebase',
      conflicts: true,
      remotes: false,
    });
    const quiet = diverged();
    expect(await repositoryState(quiet, git)).toEqual({
      operation: undefined,
      conflicts: false,
      remotes: false,
    });
    // And whether it has a remote, as IntelliJ's Fetch asks.
    run(quiet, 'remote', 'add', 'origin', 'https://example.com/r.git');
    expect(await repositoryState(quiet, git)).toMatchObject({ remotes: true });
  });

  it('skips the commit a rebase stopped at, as IntelliJ’s Skip Commit', async () => {
    const repo = rebasing();
    expect(await skipCommit(repo, git)).toBe('done');
    expect(await operation(repo, git)).toBeUndefined();
    expect(run(repo, 'log', '--format=%s').trim().split('\n')).toEqual(['main change', 'base']);
  });

  it('aborts a merge or a rebase, back to where it started', async () => {
    const repo = merging();
    await abortOperation(repo, 'merge', git);
    expect(await repositoryState(repo, git)).toEqual({
      operation: undefined,
      conflicts: false,
      remotes: false,
    });
    expect(read(repo, 'f.txt')).toBe('a\nB-main\nc\n');
    const rebased = rebasing();
    await abortOperation(rebased, 'rebase', git);
    expect(await operation(rebased, git)).toBeUndefined();
    expect(run(rebased, 'log', '-1', '--format=%s').trim()).toBe('feat');
    // Nothing to abort: git says so.
    await expect(abortOperation(rebased, 'merge', git)).rejects.toThrow(/MERGE_HEAD missing/);
  });

  it('fails as git does when the rebase can’t continue for another reason', async () => {
    const repo = rebasing();
    await acceptSide(repo, ['f.txt', 'g.txt', 'del.txt'], 'yours', git);
    // A change not added: git won't go on with it.
    write(repo, { 'f.txt': 'not added\n' });
    await expect(continueOperation(repo, git)).rejects.toThrow(/rebase --continue/);
  });
});
