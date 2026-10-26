import { PassThrough } from 'node:stream';
import { Connection, ErrorCodes } from '@cerebro-ide/protocol';
import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, serve, serveOn } from '../src/index.js';

const PORCELAIN = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n';

/** A UI-side connection to a host served on another connection. */
function connect(git = vi.fn(() => Promise.resolve(PORCELAIN))) {
  // eslint-disable-next-line prefer-const -- the two refer to each other
  let host: Connection;
  const ui = new Connection((line) => {
    host.receive(line);
  });
  host = new Connection((line) => {
    ui.receive(line);
  });
  serveOn(host, { repo: '/default', git });
  return { ui, git };
}

describe('the host’s methods', () => {
  it('answers a ping with the protocol’s version', async () => {
    expect(await connect().ui.request('host.ping')).toEqual({ version: PROTOCOL_VERSION });
  });

  it('lists worktrees of the repository asked for, or its own', async () => {
    const { ui, git } = connect();
    expect(await ui.request('git.worktrees', { repo: '/other' })).toEqual([
      { path: '/repo', head: 'abc', branch: 'main', main: true, bare: false },
    ]);
    expect(git).toHaveBeenCalledWith('/other', ['worktree', 'list', '--porcelain']);
    await ui.request('git.worktrees');
    await ui.request('git.worktrees', null);
    expect(git).toHaveBeenLastCalledWith('/default', ['worktree', 'list', '--porcelain']);
  });

  it('refuses a repository that isn’t a path, and passes git’s failures on', async () => {
    const { ui } = connect(vi.fn(() => Promise.reject(new Error('not a git repository'))));
    await expect(ui.request('git.worktrees', { repo: 5 })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    await expect(ui.request('git.worktrees')).rejects.toMatchObject({
      message: 'not a git repository',
    });
  });
});

describe('adding and removing worktrees', () => {
  it('runs git with what the request says, answering with the worktrees after', async () => {
    const { ui, git } = connect();
    expect(
      await ui.request('git.addWorktree', {
        path: '/w',
        branch: 'feat/x',
        create: true,
        from: 'main',
      }),
    ).toHaveLength(1);
    expect(git).toHaveBeenCalledWith('/default', ['worktree', 'add', '-b', 'feat/x', '/w', 'main']);
    await ui.request('git.addWorktree', { path: '/w2', branch: 'old', repo: '/r' });
    expect(git).toHaveBeenCalledWith('/r', ['worktree', 'add', '/w2', 'old']);
    await ui.request('git.removeWorktree', { path: '/w', force: true });
    expect(git).toHaveBeenCalledWith('/default', ['worktree', 'remove', '--force', '/w']);
    await ui.request('git.removeWorktree', { path: '/w2' });
    expect(git).toHaveBeenCalledWith('/default', ['worktree', 'remove', '/w2']);
  });

  it('refuses requests without a path or branch', async () => {
    const { ui } = connect();
    for (const [method, params] of [
      ['git.addWorktree', { branch: 'b' }],
      ['git.addWorktree', { path: '/w', branch: '' }],
      ['git.addWorktree', null],
      ['git.removeWorktree', { path: 3 }],
    ] as const) {
      await expect(ui.request(method, params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });
});

describe('serve', () => {
  it('speaks one message per line over streams, and closes when the input ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding('utf8');
    const connection = serve(input, output, { repo: '/r' });
    input.write('{"jsonrpc":"2.0","id":1,"me');
    input.write('thod":"host.ping"}\n');
    const line = await new Promise<string>((resolve) => output.once('data', resolve));
    expect(JSON.parse(line)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { version: PROTOCOL_VERSION },
    });
    expect(line.endsWith('\n')).toBe(true);
    input.end();
    await new Promise((resolve) => setTimeout(resolve));
    await expect(connection.request('x')).rejects.toMatchObject({
      code: ErrorCodes.ConnectionClosed,
    });
  });
});
