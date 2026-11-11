import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addRemote,
  changeRemote,
  checkRemote,
  divergence,
  fetchTarget,
  listRemotes,
  outgoing,
  push,
  removeRemote,
} from '../src/index.js';

describe('pushing, with real git', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-push-')));
  const run = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
  const commit = (cwd: string, message: string) => {
    writeFileSync(join(cwd, `${message}.txt`), message);
    run(cwd, 'add', '.');
    run(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
  };
  /** A repository with a commit, and a bare remote, `origin`, that has it. */
  const cloned = (name: string) => {
    const remote = join(root, `${name}.git`);
    const repo = join(root, name);
    run(root, 'init', '-q', '--bare', '-b', 'main', remote);
    run(root, 'init', '-q', '-b', 'main', repo);
    commit(repo, 'first');
    run(repo, 'remote', 'add', 'origin', remote);
    run(repo, 'push', '-q', '-u', 'origin', 'main');
    return { repo, remote };
  };

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('sends the commits the upstream doesn’t have, newest first', async () => {
    const { repo, remote } = cloned('upstream');
    expect(await outgoing(repo)).toMatchObject({
      branch: 'main',
      remote: 'origin',
      target: 'main',
      isNew: false,
      commits: [],
    });
    // Nothing to send: nothing pushed.
    expect(await push(repo)).toEqual({
      commits: 0,
      remote: 'origin',
      target: 'main',
      isNew: false,
      forced: false,
      tags: [],
    });
    commit(repo, 'second');
    commit(repo, 'third');
    const out = await outgoing(repo);
    expect(out.commits.map((c) => c.subject)).toEqual(['third', 'second']);
    expect(await push(repo)).toEqual({
      commits: 2,
      remote: 'origin',
      target: 'main',
      isNew: false,
      forced: false,
      tags: [],
    });
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('third');
    expect((await outgoing(repo)).commits).toEqual([]);
  });

  it('makes a new branch on the remote, and its upstream', async () => {
    const { repo, remote } = cloned('new');
    run(repo, 'checkout', '-q', '-b', 'feature');
    commit(repo, 'mine');
    const out = await outgoing(repo);
    expect(out).toMatchObject({
      branch: 'feature',
      remote: 'origin',
      target: 'feature',
      isNew: true,
    });
    // What no branch there has.
    expect(out.commits.map((c) => c.subject)).toEqual(['mine']);
    expect(await push(repo)).toEqual({
      commits: 1,
      remote: 'origin',
      target: 'feature',
      isNew: true,
      forced: false,
      tags: [],
    });
    expect(run(remote, 'log', '-1', '--format=%s', 'feature').trim()).toBe('mine');
    expect(run(repo, 'rev-parse', '--abbrev-ref', 'feature@{u}').trim()).toBe('origin/feature');
  });

  it('pushes to the upstream’s branch, and to the only remote when there’s no origin', async () => {
    const { repo, remote } = cloned('elsewhere');
    run(repo, 'remote', 'rename', 'origin', 'mine');
    run(repo, 'checkout', '-q', '-b', 'local');
    run(repo, 'branch', '-q', '--set-upstream-to=mine/main');
    commit(repo, 'up');
    expect(await outgoing(repo)).toMatchObject({ remote: 'mine', target: 'main', isNew: false });
    await push(repo);
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('up');
    run(repo, 'checkout', '-q', '-b', 'other');
    expect(await outgoing(repo)).toMatchObject({ remote: 'mine', target: 'other', isNew: true });
  });

  it('pushes where it’s told, keeping the upstream unless asked to change it, as IntelliJ’s', async () => {
    const { repo, remote } = cloned('chosen');
    const second = join(root, 'chosen-second.git');
    run(root, 'init', '-q', '--bare', '-b', 'main', second);
    run(repo, 'remote', 'add', 'second', second);
    commit(repo, 'mine');
    expect(await outgoing(repo, undefined, { remote: 'second', target: 'review' })).toMatchObject({
      branch: 'main',
      remote: 'second',
      target: 'review',
      isNew: true,
      remotes: ['origin', 'second'],
      upstream: { remote: 'origin', target: 'main' },
    });
    // New there, but the branch has an upstream: it stays.
    expect(await push(repo, undefined, { remote: 'second', target: 'review' })).toEqual({
      commits: 2,
      remote: 'second',
      target: 'review',
      isNew: true,
      forced: false,
      tags: [],
    });
    expect(run(second, 'log', '-1', '--format=%s', 'review').trim()).toBe('mine');
    expect(run(repo, 'rev-parse', '--abbrev-ref', 'main@{u}').trim()).toBe('origin/main');
    // Asked to: Set upstream, even with nothing to send.
    await push(repo, undefined, { remote: 'second', target: 'review', setUpstream: true });
    expect(run(repo, 'rev-parse', '--abbrev-ref', 'main@{u}').trim()).toBe('second/review');
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('first');
    await expect(outgoing(repo, undefined, { remote: 'nowhere', target: 'main' })).rejects.toThrow(
      'There’s no remote named nowhere',
    );
  });

  it('sends up to a commit of the branch, as Push All up to Here…, its upstream set after', async () => {
    const { repo, remote } = cloned('upTo');
    commit(repo, 'second');
    const second = run(repo, 'rev-parse', 'HEAD').trim();
    commit(repo, 'third');
    expect(
      (await outgoing(repo, undefined, undefined, second)).commits.map((c) => c.subject),
    ).toEqual(['second']);
    expect(await push(repo, undefined, undefined, second)).toMatchObject({ commits: 1 });
    expect(run(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('second');
    // A new branch, up to its first commit: made there, and its upstream set. What no branch
    // there has goes: main's third, and that commit.
    run(repo, 'checkout', '-q', '-b', 'topic');
    commit(repo, 'topic one');
    const one = run(repo, 'rev-parse', 'HEAD').trim();
    commit(repo, 'topic two');
    expect(
      await push(repo, undefined, { remote: 'origin', target: 'topic', setUpstream: true }, one),
    ).toMatchObject({ commits: 2, isNew: true });
    expect(run(remote, 'log', '-1', '--format=%s', 'topic').trim()).toBe('topic one');
    expect(run(repo, 'rev-parse', '--abbrev-ref', 'topic@{upstream}').trim()).toBe('origin/topic');
    // Not a commit of the branch: refused.
    run(repo, 'checkout', '-q', 'main');
    await expect(outgoing(repo, undefined, undefined, one)).rejects.toThrow(
      'The commit is not in the current branch',
    );
  });

  it('says why it can’t: no branch, no remote, or rejected', async () => {
    const { repo, remote } = cloned('fails');
    run(repo, 'checkout', '-q', '--detach');
    expect(await outgoing(repo)).toEqual({
      branch: undefined,
      remote: undefined,
      target: undefined,
      isNew: false,
      commits: [],
      remotes: ['origin'],
      upstream: undefined,
    });
    await expect(push(repo)).rejects.toThrow('No branch is checked out');
    run(repo, 'checkout', '-q', 'main');
    // Someone else pushed first.
    const other = join(root, 'other');
    run(root, 'clone', '-q', remote, other);
    commit(other, 'theirs');
    run(other, 'push', '-q');
    commit(repo, 'ours');
    await expect(push(repo)).rejects.toThrow('[rejected]');
    run(repo, 'remote', 'remove', 'origin');
    expect(await outgoing(repo)).toMatchObject({ branch: 'main', remote: undefined, commits: [] });
    await expect(push(repo)).rejects.toThrow('The repository has no remote');
    // Two remotes, neither origin: the first, as IntelliJ's.
    run(repo, 'remote', 'add', 'b', remote);
    run(repo, 'remote', 'add', 'a', remote);
    expect((await outgoing(repo)).remote).toBe('a');
  });

  it('pushes tags when asked, all or the branch’s, as IntelliJ’s, naming the ones it made', async () => {
    const { repo, remote } = cloned('tagged');
    run(repo, 'tag', 'light');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', 'annotated', '-m', 'v');
    // Only the annotated one on the branch, with nothing else to send.
    expect(
      await push(repo, undefined, { remote: 'origin', target: 'main', tags: 'follow' }),
    ).toEqual({
      commits: 0,
      remote: 'origin',
      target: 'main',
      isNew: false,
      forced: false,
      tags: ['annotated'],
    });
    commit(repo, 'more');
    expect(await push(repo, undefined, { remote: 'origin', target: 'main', tags: 'all' })).toEqual({
      commits: 1,
      remote: 'origin',
      target: 'main',
      isNew: false,
      forced: false,
      tags: ['light'],
    });
    expect(run(remote, 'tag').trim().split('\n')).toEqual(['annotated', 'light']);
  });

  it('says when the remote has diverged, fetches it to count, and force pushes, as IntelliJ’s', async () => {
    const { repo, remote } = cloned('diverged');
    const to = { remote: 'origin', target: 'main' };
    // Nothing in the way, nor for a branch the push makes.
    expect(await divergence(repo, to, true)).toBeUndefined();
    expect(await divergence(repo, { remote: 'origin', target: 'new' }, true)).toBeUndefined();
    // Someone else pushed two commits, not fetched yet.
    const other = join(root, 'other-diverged');
    run(root, 'clone', '-q', remote, other);
    commit(other, 'theirs');
    commit(other, 'theirs again');
    run(other, 'push', '-q');
    const fetched = run(repo, 'rev-parse', 'origin/main').trim();
    commit(repo, 'ours');
    // Where it was last fetched, without asking the remote: nothing in the way yet.
    expect(await divergence(repo, to, false)).toBeUndefined();
    // Asked, the remote has commits only a fetch can count.
    expect(await divergence(repo, to, true)).toEqual({ kind: 'fetchRequired', lease: fetched });
    await fetchTarget(repo, to);
    const theirs = run(other, 'rev-parse', 'HEAD').trim();
    expect(run(repo, 'rev-parse', 'origin/main').trim()).toBe(theirs);
    expect(await divergence(repo, to, true)).toEqual({
      kind: 'diverged',
      remoteCommits: 2,
      lease: theirs,
    });
    // A force push expecting another commit there is rejected (stale info).
    await expect(push(repo, undefined, { ...to, force: { lease: fetched } })).rejects.toThrow(
      '[rejected] (stale info)',
    );
    expect(await push(repo, undefined, { ...to, force: { lease: theirs } })).toEqual({
      commits: 1,
      remote: 'origin',
      target: 'main',
      isNew: false,
      forced: true,
      tags: [],
    });
    expect(run(remote, 'log', '--format=%s', 'main').trim().split('\n')).toEqual(['ours', 'first']);
    // Without a lease, where it was fetched: the push just made it there.
    commit(repo, 'more');
    expect(await push(repo, undefined, { ...to, force: {} })).toMatchObject({
      commits: 1,
      forced: false,
    });
    // Behind it: a push sends nothing, so nothing's in its way.
    run(repo, 'reset', '-q', '--hard', 'HEAD~1');
    expect(await divergence(repo, to, true)).toBeUndefined();
    // A remote that can't be asked: where it was fetched.
    commit(repo, 'instead');
    run(repo, 'remote', 'set-url', 'origin', join(root, 'nowhere.git'));
    expect(await divergence(repo, to, true)).toEqual({
      kind: 'diverged',
      remoteCommits: 1,
      lease: run(repo, 'rev-parse', 'origin/main').trim(),
    });
    await expect(fetchTarget(repo, to)).rejects.toThrow();
  });

  it('says the remote has diverged when its branch is gone, and force pushes a new one', async () => {
    const { repo, remote } = cloned('gone');
    commit(repo, 'ours');
    run(remote, 'branch', '-m', 'main', 'renamed');
    // Gone from the remote: the push makes it again.
    expect(await divergence(repo, { remote: 'origin', target: 'main' }, true)).toBeUndefined();
    // A new branch: the lease expects none there.
    run(repo, 'checkout', '-q', '-b', 'feature');
    expect(
      await push(repo, undefined, { remote: 'origin', target: 'feature', force: {} }),
    ).toMatchObject({ isNew: true, forced: false });
  });

  it('defines a remote whose URL answers, fetched when asked, as IntelliJ’s Define Remote', async () => {
    const { repo, remote } = cloned('defined');
    await checkRemote(repo, remote);
    await expect(checkRemote(repo, join(root, 'nowhere.git'))).rejects.toThrow(
      'does not appear to be a git repository',
    );
    // Not taken as an option.
    await expect(checkRemote(repo, '--upload-pack=touch')).rejects.toThrow('strange pathname');
    await addRemote(repo, { name: 'unfetched', url: remote, fetch: false });
    await addRemote(repo, { name: 'fetched', url: remote, fetch: true });
    expect(run(repo, 'remote').split('\n').filter(Boolean)).toEqual([
      'fetched',
      'origin',
      'unfetched',
    ]);
    // Its branches, not the HEAD git 2.48 and later also make on fetching (followRemoteHEAD).
    const branches = run(repo, 'for-each-ref', '--format=%(refname)', 'refs/remotes')
      .trim()
      .split('\n')
      .filter((ref) => !ref.endsWith('/HEAD'));
    expect(branches).toEqual(['refs/remotes/fetched/main', 'refs/remotes/origin/main']);
    await expect(addRemote(repo, { name: 'fetched', url: remote, fetch: false })).rejects.toThrow(
      'remote fetched already exists',
    );
  });

  it('lists, changes and removes remotes, as IntelliJ’s Git Remotes dialog', async () => {
    const { repo, remote } = cloned('managed');
    const other = join(root, 'other.git');
    await addRemote(repo, { name: 'b', url: other, fetch: false });
    await addRemote(repo, { name: 'a', url: remote, fetch: false });
    // Origin first, then by name.
    expect(await listRemotes(repo)).toEqual([
      { name: 'origin', url: remote },
      { name: 'a', url: remote },
      { name: 'b', url: other },
    ]);
    // Renamed, its URL kept; then its URL changed and fetched.
    await changeRemote(repo, { name: 'a', url: remote }, { name: 'c', url: remote, fetch: false });
    await changeRemote(repo, { name: 'b', url: other }, { name: 'b', url: remote, fetch: true });
    expect(await listRemotes(repo)).toEqual([
      { name: 'origin', url: remote },
      { name: 'b', url: remote },
      { name: 'c', url: remote },
    ]);
    expect(run(repo, 'rev-parse', '--verify', 'refs/remotes/b/main').trim()).not.toBe('');
    // Renamed and moved at once: the URL set on the new name.
    await changeRemote(repo, { name: 'c', url: remote }, { name: 'd', url: other, fetch: false });
    expect((await listRemotes(repo)).at(-1)).toEqual({ name: 'd', url: other });
    // Removed, with its remote-tracking branches.
    await removeRemote(repo, 'b');
    expect((await listRemotes(repo)).map((r) => r.name)).toEqual(['origin', 'd']);
    expect(run(repo, 'for-each-ref', 'refs/remotes/b')).toBe('');
    await expect(removeRemote(repo, 'nowhere')).rejects.toThrow('No such remote');
  });
});
