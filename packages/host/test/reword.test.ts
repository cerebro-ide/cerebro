import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { git, reword, rewordCheck, type Git } from '../src/index.js';

describe('Edit Commit Message, with real git', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-reword-')));
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'core.autocrlf', 'false');
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  const commit = (name: string, message = name) => {
    writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
    run('add', '.');
    execFileSync('git', ['commit', '-qm', message], {
      cwd: repo,
      stdio: 'pipe',
      // Another author, at another time, to see both kept.
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Ann Other',
        GIT_AUTHOR_EMAIL: 'ann@x',
        GIT_AUTHOR_DATE: '1700000000 +0200',
      },
    });
    return run('rev-parse', 'HEAD');
  };
  const show = (format: string, at = 'HEAD') => run('log', '-1', `--format=${format}`, at);
  const nobody = () => false;
  const first = commit('one');
  const second = commit('two', 'two\n\nits body');
  const third = commit('three');

  beforeEach(() => {
    run('checkout', '-q', '-B', 'main');
    for (const ref of ['refs/heads/side', 'refs/remotes/origin/main']) {
      run('update-ref', '-d', ref);
    }
    rmSync(join(repo, '.git', 'MERGE_HEAD'), { force: true });
    rmSync(join(repo, '.git', 'rebase-merge'), { recursive: true, force: true });
    run('reset', '-q', '--hard', third);
    // Not set, as git's default.
    run('config', 'commit.cleanup', 'default');
    run('config', '--unset', 'commit.cleanup');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('gives HEAD’s commit the message, its tree, parent and author kept, the files untouched', async () => {
    writeFileSync(join(repo, 'staged.txt'), 'staged\n');
    run('add', 'staged.txt');
    writeFileSync(join(repo, 'one.txt'), 'changed\n');
    await reword(repo, third, 'three, better', third, git);
    expect(show('%B')).toBe('three, better');
    expect(show('%T %P %an <%ae> %ad', 'HEAD')).toBe(
      `${show('%T', third)} ${second} Ann Other <ann@x> ${show('%ad', third)}`,
    );
    expect(run('rev-parse', 'main')).toBe(run('rev-parse', 'HEAD'));
    expect(run('status', '--porcelain')).toBe('M one.txt\nA  staged.txt');
    expect(run('reflog', '-1', '--format=%gs')).toBe(`reword ${third} by Cerebro`);
    run('reset', '-q', '--hard');
  });

  it('gives an older commit the message, each later one made again on it as it was', async () => {
    await reword(repo, second, 'two, better\n\nnew body', third, git);
    expect(run('log', '--format=%s', 'main')).toBe('three\ntwo, better\none');
    expect(show('%B', 'HEAD~1')).toBe('two, better\n\nnew body');
    expect(show('%T', 'HEAD')).toBe(show('%T', third));
    expect(show('%an %ad', 'HEAD')).toBe(show('%an %ad', third));
    expect(run('rev-parse', 'HEAD~2')).toBe(first);
  });

  it('gives the first commit the message, and a detached HEAD moves', async () => {
    run('checkout', '-q', '--detach');
    await reword(repo, first, 'one, better', third, git);
    expect(run('log', '--format=%s', 'HEAD')).toBe('three\ntwo\none, better');
    expect(show('%P', 'HEAD~2')).toBe('');
    expect(run('rev-parse', 'main')).toBe(third);
  });

  it('cleans the message up as git commit would, by commit.cleanup', async () => {
    const message = '\n\nsubject  \n\n\n# a comment\nbody\n\n';
    await reword(repo, third, message, third, git);
    expect(show('%B')).toBe('subject\n\n# a comment\nbody');
    run('config', 'commit.cleanup', 'strip');
    await reword(repo, 'HEAD', message, run('rev-parse', 'HEAD'), git);
    expect(show('%B')).toBe('subject\n\nbody');
    run('config', 'commit.cleanup', 'verbatim');
    await reword(repo, 'HEAD', 'kept  \n', run('rev-parse', 'HEAD'), git);
    const object = execFileSync('git', ['cat-file', 'commit', 'HEAD'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(object.endsWith('\n\nkept  \n')).toBe(true);
  });

  it('keeps a merge’s parents at HEAD, but won’t make one again between the commit and HEAD', async () => {
    run('checkout', '-q', '-b', 'side', second);
    const side = commit('side');
    run('checkout', '-q', 'main');
    run('merge', '-q', '--no-ff', '-m', 'merged', side);
    const merge = run('rev-parse', 'HEAD');
    await expect(reword(repo, second, 'no', merge, git)).rejects.toThrow(
      `Commit ${merge} has 2 parents`,
    );
    expect(run('rev-parse', 'HEAD')).toBe(merge);
    await reword(repo, merge, 'merged, better', merge, git);
    expect(show('%s %P')).toBe(`merged, better ${third} ${side}`);
  });

  it('does nothing to a commit not in the current branch', async () => {
    run('checkout', '-q', '-b', 'side', second);
    const side = commit('aside');
    run('checkout', '-q', 'main');
    await expect(reword(repo, side, 'no', third, git)).rejects.toThrow(
      'The commit is not in the current branch',
    );
    expect(run('rev-parse', 'HEAD')).toBe(third);
  });

  it('does nothing if HEAD has moved since it was checked, or moves while it works', async () => {
    await expect(reword(repo, third, 'no', second, git)).rejects.toThrow(
      'HEAD moved during the commit editing operation',
    );
    // Moved by something else just before the branch is.
    const racing: Git = async (cwd, args, env, input) => {
      if (args[0] === 'update-ref') run('reset', '-q', '--hard', second);
      return git(cwd, args, env, input);
    };
    await expect(reword(repo, third, 'no', third, racing)).rejects.toThrow(
      'HEAD moved during the commit editing operation',
    );
    expect(run('rev-parse', 'HEAD')).toBe(second);
  });

  describe('its checks, in IntelliJ’s words', () => {
    it('gives HEAD’s commit where it can be done', async () => {
      expect(await rewordCheck(repo, first, nobody, git)).toEqual({ head: third });
    });

    it('refuses a commit not in the current branch', async () => {
      run('checkout', '-q', '-b', 'side', first);
      const side = commit('elsewhere');
      run('checkout', '-q', 'main');
      expect(await rewordCheck(repo, side, nobody, git)).toEqual({
        refused: 'The commit is not in the current branch',
      });
    });

    it('refuses a commit on a protected branch of a remote', async () => {
      run('update-ref', 'refs/remotes/origin/main', second);
      const named = (name: string) => name === 'main';
      expect(await rewordCheck(repo, first, named, git)).toEqual({
        refused: "The commit is already pushed to protected branch 'origin/main'",
      });
      expect(await rewordCheck(repo, third, named, git)).toEqual({ head: third });
    });

    it('refuses while something’s under way, but a rebase allows HEAD’s commit', async () => {
      writeFileSync(join(repo, '.git', 'MERGE_HEAD'), `${first}\n`);
      expect(await rewordCheck(repo, third, nobody, git)).toEqual({
        refused: 'Cannot reword during merge',
      });
      rmSync(join(repo, '.git', 'MERGE_HEAD'));
      mkdirSync(join(repo, '.git', 'rebase-merge'));
      expect(await rewordCheck(repo, second, nobody, git)).toEqual({
        refused: 'Cannot reword during rebase',
      });
      expect(await rewordCheck(repo, third, nobody, git)).toEqual({ head: third });
    });
  });
});
