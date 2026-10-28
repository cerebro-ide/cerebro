import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ServerSpec } from '@cerebro-ide/servers';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  LanguageServer,
  LanguageServers,
  highlighted,
  located,
  pathOf,
  uriOf,
  type Located,
} from '../src/lsp.js';

const FAKE = fileURLToPath(new URL('fixtures/fake-server.mjs', import.meta.url));
// Paths as git writes them, with `/` on every OS.
const slashes = (path: string) => path.replaceAll('\\', '/');
const root = slashes(realpathSync.native(mkdtempSync(join(tmpdir(), 'cerebro-lsp-'))));
const log = join(root, 'log.jsonl');

/** A server spec for the fake server, misbehaving as `mode` says. */
const fake = (mode: string): ServerSpec => ({
  id: `fake-${mode}`,
  languageOf: (path) => (path.endsWith('.fake') ? 'fake' : undefined),
  command: () => ({ command: process.execPath, args: [FAKE, mode, log] }),
});
const at = (line: number, column: number): Located => ({ path: '', line, column });
const file = { path: `${root}/a.fake`, text: 'x' };

let pools: LanguageServers[] = [];
const pool = (...args: ConstructorParameters<typeof LanguageServers>) => {
  const made = new LanguageServers(...args);
  pools.push(made);
  return made;
};

afterEach(async () => {
  await Promise.all(pools.map((p) => p.dispose()));
  pools = [];
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('paths and locations', () => {
  it('turns paths into file URIs and back, with / and a capital drive on Windows', () => {
    expect(pathOf(uriOf('/a/b c.ts'), 'linux')).toBe('/a/b c.ts');
    expect(pathOf('file:///c%3A/Users/a.ts', 'win32')).toBe('C:/Users/a.ts');
  });

  it('reads locations and location links, one or many, or none', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } };
    expect(located(null)).toEqual([]);
    expect(located({ uri: 'file:///a.ts', range }, 'linux')).toEqual([
      { path: '/a.ts', line: 1, column: 2 },
    ]);
    expect(
      located(
        [{ targetUri: 'file:///b.ts', targetRange: range, targetSelectionRange: range }],
        'linux',
      ),
    ).toEqual([{ path: '/b.ts', line: 1, column: 2 }]);
  });

  it('reads highlights: writes apart from reads and text, or none', () => {
    const range = (line: number) => ({
      start: { line, character: 2 },
      end: { line, character: 5 },
    });
    expect(highlighted(null)).toEqual([]);
    expect(
      highlighted([
        { range: range(0), kind: 3 },
        { range: range(1), kind: 2 },
        { range: range(2) },
      ]),
    ).toEqual([
      { from: { line: 0, column: 2 }, to: { line: 0, column: 5 }, write: true },
      { from: { line: 1, column: 2 }, to: { line: 1, column: 5 }, write: false },
      { from: { line: 2, column: 2 }, to: { line: 2, column: 5 }, write: false },
    ]);
  });
});

describe('TypeScript 7’s server', () => {
  it('goes to a definition and finds usages, precisely, in unsaved text too', async () => {
    const project = `${root}/ts`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    writeFileSync(
      join(project, 'a.ts'),
      'export function target() {}\nexport function other() {}\n',
    );
    const b = { path: `${project}/b.ts`, text: "import { target } from './a';\ntarget();\n" };
    writeFileSync(b.path, b.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.definitions(project, b, at(1, 2))).toEqual([
      { path: `${project}/a.ts`, line: 0, column: 16 },
    ]);
    // Edited, not saved: answered as the UI has it.
    const edited = { ...b, text: "import { other } from './a';\n\nother();\n" };
    expect(await servers.definitions(project, edited, at(2, 1))).toEqual([
      { path: `${project}/a.ts`, line: 1, column: 16 },
    ]);
    const usages = await servers.usages(
      project,
      { path: `${project}/a.ts`, text: readFileSync(join(project, 'a.ts'), 'utf8') },
      at(1, 17),
    );
    expect(usages).toEqual(
      expect.arrayContaining([{ path: `${project}/b.ts`, line: 2, column: 0 }]),
    );
    expect(usages).not.toContainEqual({ path: `${project}/a.ts`, line: 1, column: 16 });
    // One server for the worktree, whatever the file.
    expect(servers.size).toBe(1);
  }, 60_000);

  it('highlights a symbol where it is in its file, not another of the same name', async () => {
    const project = `${root}/ts`;
    const c = {
      path: `${project}/c.ts`,
      text: [
        'export function a() {',
        '  const extra = 1;',
        '  return extra;',
        '}',
        'export function b() {',
        '  const extra = 2;',
        '  return extra;',
        '}',
        '',
      ].join('\n'),
    };
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.highlights(project, c, at(2, 10))).toEqual([
      { from: { line: 1, column: 8 }, to: { line: 1, column: 13 }, write: true },
      { from: { line: 2, column: 9 }, to: { line: 2, column: 14 }, write: false },
    ]);
  }, 60_000);
});

