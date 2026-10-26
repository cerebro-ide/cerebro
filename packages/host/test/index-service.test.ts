import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection, ErrorCodes } from '@cerebro-ide/protocol';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { FRESH_FOR, git, IndexService, serveOn } from '../src/index.js';

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

  it('serves the index over the protocol, refusing requests without a worktree', async () => {
    // eslint-disable-next-line prefer-const -- the two refer to each other
    let host: Connection;
    const ui = new Connection((line) => {
      host.receive(line);
    });
    host = new Connection((line) => {
      ui.receive(line);
    });
    serveOn(host, { repo });
    expect(await ui.request('index.symbols', { worktree: repo, query: 'Shape' })).toHaveLength(1);
    expect(await ui.request('index.definitions', { worktree: repo, name: 'Shape' })).toHaveLength(
      1,
    );
    expect(await ui.request('index.usages', { worktree: repo, name: 'Shape' })).toHaveLength(2);
    await expect(ui.request('index.symbols', { query: 'x' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });
});
