import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Connection, ErrorCodes } from '@cerebro-ide/protocol';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  defaultHookCommand,
  git as runGit,
  hookSettings,
  makeSpawnHelperExecutable,
  nodePty,
  PROTOCOL_VERSION,
  serve,
  sendHook,
  serveOn,
  shellWord,
  type Git,
  type LanguageServers,
  type Pty,
  type Turn,
} from '../src/index.js';

type Env = Record<string, string>;

const PORCELAIN = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n';

/** A UI-side connection to a host served on another connection. */
function connect(
  git: Mock<Git> = vi.fn(() => Promise.resolve(PORCELAIN)),
  pty?: () => Pty,
  languageServers?: LanguageServers,
  rg?: string,
) {
  // eslint-disable-next-line prefer-const -- the two refer to each other
  let host: Connection;
  const ui = new Connection((line) => {
    host.receive(line);
  });
  host = new Connection((line) => {
    ui.receive(line);
  });
  const stop = serveOn(host, {
    repo: '/default',
    git,
    ...(pty ? { pty } : {}),
    ...(languageServers ? { languageServers } : {}),
    ...(rg ? { rg } : {}),
  });
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

describe('language servers', () => {
  it('asks them about a file as the UI has it, and checks what it’s given', async () => {
    const servers = {
      open: vi.fn(),
      definitions: vi.fn(() => Promise.resolve([{ path: '/w/a.ts', line: 1, column: 2 }])),
      usages: vi.fn(() => Promise.resolve(null)),
      dispose: vi.fn(() => Promise.resolve()),
    };
    const { ui, stop } = connect(undefined, undefined, servers as unknown as LanguageServers);
    const file = { worktree: '/w', path: '/w/b.ts', text: 'x' };
    expect(await ui.request('lsp.open', file)).toBeNull();
    expect(servers.open).toHaveBeenCalledWith('/w', { path: '/w/b.ts', text: 'x' });
    expect(await ui.request('lsp.definitions', { ...file, line: 3, column: 4 })).toEqual([
      { path: '/w/a.ts', line: 1, column: 2 },
    ]);
    expect(servers.definitions).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 3, column: 4 },
    );
    expect(await ui.request('lsp.usages', { ...file, line: 0, column: 0 })).toBeNull();
    await expect(ui.request('lsp.usages', { ...file, line: 'a', column: 0 })).rejects.toMatchObject(
      { code: ErrorCodes.InvalidParams },
    );
    await expect(ui.request('lsp.open', { ...file, text: 3 })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    stop();
    expect(servers.dispose).toHaveBeenCalled();
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

describe('changes', () => {
  it('lists a worktree’s changes', async () => {
    const { ui, git } = connect(vi.fn(() => Promise.resolve(' M b.ts\0?? a.ts\0')));
    expect(await ui.request('git.changes', { path: '/w' })).toEqual([
      { path: 'a.ts', status: 'untracked' },
      { path: 'b.ts', status: 'modified' },
    ]);
    expect(git).toHaveBeenCalledWith('/w', [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
  });

  it('gives a file’s two sides: as committed, where it was, and as it is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerebro-diff-'));
    writeFileSync(join(dir, 'new.ts'), 'now');
    writeFileSync(join(dir, 'same.ts'), 'same');
    writeFileSync(join(dir, 'b.bin'), new Uint8Array([0, 1]));
    const git = vi.fn((_cwd: string, args: readonly string[]) => {
      if (args[0] === 'status') return Promise.resolve('R  new.ts\0old.ts\0 D gone.ts\0');
      return Promise.resolve(`committed ${String(args[1])}`);
    });
    const { ui } = connect(git);
    expect(await ui.request('git.diff', { path: dir, file: 'new.ts' })).toEqual({
      original: 'committed HEAD:old.ts',
      text: 'now',
    });
    expect(await ui.request('git.diff', { path: dir, file: 'gone.ts' })).toEqual({
      original: 'committed HEAD:gone.ts',
      text: '',
    });
    expect(await ui.request('git.diff', { path: dir, file: 'same.ts' })).toEqual({
      original: 'committed HEAD:same.ts',
      text: 'same',
    });
    await expect(ui.request('git.diff', { path: dir, file: 'b.bin' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      data: { reason: 'binary' },
    });
    rmSync(dir, { recursive: true });
  });

  it('lists the changes between two commits, and gives a file’s sides at each', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) => {
      if (args[0] === 'diff') return Promise.resolve('R100\0old.ts\0new.ts\0M\0b.ts\0');
      return Promise.resolve(`at ${String(args[1])}`);
    });
    const { ui } = connect(git);
    const range = { path: '/w', from: 'c1', to: 'c2' };
    expect(await ui.request('git.changes', range)).toEqual([
      { path: 'b.ts', status: 'modified' },
      { path: 'new.ts', status: 'renamed', from: 'old.ts' },
    ]);
    expect(git).toHaveBeenCalledWith('/w', ['diff', '--name-status', '-z', '-M', 'c1', 'c2']);
    expect(await ui.request('git.diff', { ...range, file: 'new.ts' })).toEqual({
      original: 'at c1:old.ts',
      text: 'at c2:new.ts',
    });
    expect(await ui.request('git.diff', { ...range, file: 'b.ts' })).toEqual({
      original: 'at c1:b.ts',
      text: 'at c2:b.ts',
    });
  });
});

describe('ignored files and rolling back', () => {
  it('lists ignored files', async () => {
    const { ui, git } = connect(vi.fn(() => Promise.resolve('out/\0a.log\0')));
    expect(await ui.request('git.ignored', { path: '/w' })).toEqual(['a.log', 'out/']);
    expect(git).toHaveBeenCalledWith('/w', [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z',
    ]);
  });

  it('rolls back the files named, as changed now, and gives the changes left', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(args[0] === 'status' ? ' M a.ts\0A  n.ts\0?? u.ts\0' : ''),
    );
    const { ui } = connect(git);
    await ui.request('git.rollback', { path: '/w', files: ['a.ts', 'n.ts', 'gone.ts'] });
    expect(git).toHaveBeenCalledWith('/w', ['restore', '--staged', '--', 'n.ts']);
    expect(git).toHaveBeenCalledWith('/w', [
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      'a.ts',
    ]);
    git.mockClear();
    expect(
      await ui.request('git.rollback', { path: '/w', files: ['n.ts'], deleteAdded: true }),
    ).toHaveLength(3);
    expect(git).toHaveBeenCalledWith('/w', [
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      'n.ts',
    ]);
    for (const files of [undefined, 'a.ts', [3]]) {
      await expect(ui.request('git.rollback', { path: '/w', files })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
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

  it('saves a file that exists, all of it, refusing to make one', async () => {
    const { ui } = connect();
    const dir = mkdtempSync(join(tmpdir(), 'cerebro-write-'));
    const file = join(dir, 'a.ts');
    writeFileSync(file, 'a longer text than what replaces it');
    expect(await ui.request('fs.write', { path: file, text: 'short' })).toBeNull();
    expect(readFileSync(file, 'utf8')).toBe('short');
    await expect(
      ui.request('fs.write', { path: join(dir, 'none'), text: '' }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
    });
    expect(existsSync(join(dir, 'none'))).toBe(false);
    for (const params of [{ path: file }, { path: file, text: 3 }, { text: 'x' }]) {
      await expect(ui.request('fs.write', params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
    rmSync(dir, { recursive: true });
  });

  it('searches a folder’s files, refusing a bad pattern', async () => {
    const { ui } = connect();
    const found = (await ui.request('search.text', {
      path: import.meta.dirname,
      query: 'searches a folder’s files',
      matchCase: true,
      words: false,
      regex: false,
    })) as { matches: { path: string }[] };
    // This test's name and its query.
    expect(found.matches.map((m) => m.path.split('/').at(-1))).toEqual([
      'host.test.ts',
      'host.test.ts',
    ]);
    await expect(
      ui.request('search.text', { path: import.meta.dirname, query: '(', regex: true }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    // Only the files the masks keep.
    const masked = (await ui.request('search.text', {
      path: import.meta.dirname,
      // Not written whole, or this line would be found too.
      query: ['searches a', 'folder’s files'].join(' '),
      matchCase: true,
      masks: ['*.ts', '!host.*'],
    })) as { matches: unknown[] };
    expect(masked.matches).toEqual([]);
    await expect(
      ui.request('search.text', { path: import.meta.dirname, query: 'x', masks: [1] }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    await expect(
      ui.request('search.text', { path: import.meta.dirname, query: 'x', masks: '*.ts' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    // Replacements, and a limit, when asked.
    const replacing = (await ui.request('search.text', {
      path: import.meta.dirname,
      query: ['searches a', 'folder’s files'].join(' '),
      matchCase: true,
      replace: 'X',
      limit: 1,
    })) as { matches: { replacements: string[] }[]; limited: boolean };
    expect(replacing.matches.map((m) => m.replacements)).toEqual([['X']]);
    expect(replacing.limited).toBe(true);
    for (const bad of [{ replace: 1 }, { limit: 0 }, { limit: 1.5 }]) {
      await expect(
        ui.request('search.text', { path: import.meta.dirname, query: 'x', ...bad }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
    // A Directory typed that isn't there: said so, as a bad query.
    await expect(
      ui.request('search.text', { path: join(import.meta.dirname, 'none'), query: 'x' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams, message: /No such folder/ });
    // ripgrep that can't start: the host's own failure.
    const broken = connect(undefined, undefined, undefined, join(import.meta.dirname, 'no-rg')).ui;
    await expect(
      broken.request('search.text', { path: import.meta.dirname, query: 'x' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InternalError });
  });

  it('lists a folder', async () => {
    const { ui } = connect();
    const entries = (await ui.request('fs.list', { path: import.meta.dirname })) as {
      name: string;
    }[];
    expect(entries.map((e) => e.name)).toContain('host.test.ts');
    // This repository ignores nothing in its tests' folder.
    expect(entries.some((e) => 'ignored' in e)).toBe(false);
    // A repository that ignores some, with real git: they say so.
    const real = connect(vi.fn(runGit)).ui;
    const repo = mkdtempSync(join(tmpdir(), 'cerebro-host-ignored-'));
    execFileSync('git', ['init', '-q', repo]);
    writeFileSync(join(repo, '.gitignore'), '*.log\n');
    writeFileSync(join(repo, 'debug.log'), '');
    writeFileSync(join(repo, 'kept.ts'), '');
    expect(await real.request('fs.list', { path: repo })).toEqual([
      expect.objectContaining({ name: '.gitignore' }),
      expect.objectContaining({ name: 'debug.log', ignored: true }),
      { name: 'kept.ts', path: `${repo.replaceAll('\\', '/')}/kept.ts`, kind: 'file' },
    ]);
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

  it('runs an agent with Cerebro’s hooks, telling the UI its status', async () => {
    const { pty } = fake();
    const spawn = vi.fn(() => pty);
    // eslint-disable-next-line prefer-const -- the two refer to each other
    let host: Connection;
    const ui = new Connection((line) => {
      host.receive(line);
    });
    host = new Connection((line) => {
      ui.receive(line);
    });
    const stop = serveOn(host, { repo: '/r', pty: spawn, hookCommand: 'hook-client' });
    await ui.request('terminal.open', {
      key: 'claude:/w',
      cwd: '/w',
      command: 'claude',
      args: ['--resume', 's'],
      agent: true,
    });
    const [, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string> },
    ];
    expect(args.slice(0, 2)).toEqual(['--settings', hookSettings('hook-client')]);
    expect(args.slice(2)).toEqual(['--resume', 's']);
    expect(options.env['CEREBRO_AGENT_KEY']).toBe('claude:/w');
    const statuses = vi.fn();
    ui.onNotification('agent.status', statuses);
    await sendHook(options.env['CEREBRO_HOOK_SOCKET'] as string, {
      key: 'claude:/w',
      event: 'Notification',
      input: { session_id: 's' },
    });
    await vi.waitFor(() => {
      expect(statuses).toHaveBeenCalledWith({
        key: 'claude:/w',
        state: 'waiting',
        sessionId: 's',
        event: 'Notification',
      });
    });
    // An agent without arguments of its own.
    await ui.request('terminal.open', { key: 'claude:/v', cwd: '/v', agent: true });
    expect((spawn.mock.calls[1] as unknown as [string, string[]])[1]).toHaveLength(2);
    stop();
  });

  it('keeps each agent turn’s snapshots, and lists the turns', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-turns-')));
    execFileSync('git', ['init', '-q', dir]);
    writeFileSync(join(dir, 'a.txt'), 'before');
    const spawn = vi.fn(() => fake().pty);
    // eslint-disable-next-line prefer-const -- the two refer to each other
    let host: Connection;
    const ui = new Connection((line) => {
      host.receive(line);
    });
    host = new Connection((line) => {
      ui.receive(line);
    });
    const stop = serveOn(host, { repo: dir, git: runGit, pty: spawn, hookCommand: 'h' });
    await ui.request('terminal.open', { key: 'claude:a', cwd: dir, agent: true });
    await ui.request('terminal.open', { key: 'claude:b', cwd: tmpdir(), agent: true });
    const socket = (spawn.mock.calls[0] as unknown as [string, string[], { env: Env }])[2].env[
      'CEREBRO_HOOK_SOCKET'
    ] as string;
    const statuses = vi.fn();
    ui.onNotification('agent.status', statuses);
    const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The hook returns once the snapshot before the turn is taken.
    await sendHook(socket, {
      key: 'claude:a',
      event: 'UserPromptSubmit',
      input: { prompt: 'Change a' },
    });
    // Not an agent the host started; and one outside a repository, which can't be kept.
    await sendHook(socket, { key: 'other', event: 'UserPromptSubmit', input: {} });
    await sendHook(socket, { key: 'claude:b', event: 'UserPromptSubmit', input: {} });
    await vi.waitFor(() => {
      expect(statuses).toHaveBeenCalledTimes(3);
      expect(failed).toHaveBeenCalled();
    });
    failed.mockRestore();
    writeFileSync(join(dir, 'a.txt'), 'after');
    await sendHook(socket, { key: 'claude:a', event: 'Stop', input: {} });
    const turns = await vi.waitFor(async () => {
      const listed = (await ui.request('agent.turns', { path: dir })) as Turn[];
      expect(listed).toHaveLength(1);
      return listed;
    });
    const [turn] = turns as [Turn];
    expect(turn.prompt).toBe('Change a');
    expect(
      await ui.request('git.diff', { path: dir, file: 'a.txt', from: turn.start, to: turn.end }),
    ).toEqual({
      original: 'before',
      text: 'after',
    });
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs hooks with this host’s entry, as Node, quoted for the shell', () => {
    expect(defaultHookCommand('/opt/My App/electron', "/it's/main.js")).toBe(
      `ELECTRON_RUN_AS_NODE=1 '/opt/My App/electron' '/it'\\''s/main.js' hook`,
    );
    expect(defaultHookCommand()).toContain(shellWord(process.execPath));
    const argv = process.argv;
    process.argv = [argv[0] as string];
    expect(defaultHookCommand('/node')).toBe(`ELECTRON_RUN_AS_NODE=1 '/node' '' hook`);
    process.argv = argv;
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
