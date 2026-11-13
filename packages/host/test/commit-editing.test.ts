import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { drop, editCheck, git, reword, undoEdit, type Git } from '../src/index.js';

describe('Edit Commit Message and Drop Commit, with real git', () => {
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
    const head = run('rev-parse', 'HEAD');
    const made = await reword(repo, third, 'three, better', third, git);
    expect(made).toEqual({ commit: run('rev-parse', 'HEAD'), head: run('rev-parse', 'HEAD') });
    expect(made.head).not.toBe(head);
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
    const made = await reword(repo, second, 'two, better\n\nnew body', third, git);
    expect(made).toEqual({ commit: run('rev-parse', 'HEAD~1'), head: run('rev-parse', 'HEAD') });
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

  it('signs the commits it makes where commit.gpgSign is set, as git commit would', async () => {
    // A signer that fails: each edit tries it, and changes nothing.
    run('config', 'commit.gpgSign', 'true');
    run('config', 'gpg.program', 'false');
    try {
      await expect(reword(repo, second, 'no', third, git)).rejects.toThrow(/gpg failed to sign/);
      await expect(drop(repo, second, third, git)).rejects.toThrow(/gpg failed to sign/);
      expect(run('rev-parse', 'HEAD')).toBe(third);
    } finally {
      run('config', '--unset', 'commit.gpgSign');
      run('config', '--unset', 'gpg.program');
    }
  });

  describe('after, as IntelliJ’s: notes copied, and the post-rewrite hook run', () => {
    const told = join(repo, '.git', 'told.txt');
    beforeEach(() => {
      // A hook that writes down what it's told.
      const hook = join(repo, '.git', 'hooks', 'post-rewrite');
      writeFileSync(hook, `#!/bin/sh\necho "$*" > '${told}'\ncat >> '${told}'\n`);
      chmodSync(hook, 0o755);
      // Notes follow a rewrite only where it's set (git's).
      run('config', 'notes.rewriteRef', 'refs/notes/commits');
      return () => {
        rmSync(hook);
        rmSync(told, { force: true });
        run('update-ref', '-d', 'refs/notes/commits');
        run('config', '--unset', 'notes.rewriteRef');
      };
    });

    it('tells which commits a reword made again from which', async () => {
      run('notes', 'add', '-m', 'a note', second);
      const { commit, head } = await reword(repo, second, 'two, better', third, git);
      expect(run('notes', 'show', commit)).toBe('a note');
      expect(readFileSync(told, 'utf8')).toBe(`rebase\n${second} ${commit}\n${third} ${head}\n`);
    });

    it('tells which a drop made again, one left empty become the one before it', async () => {
      // A commit that only undoes the one dropped.
      run('rm', '-q', 'three.txt');
      run('commit', '-qm', 'undo three');
      const undo = run('rev-parse', 'HEAD');
      expect(await drop(repo, third, undo, git)).toBe(second);
      expect(readFileSync(told, 'utf8')).toBe(`rebase\n${undo} ${second}\n`);
      // HEAD's dropped: nothing made again, nothing told.
      rmSync(told);
      await drop(repo, second, second, git);
      expect(() => readFileSync(told)).toThrow();
      // The first dropped, the next only undoing it: nothing before it to become.
      run('checkout', '-q', '--orphan', 'alone');
      run('rm', '-rq', '--cached', '.');
      writeFileSync(join(repo, 'alone.txt'), 'alone\n');
      run('add', 'alone.txt');
      run('commit', '-qm', 'alone');
      const alone = run('rev-parse', 'HEAD');
      run('rm', '-q', 'alone.txt');
      run('commit', '-qm', 'undo alone');
      await drop(repo, alone, run('rev-parse', 'HEAD'), git);
      expect(run('log', '--format=%T %P|%B', 'alone')).toBe(
        '4b825dc642cb6eb9a060e54bf8d69288fbee4904 |',
      );
      expect(() => readFileSync(told)).toThrow();
      run('checkout', '-q', '-f', 'main');
      run('branch', '-q', '-D', 'alone');
      run('clean', '-qfd');
    });

    it('logs their failures, the edit done', async () => {
      const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failing: Git = async (cwd, args, env, input) => {
        if (args[0] === 'notes' || args[0] === 'hook') throw new Error('failed');
        return git(cwd, args, env, input);
      };
      const { head } = await reword(repo, second, 'two, better', third, failing);
      expect(run('rev-parse', 'HEAD')).toBe(head);
      expect(failed.mock.calls.map((call) => String(call[0]))).toEqual([
        'Copying the notes after a commit edit failed',
        'The post-rewrite hook after a commit edit failed',
      ]);
      failed.mockRestore();
    });
  });

  describe('its checks, in IntelliJ’s words', () => {
    it('gives HEAD’s commit where it can be done', async () => {
      expect(await editCheck(repo, first, 'reword', nobody, git)).toEqual({ head: third });
    });

    it('refuses a commit not in the current branch', async () => {
      run('checkout', '-q', '-b', 'side', first);
      const side = commit('elsewhere');
      run('checkout', '-q', 'main');
      expect(await editCheck(repo, side, 'reword', nobody, git)).toEqual({
        refused: 'The commit is not in the current branch',
      });
    });

    it('refuses a commit on a protected branch of a remote', async () => {
      run('update-ref', 'refs/remotes/origin/main', second);
      const named = (name: string) => name === 'main';
      expect(await editCheck(repo, first, 'reword', named, git)).toEqual({
        refused: "The commit is already pushed to protected branch 'origin/main'",
      });
      expect(await editCheck(repo, third, 'reword', named, git)).toEqual({ head: third });
    });

    it('refuses while something’s under way, but a rebase allows HEAD’s commit', async () => {
      writeFileSync(join(repo, '.git', 'MERGE_HEAD'), `${first}\n`);
      expect(await editCheck(repo, third, 'reword', nobody, git)).toEqual({
        refused: 'Cannot reword during merge',
      });
      rmSync(join(repo, '.git', 'MERGE_HEAD'));
      mkdirSync(join(repo, '.git', 'rebase-merge'));
      expect(await editCheck(repo, second, 'reword', nobody, git)).toEqual({
        refused: 'Cannot reword during rebase',
      });
      expect(await editCheck(repo, third, 'reword', nobody, git)).toEqual({ head: third });
      // Dropping, not even HEAD's.
      expect(await editCheck(repo, third, 'drop', nobody, git)).toEqual({
        refused: 'Cannot drop during rebase',
      });
    });
  });

  describe('Undo, from the notification', () => {
    it('puts HEAD back where it was, local changes kept', async () => {
      const { head } = await reword(repo, second, 'two, better', third, git);
      writeFileSync(join(repo, 'one.txt'), 'local\n');
      expect(await undoEdit(repo, third, head, nobody, git)).toBeNull();
      expect(run('rev-parse', 'main')).toBe(third);
      expect(run('status', '--porcelain')).toBe('M one.txt');
      run('checkout', '--', 'one.txt');
      // A drop of HEAD's commit made none: undone as well.
      const dropped = await drop(repo, third, third, git);
      expect(await undoEdit(repo, third, dropped, nobody, git)).toBeNull();
      expect(run('log', '--format=%s', 'main')).toBe('three\ntwo\none');
    });

    it('refuses in IntelliJ’s words once HEAD has moved, or what it made is protected', async () => {
      const { head } = await reword(repo, second, 'two, better', third, git);
      expect(await undoEdit(repo, third, second, nobody, git)).toEqual({
        refused: 'Repository has already been changed',
      });
      run('update-ref', 'refs/remotes/origin/main', head);
      const named = (name: string) => name === 'main';
      expect(await undoEdit(repo, third, head, named, git)).toEqual({
        refused:
          'Commits from current branch have already been pushed to protected branch origin/main',
      });
      expect(run('rev-parse', 'main')).toBe(head);
    });

    it('fails in git’s words where local changes would be lost', async () => {
      const dropped = await drop(repo, second, third, git);
      writeFileSync(join(repo, 'two.txt'), 'local\n');
      await expect(undoEdit(repo, third, dropped, nobody, git)).rejects.toThrow(/two\.txt/);
      expect(run('rev-parse', 'HEAD')).toBe(dropped);
      rmSync(join(repo, 'two.txt'));
    });
  });

  describe('Drop Commit', () => {
    it('drops a commit, each later one’s changes applied on what’s before it, local changes kept', async () => {
      writeFileSync(join(repo, 'one.txt'), 'local\n');
      expect(await drop(repo, second, third, git)).toBe(run('rev-parse', 'HEAD'));
      expect(run('log', '--format=%s', 'main')).toBe('three\none');
      expect(run('ls-tree', '--name-only', 'HEAD')).toBe('one.txt\nthree.txt');
      expect(show('%an %ad', 'HEAD')).toBe(show('%an %ad', third));
      expect(run('status', '--porcelain')).toBe('M one.txt');
      expect(run('reflog', '-1', '--format=%gs')).toBe(`drop ${second} by Cerebro: updating HEAD`);
    });

    it('drops HEAD’s commit, and the first, the next made the first', async () => {
      await drop(repo, third, third, git);
      expect(run('log', '--format=%s', 'main')).toBe('two\none');
      run('reset', '-q', '--hard', third);
      await drop(repo, first, third, git);
      expect(run('log', '--format=%s %P', 'main')).toBe(`three ${run('rev-parse', 'HEAD~1')}\ntwo`);
      expect(run('ls-tree', '--name-only', 'HEAD')).toBe('three.txt\ntwo.txt');
    });

    it('drops a later commit left with no changes of its own, and leaves an empty commit if none’s left', async () => {
      // A commit that only undoes the one dropped.
      run('rm', '-q', 'three.txt');
      run('commit', '-qm', 'undo three');
      await drop(repo, third, run('rev-parse', 'HEAD'), git);
      expect(run('log', '--format=%s', 'main')).toBe('two\none');
      // The only commit there is, dropped.
      run('checkout', '-q', '--orphan', 'alone');
      run('rm', '-rq', '--cached', '.');
      writeFileSync(join(repo, 'alone.txt'), 'alone\n');
      run('add', 'alone.txt');
      run('commit', '-qm', 'alone');
      const alone = run('rev-parse', 'HEAD');
      await drop(repo, alone, alone, git);
      expect(run('log', '--format=%T %P|%B', 'alone')).toBe(
        '4b825dc642cb6eb9a060e54bf8d69288fbee4904 |',
      );
      run('checkout', '-q', '-f', 'main');
      run('branch', '-q', '-D', 'alone');
      run('clean', '-qfd');
    });

    it('changes nothing where a later commit’s changes conflict, saying where', async () => {
      writeFileSync(join(repo, 'two.txt'), 'two, again\n');
      run('commit', '-qam', 'two again');
      const head = run('rev-parse', 'HEAD');
      await expect(drop(repo, second, head, git)).rejects.toThrow(
        'CONFLICT (modify/delete): two.txt deleted in',
      );
      expect(run('rev-parse', 'HEAD')).toBe(head);
    });

    it('changes nothing where local changes would be lost, in git’s words, or HEAD moved', async () => {
      writeFileSync(join(repo, 'two.txt'), 'local\n');
      await expect(drop(repo, second, third, git)).rejects.toThrow(/two\.txt/);
      expect(run('rev-parse', 'HEAD')).toBe(third);
      run('checkout', '--', 'two.txt');
      await expect(drop(repo, second, second, git)).rejects.toThrow(
        'HEAD moved during the commit editing operation',
      );
    });
  });
});
