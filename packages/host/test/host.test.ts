import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Connection, ErrorCodes } from '@cerebro-ide/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  makeSpawnHelperExecutable,
  nodePty,
  PROTOCOL_VERSION,
  serve,
  serveOn,
  type Pty,
} from '../src/index.js';

const PORCELAIN = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n';

/** A UI-side connection to a host served on another connection. */
function connect(git = vi.fn(() => Promise.resolve(PORCELAIN)), pty?: () => Pty) {
  // eslint-disable-next-line prefer-const -- the two refer to each other
  let host: Connection;
  const ui = new Connection((line) => {
    host.receive(line);
  });
  host = new Connection((line) => {
    ui.receive(line);
  });
  const stop = serveOn(host, { repo: '/default', git, ...(pty ? { pty } : {}) });
  return { ui, git, stop };
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

describe('git files', () => {
  it('lists a worktree’s files', async () => {
    const { ui, git } = connect(vi.fn(() => Promise.resolve('b.ts\0a.ts\0a.ts\0')));
    expect(await ui.request('git.files', { path: '/w' })).toEqual(['a.ts', 'b.ts']);
    expect(git).toHaveBeenCalledWith('/w', [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
  });
});

describe('files', () => {
  it('reads a file, refusing a binary one with its reason', async () => {
    const { ui } = connect();
    const read = (await ui.request('fs.read', { path: import.meta.filename })) as { text: string };
    expect(read.text).toContain('reads a file');
    const dir = mkdtempSync(join(tmpdir(), 'cerebro-read-'));
    writeFileSync(join(dir, 'b.bin'), new Uint8Array([0, 1]));
    await expect(ui.request('fs.read', { path: join(dir, 'b.bin') })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      data: { reason: 'binary' },
    });
    await expect(ui.request('fs.read', { path: join(dir, 'none') })).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
    });
    rmSync(dir, { recursive: true });
  });

  it('lists a folder', async () => {
    const { ui } = connect();
    const entries = (await ui.request('fs.list', { path: import.meta.dirname })) as {
      name: string;
    }[];
    expect(entries.map((e) => e.name)).toContain('host.test.ts');
    await expect(ui.request('fs.list', {})).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
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

describe('terminals', () => {
  function fake() {
    let output: (data: string) => void = () => undefined;
    const pty = {
      onData: (listener: (data: string) => void) => (output = listener),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    return {
      pty,
      output: (data: string) => {
        output(data);
      },
    };
  }

  it('opens, writes, resizes and closes, the output arriving as notifications', async () => {
    const { pty, output } = fake();
    const spawn = vi.fn(() => pty);
    const { ui, stop } = connect(undefined, spawn);
    const data = vi.fn();
    ui.onNotification('terminal.data', data);
    expect(
      await ui.request('terminal.open', {
        key: 'agent:/w',
        cwd: '/w',
        command: 'claude',
        args: ['--continue', 1],
        cols: 100.6,
        rows: 30,
      }),
    ).toEqual({ id: 1, buffer: '' });
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['--continue', '1'],
      expect.objectContaining({ cwd: '/w', cols: 100, rows: 30 }),
    );
    output('hello');
    await vi.waitFor(() => {
      expect(data).toHaveBeenCalledWith({ id: 1, data: 'hello' });
    });
    await ui.request('terminal.write', { id: 1, data: 'x' });
    expect(pty.write).toHaveBeenCalledWith('x');
    // A size that isn't one is the default.
    await ui.request('terminal.resize', { id: 1, cols: 0, rows: 'big' });
    expect(pty.resize).toHaveBeenCalledWith(80, 24);
    await ui.request('terminal.close', { id: 1 });
    expect(pty.kill).toHaveBeenCalledTimes(1);
    await ui.request('terminal.open', { key: 'k', cwd: '/w' });
    expect(spawn).toHaveBeenLastCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
    // Ending the connection ends its terminals.
    stop();
    expect(pty.kill).toHaveBeenCalledTimes(2);
  });

  it('refuses requests without an id', async () => {
    const { ui } = connect(undefined, () => fake().pty);
    await expect(ui.request('terminal.write', { data: 'x' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    await expect(ui.request('terminal.close', null)).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });

  it.runIf(process.platform !== 'win32')('runs a real process on a pseudo-terminal', async () => {
    const pty = nodePty('/bin/sh', ['-c', 'echo $TERM'], {
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      env: process.env,
    });
    let output = '';
    pty.onData((data) => (output += data));
    const code = await new Promise<number>((resolve) => {
      pty.onExit(({ exitCode }) => {
        resolve(exitCode);
      });
    });
    expect(code).toBe(0);
    expect(output.trim()).toBe('xterm-256color');
  });

  it('makes node-pty’s macOS helper executable, which its package leaves unexecutable', () => {
    const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    const helper = join(root, 'prebuilds', 'darwin-x64', 'spawn-helper');
    const mode = statSync(helper).mode & 0o777;
    try {
      chmodSync(helper, 0o644);
      makeSpawnHelperExecutable('linux', 'x64');
      expect(statSync(helper).mode & 0o777).toBe(0o644);
      makeSpawnHelperExecutable('darwin', 'x64');
      expect(statSync(helper).mode & 0o777).toBe(0o755);
      // No prebuild for the architecture: nothing to do.
      expect(() => {
        makeSpawnHelperExecutable('darwin', 'mips');
      }).not.toThrow();
    } finally {
      chmodSync(helper, mode);
    }
  });
});
