import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { outgoing, push } from '../src/index.js';

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
    // Two remotes, neither origin: which isn't known.
    run(repo, 'remote', 'add', 'a', remote);
    run(repo, 'remote', 'add', 'b', remote);
    expect((await outgoing(repo)).remote).toBeUndefined();
  });
});
