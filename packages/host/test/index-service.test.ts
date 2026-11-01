import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { BlobIndex } from '@cerebro-ide/index';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, ErrorCodes } from '@cerebro-ide/protocol';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FRESH_FOR, git, IndexService, SAVE_AFTER, serveOn } from '../src/index.js';
import { indexCacheFile } from '../src/host.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-index-service-')));
const repo = join(root, 'repo');
execFileSync('git', ['init', '-q', '-b', 'main', repo]);
writeFileSync(join(repo, 'shape.ts'), 'export class Shape {}\nnew Shape();\n');
execFileSync('git', ['add', '.'], { cwd: repo });
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
  cwd: repo,
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('IndexService', () => {
  it('answers with paths in the worktree', async () => {
    const service = new IndexService(git);
    expect(await service.symbols(repo, 'sha')).toEqual([
      { name: 'Shape', kind: 'class', path: `${repo}/shape.ts`, line: 0, column: 13 },
    ]);
    expect((await service.definitions(repo, 'Shape'))[0]?.path).toBe(`${repo}/shape.ts`);
    expect(await service.usages(repo, 'Shape')).toEqual([
      { path: `${repo}/shape.ts`, line: 0, column: 13 },
      { path: `${repo}/shape.ts`, line: 1, column: 4 },
    ]);
  });

  it('keeps the index in a cache: saved after indexing, and started from in the next run', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const cache = join(root, 'cache', 'repo.json');
      const first = new IndexService(git, Date.now, undefined, cache);
      await first.symbols(repo, 'Shape');
      expect(existsSync(cache)).toBe(false);
      await vi.advanceTimersByTimeAsync(SAVE_AFTER);
      await vi.waitFor(() => {
        expect(existsSync(cache)).toBe(true);
      });
      // The next run parses nothing: its blobs come from the cache.
      const parse = vi.spyOn(BlobIndex.prototype, 'parse');
      const second = new IndexService(git, Date.now, undefined, cache);
      expect((await second.symbols(repo, 'Shape')).map((s) => s.name)).toEqual(['Shape']);
      expect(parse).not.toHaveBeenCalled();
      parse.mockRestore();
      // Nothing new parsed: nothing to save.
      await vi.advanceTimersByTimeAsync(SAVE_AFTER);
      // A folder that isn't a repository fails to index, and saves nothing either.
      const failing = new IndexService(git, Date.now, undefined, join(root, 'cache', 'none.json'));
      await expect(failing.symbols(join(root, 'missing'), 'x')).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(SAVE_AFTER);
      expect(existsSync(join(root, 'cache', 'none.json'))).toBe(false);
      // A cache that can't be written (a file is where its folder would be): the index still works.
      writeFileSync(join(root, 'file'), '');
      const unwritable = new IndexService(git, Date.now, undefined, join(root, 'file', 'x.json'));
      expect(await unwritable.symbols(repo, 'Shape')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(SAVE_AFTER);
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    } finally {
      vi.useRealTimers();
    }
  });

  it('names a repository’s cache file by its path', () => {
    expect(indexCacheFile('/c', '/repo')).toBe(indexCacheFile('/c', '/repo'));
    expect(indexCacheFile('/c', '/repo')).not.toBe(indexCacheFile('/c', '/other'));
    expect(indexCacheFile('/c', '/repo')).toMatch(/[0-9a-f]{16}\.json$/);
  });

  it('reuses a fresh indexing, and indexes again once it’s older', async () => {
    let now = 0;
    const counted = vi.fn(git);
    const service = new IndexService(counted, () => now);
    await service.symbols(repo, 'x');
    const calls = counted.mock.calls.length;
    now = FRESH_FOR;
    await service.symbols(repo, 'y');
    expect(counted.mock.calls.length).toBe(calls);
    writeFileSync(join(repo, 'more.ts'), 'export function more() {}\n');
    now = FRESH_FOR + 1;
    expect((await service.symbols(repo, 'more')).map((s) => s.name)).toEqual(['more']);
    expect(counted.mock.calls.length).toBeGreaterThan(calls);
  });

  it('warms a worktree up front, telling how far it got', async () => {
    const reports: [string, number, number][] = [];
    const service = new IndexService(git, Date.now, (worktree, done, total) =>
      reports.push([worktree, done, total]),
    );
    service.warm(repo);
    // Finished: the last report has all files done.
    await vi.waitFor(() => {
      const [worktree, done, total] = reports.at(-1) ?? [];
      expect(worktree).toBe(repo);
      expect(done).toBe(total);
    });
    // A worktree that can't be indexed fails quietly when warmed.
    service.warm(join(root, 'not-a-repo'));
  });

  it('serves the index over the protocol, refusing requests without a worktree', async () => {
    // eslint-disable-next-line prefer-const -- the two refer to each other
    let host: Connection;
    const ui = new Connection((line) => {
      host.receive(line);
    });
    host = new Connection((line) => {
      ui.receive(line);
    });
    // A cache folder that can't be made (a file is in its place): the index works without one.
    writeFileSync(join(root, 'blocked'), '');
    serveOn(host, { repo, indexCache: join(root, 'blocked') });
    const progress = vi.fn();
    ui.onNotification('index.progress', progress);
    expect(await ui.request('index.warm', { worktree: repo })).toBeNull();
    await vi.waitFor(() => {
      const last = progress.mock.calls.at(-1)?.[0] as
        { worktree: string; done: number; total: number } | undefined;
      expect(last?.worktree).toBe(repo);
      expect(last?.done).toBe(last?.total);
    });
    expect(await ui.request('index.symbols', { worktree: repo, query: 'Shape' })).toHaveLength(1);
    expect(
      await ui.request('index.symbols', { worktree: repo, query: 'Shape', kinds: ['function'] }),
    ).toEqual([]);
    await expect(
      ui.request('index.symbols', { worktree: repo, query: 'x', kinds: [1] }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    expect(await ui.request('index.definitions', { worktree: repo, name: 'Shape' })).toHaveLength(
      1,
    );
    expect(await ui.request('index.usages', { worktree: repo, name: 'Shape' })).toHaveLength(2);
    // A folder outside git: its files as ripgrep lists them.
    const plain = join(root, 'plain');
    mkdirSync(plain);
    writeFileSync(join(plain, 'loose.ts'), 'export const loose = 1;\n');
    expect(await ui.request('index.symbols', { worktree: plain, query: 'loose' })).toHaveLength(1);
    expect(await ui.request('git.files', { path: plain })).toEqual(['loose.ts']);
    await expect(ui.request('index.symbols', { query: 'x' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });
});
