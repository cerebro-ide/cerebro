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
  GitError,
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
import { askPassClient } from '../src/askpass.js';

type Env = Record<string, string>;

const PORCELAIN = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n';

/** What the host's remote commands run with: git's credential helpers left out, asking the page. */
const HELPERLESS = ['-c', 'credential.helper='];
const ASKING = expect.objectContaining({
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: expect.stringMatching(/git\.(sh|bat)$/) as string,
  SSH_ASKPASS: expect.stringMatching(/ssh\.(sh|bat)$/) as string,
  SSH_ASKPASS_REQUIRE: 'force',
}) as Env;
/** A remote command's own arguments. */
const bare = (args: readonly string[]) => (args[0] === '-c' ? args.slice(2) : args);

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
      highlights: vi.fn(() => Promise.resolve([])),
      markers: vi.fn(() => Promise.resolve([])),
      structure: vi.fn(() => Promise.resolve(null)),
      folds: vi.fn(() => Promise.resolve(null)),
      format: vi.fn(() => Promise.resolve([])),
      problems: vi.fn(() => Promise.resolve(null)),
      contextActions: vi.fn(() => Promise.resolve([])),
      completions: vi.fn(() => Promise.resolve(null)),
      hover: vi.fn(() => Promise.resolve(null)),
      signatures: vi.fn(() => Promise.resolve(null)),
      renaming: vi.fn(() => Promise.resolve(null)),
      rename: vi.fn(() => Promise.resolve(null)),
      completionEdits: vi.fn(() => Promise.resolve([])),
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
    expect(await ui.request('lsp.highlights', { ...file, line: 2, column: 1 })).toEqual([]);
    expect(servers.highlights).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 2, column: 1 },
    );
    expect(await ui.request('lsp.markers', file)).toEqual([]);
    expect(await ui.request('lsp.structure', file)).toBeNull();
    expect(servers.structure).toHaveBeenCalledWith('/w', { path: '/w/b.ts', text: 'x' });
    expect(await ui.request('lsp.folds', file)).toBeNull();
    expect(servers.folds).toHaveBeenCalledWith('/w', { path: '/w/b.ts', text: 'x' });
    const options = { tabSize: 2, insertSpaces: true };
    expect(await ui.request('lsp.format', { ...file, ...options })).toEqual([]);
    expect(servers.format).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      options,
      undefined,
    );
    const range = { from: { line: 0, column: 1 }, to: { line: 2, column: 0 } };
    await ui.request('lsp.format', { ...file, ...options, ...range });
    expect(servers.format).toHaveBeenLastCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      options,
      range,
    );
    for (const bad of [
      { tabSize: 'two', insertSpaces: true },
      { tabSize: 2, insertSpaces: 'yes' },
      { ...options, from: range.from },
      { ...options, to: range.to },
    ]) {
      await expect(ui.request('lsp.format', { ...file, ...bad })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
    expect(servers.markers).toHaveBeenCalledWith('/w', { path: '/w/b.ts', text: 'x' });
    expect(await ui.request('lsp.problems', file)).toBeNull();
    expect(servers.problems).toHaveBeenCalledWith('/w', { path: '/w/b.ts', text: 'x' });
    expect(await ui.request('lsp.contextActions', { ...file, line: 1, column: 0 })).toEqual([]);
    expect(await ui.request('lsp.hover', { ...file, line: 0, column: 2 })).toBeNull();
    expect(servers.hover).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 0, column: 2 },
    );
    expect(await ui.request('lsp.signatures', { ...file, line: 0, column: 3 })).toBeNull();
    expect(await ui.request('lsp.renaming', { ...file, line: 0, column: 3 })).toBeNull();
    expect(await ui.request('lsp.rename', { ...file, line: 0, column: 3, name: 'y' })).toBeNull();
    expect(servers.rename).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 0, column: 3 },
      'y',
    );
    expect(servers.signatures).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 0, column: 3 },
    );
    expect(await ui.request('lsp.completions', { ...file, line: 0, column: 1 })).toBeNull();
    expect(servers.completions).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 0, column: 1 },
    );
    const item = { label: 'a', data: 1 };
    expect(
      await ui.request('lsp.completionEdits', { worktree: '/w', path: '/w/b.ts', item }),
    ).toEqual([]);
    expect(servers.completionEdits).toHaveBeenCalledWith('/w', '/w/b.ts', item);
    expect(servers.contextActions).toHaveBeenCalledWith(
      '/w',
      { path: '/w/b.ts', text: 'x' },
      { path: '', line: 1, column: 0 },
    );
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

