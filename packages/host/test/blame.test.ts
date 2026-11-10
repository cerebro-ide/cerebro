import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { blame, git } from '../src/index.js';

describe('blame, with real git', () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-blame-')));
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  const run = (env: Record<string, string>, ...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
  /** A commit by `who`, `days` after the epoch's first day. */
  const commitAs = (who: string, days: number, message: string) => {
    const date = `@${String(86_400 * days)} +0000`;
    run(
      { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      '-c',
      `user.name=${who}`,
      '-c',
      `user.email=${who.toLowerCase()}@x.org`,
      'commit',
      '-qam',
      message,
    );
  };
  run({}, 'init', '-q');

  it('says who last changed each line, and when; none for lines changed since', async () => {
    writeFileSync(join(repo, 'old.txt'), 'a\nb\nc\n');
    run({}, 'add', '.');
    commitAs('Ada', 1, 'First\n\nWith a body.');
    // Renamed since: its first commit had it at its old path.
    run({}, 'mv', 'old.txt', 'f.txt');
    writeFileSync(join(repo, 'f.txt'), 'a\nB\nc\nd\n');
    run({}, 'add', '.');
    commitAs('Bob', 2, 'Second');
    const found = await blame(repo, 'f.txt', 'a\nB\nC!\nd\nnew\n', git);
    const [bob, ada] = found.commits;
    expect(found.commits.map((c) => [c.author, c.email, c.time, c.message, c.path])).toEqual([
      ['Bob', 'bob@x.org', 2 * 86_400_000, 'Second', undefined],
      ['Ada', 'ada@x.org', 86_400_000, 'First\n\nWith a body.', 'old.txt'],
    ]);
    expect(found.lines).toEqual([ada?.hash, bob?.hash, null, bob?.hash, null]);
  });

  it('says why it can’t: a file not committed', async () => {
    writeFileSync(join(repo, 'new.txt'), 'x\n');
    await expect(blame(repo, 'new.txt', 'x\n', git)).rejects.toThrow('no such path');
    // An empty one: nothing to say.
    writeFileSync(join(repo, 'empty.txt'), '');
    run({}, 'add', '.');
    commitAs('Ada', 3, 'Empty');
    expect(await blame(repo, 'empty.txt', '', git)).toEqual({ lines: [], commits: [] });
  });
});
