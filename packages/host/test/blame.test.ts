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

  it('says each commit’s committer date, and the commit before it that changed the file', async () => {
    writeFileSync(join(repo, 'p.txt'), 'a\n');
    run({}, 'add', '.');
    commitAs('Ada', 4, 'Added');
    writeFileSync(join(repo, 'p.txt'), 'a\nb\n');
    // Committed a day after it was written.
    run(
      {
        GIT_AUTHOR_DATE: `@${String(86_400 * 5)} +0000`,
        GIT_COMMITTER_DATE: `@${String(86_400 * 6)} +0000`,
      },
      '-c',
      'user.name=Bob',
      '-c',
      'user.email=bob@x.org',
      'commit',
      '-qam',
      'Changed',
    );
    const [changed, added] = (await blame(repo, 'p.txt', 'a\nb\n', git)).commits;
    expect(changed?.time).toBe(5 * 86_400_000);
    expect(changed?.committed).toBe(6 * 86_400_000);
    expect(changed?.previous).toEqual({ hash: added?.hash, path: 'p.txt' });
    // Where the file was added: none before.
    expect(added?.previous).toBeUndefined();
  });

  it('ignores whitespace, and finds lines moved within the file or across files, as asked', async () => {
    const lines = Array.from(
      { length: 6 },
      (_, i) => `a line long enough to be followed ${String(i)}`,
    );
    writeFileSync(join(repo, 'm.txt'), `${lines.join('\n')}\n`);
    writeFileSync(join(repo, 'from.txt'), `${lines.map((l) => `${l}!`).join('\n')}\n`);
    run({}, 'add', '.');
    commitAs('Ada', 7, 'Lines');
    // Indented, the first three moved to the end, and from.txt's moved in.
    const moved = [...lines.slice(3), ...lines.slice(0, 3)].map((l, i) => (i === 0 ? `  ${l}` : l));
    const text = `${[...moved, ...lines.map((l) => `${l}!`)].join('\n')}\n`;
    writeFileSync(join(repo, 'm.txt'), text);
    // Moved out of from.txt: git looks across files for what the same commit changed.
    writeFileSync(join(repo, 'from.txt'), '');
    commitAs('Bob', 8, 'Moved');
    const by = async (options: Parameters<typeof blame>[4]) => {
      const found = await blame(repo, 'm.txt', text, git, options);
      const names = new Map(found.commits.map((c) => [c.hash, c.author]));
      return found.lines.map((hash) => names.get(hash as string));
    };
    const bob = (n: number) => Array<string>(n).fill('Bob');
    const ada = (n: number) => Array<string>(n).fill('Ada');
    // Whitespace: the indented line is Ada's only when ignored.
    expect((await by({ ignoreWhitespace: false, movements: 'none' }))[0]).toBe('Bob');
    expect((await by(undefined))[0]).toBe('Ada');
    expect(await by({ ignoreWhitespace: true, movements: 'none' })).toEqual([...ada(3), ...bob(9)]);
    expect(await by({ ignoreWhitespace: true, movements: 'within' })).toEqual([
      ...ada(6),
      ...bob(6),
    ]);
    expect(await by({ ignoreWhitespace: true, movements: 'across' })).toEqual(ada(12));
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
