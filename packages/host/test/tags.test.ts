import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createTag,
  deleteRemoteTag,
  deleteTag,
  git,
  listTags,
  pushTag,
  resolveRevision,
  restoreTag,
  validRevision,
} from '../src/index.js';

describe('tags, with real git', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-tags-')));
  const run = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' }).trim();
  run('init', '-q', '-b', 'main');
  // Someone an annotated tag is made by (CI's git has no one).
  run('config', 'user.name', 't');
  run('config', 'user.email', 't@t');
  run('commit', '-q', '--allow-empty', '-m', 'first');
  run('commit', '-q', '--allow-empty', '-m', 'second');

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('makes a lightweight tag of HEAD, and lists it', async () => {
    expect(await listTags(repo, git)).toEqual([]);
    await createTag(repo, { name: 'v1', force: false }, git);
    expect(run('cat-file', '-t', 'v1')).toBe('commit');
    expect(run('rev-parse', 'v1')).toBe(run('rev-parse', 'HEAD'));
    expect(await listTags(repo, git)).toEqual(['v1']);
  });

  it('makes an annotated tag of another commit, its message as typed', async () => {
    await createTag(
      repo,
      { name: 'v0', commit: 'HEAD~1', message: 'The # first\n', force: false },
      git,
    );
    expect(run('cat-file', '-t', 'v0')).toBe('tag');
    expect(run('rev-parse', 'v0^{commit}')).toBe(run('rev-parse', 'HEAD~1'));
    expect(run('tag', '-l', '--format=%(contents)', 'v0')).toBe('The # first');
  });

  it('fails on a tag taken, unless forced', async () => {
    await expect(
      createTag(repo, { name: 'v1', commit: 'HEAD~1', force: false }, git),
    ).rejects.toThrow(/already exists/);
    await createTag(repo, { name: 'v1', commit: 'HEAD~1', force: true }, git);
    expect(run('rev-parse', 'v1')).toBe(run('rev-parse', 'HEAD~1'));
  });

  it('takes a name that looks like an option as a name', async () => {
    await expect(createTag(repo, { name: '-d', force: false }, git)).rejects.toThrow(
      /not a valid tag name/,
    );
    expect(await listTags(repo, git)).toEqual(['v0', 'v1']);
  });

  it('says whether a revision names something git knows', async () => {
    expect(await validRevision(repo, 'HEAD~1', git)).toBe(true);
    expect(await validRevision(repo, 'v0', git)).toBe(true);
    expect(await validRevision(repo, 'nowhere', git)).toBe(false);
    expect(await validRevision(repo, '--all', git)).toBe(false);
  });

  it('gives the commit a hash’s start, a branch or a tag names, an annotated tag’s too', async () => {
    const first = run('rev-parse', 'HEAD~1').trim();
    expect(await resolveRevision(repo, first.slice(0, 7), git)).toBe(first);
    expect(await resolveRevision(repo, 'main', git)).toBe(run('rev-parse', 'HEAD').trim());
    // v0 is annotated: its commit, not the tag's object.
    expect(await resolveRevision(repo, 'v0', git)).toBe(first);
    expect(await resolveRevision(repo, 'nowhere', git)).toBeUndefined();
    expect(await resolveRevision(repo, '--all', git)).toBeUndefined();
  });

  it('deletes a tag, keeping what it pointed at, and restores it as it was, annotated or not', async () => {
    const object = run('rev-parse', 'refs/tags/v0');
    const deleted = await deleteTag(repo, 'v0', git);
    expect(deleted).toEqual({ hash: object, remotes: 0 });
    expect(await listTags(repo, git)).toEqual(['v1']);
    await restoreTag(repo, 'v0', deleted.hash, git);
    expect(run('cat-file', '-t', 'v0')).toBe('tag');
    expect(run('tag', '-l', '--format=%(contents)', 'v0')).toBe('The # first');
    const light = await deleteTag(repo, 'v1', git);
    await restoreTag(repo, 'v1', light.hash, git);
    expect(run('rev-parse', 'v1')).toBe(run('rev-parse', 'HEAD~1'));
  });

  it('says why a tag wasn’t deleted', async () => {
    await expect(deleteTag(repo, 'nowhere', git)).rejects.toThrow(/Needed a single revision/);
  });
});

describe('a tag deleted on the remotes, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-remote-tags-')));
  const at = (...path: string[]) => join(root, ...path);
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();
  for (const bare of ['origin', 'other', 'moved']) run(root, 'init', '-q', '--bare', bare);
  run(root, 'init', '-q', '-b', 'main', 'work');
  const work = at('work');
  run(
    work,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'one',
  );
  run(
    work,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'two',
  );
  for (const remote of ['origin', 'other', 'moved']) run(work, 'remote', 'add', remote, at(remote));
  run(work, 'tag', 'v1', 'HEAD~1');
  run(work, 'push', '-q', 'origin', 'v1');
  // `moved` has v1 elsewhere: what's deleted here isn't what it has.
  run(work, 'push', '-q', 'moved', 'HEAD:refs/tags/v1');

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('deletes it where the remote has it at what it pointed at here; says where it couldn’t', async () => {
    const deleted = await deleteTag(work, 'v1', git);
    expect(deleted.remotes).toBe(3);
    expect(await deleteRemoteTag(work, 'v1', deleted.hash, git, git)).toEqual({
      deleted: ['origin'],
      failed: [{ remote: 'moved', error: expect.stringMatching(/stale info/) as string }],
    });
    expect(run(at('origin'), 'tag')).toBe('');
    expect(run(at('moved'), 'tag')).toBe('v1');
    // Again: on no remote, nothing to delete.
    expect(await deleteRemoteTag(work, 'v1', deleted.hash, git, git)).toEqual({
      deleted: [],
      failed: [{ remote: 'moved', error: expect.stringMatching(/stale info/) as string }],
    });
  });

  it('pushes a tag alone to a remote; not again when it has it; says why one has it elsewhere', async () => {
    run(work, 'tag', 'v2', 'HEAD~1');
    expect(await pushTag(work, 'v2', 'other', git)).toBe(true);
    expect(run(at('other'), 'tag')).toBe('v2');
    // The tag alone: not the branch.
    expect(run(at('other'), 'branch')).toBe('');
    expect(await pushTag(work, 'v2', 'other', git)).toBe(false);
    // `moved` has v2 elsewhere: git refuses, and the ref it refused comes first.
    run(work, 'push', '-q', 'moved', 'HEAD:refs/tags/v2');
    run(work, 'tag', '-f', 'v2', 'HEAD~1');
    await expect(pushTag(work, 'v2', 'moved', git)).rejects.toThrow(
      /^!\trefs\/tags\/v2:refs\/tags\/v2\t\[rejected\] \(already exists\)/,
    );
  });
});