describe('basedpyright, for Python', () => {
  it('goes to a definition and finds usages, precisely, in unsaved text too', async () => {
    const project = `${root}/py`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'a.py'), 'def target():\n    pass\n\ndef other():\n    pass\n');
    // Never opened: found all the same, with no project file (pyright's project is the folder).
    writeFileSync(join(project, 'c.py'), 'import a\n\na.other()\n');
    const b = { path: `${project}/b.py`, text: 'from a import target\ntarget()\n' };
    writeFileSync(b.path, b.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.definitions(project, b, at(1, 2))).toEqual([
      { path: `${project}/a.py`, line: 0, column: 4 },
    ]);
    // Edited, not saved: answered as the UI has it.
    const edited = { ...b, text: 'from a import other\n\nother()\n' };
    expect(await servers.definitions(project, edited, at(2, 1))).toEqual([
      { path: `${project}/a.py`, line: 3, column: 4 },
    ]);
    const usages = await servers.usages(
      project,
      { path: `${project}/a.py`, text: readFileSync(join(project, 'a.py'), 'utf8') },
      at(3, 5),
    );
    expect(usages).toEqual(
      expect.arrayContaining([
        { path: `${project}/b.py`, line: 2, column: 0 },
        { path: `${project}/c.py`, line: 2, column: 2 },
      ]),
    );
    expect(usages).not.toContainEqual({ path: `${project}/a.py`, line: 3, column: 4 });
  }, 60_000);

  it('highlights a symbol where it is in its file, not another of the same name', async () => {
    const project = `${root}/py`;
    const d = {
      path: `${project}/d.py`,
      text: 'def a():\n    extra = 1\n    return extra\n\ndef b():\n    extra = 2\n    return extra\n',
    };
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.highlights(project, d, at(2, 12))).toEqual([
      { from: { line: 1, column: 4 }, to: { line: 1, column: 9 }, write: true },
      { from: { line: 2, column: 11 }, to: { line: 2, column: 16 }, write: false },
    ]);
  }, 60_000);
});

describe('bash-language-server, for shell scripts', () => {
  it('goes to a definition and finds usages, in a script never opened too', async () => {
    const project = `${root}/sh`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'lib.sh'), 'greet() {\n  echo hi\n}\n');
    // Never opened: found all the same, once the server has read the folder.
    writeFileSync(join(project, 'other.sh'), 'source ./lib.sh\ngreet\n');
    const main = { path: `${project}/main.sh`, text: 'source ./lib.sh\n\ngreet\n' };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.definitions(project, main, at(2, 1))).toEqual([
      { path: `${project}/lib.sh`, line: 0, column: 0 },
    ]);
    const usages = await servers.usages(
      project,
      { path: `${project}/lib.sh`, text: readFileSync(join(project, 'lib.sh'), 'utf8') },
      at(0, 1),
    );
    expect(usages).toEqual(
      expect.arrayContaining([
        { path: `${project}/main.sh`, line: 2, column: 0 },
        { path: `${project}/other.sh`, line: 1, column: 0 },
      ]),
    );
  }, 60_000);

  it('highlights a name where it is in its script', async () => {
    const project = `${root}/sh`;
    const main = { path: `${project}/main.sh`, text: 'source ./lib.sh\n\ngreet\ngreet\n' };
    const servers = pool(undefined, { patience: 60_000 });
    const found = await servers.highlights(project, main, at(2, 1));
    expect(found?.map((h) => h.from.line)).toEqual([2, 3]);
  }, 60_000);
});