describe('Prettier', () => {
  it('formats a file as the UI has it, or a part, and checks what it’s given', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-prettier-')));
    // A package that says what it was asked.
    writeFileSync(join(folder, 'package.json'), '{ "main": "index.mjs" }');
    writeFileSync(
      join(folder, 'index.mjs'),
      [
        'export const format = (text, o) => JSON.stringify([text, o.rangeStart, o.rangeEnd]);',
        'export const resolveConfig = () => Promise.resolve(null);',
        "export const getFileInfo = () => Promise.resolve({ ignored: false, inferredParser: 'x' });",
      ].join('\n'),
    );
    const { ui, stop } = connect();
    const file = { path: join(folder, 'a.ts'), text: 'x', package: folder };
    expect(await ui.request('prettier.format', file)).toEqual({ text: '["x",null,null]' });
    expect(await ui.request('prettier.format', { ...file, from: 0, to: 1 })).toEqual({
      text: '["x",0,1]',
    });
    // Without a package, the closest above the file: none here.
    expect(await ui.request('prettier.format', { ...file, package: undefined })).toEqual({
      refused: 'Prettier: package is not installed',
    });
    for (const bad of [{ from: 0 }, { to: 'end' }, { package: 3 }, { text: 3 }]) {
      await expect(ui.request('prettier.format', { ...file, ...bad })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
    stop();
    rmSync(folder, { recursive: true, force: true });
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

  it('lists a page of the log, and checks what it’s given', async () => {
    const { ui, git } = connect(
      vi.fn(() => Promise.resolve('a\x1f\x1fAnn\x1fa@x\x1f1\x1f\x1fone\0')),
    );
    expect(await ui.request('git.log', { worktree: '/w', skip: 0, max: 5 })).toEqual([
      {
        hash: 'a',
        parents: [],
        author: 'Ann',
        email: 'a@x',
        time: 1000,
        subject: 'one',
        body: '',
        refs: [],
      },
    ]);
    expect(git).toHaveBeenCalledWith(
      '/w',
      expect.arrayContaining(['--skip=0', '--max-count=5']),
      undefined,
      undefined,
    );
    await ui.request('git.log', { worktree: '/w', skip: 0, max: 5, branches: ['HEAD'] });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      expect.arrayContaining(['--end-of-options', 'HEAD']),
      undefined,
      undefined,
    );
    // Filtered: by the text, as given.
    const filter = {
      text: { text: 'fix', regex: true, matchCase: true },
      after: 0,
      paths: ['src'],
    };
    await ui.request('git.log', { worktree: '/w', skip: 0, max: 5, filter });
    expect(git).toHaveBeenCalledWith(
      '/w',
      expect.arrayContaining(['--grep=fix', '--extended-regexp', '--after=@0', ':(literal)src']),
      undefined,
      undefined,
    );
    for (const bad of [
      { skip: 0 },
      { skip: 'a', max: 1 },
      { skip: 0, max: 1, branches: 'main' },
      { skip: 0, max: 1, branches: [''] },
      { skip: 0, max: 1, filter: { text: { text: ' ', regex: false, matchCase: false } } },
      { skip: 0, max: 1, filter: { text: { text: 'a', regex: 'no', matchCase: false } } },
      { skip: 0, max: 1, filter: { text: { text: 'a', regex: false } } },
      { skip: 0, max: 1, filter: { text: { regex: false, matchCase: false } } },
      { skip: 0, max: 1, filter: { authors: 'Ann' } },
      { skip: 0, max: 1, filter: { authors: [''] } },
      { skip: 0, max: 1, filter: { paths: 'src' } },
      { skip: 0, max: 1, filter: { paths: [''] } },
      { skip: 0, max: 1, filter: { after: 1.5 } },
      { skip: 0, max: 1, filter: { before: '1' } },
    ]) {
      await expect(ui.request('git.log', { worktree: '/w', ...bad })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('lists the authors, and who commits', async () => {
    const { ui } = connect(
      vi.fn((_cwd: string, args: readonly string[]) =>
        Promise.resolve(args[0] === 'config' ? 'x\n' : 'Ann\x1fa@x\nAnn\x1fa@x\n'),
      ),
    );
    expect(await ui.request('git.authors', { worktree: '/w' })).toEqual({
      authors: [{ name: 'Ann', email: 'a@x' }],
      me: { name: 'x', email: 'x' },
    });
  });

  it('lists the branches', async () => {
    const { ui, git } = connect(
      vi.fn(() => Promise.resolve('refs/heads/main\tabc\t*\t\nrefs/heads/b\tdef\t \t\n')),
    );
    expect(await ui.request('git.branches', { worktree: '/w' })).toEqual([
      { ref: 'refs/heads/main', hash: 'abc', current: true },
      { ref: 'refs/heads/b', hash: 'def', current: false },
    ]);
    expect(git).toHaveBeenCalledWith('/w', expect.arrayContaining(['for-each-ref']));
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

  it('records saves and replacing in the Local History, and lists, shows and reverts a file’s versions', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-history-')));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const { ui, stop } = connect(vi.fn<Git>(runGit));
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'first');
    await ui.request('history.record', { path: dir });
    await ui.request('fs.write', { path: file, text: 'saved' });
    await ui.request('fs.write', { path: file, text: 'replaced', label: 'Replace in Files' });
    await ui.request('history.label', { path: dir, label: 'Mine' });
    // Outside a repository: written, with nothing recorded.
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-plain-')));
    writeFileSync(join(outside, 'x.txt'), '');
    await ui.request('fs.write', { path: join(outside, 'x.txt'), text: 'x' });
    expect(readFileSync(join(outside, 'x.txt'), 'utf8')).toBe('x');
    rmSync(outside, { recursive: true, force: true });
    type Version = { commit: string; label: string };
    const versions = (await ui.request('history.file', { path: dir, file: 'a.txt' })) as Version[];
    expect(versions.map((v) => v.label)).toEqual(['Mine', 'Replace in Files', '', '']);
    const first = versions.at(-1) as Version;
    expect(
      await ui.request('history.text', { path: dir, file: 'a.txt', commit: first.commit }),
    ).toEqual({
      text: 'first',
    });
    expect(
      await ui.request('history.text', { path: dir, file: 'b.txt', commit: first.commit }),
    ).toEqual({
      text: null,
    });
    await ui.request('history.revert', { path: dir, file: 'a.txt', commit: first.commit });
    expect(readFileSync(file, 'utf8')).toBe('first');
    expect(
      ((await ui.request('history.file', { path: dir, file: 'a.txt' })) as Version[])[0]?.label,
    ).toBe('Revert');
    for (const [method, params] of [
      ['history.text', { path: dir, file: 'a.txt', commit: 'HEAD' }],
      ['history.revert', { path: dir, file: 'a.txt', commit: '--help' }],
      ['history.label', { path: dir }],
      ['fs.write', { path: file, text: '', label: 1 }],
    ] as const) {
      await expect(ui.request(method, params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers a save before recording it in the Local History, which comes after', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-save-')));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'first');
    // Git held up until the save's answer: a save that waited for its record wouldn't answer.
    let release: (value: undefined) => void = () => undefined;
    const held = new Promise<undefined>((resolve) => {
      release = resolve;
    });
    const { ui, stop } = connect(
      vi.fn<Git>(async (...args) => {
        await held;
        return runGit(...args);
      }),
    );
    await ui.request('fs.write', { path: file, text: 'saved' });
    expect(readFileSync(file, 'utf8')).toBe('saved');
    release(undefined);
    type Version = { commit: string; label: string };
    const versions = (await ui.request('history.file', { path: dir, file: 'a.txt' })) as Version[];
    expect(versions.map((v) => v.label)).toEqual(['', '']);
    expect(
      await ui.request('history.text', { path: dir, file: 'a.txt', commit: versions[1]?.commit }),
    ).toEqual({ text: 'first' });
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('shelves, lists, unshelves and deletes shelved changes, and stashes', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-shelf-')));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    writeFileSync(join(dir, 'a.txt'), 'a');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first'], {
      cwd: dir,
    });
    // Someone to stash as: a test machine may have no one set.
    const git = vi.fn<Git>((cwd, args, env, input) =>
      runGit(cwd, args, { ...env, GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, input),
    );
    const { ui, stop } = connect(git);
    writeFileSync(join(dir, 'a.txt'), 'changed');
    writeFileSync(join(dir, 'b.txt'), 'b');
    // Only the files named; what's left is given back.
    expect(
      await ui.request('git.shelve', { path: dir, files: ['a.txt'], message: 'Aside' }),
    ).toEqual([{ path: 'b.txt', status: 'untracked' }]);
    const [shelf] = (await ui.request('git.shelves', { path: dir })) as { id: string }[];
    await ui.request('git.unshelve', { path: dir, id: shelf?.id });
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('changed');
    await ui.request('git.shelve', { path: dir, files: ['a.txt'], message: 'Again' });
    const [again] = (await ui.request('git.shelves', { path: dir })) as { id: string }[];
    await ui.request('git.deleteShelf', { path: dir, id: again?.id });
    expect(await ui.request('git.shelves', { path: dir })).toEqual([]);
    // The stash, with and without a message.
    writeFileSync(join(dir, 'a.txt'), 'stashed');
    await ui.request('git.stash', { path: dir, message: 'Mine', includeUntracked: true });
    expect(existsSync(join(dir, 'b.txt'))).toBe(false);
    writeFileSync(join(dir, 'a.txt'), 'stashed again');
    await ui.request('git.stash', { path: dir, keepIndex: true });
    const stashes = (await ui.request('git.stashes', { path: dir })) as { message: string }[];
    expect(stashes.map((s) => s.message)).toEqual([
      expect.stringMatching(/^WIP on main/) as string,
      'On main: Mine',
    ]);
    await ui.request('git.dropStash', { path: dir, ref: 'stash@{0}' });
    await ui.request('git.unstash', {
      path: dir,
      ref: 'stash@{0}',
      pop: true,
      reinstateIndex: false,
    });
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('b');
    await ui.request('git.stash', { path: dir, message: 'Last' });
    await ui.request('git.clearStashes', { path: dir });
    expect(await ui.request('git.stashes', { path: dir })).toEqual([]);
    for (const [method, params] of [
      ['git.shelve', { path: dir, files: 'a.txt', message: 'm' }],
      ['git.unshelve', { path: dir, id: '../x' }],
      ['git.deleteShelf', { path: dir }],
      ['git.unstash', { path: dir, ref: 'HEAD' }],
      ['git.dropStash', { path: dir, ref: 'stash@{x}' }],
    ] as const) {
      await expect(ui.request(method, params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
    stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('commits the files named, as changed now, and gives the changes left', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      // No merge under way: git finds no MERGE_HEAD.
      args[0] === 'rev-parse'
        ? Promise.reject(new Error('exit 1'))
        : Promise.resolve(
            args[0] === 'status'
              ? ' M a.ts\0R  n.ts\0o.ts\0?? u.ts\0'
              : args[0] === 'log'
                ? 'Last\n\n'
                : '',
          ),
    );
    const { ui } = connect(git);
    const left = await ui.request('git.commit', {
      path: '/w',
      files: ['a.ts', 'n.ts', 'u.ts', 'gone.ts'],
      message: 'Message',
      amend: true,
    });
    expect(left).toHaveLength(3);
    const literal = { GIT_LITERAL_PATHSPECS: '1' };
    expect(git).toHaveBeenCalledWith('/w', ['add', '--', 'u.ts'], literal);
    expect(git).toHaveBeenCalledWith(
      '/w',
      ['commit', '--only', '--file=-', '--amend', '--', 'a.ts', 'o.ts', 'n.ts', 'u.ts'],
      literal,
      'Message',
    );
    expect(await ui.request('git.lastMessage', { path: '/w' })).toBe('Last');
    for (const params of [
      { path: '/w', files: ['a.ts'] },
      { path: '/w', files: 'a.ts', message: 'm' },
      { path: '/w', message: 'm' },
    ]) {
      await expect(ui.request('git.commit', params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('checks for a diverged remote, and fetches the push’s target', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(
        bare(args)[0] === 'rev-parse' ? 'abc\n' : bare(args)[0] === 'rev-list' ? '1\t2\n' : '',
      ),
    );
    const { ui } = connect(git);
    const to = { path: '/w', remote: 'origin', target: 'main' };
    expect(await ui.request('git.divergence', to)).toEqual({
      kind: 'diverged',
      remoteCommits: 2,
      lease: 'abc',
    });
    // Not asked unless told.
    expect(git.mock.calls.some(([, args]) => bare(args)[0] === 'ls-remote')).toBe(false);
    await ui.request('git.divergence', { ...to, checkRemote: true });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'ls-remote', '--end-of-options', 'origin', 'refs/heads/main'],
      ASKING,
    );
    await ui.request('git.fetchTarget', to);
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [
        ...HELPERLESS,
        'fetch',
        '--quiet',
        '--end-of-options',
        'origin',
        '+refs/heads/main:refs/remotes/origin/main',
      ],
      ASKING,
    );
    for (const method of ['git.divergence', 'git.fetchTarget']) {
      await expect(ui.request(method, { path: '/w', remote: 'origin' })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('updates the project, fetching with credentials asked for', async () => {
    const answers: Record<string, string> = {
      'rev-parse': '/nowhere/state\n',
      'symbolic-ref': 'main\n',
      'for-each-ref': 'origin\n',
      'rev-list': '0\n',
    };
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(answers[bare(args)[0] as string] ?? ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.update', { path: '/w', method: 'merge', save: 'shelve' })).toEqual(
      { kind: 'nothing' },
    );
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--quiet', '--end-of-options', 'origin'],
      ASKING,
    );
    // Pull's with --rebase: from the branch asked for.
    expect(
      await ui.request('git.update', {
        path: '/w',
        method: 'rebase',
        save: 'stash',
        from: { remote: 'up', branch: 'dev' },
      }),
    ).toEqual({ kind: 'nothing' });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--quiet', '--end-of-options', 'up'],
      ASKING,
    );
    for (const params of [
      { path: '/w', method: 'pull', save: 'shelve' },
      { path: '/w', method: 'rebase', save: 'drawer' },
      { path: '/w', method: 'rebase', save: 'stash', from: { remote: 'up' } },
    ]) {
      await expect(ui.request('git.update', params)).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('fetches every remote, pulls with the options asked, and says where a pull comes from', async () => {
    const answers: Record<string, string> = {
      remote: 'origin\n',
      'rev-parse': '/nowhere/state\n',
      'symbolic-ref': 'main\n',
      'rev-list': '0\n',
    };
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(answers[bare(args)[0] as string] ?? ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.fetch', { path: '/w' })).toEqual({ pruned: [], failed: [] });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--prune', '--quiet', '--end-of-options', 'origin'],
      ASKING,
    );
    // One remote, as the Pull dialog asks.
    git.mockClear();
    await ui.request('git.fetch', { path: '/w', remote: 'upstream' });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--prune', '--quiet', '--end-of-options', 'upstream'],
      ASKING,
    );
    expect(git.mock.calls.some(([, args]) => bare(args)[0] === 'remote')).toBe(false);
    expect(await ui.request('git.tracking', { path: '/w' })).toEqual({
      branch: 'main',
      remotes: ['origin'],
      upstream: undefined,
    });
    expect(
      await ui.request('git.pull', {
        path: '/w',
        remote: 'origin',
        branch: 'main',
        options: ['--ff-only'],
      }),
    ).toEqual({ kind: 'merged', files: 0, commits: 0 });
    expect(await ui.request('git.pull', { path: '/w', remote: 'origin', branch: 'main' })).toEqual({
      kind: 'merged',
      files: 0,
      commits: 0,
    });
    for (const options of ['--ff-only', ['--exec=x']]) {
      await expect(
        ui.request('git.pull', { path: '/w', remote: 'origin', branch: 'main', options }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
  });

  it('merges with the options and message asked, and lists the branches not merged', async () => {
    const answers: Record<string, string> = {
      'rev-parse': '/nowhere/state\n',
      'rev-list': '0\n',
      branch: 'refs/heads/side []\n',
    };
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(answers[bare(args)[0] as string] ?? ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.unmerged', { path: '/w' })).toEqual(['refs/heads/side']);
    expect(
      await ui.request('git.merge', {
        path: '/w',
        branch: 'side',
        options: ['--no-ff'],
        message: 'Merged',
      }),
    ).toEqual({ kind: 'merged', files: 0, commits: 0 });
    expect(git.mock.calls.map((c) => bare(c[1]))).toContainEqual([
      'merge',
      '--no-ff',
      '-m',
      'Merged',
      '--end-of-options',
      'side',
    ]);
    expect(await ui.request('git.merge', { path: '/w', branch: 'side' })).toMatchObject({
      kind: 'merged',
    });
    for (const params of [{ options: ['--rebase'] }, { options: '--no-ff' }, { message: 1 }]) {
      await expect(
        ui.request('git.merge', { path: '/w', branch: 'side', ...params }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
  });

  it('carries on with an update given back what it gave, and nothing else', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(bare(args)[0] === 'rev-parse' ? '/nowhere/state\n' : ''),
    );
    const { ui } = connect(git);
    const before = 'a'.repeat(40);
    for (const saved of [undefined, { how: 'stash' }, { how: 'shelve', id: '1-2' }]) {
      const resume = { method: 'merge', before, commits: 2, ...(saved ? { saved } : {}) };
      expect(await ui.request('git.continueUpdate', { path: '/w', resume })).toMatchObject({
        kind: 'updated',
        commits: 2,
      });
    }
    for (const resume of [
      undefined,
      { method: 'pull', before, commits: 2 },
      { method: 'rebase', before: 3, commits: 2 },
      { method: 'rebase', before: 'HEAD', commits: 2 },
      { method: 'rebase', before, commits: 'two' },
      { method: 'rebase', before, commits: 2, saved: { how: 'drawer' } },
      { method: 'rebase', before, commits: 2, saved: { how: 'shelve', id: '../x' } },
      { method: 'rebase', before, commits: 2, saved: { how: 'shelve', id: 7 } },
    ]) {
      await expect(ui.request('git.continueUpdate', { path: '/w', resume })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('blames a file’s text, as given', async () => {
    const git = vi.fn<Git>(() => Promise.resolve(''));
    const { ui } = connect(git);
    expect(
      await ui.request('git.blame', { path: '/w', file: 'a.txt', contents: 'edited' }),
    ).toEqual({ lines: [], commits: [] });
    expect(git.mock.calls[0]?.[3]).toBe('edited');
    // IntelliJ's defaults: whitespace ignored, no movements looked for; else as asked.
    expect(git.mock.calls[0]?.[1]).toContain('-w');
    await ui.request('git.blame', {
      path: '/w',
      file: 'a.txt',
      contents: '',
      ignoreWhitespace: false,
      movements: 'across',
    });
    expect(git.mock.calls.at(-1)?.[1]).toContain('-C');
    expect(git.mock.calls.at(-1)?.[1]).not.toContain('-w');
    for (const bad of [{ contents: 3 }, { ignoreWhitespace: 'yes' }, { movements: 'far' }]) {
      await expect(
        ui.request('git.blame', { path: '/w', file: 'a.txt', contents: '', ...bad }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
  });

  it('lists conflicts, gives their versions, and resolves them, as told', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(bare(args)[0] === 'rev-parse' ? '/nowhere/state\n' : ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.conflicts', { path: '/w' })).toEqual({ files: [] });
    expect(await ui.request('git.mergeRevisions', { path: '/w', file: 'a.txt' })).toEqual({
      binary: false,
      base: '',
      yours: '',
      theirs: '',
    });
    for (const side of ['yours', 'theirs']) {
      expect(await ui.request('git.acceptSide', { path: '/w', files: ['a.txt'], side })).toBe(null);
    }
    await expect(
      ui.request('git.acceptSide', { path: '/w', files: ['a.txt'], side: 'both' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    // Not in conflict, so not written.
    await expect(
      ui.request('git.resolve', { path: '/w', file: 'a.txt', text: 'merged' }),
    ).rejects.toThrow(/isn't in conflict/);
    await expect(
      ui.request('git.resolve', { path: '/w', file: 'a.txt', text: 3 }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams }); // In conflict, it's written and added.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-resolve-')));
    git.mockImplementation((_cwd, args) =>
      Promise.resolve(bare(args)[0] === 'ls-files' ? '100644 abc 2\ta.txt\0' : '/nowhere/state\n'),
    );
    expect(await ui.request('git.resolve', { path: dir, file: 'a.txt', text: 'merged' })).toBe(
      null,
    );
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('merged');
    expect(git).toHaveBeenCalledWith(dir, ['add', '--', 'a.txt'], { GIT_LITERAL_PATHSPECS: '1' });
    rmSync(dir, { recursive: true, force: true });
  });

  it('gives the repository’s state, and continues, skips or aborts what’s under way', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(bare(args)[0] === 'rev-parse' ? '/nowhere/state\n' : ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.state', { path: '/w' })).toEqual({
      conflicts: false,
      remotes: false,
    });
    expect(await ui.request('git.continue', { path: '/w' })).toBe('done');
    expect(await ui.request('git.skipCommit', { path: '/w' })).toBe('done');
    for (const operation of ['merge', 'rebase', 'cherry-pick', 'revert']) {
      expect(await ui.request('git.abort', { path: '/w', operation })).toBe(null);
      expect(git).toHaveBeenCalledWith('/w', [operation, '--abort']);
    }
    await expect(
      ui.request('git.abort', { path: '/w', operation: 'bisect' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
  });

  it('cherry-picks or reverts a commit by its hash, from the Log, and continues either', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(
        bare(args)[0] === 'for-each-ref'
          ? 'origin/main\n'
          : bare(args)[0] === 'rev-parse'
            ? '/w\n'
            : '',
      ),
    );
    const { ui } = connect(git);
    expect(
      await ui.request('git.cherryPick', { path: '/w', hash: 'abc1234', protected: ['main'] }),
    ).toBe('picked');
    expect(git).toHaveBeenCalledWith('/w', ['cherry-pick', '-x', 'abc1234'], {
      GIT_TERMINAL_PROMPT: '0',
      GIT_EDITOR: 'true',
    });
    expect(await ui.request('git.continueApplying', { path: '/w', operation: 'cherry-pick' })).toBe(
      'picked',
    );
    // Revert Commit, and on once its conflicts are resolved.
    expect(await ui.request('git.revert', { path: '/w', hash: 'abc1234' })).toBe('picked');
    expect(git).toHaveBeenCalledWith('/w', ['revert', 'abc1234'], {
      GIT_TERMINAL_PROMPT: '0',
      GIT_EDITOR: 'true',
    });
    expect(await ui.request('git.continueApplying', { path: '/w', operation: 'revert' })).toBe(
      'picked',
    );
    await expect(
      ui.request('git.continueApplying', { path: '/w', operation: 'merge' }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    await expect(ui.request('git.revert', { path: '/w', hash: '-n' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    // Not a hash, as an option would be taken; not a list of names.
    for (const params of [
      { hash: '--abort', protected: [] },
      { hash: 'abc1234', protected: 'main' },
      { hash: 'abc1234', protected: [1] },
    ]) {
      await expect(ui.request('git.cherryPick', { path: '/w', ...params })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('undoes HEAD’s commit, unless a protected branch on a remote has it', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(
        bare(args)[0] === 'for-each-ref'
          ? 'origin/main\n'
          : bare(args)[0] === 'rev-parse'
            ? 'abc1234\n'
            : '',
      ),
    );
    const { ui } = connect(git);
    expect(
      await ui.request('git.undoCommit', { path: '/w', hash: 'abc1234', protected: ['main'] }),
    ).toBe('origin/main');
    expect(git).not.toHaveBeenCalledWith('/w', expect.arrayContaining(['reset']));
    expect(await ui.request('git.undoCommit', { path: '/w', hash: 'abc1234', protected: [] })).toBe(
      null,
    );
    expect(git).toHaveBeenCalledWith('/w', ['reset', '--soft', 'abc1234^', '--']);
    for (const params of [
      { hash: '--abort', protected: [] },
      { hash: 'abc1234', protected: 'main' },
    ]) {
      await expect(ui.request('git.undoCommit', { path: '/w', ...params })).rejects.toMatchObject({
        code: ErrorCodes.InvalidParams,
      });
    }
  });

  it('lists tags, checks a revision and makes a tag, as asked', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      bare(args)[0] === 'rev-parse'
        ? Promise.reject(new Error('fatal: Needed a single revision'))
        : Promise.resolve(bare(args)[0] === 'for-each-ref' ? 'v1\nv2\n' : ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.tags', { path: '/w' })).toEqual(['v1', 'v2']);
    expect(await ui.request('git.validRevision', { path: '/w', revision: 'nope' })).toBe(false);
    expect(await ui.request('git.resolveRevision', { path: '/w', revision: 'nope' })).toBe(null);
    expect(await ui.request('git.createTag', { path: '/w', name: 'v3' })).toBe(null);
    expect(
      await ui.request('git.createTag', {
        path: '/w',
        name: 'v1',
        commit: 'side',
        message: 'One',
        force: true,
      }),
    ).toBe(null);
    expect(git).toHaveBeenCalledWith('/w', ['tag', '--', 'v3'], undefined, undefined);
    expect(git).toHaveBeenCalledWith(
      '/w',
      ['tag', '-a', '-f', '-F', '-', '--', 'v1', 'side'],
      undefined,
      'One',
    );
    await expect(ui.request('git.createTag', { path: '/w' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });

  it('resets HEAD, as asked', async () => {
    const git = vi.fn<Git>(() => Promise.resolve(''));
    const { ui } = connect(git);
    const asked = () => git.mock.calls.map(([, args]) => bare(args).join(' '));
    expect(await ui.request('git.reset', { path: '/w', mode: 'hard', commit: 'HEAD~1' })).toBe(
      null,
    );
    expect(await ui.request('git.reset', { path: '/w', mode: 'soft' })).toBe(null);
    // The Log's Keep.
    expect(await ui.request('git.reset', { path: '/w', mode: 'keep', commit: 'abc' })).toBe(null);
    expect(asked()).toEqual(
      expect.arrayContaining(['reset --hard HEAD~1 --', 'reset --soft --', 'reset --keep abc --']),
    );
    await expect(ui.request('git.reset', { path: '/w', mode: 'merge' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });

  it('checks out, makes, renames, deletes, restores, merges and rebases branches, as asked', async () => {
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      Promise.resolve(bare(args)[0] === 'rev-parse' ? 'abc\n' : ''),
    );
    const { ui } = connect(git);
    const asked = () => git.mock.calls.map(([, args]) => bare(args).join(' '));
    expect(await ui.request('git.checkout', { path: '/w', branch: 'side' })).toBe(null);
    expect(await ui.request('git.checkout', { path: '/w', branch: 'origin/x', remote: true })).toBe(
      null,
    );
    expect(await ui.request('git.checkoutRevision', { path: '/w', reference: 'v1' })).toBe(null);
    expect(await ui.request('git.createBranch', { path: '/w', name: 'n' })).toBe(null);
    expect(
      await ui.request('git.createBranch', {
        path: '/w',
        name: 'm',
        from: 'side',
        checkout: true,
        overwrite: true,
      }),
    ).toBe(null);
    expect(await ui.request('git.renameBranch', { path: '/w', from: 'n', to: 'o' })).toBe(null);
    expect(await ui.request('git.deleteBranch', { path: '/w', name: 'o' })).toEqual({
      hash: 'abc',
      unmerged: false,
    });
    expect(await ui.request('git.restoreBranch', { path: '/w', name: 'o', hash: 'abc' })).toBe(
      null,
    );
    expect(await ui.request('git.deleteRemoteBranch', { path: '/w', name: 'origin/x' })).toBe(null);
    for (const name of ['x', 'origin/', '/x']) {
      await expect(
        ui.request('git.deleteRemoteBranch', { path: '/w', name }),
      ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    }
    expect(await ui.request('git.mergeBranch', { path: '/w', branch: 'side' })).toBe('upToDate');
    expect(await ui.request('git.rebaseOnto', { path: '/w', onto: 'side' })).toBe('upToDate');
    expect(
      await ui.request('git.rebase', {
        path: '/w',
        options: ['--update-refs'],
        onto: 'main',
        upstream: 'old',
        branch: 'side',
      }),
    ).toBe('upToDate');
    expect(await ui.request('git.rebase', { path: '/w', upstream: '' })).toBe('upToDate');
    await expect(
      ui.request('git.rebase', { path: '/w', options: ['--interactive'] }),
    ).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
    expect(asked()).toEqual(
      expect.arrayContaining([
        'checkout side --',
        'checkout --track origin/x',
        'checkout --detach v1 --',
        'branch n HEAD',
        'checkout -B m side',
        'branch --move n o',
        'branch --delete o',
        'branch o abc',
        'push --end-of-options origin :refs/heads/x',
        'merge --no-edit side',
        'rebase --autostash side',
        'rebase --autostash --update-refs --onto main old side',
        'rebase --autostash --root',
      ]),
    );
    await expect(ui.request('git.checkout', { path: '/w' })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
  });

  it('says what a push would send, and pushes, where it’s told', async () => {
    // No branch checked out: there's nothing to push.
    const git = vi.fn((_cwd: string, args: readonly string[]) =>
      bare(args)[0] === 'symbolic-ref'
        ? Promise.reject(new Error('detached'))
        : Promise.resolve(bare(args)[0] === 'remote' ? 'origin\n' : ''),
    );
    const { ui } = connect(git);
    expect(await ui.request('git.outgoing', { path: '/w' })).toEqual({
      branch: undefined,
      remote: undefined,
      target: undefined,
      isNew: false,
      commits: [],
      remotes: ['origin'],
      upstream: undefined,
    });
    await expect(
      ui.request('git.push', { path: '/w', remote: 'origin', target: 't', setUpstream: true }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
      message: 'No branch is checked out',
    });
    await expect(ui.request('git.push', {})).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    // A branch: where it's told.
    git.mockImplementation((_cwd: string, args: readonly string[]) =>
      Promise.resolve(
        bare(args)[0] === 'remote' ? 'origin\n' : bare(args)[0] === 'symbolic-ref' ? 'main\n' : '',
      ),
    );
    expect(
      await ui.request('git.outgoing', { path: '/w', remote: 'origin', target: 'review' }),
    ).toMatchObject({ remote: 'origin', target: 'review', isNew: true });
    expect(await ui.request('git.push', { path: '/w' })).toMatchObject({ target: 'main' });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [
        ...HELPERLESS,
        'push',
        '--porcelain',
        '--set-upstream',
        '--end-of-options',
        'origin',
        'HEAD:refs/heads/main',
      ],
      ASKING,
    );
    await ui.request('git.push', { path: '/w', remote: 'origin', target: 'main', tags: 'follow' });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [
        ...HELPERLESS,
        'push',
        '--porcelain',
        '--set-upstream',
        '--follow-tags',
        '--end-of-options',
        'origin',
        'HEAD:refs/heads/main',
      ],
      ASKING,
    );
    await expect(
      ui.request('git.push', { path: '/w', remote: 'origin', target: 'main', tags: 'some' }),
    ).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
      message: 'tags must be all or follow',
    });
    // A force push, expecting the remote's branch where it's told, else where it was fetched.
    await ui.request('git.push', {
      path: '/w',
      remote: 'origin',
      target: 'main',
      force: true,
      lease: 'abc',
    });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [
        ...HELPERLESS,
        'push',
        '--porcelain',
        '--set-upstream',
        '--force-with-lease=refs/heads/main:abc',
        '--end-of-options',
        'origin',
        'HEAD:refs/heads/main',
      ],
      ASKING,
    );
    await ui.request('git.push', { path: '/w', remote: 'origin', target: 'main', force: true });
    expect(git.mock.lastCall?.[1]).toContain('--force-with-lease=refs/heads/main:');
    // Failing: the refs it refused, from its output, before its words; else its words alone.
    for (const [error, message] of [
      [
        new GitError(
          'error: failed to push',
          'To r\n!\tHEAD:refs/heads/main\t[rejected] (fetch first)\nDone\n',
        ),
        '!\tHEAD:refs/heads/main\t[rejected] (fetch first)\nerror: failed to push',
      ],
      [new GitError('fatal: no access', ''), 'fatal: no access'],
      [new Error('spawn git ENOENT'), 'spawn git ENOENT'],
    ] as const) {
      git.mockImplementation((_cwd: string, args: readonly string[]) =>
        bare(args)[0] === 'push'
          ? Promise.reject(error)
          : Promise.resolve(
              bare(args)[0] === 'remote'
                ? 'origin\n'
                : bare(args)[0] === 'symbolic-ref'
                  ? 'main\n'
                  : '',
            ),
      );
      await expect(ui.request('git.push', { path: '/w' })).rejects.toMatchObject({ message });
    }
  });

  it('checks, adds, lists, changes and removes remotes, fetched when asked', async () => {
    const git = vi.fn<Git>(() => Promise.resolve(''));
    const { ui } = connect(git);
    await ui.request('git.checkRemote', { path: '/w', url: 'u' });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [...HELPERLESS, 'ls-remote', '--heads', '--end-of-options', 'u'],
      ASKING,
    );
    await ui.request('git.addRemote', { path: '/w', name: 'n', url: 'u' });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [...HELPERLESS, 'remote', 'add', '--end-of-options', 'n', 'u'],
      ASKING,
    );
    await ui.request('git.addRemote', { path: '/w', name: 'f', url: 'u', fetch: true });
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--quiet', '--end-of-options', 'f'],
      ASKING,
    );
    await ui.request('git.removeRemote', { path: '/w', name: 'n' });
    expect(git).toHaveBeenLastCalledWith('/w', ['remote', 'remove', '--end-of-options', 'n']);
    await ui.request('git.changeRemote', {
      path: '/w',
      fromName: 'n',
      fromUrl: 'u',
      name: 'n',
      url: 'v',
      fetch: true,
    });
    expect(git).toHaveBeenCalledWith(
      '/w',
      [...HELPERLESS, 'remote', 'set-url', '--end-of-options', 'n', 'v'],
      ASKING,
    );
    expect(git).toHaveBeenLastCalledWith(
      '/w',
      [...HELPERLESS, 'fetch', '--quiet', '--end-of-options', 'n'],
      ASKING,
    );
    git.mockImplementation((_cwd: string, args: readonly string[]) =>
      Promise.resolve(args[0] === 'remote' && args.length === 1 ? 'origin\n' : 'u\n'),
    );
    expect(await ui.request('git.remotes', { path: '/w' })).toEqual([{ name: 'origin', url: 'u' }]);
    for (const [method, params] of [
      ['git.checkRemote', { path: '/w' }],
      ['git.addRemote', { path: '/w', url: 'u' }],
      ['git.changeRemote', { path: '/w', name: 'n', url: 'u' }],
    ] as const) {
      await expect(ui.request(method, params)).rejects.toMatchObject({
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
    // An image's bytes, in base64.
    expect(await ui.request('fs.readBytes', { path: join(dir, 'b.bin') })).toEqual({
      data: 'AAE=',
    });
    await expect(ui.request('fs.readBytes', { path: join(dir, 'none') })).rejects.toMatchObject({
      code: ErrorCodes.InternalError,
    });
    expect(await ui.request('fs.exists', { path: join(dir, 'b.bin') })).toBe(true);
    expect(await ui.request('fs.exists', { path: join(dir, 'none') })).toBe(false);
    rmSync(dir, { recursive: true });
  });

  it('records the Local History after a save under way, not while it writes', async () => {
    // Git reading a file while it's written over fails on Windows ("mmap failed", measured).
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cerebro-host-during-')));
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const git = vi.fn<Git>(runGit);
    const { ui } = connect(git);
    const file = join(dir, 'a.txt');
    writeFileSync(file, 'first');
    await Promise.all([
      ui.request('fs.write', { path: file, text: 'saved' }),
      ui.request('history.record', { path: dir }),
    ]);
    // The save's record finds its worktree first.
    expect(git.mock.calls[0]?.[1]).toEqual(['rev-parse', '--show-toplevel']);
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

describe('credentials', () => {
  it('asks the page for what git asks, and tells it how the command ended', async () => {
    // Git, asking through the askpass client as git's own would.
    const git = vi.fn(async (_cwd: string, args: readonly string[], env?: Env) => {
      if (bare(args)[0] === 'config') return 'store\n';
      const out: string[] = [];
      await askPassClient(
        ['git', "Password for 'https://h': "],
        env ?? {},
        {
          write: (text: string) => out.push(text),
        },
        { write: () => true },
      );
      return out.join('');
    });
    // The scripts run this host's entry: none here, as Node runs from standard input.
    const argv = process.argv;
    process.argv = [argv[0] as string];
    const { ui, stop } = connect(git);
    process.argv = argv;
    const done: unknown[] = [];
    ui.onNotification('askpass.done', (params) => done.push(params));
    ui.onNotification('askpass.prompt', (params) => {
      const { id } = params as { id: string };
      expect(params).toMatchObject({
        kind: 'git',
        prompt: "Password for 'https://h': ",
        silent: false,
        helper: true,
      });
      // Answered twice: the second finds nobody waiting.
      void ui.request('askpass.answer', { id, answer: 'secret' });
      void ui.request('askpass.answer', { id, answer: 'again' });
    });
    await ui.request('git.checkRemote', { path: '/w', url: 'u' });
    expect(await git.mock.results[0]?.value).toBe('secret\n');
    const script = (git.mock.calls[0]?.[2] as Env)['GIT_ASKPASS'] as string;
    expect(readFileSync(script, 'utf8')).toContain(`"${process.execPath}" "" askpass git`);
    expect(done).toEqual([{ session: expect.any(String) as string, failed: false }]);
    // Git's helper, when the page says so.
    await ui.request('askpass.configure', { useCredentialHelper: true });
    git.mockClear();
    await ui.request('git.checkRemote', { path: '/w', url: 'u' });
    expect(git.mock.calls[0]?.[1]).toEqual(['ls-remote', '--heads', '--end-of-options', 'u']);
    await ui.request('askpass.configure', {});
    git.mockClear();
    await ui.request('git.checkRemote', { path: '/w', url: 'u' });
    expect(git.mock.calls[0]?.[1].slice(0, 2)).toEqual(HELPERLESS);
    await expect(ui.request('askpass.answer', { id: '1', answer: 1 })).rejects.toMatchObject({
      code: ErrorCodes.InvalidParams,
    });
    stop();
  });
});
