import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { git, listShelves, listStashes, savedMessage, update } from '../src/index.js';

describe('updating the project, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-update-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const commit = (cwd: string, message: string, file = `${message}.txt`, text = message) => {
    writeFileSync(join(cwd, file), text);
    run(cwd, 'add', '.');
    run(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
  };
  /**
   * A repository whose `main` tracks `origin/main`, with a shared file; and another clone, whose
   * pushes are what the update brings.
   */
  let clones = 0;
  const cloned = () => {
    const name = `r${String(++clones)}`;
    const remote = join(root, `${name}.git`);
    const repo = join(root, name);
    const other = join(root, `${name}-other`);
    run(root, 'init', '-q', '--bare', '-b', 'main', remote);
    run(root, 'init', '-q', '-b', 'main', repo);
    // The text as written, on every machine.
    run(repo, 'config', 'core.autocrlf', 'false');
    commit(repo, 'first', 'shared.txt', 'one\ntwo\nthree\n');
    run(repo, 'remote', 'add', 'origin', remote);
    run(repo, 'push', '-q', '-u', 'origin', 'main');
    run(root, 'clone', '-q', '-c', 'core.autocrlf=false', remote, other);
    /** A commit pushed from the other clone. */
    const upstream = (message: string, file?: string, text?: string) => {
      commit(other, message, file, text);
      run(other, 'push', '-q', 'origin', 'main');
    };
    return { repo, upstream };
  };
  const merge = { method: 'merge', save: 'shelve' } as const;
  const rebase = { method: 'rebase', save: 'shelve' } as const;
  const subjects = (repo: string) => run(repo, 'log', '--format=%s').trim().split('\n');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('says when there’s no branch, no upstream, or nothing to bring', async () => {
    const { repo } = cloned();
    expect(await update(repo, merge, git, git)).toEqual({ kind: 'nothing' });
    run(repo, 'checkout', '-q', '-b', 'alone');
    expect(await update(repo, merge, git, git)).toEqual({ kind: 'noUpstream', branch: 'alone' });
    run(repo, 'checkout', '-q', '--detach');
    expect(await update(repo, merge, git, git)).toEqual({ kind: 'detached' });
  });

  it('fetches with the remote commands’ git, and merges what the upstream brings', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    upstream('more');
    commit(repo, 'mine');
    const remote = vi.fn(git);
    expect(await update(repo, merge, git, remote)).toEqual({
      kind: 'updated',
      files: 2,
      commits: 2,
      restored: true,
    });
    expect(remote).toHaveBeenCalledWith(repo, ['fetch', '--quiet', '--end-of-options', 'origin'], {
      GIT_TERMINAL_PROMPT: '0',
    });
    expect(subjects(repo)[0]).toMatch(/^Merge /);
  });

  it('rebases the branch on the upstream', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    commit(repo, 'mine');
    expect(await update(repo, rebase, git, git)).toMatchObject({ kind: 'updated', commits: 1 });
    expect(subjects(repo)).toEqual(['mine', 'theirs', 'first']);
  });

  it('saves local changes only when they’re in the way of a merge, and puts them back', async () => {
    const { repo, upstream } = cloned();
    const lines = (...changed: [number, string][]) => {
      const text = ['1', '2', '3', '4', '5', '6', '7', '8'];
      for (const [at, line] of changed) text[at] = line;
      return `${text.join('\n')}\n`;
    };
    upstream('long', 'long.txt', lines());
    // A change to a file the upstream didn't change isn't in the way.
    writeFileSync(join(repo, 'shared.txt'), 'one\ntwo\nthree\nfour\n');
    expect(await update(repo, merge, git, git)).toMatchObject({ kind: 'updated', restored: true });
    expect(await listShelves(repo, git)).toEqual([]);
    // One the upstream changed is: shelved, then unshelved.
    writeFileSync(join(repo, 'long.txt'), lines([7, 'eight']));
    upstream('also', 'long.txt', lines([0, 'one']));
    const at = new Date(2026, 10, 9, 10, 30);
    expect(await update(repo, { ...merge, now: at }, git, git)).toMatchObject({
      kind: 'updated',
      restored: true,
    });
    expect(readFileSync(join(repo, 'long.txt'), 'utf8')).toBe(lines([0, 'one'], [7, 'eight']));
    expect(await listShelves(repo, git)).toEqual([]);
    expect(savedMessage(at)).toBe(`Uncommitted changes before Update at ${at.toLocaleString()}`);
  });

  it('saves them for a merge when the index has changes, in a stash when asked', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    writeFileSync(join(repo, 'staged.txt'), 'staged');
    run(repo, 'add', 'staged.txt');
    expect(await update(repo, { ...merge, save: 'stash' }, git, git)).toMatchObject({
      kind: 'updated',
      restored: true,
    });
    // Put back with the index as it was.
    expect(run(repo, 'status', '--porcelain')).toBe('A  staged.txt\n');
    expect(await listStashes(repo, git)).toEqual([]);
  });

  it('fast-forwards a rebase with local changes without saving them', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    writeFileSync(join(repo, 'shared.txt'), 'changed\n');
    const run = vi.fn(git);
    expect(await update(repo, rebase, run, git)).toMatchObject({ kind: 'updated', commits: 1 });
    expect(run.mock.calls.some(([, args]) => args.includes('rebase'))).toBe(false);
    expect(await listShelves(repo, git)).toEqual([]);
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('changed\n');
  });

  it('saves local changes for a rebase that isn’t a fast-forward; untracked files stay', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs');
    commit(repo, 'mine');
    writeFileSync(join(repo, 'shared.txt'), 'changed\n');
    writeFileSync(join(repo, 'new.txt'), 'new');
    expect(await update(repo, rebase, git, git)).toMatchObject({ kind: 'updated', restored: true });
    expect(subjects(repo)).toEqual(['mine', 'theirs', 'first']);
    expect(run(repo, 'status', '--porcelain')).toBe(' M shared.txt\n?? new.txt\n');
  });

  it('keeps the changes saved when they don’t go back over the update', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'shared.txt', 'ONE\ntwo\nthree\n');
    writeFileSync(join(repo, 'shared.txt'), 'uno\ntwo\nthree\n');
    expect(await update(repo, merge, git, git)).toMatchObject({ kind: 'updated', restored: false });
    expect((await listShelves(repo, git)).map((s) => s.message)).toEqual([
      expect.stringMatching(/^Uncommitted changes before Update at /) as string,
    ]);
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('ONE\ntwo\nthree\n');
  });

  it('stops at a merge’s conflicts, then won’t update until they’re resolved', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'shared.txt', 'ONE\ntwo\nthree\n');
    commit(repo, 'mine', 'shared.txt', 'uno\ntwo\nthree\n');
    expect(await update(repo, merge, git, git)).toEqual({
      kind: 'conflicts',
      method: 'merge',
      saved: false,
    });
    expect(await update(repo, merge, git, git)).toEqual({ kind: 'unfinished', state: 'merge' });
  });

  it('stops at a rebase’s conflicts, its local changes kept saved', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'shared.txt', 'ONE\ntwo\nthree\n');
    commit(repo, 'mine', 'shared.txt', 'uno\ntwo\nthree\n');
    writeFileSync(join(repo, 'other.txt'), 'changed');
    run(repo, 'add', 'other.txt');
    expect(await update(repo, rebase, git, git)).toEqual({
      kind: 'conflicts',
      method: 'rebase',
      saved: true,
    });
    expect(await listShelves(repo, git)).toHaveLength(1);
    expect(await update(repo, rebase, git, git)).toEqual({ kind: 'unfinished', state: 'rebase' });
  });

  it('won’t update with files unmerged', async () => {
    const { repo } = cloned();
    writeFileSync(join(repo, 'shared.txt'), 'stashed\n');
    run(repo, 'stash', '-q');
    commit(repo, 'mine', 'shared.txt', 'committed\n');
    expect(() => run(repo, 'stash', 'pop', '-q')).toThrow();
    expect(await update(repo, merge, git, git)).toEqual({ kind: 'unfinished', state: 'unmerged' });
  });

  it('fails as git does when the merge can’t start, the changes saved put back', async () => {
    const { repo, upstream } = cloned();
    upstream('theirs', 'theirs.txt', 'theirs');
    writeFileSync(join(repo, 'theirs.txt'), 'untracked here');
    writeFileSync(join(repo, 'staged.txt'), 'staged');
    run(repo, 'add', 'staged.txt');
    await expect(update(repo, merge, git, git)).rejects.toThrow(/untracked working tree files/);
    expect(await listShelves(repo, git)).toEqual([]);
    // Unshelved, an added file is back, though not added (the shelf's way).
    expect(run(repo, 'status', '--porcelain')).toBe('?? staged.txt\n?? theirs.txt\n');
  });
});