describe('LanguageServers', () => {
  it('has no answer for a language without a server', async () => {
    const servers = pool([fake('links')]);
    expect(
      await servers.definitions(root, { path: `${root}/a.txt`, text: '' }, at(0, 0)),
    ).toBeNull();
    servers.open(root, { path: `${root}/a.txt`, text: '' });
    expect(servers.size).toBe(0);
  });

  it('has no answer for a file outside any project its server needs, as TypeScript’s', async () => {
    const project = `${root}/projects`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(`${project}/app/src`, { recursive: true });
    writeFileSync(`${project}/app/project.json`, '{}');
    const needy: ServerSpec = { ...fake('links'), projectFiles: ['project.json'] };
    const servers = pool([needy]);
    // Its project file in a folder above, up to the worktree: asked.
    const inside = { path: `${project}/app/src/a.fake`, text: 'x' };
    expect(await servers.definitions(project, inside, at(0, 0))).not.toBeNull();
    // None between it and the worktree: not asked, so the name matches show instead of nothing.
    const outside = { path: `${project}/a.fake`, text: 'x' };
    expect(await servers.definitions(project, outside, at(0, 0))).toBeNull();
    expect(servers.size).toBe(1);
  });

  it('waits for a server to say it’s loaded, when it can say so, before asking it', async () => {
    const loads: ServerSpec = { ...fake('loads'), readyWhen: /^Loaded \d+ files/ };
    const servers = pool([loads]);
    const started = Date.now();
    expect(await servers.definitions(root, file, at(0, 0))).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    // Not loaded in time: no answer, so the name matches show.
    const slow = pool([loads], { patience: 100 });
    expect(await slow.definitions(root, file, at(0, 0))).toBeNull();
  });

  it('opens a file in its server ahead of a question, answering what the server asks', async () => {
    writeFileSync(log, '');
    const servers = pool([fake('links')]);
    servers.open(root, file);
    const found = servers.serverFor(root, file.path);
    await found?.server.ready;
    await vi.waitFor(() => {
      expect(readFileSync(log, 'utf8')).toContain('textDocument/didOpen');
      expect(readFileSync(log, 'utf8')).toContain('"id":"c4"');
    });
    const answers = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id?: string; result?: unknown });
    expect(answers.find((m) => m.id === 'c1')?.result).toEqual([null, null]);
    expect(answers.find((m) => m.id === 'c2')?.result).toEqual([]);
    expect(answers.find((m) => m.id === 'c3')?.result).toBeNull();
    expect(answers.find((m) => m.id === 'c4')?.result).toEqual([
      { uri: uriOf(root), name: root.split('/').at(-1) },
    ]);
    expect(await servers.definitions(root, file, at(0, 0))).toEqual([
      { path: pathOf('file:///x/y.ts'), line: 4, column: 2 },
    ]);
    // The same text again isn't sent again; changed, it is.
    const changes = () => readFileSync(log, 'utf8').split('didChange').length - 1;
    expect(changes()).toBe(0);
    await servers.definitions(root, { ...file, text: 'y' }, at(0, 0));
    expect(changes()).toBe(1);
  });

  it('gives up on an answer that doesn’t come in time, or an error', async () => {
    expect(
      await pool([fake('silent')], { patience: 50 }).definitions(root, file, at(0, 0)),
    ).toBeNull();
    expect(await pool([fake('fails')]).definitions(root, file, at(0, 0))).toBeNull();
  });

  it('forgets a server that exits, and starts another when asked again', async () => {
    const servers = pool([fake('exit')]);
    const first = servers.serverFor(root, file.path)?.server;
    await expect(first?.ready).rejects.toThrow();
    await vi.waitFor(() => {
      expect(servers.size).toBe(0);
    });
    expect(first?.exited).toBe(true);
    expect(await servers.definitions(root, file, at(0, 0))).toBeNull();
    servers.open(root, file);
  });

  it('stops a server unused for a while, and keeps one in use', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const servers = pool([fake('links')], { idleAfter: 1_000 });
      const server = servers.serverFor(root, file.path)?.server;
      vi.advanceTimersByTime(600);
      servers.serverFor(root, file.path);
      vi.advanceTimersByTime(600);
      expect(servers.size).toBe(1);
      vi.advanceTimersByTime(600);
      expect(servers.size).toBe(0);
      vi.useRealTimers();
      await vi.waitFor(() => {
        expect(server?.exited).toBe(true);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes a server that can’t start as exited, once', async () => {
    const onExit = vi.fn();
    const missing = new LanguageServer(
      { ...fake('links'), command: () => ({ command: join(root, 'no-such-server'), args: [] }) },
      root,
      onExit,
    );
    await expect(missing.ready).rejects.toThrow();
    expect(missing.exited).toBe(true);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('takes an exit after an error, as Node may send, as the same end; and ignores broken pipes', () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
    });
    const onExit = vi.fn();
    const server = new LanguageServer(fake('links'), root, onExit, () => child as never);
    child.stdin.emit('error', new Error('EPIPE'));
    child.emit('error', new Error('gone'));
    child.emit('exit', 1);
    expect(onExit).toHaveBeenCalledOnce();
    expect(server.exited).toBe(true);
  });

  it('stops once its server has exited, so what it holds can go (CI: its folder couldn’t)', async () => {
    const server = new LanguageServer(fake('links'), root, () => undefined);
    await server.ready;
    await server.stop();
    expect(server.exited).toBe(true);
  });

  it('kills a server that won’t stop, or can’t be asked to', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stubborn = new LanguageServer(fake('stubborn'), root, () => undefined);
    vi.useRealTimers();
    await stubborn.ready;
    const stopping = stubborn.stop();
    await vi.waitFor(() => {
      expect(stubborn.exited).toBe(true);
    }, 5_000);
    await stopping;
    // Stopped already: nothing to do.
    await stubborn.stop();
    // A server whose process has no pipes can't be asked.
    const piped = new LanguageServer(
      fake('links'),
      root,
      () => undefined,
      (command, args, cwd) => spawn(command, args, { cwd, stdio: 'ignore' }),
    );
    await piped.stop();
    await vi.waitFor(() => {
      expect(piped.exited).toBe(true);
    });
  });

  it('keeps a stopped server’s replacement when the old one’s exit comes late', async () => {
    const servers = pool([fake('links')]);
    const old = servers.serverFor(root, file.path)?.server;
    await old?.ready;
    const stopping = servers.dispose();
    const replacement = servers.serverFor(root, file.path)?.server;
    await stopping;
    await vi.waitFor(() => {
      expect(old?.exited).toBe(true);
    });
    expect(servers.size).toBe(1);
    expect(servers.serverFor(root, file.path)?.server).toBe(replacement);
  });
});
