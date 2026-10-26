import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  git,
  listChangesBetween,
  listTurns,
  snapshot,
  textAt,
  TurnRecorder,
  TURNS,
} from '../src/index.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-turns-')));
const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** A new repository; with a first commit, unless `empty`. */
function repository(name: string, empty = false): string {
  const repo = join(root, name);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  if (!empty) {
    writeFileSync(join(repo, 'a.txt'), 'a');
    run(repo, 'add', '.');
    run(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first');
  }
  return repo;
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('snapshots', () => {
  it('commit every file git doesn’t ignore, leaving the index as it was', async () => {
    const repo = repository('snapshot');
    writeFileSync(join(repo, '.gitignore'), 'out/\n');
    writeFileSync(join(repo, 'b.txt'), 'b');
    writeFileSync(join(repo, 'staged.txt'), 's');
    run(repo, 'add', 'staged.txt');
    const head = run(repo, 'rev-parse', 'HEAD').trim();
    const commit = await snapshot(repo, head, 'message', git);
    expect(run(repo, 'ls-tree', '--name-only', commit).split('\n').filter(Boolean)).toEqual([
      '.gitignore',
      'a.txt',
      'b.txt',
      'staged.txt',
    ]);
    expect(run(repo, 'rev-parse', `${commit}^`).trim()).toBe(head);
    expect(run(repo, 'status', '--porcelain')).toBe('A  staged.txt\n?? .gitignore\n?? b.txt\n');
  });

  it('work in a repository without commits or an index', async () => {
    const repo = repository('empty', true);
    writeFileSync(join(repo, 'a.txt'), 'a');
    const commit = await snapshot(repo, undefined, 'message', git);
    expect(await textAt(repo, commit, 'a.txt')).toBe('a');
    expect(await textAt(repo, commit, 'missing.txt')).toBe('');
  });
});

describe('turns', () => {
  it('are kept from a prompt to the turn’s end, the latest first', async () => {
    const repo = repository('turns');
    let time = 1000;
    const recorder = new TurnRecorder(git, () => time);
    await recorder.started('claude', repo, 'First');
    writeFileSync(join(repo, 'a.txt'), 'changed');
    // Another agent's turn ends without having started (the host started after it was sent).
    await recorder.ended('other');
    await recorder.ended('claude');
    time = 2000;
    const long = 'x'.repeat(300);
    await recorder.started('claude', repo, long);
    writeFileSync(join(repo, 'b.txt'), 'new');
    await recorder.ended('claude');
    // Others' refs, under the same name.
    run(repo, 'update-ref', `${TURNS}500-9`, 'HEAD');
    const tree = run(repo, 'rev-parse', 'HEAD^{tree}').trim();
    const other = run(
      repo,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit-tree',
      tree,
      '-m',
      '{}',
    );
    run(repo, 'update-ref', `${TURNS}400-9`, other.trim());

    const turns = await listTurns(repo, git);
    expect(turns.map((t) => [t.id, t.time, t.prompt])).toEqual([
      ['2000-2', 2000, 'x'.repeat(200)],
      ['1000-1', 1000, 'First'],
      ['500-9', 500, ''],
      ['400-9', 400, ''],
    ]);
    const [second, first] = turns as [(typeof turns)[0], (typeof turns)[0]];
    expect(await listChangesBetween(repo, first.start, first.end)).toEqual([
      { path: 'a.txt', status: 'modified' },
    ]);
    // What the second turn changed, not the first.
    expect(await listChangesBetween(repo, second.start, second.end)).toEqual([
      { path: 'b.txt', status: 'added' },
    ]);
    // Only this worktree sees them.
    run(repo, 'worktree', 'add', '-q', '-b', 'other', join(root, 'other'));
    expect(await listTurns(join(root, 'other'), git)).toEqual([]);
  });

  it('go on after a snapshot fails, and are kept however soon they end', async () => {
    const recorder = new TurnRecorder(git);
    const outside = join(root, 'not-a-repository');
    await expect(recorder.started('k', outside, 'p')).rejects.toThrow();
    const repo = repository('after-failure');
    // A turn that ends before its first snapshot is taken.
    void recorder.started('k', repo, 'p');
    await recorder.ended('k');
    expect(await listTurns(repo, git)).toHaveLength(1);
  });
});
