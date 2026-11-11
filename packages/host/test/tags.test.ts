import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createTag, git, listTags, resolveRevision, validRevision } from '../src/index.js';

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
});
