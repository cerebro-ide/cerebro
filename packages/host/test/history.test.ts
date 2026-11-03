import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fileHistory, git, HISTORY, record, recording, revert, textIn } from '../src/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-history-')));
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** A new repository with a.txt and b.txt committed. */
function repository(name: string): string {
  const repo = join(root, name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a1');
  writeFileSync(join(repo, 'b.txt'), 'b1');
  run(repo, 'add', '.');
  run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  return repo;
}

const read = (repo: string, file: string) => readFileSync(join(repo, file), 'utf8');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Local History', () => {
  it('records the files when they change, and lists a file’s versions with what made them', async () => {
    const repo = repository('versions');
    expect(await fileHistory(repo, 'a.txt', git)).toEqual([]);
    let time = 1000;
    const now = () => time;
    // The first record: the files as found, with no label.
    const first = await record(repo, 'External change', git, { now });
    expect(first).toEqual(expect.any(String));
    // Nothing changed: nothing recorded.
    expect(await record(repo, 'External change', git, { now })).toBeUndefined();
    time = 2000;
    writeFileSync(join(repo, 'a.txt'), 'a2');
    await record(repo, '', git, { now });
    time = 3000;
    writeFileSync(join(repo, 'b.txt'), 'b2');
    await record(repo, 'Rollback', git, { now });
    // A label the user puts is recorded though nothing changed, and is in every file's history.
    time = 4000;
    await record(repo, 'Before the refactoring', git, { always: true, now });
    const history = await fileHistory(repo, 'a.txt', git);
    expect(history.map(({ time, label, put }) => ({ time, label, put }))).toEqual([
      { time: 4000, label: 'Before the refactoring', put: true },
      { time: 2000, label: '', put: false },
      { time: 1000, label: '', put: false },
    ]);
    expect((await fileHistory(repo, 'b.txt', git)).map((r) => r.label)).toEqual([
      'Before the refactoring',
      'Rollback',
      '',
    ]);
    // A version's text; none where the file wasn't.
    expect(await textIn(repo, history[2]?.commit as string, 'a.txt', git)).toBe('a1');
    expect(await textIn(repo, history[2]?.commit as string, 'new.txt', git)).toBeUndefined();
    // The records are a chain, kept by one ref.
    expect(run(repo, 'rev-list', '--count', HISTORY).trim()).toBe('4');
  });

  it('records a change Cerebro makes, after what changed outside it', async () => {
    const repo = repository('recording');
    await record(repo, '', git);
    writeFileSync(join(repo, 'a.txt'), 'outside');
    const result = await recording(repo, 'Replace in Files', git, () => {
      writeFileSync(join(repo, 'a.txt'), 'replaced');
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect((await fileHistory(repo, 'a.txt', git)).map((r) => r.label)).toEqual([
      'Replace in Files',
      'External change',
      '',
    ]);
  });

  it('makes the change outside a repository, recording nothing', async () => {
    const folder = join(root, 'plain');
    mkdirSync(folder);
    expect(await recording(folder, 'Save', git, () => Promise.resolve('done'))).toBe('done');
  });

  it('reverts a file to a version, deleting it if it wasn’t there', async () => {
    const repo = repository('revert');
    const before = (await record(repo, '', git)) as string;
    writeFileSync(join(repo, 'a.txt'), 'changed');
    writeFileSync(join(repo, 'new.txt'), 'new');
    await record(repo, '', git);
    await revert(repo, 'a.txt', before, git);
    expect(read(repo, 'a.txt')).toBe('a1');
    await revert(repo, 'new.txt', before, git);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
  });

  it('records one after another, when asked at once', async () => {
    const repo = repository('queue');
    writeFileSync(join(repo, 'a.txt'), 'x');
    const made = await Promise.all([
      record(repo, 'one', git),
      record(repo, 'two', git, { always: true }),
      record(repo, 'three', git, { always: true }),
    ]);
    expect(made.every((commit) => commit !== undefined)).toBe(true);
    expect(run(repo, 'rev-list', '--count', HISTORY).trim()).toBe('3');
  });
});
