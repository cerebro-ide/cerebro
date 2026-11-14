import { spawn, spawnSync } from 'node:child_process';
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
  actionsOf,
  completionsOf,
  hoverOf,
  highlighted,
  callsOf,
  defined,
  located,
  pathOf,
  problemsOf,
  referencesIn,
  signaturesOf,
  renamingOf,
  fileEditsOf,
  filtered,
  foldsOf,
  structureOf,
  symbolsOf,
  NO_FORMATTING,
  NO_RANGE_FORMATTING,
  uriOf,
  type FileEdits,
  type FileSymbol,
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

  it('spells a Windows path’s URI as VS Code does, as TypeScript’s server compares them', () => {
    // Its highlights are kept only for the URI asked about, spelled as it spells it: with Node's
    // `file:///C:/...`, none were (measured, Windows CI).
    expect(uriOf('C:\\Users\\a b\\x.ts', 'win32')).toBe('file:///c%3A/Users/a%20b/x.ts');
    expect(pathOf(uriOf('C:\\Users\\a.ts', 'win32'), 'win32')).toBe('C:/Users/a.ts');
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

  it('reads call hierarchy items, and incoming calls with where they call, or none', () => {
    const range = { start: { line: 3, character: 9 }, end: { line: 3, character: 10 } };
    const item = { name: 'f', kind: 12, uri: 'file:///a.ts', selectionRange: range };
    expect(callsOf(null)).toEqual([]);
    expect(callsOf([item], 'linux')).toEqual([
      { name: 'f', kind: 'function', path: '/a.ts', at: { line: 3, column: 9 }, calls: [], item },
    ]);
    const from = { ...item, detail: 'b.ts', kind: 99 };
    expect(callsOf([{ from, fromRanges: [range, range] }], 'linux')).toEqual([
      {
        name: 'f',
        detail: 'b.ts',
        path: '/a.ts',
        at: { line: 3, column: 9 },
        calls: [
          { line: 3, column: 9 },
          { line: 3, column: 9 },
        ],
        item: from,
      },
    ]);
  });

  it('reads definitions with their declarations’ lines: a link’s target, a location’s range', () => {
    const name = { start: { line: 2, character: 6 }, end: { line: 2, character: 9 } };
    const whole = { start: { line: 1, character: 0 }, end: { line: 4, character: 1 } };
    expect(defined(null)).toEqual([]);
    expect(defined({ uri: 'file:///a.ts', range: name }, 'linux')).toEqual([
      { path: '/a.ts', line: 2, column: 6, first: 2, last: 2 },
    ]);
    expect(
      defined(
        [{ targetUri: 'file:///b.ts', targetRange: whole, targetSelectionRange: name }],
        'linux',
      ),
    ).toEqual([{ path: '/b.ts', line: 2, column: 6, first: 1, last: 4 }]);
  });

  it('reads references in one file as highlights, or none', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    expect(referencesIn('/a.ts', null, 'linux')).toEqual([]);
    expect(
      referencesIn(
        '/a.ts',
        [
          { uri: 'file:///b.ts', range },
          { uri: 'file:///a.ts', range },
        ],
        'linux',
      ),
    ).toEqual([{ from: { line: 1, column: 2 }, to: { line: 1, column: 5 }, write: false }]);
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

describe('problems', () => {
  it('reads diagnostics as problems: how bad, what found them, unused or deprecated', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    const span = { from: { line: 1, column: 2 }, to: { line: 1, column: 5 } };
    expect(
      problemsOf([
        { range, severity: 1, message: 'e', source: 'ts', code: 2322 },
        { range, severity: 2, message: 'w', code: 'reportX' },
        { range, severity: 3, message: 'i' },
        { range, severity: 4, message: 'h', tags: [1, 2] },
        // None, or one LSP doesn't have: an error.
        { range, message: 'n' },
        { range, severity: 9, message: 'odd' },
      ]),
    ).toEqual([
      {
        ...span,
        severity: 'error',
        message: 'e',
        source: 'ts',
        code: '2322',
        unused: false,
        deprecated: false,
      },
      {
        ...span,
        severity: 'warning',
        message: 'w',
        code: 'reportX',
        unused: false,
        deprecated: false,
      },
      { ...span, severity: 'weak', message: 'i', unused: false, deprecated: false },
      { ...span, severity: 'hint', message: 'h', unused: true, deprecated: true },
      { ...span, severity: 'error', message: 'n', unused: false, deprecated: false },
      { ...span, severity: 'error', message: 'odd', unused: false, deprecated: false },
    ]);
    expect(problemsOf(undefined)).toEqual([]);
  });

  it('asks a server that answers for them, and waits for one that sends them unasked', async () => {
    const pulls = pool([fake('pulls')]);
    expect(await pulls.problems(root, file)).toEqual([
      expect.objectContaining({ severity: 'error', message: 'pulled' }),
    ]);
    const pushes = pool([fake('pushes')]);
    // Sent for the version it has.
    expect(await pushes.problems(root, file)).toEqual([
      expect.objectContaining({ severity: 'warning', message: 'x', code: '7', unused: true }),
    ]);
    expect((await pushes.problems(root, { ...file, text: 'y' }))?.[0]?.message).toBe('y');
    // Asked again with the same text: what was sent.
    expect((await pushes.problems(root, { ...file, text: 'y' }))?.[0]?.message).toBe('y');
    // Sent later, with no version: taken as the latest's.
    expect((await pushes.problems(root, { ...file, text: 'late' }))?.[0]?.message).toBe('late');
    // A server that sends none: no answer in time.
    const silent = pool([fake('links')], { problemsPatience: 100 });
    expect(await silent.problems(root, file)).toBeNull();
  });
});

describe('context actions', () => {
  it('reads code actions made by edits to the file asked about, as context actions', () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    const here = { 'file:///a.ts': [{ range, newText: 'x' }] };
    expect(
      actionsOf(
        '/a.ts',
        [
          { title: 'Fix', kind: 'quickfix', edit: { changes: here } },
          {
            title: 'Two',
            edit: {
              changes: {
                'file:///a.ts': [
                  { range, newText: 'a' },
                  { range, newText: 'b' },
                ],
              },
            },
          },
          // A command, alone or after its edit: the server would make the change.
          { title: 'Command', command: 'do.it' },
          { title: 'Both', edit: { changes: here }, command: { title: 'c', command: 'do.it' } },
          { title: 'Disabled', edit: { changes: here }, disabled: { reason: 'no' } },
          { title: 'Elsewhere', edit: { changes: { ...here, 'file:///b.ts': [] } } },
          { title: 'Nothing', edit: {} },
        ],
        'linux',
      ),
    ).toEqual([
      {
        title: 'Fix',
        kind: 'quickfix',
        edits: [{ from: { line: 1, column: 2 }, to: { line: 1, column: 5 }, text: 'x' }],
      },
      {
        title: 'Two',
        edits: [
          { from: { line: 1, column: 2 }, to: { line: 1, column: 5 }, text: 'a' },
          { from: { line: 1, column: 2 }, to: { line: 1, column: 5 }, text: 'b' },
        ],
      },
    ]);
    expect(actionsOf('/a.ts', null)).toEqual([]);
  });

  it('gives the server the problems at the place, as it sent them, pulled or pushed', async () => {
    // Each fake's problem spans line 0's first character: at either end of it, and not after.
    const pulls = pool([fake('pulls')]);
    expect(await pulls.contextActions(root, file, at(0, 1))).toEqual([
      { title: 'pulled', edits: [expect.objectContaining({ text: 'pulled' })] },
    ]);
    expect(await pulls.contextActions(root, file, at(0, 2))).toEqual([]);
    // A server offering no organizing of imports: no edits.
    expect(await pulls.organizeImports(root, file)).toEqual([]);
    const pushes = pool([fake('pushes')]);
    expect((await pushes.contextActions(root, file, at(0, 0)))?.map((a) => a.title)).toEqual(['x']);
    expect(await pushes.contextActions(root, file, at(1, 0))).toEqual([]);
    expect(
      await pool([fake('pushes')]).contextActions(root, { ...file, path: '/x.other' }, at(0, 0)),
    ).toBeNull();
  });
});

describe('completions', () => {
  it('reads completion items: their kind, type and module, and what they put where', () => {
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } };
    const span = { from: { line: 1, column: 0 }, to: { line: 1, column: 2 } };
    const items = [
      { label: 'alpha', kind: 10, detail: 'number', sortText: '11' },
      { label: 'run', kind: 3, labelDetails: { description: './lib' }, data: 1 },
      {
        label: 'walk',
        textEdit: { range, newText: 'walk' },
        additionalTextEdits: [{ range, newText: 'x' }],
      },
      { label: 'odd', kind: 99, insertText: 'odd()' },
    ];
    expect(completionsOf({ isIncomplete: true, items }, true)).toEqual({
      incomplete: true,
      items: [
        { label: 'alpha', kind: 'property', detail: 'number', sortText: '11', resolve: items[0] },
        { label: 'run', kind: 'function', description: './lib', resolve: items[1] },
        // Its other edits given: none to ask for.
        { label: 'walk', edit: { ...span, text: 'walk' }, extraEdits: [{ ...span, text: 'x' }] },
        { label: 'odd', insert: 'odd()', resolve: items[3] },
      ],
    });
    // A server that tells no more of them: none to ask; a list on its own: all there is.
    expect(completionsOf([items[0]], false)).toEqual({
      incomplete: false,
      items: [{ label: 'alpha', kind: 'property', detail: 'number', sortText: '11' }],
    });
    expect(completionsOf({ items: [] }, false)).toEqual({ incomplete: false, items: [] });
    expect(completionsOf(null, false)).toEqual({ incomplete: false, items: [] });
  });

  it('asks the file’s server, and for a completion’s other edits when it gives them only then', async () => {
    const servers = pool([fake('completes')]);
    const found = await servers.completions(root, file, at(0, 1));
    expect(found?.items.map((c) => c.label)).toEqual(['alpha', 'beta']);
    const beta = found?.items[1]?.resolve;
    expect(await servers.completionEdits(root, file.path, beta)).toEqual([
      { from: { line: 0, column: 0 }, to: { line: 0, column: 0 }, text: 'import beta;\n' },
    ]);
    expect(await servers.completionEdits(root, file.path, found?.items[0]?.resolve)).toEqual([]);
    // No server for the file: no answer.
    expect(await servers.completions(root, { ...file, path: '/x.other' }, at(0, 0))).toBeNull();
    expect(await servers.completionEdits(root, '/x.other', beta)).toBeNull();
    // One that offers none, and can tell no more.
    expect(await pool([fake('pulls')]).completions(root, file, at(0, 0))).toEqual({
      incomplete: false,
      items: [],
    });
  });
});

describe('hovers', () => {
  it('are Markdown: plain text escaped, code fenced, several parts apart', () => {
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } };
    expect(hoverOf({ contents: { kind: 'markdown', value: '**a**\n' }, range })).toEqual({
      text: '**a**',
    });
    expect(hoverOf({ contents: { kind: 'plaintext', value: 'a_b *c*' } })).toEqual({
      text: 'a\\_b \\*c\\*',
    });
    expect(hoverOf({ contents: ['one', { language: 'ts', value: 'let a' }] })).toEqual({
      text: 'one\n\n```ts\nlet a\n```',
    });
    // Nothing to say: none.
    expect(hoverOf({ contents: [] })).toBeNull();
    expect(hoverOf({ contents: '' })).toBeNull();
    expect(hoverOf(null)).toBeNull();
  });
});

describe('signatures', () => {
  it('are where each parameter is in its signature, given there or as its text; one is active', () => {
    expect(
      signaturesOf({
        signatures: [
          {
            label: 'add(a: number, b: number): number',
            parameters: [{ label: 'a: number' }, { label: 'b: number' }],
            activeParameter: 1,
          },
          { label: '(x, x)', parameters: [{ label: 'x' }, { label: 'x' }, { label: 'gone' }] },
          { label: '(n: int)', parameters: [{ label: [1, 7] }] },
          { label: 'none()' },
        ],
        activeSignature: 2,
        activeParameter: 0,
      }),
    ).toEqual({
      signatures: [
        {
          label: 'add(a: number, b: number): number',
          parameters: [
            { from: 4, to: 13 },
            { from: 15, to: 24 },
          ],
          active: 1,
        },
        // The second `x` after the first; one not there, at the start.
        {
          label: '(x, x)',
          parameters: [
            { from: 1, to: 2 },
            { from: 4, to: 5 },
            { from: 0, to: 4 },
          ],
          active: 0,
        },
        { label: '(n: int)', parameters: [{ from: 1, to: 7 }], active: 0 },
        // Past its parameters: none active.
        { label: 'none()', parameters: [] },
      ],
      active: 2,
    });
    expect(
      signaturesOf({ signatures: [{ label: 'f()', activeParameter: null }], activeSignature: 3 }),
    ).toEqual({ signatures: [{ label: 'f()', parameters: [] }], active: 0 });
    // Which one not said: the first.
    expect(signaturesOf({ signatures: [{ label: 'g()' }] })).toEqual({
      signatures: [{ label: 'g()', parameters: [] }],
      active: 0,
    });
    expect(signaturesOf({ signatures: [] })).toBeNull();
    expect(signaturesOf(null)).toBeNull();
  });
});

describe('rename', () => {
  const range = (line: number, from: number, to: number) => ({
    start: { line, character: from },
    end: { line, character: to },
  });
  const span = (line: number, from: number, to: number) => ({
    from: { line, column: from },
    to: { line, column: to },
  });

  it('is where the name is, with the name given or read from the text there', () => {
    const text = 'const n = 1;\nn;\n';
    expect(renamingOf({ range: range(0, 6, 7), placeholder: 'n' }, text)).toEqual({
      ...span(0, 6, 7),
      name: 'n',
    });
    expect(renamingOf(range(1, 0, 1), text)).toEqual({ ...span(1, 0, 1), name: 'n' });
    // Across lines (none measured): no name to read; on a line that isn't there, none either.
    expect(
      renamingOf({ start: { line: 0, character: 6 }, end: { line: 1, character: 1 } }, text)?.name,
    ).toBe('');
    expect(renamingOf(range(5, 0, 1), text)?.name).toBe('');
    expect(renamingOf({ defaultBehavior: true }, text)).toBeNull();
    expect(renamingOf(null, text)).toBeNull();
  });

  it('is edits by file, as a map or per version of a file; none with a file made, moved or deleted', () => {
    const edit = { range: range(0, 0, 1), newText: 'm' };
    const edited = { ...span(0, 0, 1), text: 'm' };
    expect(fileEditsOf({ changes: { [uriOf('/r/a.ts')]: [edit] } })).toEqual([
      { path: pathOf(uriOf('/r/a.ts')), edits: [edited] },
    ]);
    expect(
      fileEditsOf({
        documentChanges: [
          { textDocument: { uri: uriOf('/r/b.py'), version: null }, edits: [edit] },
        ],
      }),
    ).toEqual([{ path: pathOf(uriOf('/r/b.py')), edits: [edited] }]);
    expect(
      fileEditsOf({ documentChanges: [{ kind: 'rename', oldUri: 'a', newUri: 'b' }] }),
    ).toBeNull();
    expect(fileEditsOf({})).toEqual([]);
    expect(fileEditsOf(null)).toBeNull();
  });

  it('tells a server of the files it names before they’re renamed: by glob, kind and scheme', () => {
    // TypeScript's server's (measured, 7.0.2).
    const ts = [{ scheme: 'file', pattern: { glob: '**/*.{ts,tsx,js,jsx,cts,cjs,mts,mjs,json}' } }];
    expect(filtered(ts, '/r/src/a.ts', false)).toBe(true);
    expect(filtered(ts, 'C:\\r\\a.tsx', false)).toBe(true);
    expect(filtered(ts, '/r/a.css', false)).toBe(false);
    expect(filtered(ts, '/r/A.TS', false)).toBe(false);
    expect(
      filtered([{ pattern: { glob: '**/*.ts', options: { ignoreCase: true } } }], '/r/A.TS', false),
    ).toBe(true);
    // Only files, or only folders; another scheme's, none.
    const files = [{ pattern: { glob: '**/src', matches: 'file' as const } }];
    expect(filtered(files, '/r/src', true)).toBe(false);
    expect(filtered(files, '/r/src', false)).toBe(true);
    const folders = [{ pattern: { glob: '**/src', matches: 'folder' as const } }];
    expect(filtered(folders, '/r/src', false)).toBe(false);
    expect(filtered(folders, '/r/src', true)).toBe(true);
    expect(filtered([{ scheme: 'untitled', pattern: { glob: '**' } }], '/r/a.ts', false)).toBe(
      false,
    );
  });

  it('asks a server nothing before a file’s renamed when it names no files', async () => {
    expect(await pool([fake('links')]).willRename(root, file.path, `${root}/b.fake`)).toBeNull();
  });

  it('says why a server won’t rename, and nothing when it’s gone', async () => {
    const fails = pool([fake('fails')]);
    expect(await fails.renaming(root, file, at(0, 0))).toEqual({ refused: 'Not here.' });
    expect(await fails.rename(root, file, at(0, 0), 'y')).toEqual({ refused: 'Not here.' });
    const links = pool([fake('links')]);
    expect(await links.renaming(root, file, at(0, 0))).toBeNull();
    expect(await links.rename(root, file, at(0, 0), 'y')).toBeNull();
    expect(await pool([fake('dies')]).renaming(root, file, at(0, 0))).toBeNull();
    expect(await pool([fake('dies')]).rename(root, file, at(0, 0), 'y')).toBeNull();
  });
});

describe('file structure', () => {
  const range = (line: number, from: number, to: number) => ({
    start: { line, character: from },
    end: { line, character: to },
  });

  it('is the symbols as the server nests them, or nested by their ranges when flat', () => {
    const nested = [
      { name: 'A', kind: 5, range: range(0, 0, 9), selectionRange: range(0, 6, 7), children: [] },
    ];
    expect(symbolsOf(nested)).toBe(nested);
    const flat = (name: string, line: number, from: number, to: number) => ({
      name,
      kind: 12,
      location: { uri: 'file:///a.sh', range: range(line, from, to) },
    });
    const symbol = (name: string, line: number, from: number, to: number, children = []) => ({
      name,
      kind: 12,
      range: range(line, from, to),
      selectionRange: range(line, from, to),
      children,
    });
    expect(
      symbolsOf([
        flat('greet', 0, 0, 30),
        flat('who', 0, 10, 16),
        flat('inner', 0, 18, 24),
        flat('bye', 1, 0, 20),
      ]),
    ).toEqual([
      {
        ...symbol('greet', 0, 0, 30),
        children: [symbol('who', 0, 10, 16), symbol('inner', 0, 18, 24)],
      },
      symbol('bye', 1, 0, 20),
    ]);
    expect(symbolsOf(null)).toEqual([]);
  });

  it('is each symbol’s name, kind by name, extent and name’s place', () => {
    expect(
      structureOf([
        {
          name: 'A',
          kind: 5,
          range: range(0, 0, 9),
          selectionRange: range(0, 6, 7),
          children: [
            { name: 'x', kind: 99, range: range(0, 2, 3), selectionRange: range(0, 2, 3) },
          ],
        },
      ]),
    ).toEqual([
      {
        name: 'A',
        kind: 'class',
        from: { line: 0, column: 0 },
        to: { line: 0, column: 9 },
        at: { line: 0, column: 6 },
        children: [
          {
            name: 'x',
            from: { line: 0, column: 2 },
            to: { line: 0, column: 3 },
            at: { line: 0, column: 2 },
            children: [],
          },
        ],
      },
    ]);
  });

  it('is asked of the file’s server; none without one', async () => {
    const a = { path: `${root}/a.fake`, text: 'class A {\n  run() {}\n}\n' };
    const found = await pool([fake('symbols')]).structure(root, a);
    expect(found?.map((s) => [s.name, s.kind, s.children.map((c) => c.name)])).toEqual([
      ['A', 'class', ['run']],
    ]);
    expect(await pool([fake('links')]).structure(root, a)).toEqual([]);
    expect(
      await pool([fake('symbols')]).structure(root, { path: `${root}/a.txt`, text: '' }),
    ).toBeNull();
  });
});

/** A file's structure as names, a member as `Owner.name`, each with its kind. */
const outline = (symbols: readonly FileSymbol[], owner = ''): string[] =>
  symbols.flatMap((s) => [
    `${owner}${s.name} ${s.kind ?? ''}`,
    ...outline(s.children, `${owner}${s.name}.`),
  ]);

describe('formatting', () => {
  const options = { tabSize: 2, insertSpaces: true };
  const range = { from: { line: 0, column: 0 }, to: { line: 0, column: 1 } };

  it('is the server’s edits, or why it won’t: it doesn’t format, or not a part', async () => {
    const formats = pool([fake('formats')]);
    expect(await formats.format(root, file, options)).toEqual([
      { from: { line: 0, column: 0 }, to: { line: 0, column: 0 }, text: '  ' },
    ]);
    expect(await formats.format(root, file, options, range)).toEqual({
      refused: NO_RANGE_FORMATTING,
    });
    expect(await pool([fake('links')]).format(root, file, options)).toEqual({
      refused: NO_FORMATTING,
    });
    const fails = pool([fake('fails')]);
    expect(await fails.format(root, file, options)).toEqual({ refused: 'Not formatted.' });
    expect(await fails.format(root, file, options, range)).toEqual([]);
    expect(await fails.format(root, { path: `${root}/a.txt`, text: '' }, options)).toBeNull();
  });
});

describe('folds', () => {
  it('are the server’s ranges, a character left out its line’s end', () => {
    const text = 'a {\n  b\n}\n';
    expect(
      foldsOf(
        [
          { startLine: 0, startCharacter: 2, endLine: 2, endCharacter: 1 },
          { startLine: 0, endLine: 1, kind: 'region', collapsedText: 'R' },
          // Past the text's end: the server's, as it is.
          { startLine: 7, endLine: 8 },
        ],
        text,
      ),
    ).toEqual([
      { from: { line: 0, column: 2 }, to: { line: 2, column: 1 } },
      {
        from: { line: 0, column: 3 },
        to: { line: 1, column: 3 },
        kind: 'region',
        collapsedText: 'R',
      },
      { from: { line: 7, column: 0 }, to: { line: 8, column: 0 } },
    ]);
    expect(foldsOf(null, text)).toEqual([]);
  });

  it('are none from a server that doesn’t fold', async () => {
    expect(await pool([fake('links')]).folds(root, file)).toBeNull();
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

  it('goes to what implements a symbol, and to the type of one', async () => {
    const project = `${root}/ts-types`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    const a = {
      path: `${project}/a.ts`,
      text:
        'interface Shape { area(): number }\n' +
        'class Square implements Shape { area() { return 1; } }\n' +
        'const shape: Shape = new Square();\n',
    };
    writeFileSync(a.path, a.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.implementations(project, a, at(0, 11))).toEqual([
      { path: a.path, line: 1, column: 6 },
    ]);
    expect(await servers.typeDefinitions(project, a, at(2, 7))).toEqual([
      { path: a.path, line: 0, column: 10 },
    ]);
    // The declaration's lines, Quick Definition's: the whole function.
    const c = { path: `${project}/c.ts`, text: 'function f() {\n  return 1;\n}\nf();\n' };
    writeFileSync(c.path, c.text);
    expect(await servers.definitionSpans(project, c, at(3, 0))).toEqual([
      { path: c.path, line: 0, column: 9, first: 0, last: 2 },
    ]);
  }, 60_000);

  it('finds a function’s callers, and theirs, with where they call it', async () => {
    const project = `${root}/ts-calls`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    const a = {
      path: `${project}/a.ts`,
      text:
        'export function area() { return 1; }\n' +
        'function twice() { return area() + area(); }\n' +
        'export function top() { return twice(); }\n',
    };
    writeFileSync(a.path, a.text);
    const servers = pool(undefined, { patience: 60_000 });
    const [root_] = (await servers.prepareCalls(project, a, at(0, 17))) ?? [];
    expect(root_).toMatchObject({ name: 'area', path: a.path, at: { line: 0, column: 16 } });
    const callers = (await servers.incomingCalls(project, a.path, root_?.item)) ?? [];
    expect(callers).toMatchObject([
      {
        name: 'twice',
        path: a.path,
        at: { line: 1, column: 9 },
        calls: [
          { line: 1, column: 26 },
          { line: 1, column: 35 },
        ],
      },
    ]);
    expect(await servers.incomingCalls(project, a.path, callers[0]?.item)).toMatchObject([
      { name: 'top', at: { line: 2, column: 16 }, calls: [{ line: 2, column: 31 }] },
    ]);
  }, 60_000);

  it('organizes a file’s imports: the unused gone, the rest in order', async () => {
    const project = `${root}/ts-imports`;
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    writeFileSync(join(project, 'a.ts'), 'export const a = 1;\nexport const z = 2;\n');
    const b = {
      path: `${project}/b.ts`,
      text: "import { z, a } from './a';\nimport { readFileSync } from 'node:fs';\nconsole.log(a, z);\n",
    };
    writeFileSync(b.path, b.text);
    const servers = pool(undefined, { patience: 60_000 });
    const edits = (await servers.organizeImports(project, b)) ?? [];
    expect(edits).toEqual([
      {
        from: { line: 0, column: 0 },
        to: { line: 1, column: 0 },
        text: "import { a, z } from './a';\n",
      },
      { from: { line: 1, column: 0 }, to: { line: 2, column: 0 }, text: '' },
    ]);
    // Organized already: the same text again (measured), which the editor takes as no change.
    const done = { ...b, text: "import { a, z } from './a';\nconsole.log(a, z);\n" };
    expect(await servers.organizeImports(project, done)).toEqual([
      {
        from: { line: 0, column: 0 },
        to: { line: 1, column: 0 },
        text: "import { a, z } from './a';\n",
      },
    ]);
  }, 60_000);

  it('finds a file’s problems, in unsaved text too', async () => {
    const project = `${root}/ts`;
    const bad = { path: `${project}/bad.ts`, text: 'const n: number = "x";\nexport {};\n' };
    writeFileSync(bad.path, bad.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.problems(project, bad)).toEqual(
      expect.arrayContaining([
        {
          from: { line: 0, column: 6 },
          to: { line: 0, column: 7 },
          severity: 'error',
          message: "Type 'string' is not assignable to type 'number'.",
          source: 'ts',
          code: '2322',
          unused: false,
          deprecated: false,
        },
        // Declared, never read: a hint, shown as unused.
        expect.objectContaining({ severity: 'hint', code: '6133', unused: true }),
      ]),
    );
    // Edited, not saved: none.
    expect(await servers.problems(project, { ...bad, text: 'export const n = 1;\n' })).toEqual([]);
  }, 60_000);

  it('completes a member, and a function from another file with its import', async () => {
    const project = `${root}/ts`;
    writeFileSync(join(project, 'values.ts'), 'export const value = { alpha: 1, beta: "b" };\n');
    const main = {
      path: `${project}/complete.ts`,
      text: "import { value } from './values';\nvalue.al\ntarg\n",
    };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    const members = await servers.completions(project, main, at(1, 8));
    // Every member: the client matches them to what's typed.
    expect(members?.items.map((c) => [c.label, c.kind])).toEqual([
      // LSP's Field: TypeScript's kind for an object's members (measured).
      ['alpha', 'field'],
      ['beta', 'field'],
    ]);
    const names = await servers.completions(project, main, at(2, 4));
    const target = names?.items.find((c) => c.label === 'target');
    expect(target).toMatchObject({ kind: 'function', description: './a' });
    // Its import only when asked about it (measured).
    expect(target?.extraEdits).toBeUndefined();
    expect(await servers.completionEdits(project, main.path, target?.resolve)).toEqual([
      {
        from: { line: 0, column: 0 },
        to: { line: 0, column: 0 },
        // In the file's quotes.
        text: "import { target } from './a';\n",
      },
    ]);
  }, 60_000);

  it('says what a symbol is: its definition, and its documentation, as Markdown', async () => {
    const project = `${root}/ts`;
    writeFileSync(
      join(project, 'documented.ts'),
      '/**\n * Counts the things.\n * @param count How many.\n */\nexport function tally(count: number) {\n  return count;\n}\n',
    );
    const main = {
      path: `${project}/hover.ts`,
      text: "import { tally } from './documented';\ntally(2);\n",
    };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.hover(project, main, at(1, 2))).toEqual({
      text: '```typescript\n(alias) function tally(count: number): number\n```\nCounts the things.\n\n*@param* `count` — How many.',
    });
    // Nothing there: none.
    expect(await servers.hover(project, main, at(2, 0))).toBeNull();
  }, 60_000);

  it('changes the imports of a file renamed, before it’s renamed', async () => {
    const project = `${root}/ts`;
    writeFileSync(`${project}/sums.ts`, 'export const sum = 1;\n');
    const user = { path: `${project}/totals.ts`, text: "import { sum } from './sums';\nsum;\n" };
    writeFileSync(user.path, user.text);
    const servers = pool(undefined, { patience: 60_000 });
    // Open, so the server has the project loaded, as the editor has it.
    servers.open(project, user);
    const edits = await servers.willRename(project, `${project}/sums.ts`, `${project}/adds.ts`);
    expect(edits).toEqual([
      {
        path: user.path,
        edits: [{ from: { line: 0, column: 21 }, to: { line: 0, column: 27 }, text: './adds' }],
      },
    ]);
  }, 60_000);

  it('tells a class from its constructor where `new` goes to both', async () => {
    const project = `${root}/ts`;
    writeFileSync(
      `${project}/figure.ts`,
      'export class Figure {\n  constructor(public x: number) {}\n}\n',
    );
    const user = {
      path: `${project}/draw.ts`,
      text: "import { Figure } from './figure';\nnew Figure(1);\n",
    };
    writeFileSync(user.path, user.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.definitions(project, user, at(1, 6))).toEqual([
      { path: `${project}/figure.ts`, line: 0, column: 13, name: 'Figure', kind: 'class' },
      {
        path: `${project}/figure.ts`,
        line: 1,
        column: 2,
        name: 'constructor',
        kind: 'constructor',
      },
    ]);
  }, 60_000);

  it('renames a function everywhere from where it’s used, not with an alias in the import', async () => {
    const project = `${root}/ts`;
    writeFileSync(`${project}/tally.ts`, 'export function tally(n: number) {\n  return n;\n}\n');
    const user = {
      path: `${project}/counts.ts`,
      text: "import { tally } from './tally';\ntally(1);\nconst s = 'x';\n",
    };
    writeFileSync(user.path, user.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.renaming(project, user, at(1, 2))).toEqual({
      from: { line: 1, column: 0 },
      to: { line: 1, column: 5 },
      name: 'tally',
    });
    const edits = await servers.rename(project, user, at(1, 2), 'count');
    const columns = (path: string) =>
      (edits as FileEdits[])
        .find((file) => file.path === path)
        ?.edits.map((edit) => [edit.from.line, edit.from.column, edit.text]);
    expect(columns(`${project}/tally.ts`)).toEqual([[0, 16, 'count']]);
    expect(columns(user.path)).toEqual([
      [0, 9, 'count'],
      [1, 0, 'count'],
    ]);
    // A string: TypeScript's words for why not.
    expect(await servers.renaming(project, user, at(2, 11))).toEqual({
      refused: 'You cannot rename this element.',
    });
  }, 60_000);

  it('says what’s called at a place: its signature, and the parameter the place is at', async () => {
    const project = `${root}/ts`;
    const main = {
      path: `${project}/called.ts`,
      text: 'function add(a: number, b = 2) { return a + b; }\nadd(1, \n',
    };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.signatures(project, main, at(1, 7))).toEqual({
      signatures: [
        {
          label: 'add(a: number, b?: number): number',
          parameters: [
            { from: 4, to: 13 },
            { from: 15, to: 25 },
          ],
          active: 1,
        },
      ],
      active: 0,
    });
    // Outside the call: nothing.
    expect(await servers.signatures(project, main, at(0, 0))).toBeNull();
  }, 60_000);

  it('offers the fixes for the problem at the caret, as edits', async () => {
    const project = `${root}/ts`;
    const main = { path: `${project}/fix.ts`, text: "target();\nconst n: number = 'x';\n" };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.contextActions(project, main, at(0, 2))).toContainEqual({
      title: 'Add import from "./a"',
      kind: 'quickfix',
      edits: [
        {
          from: { line: 0, column: 0 },
          to: { line: 0, column: 0 },
          text: 'import { target } from "./a";\n\n',
        },
      ],
    });
    // Where there's no problem, none (measured: it offers fixes only for the problems it's given).
    expect(await servers.contextActions(project, main, at(1, 0))).toEqual([]);
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

describe('highlights a name reached through a module’s exports', () => {
  it('highlights it from its references, where the server’s highlights have none', async () => {
    // As eslint-plugin-react-hooks' `configs`: a constant exported by name, reached as a member of
    // the module (TypeScript 7 highlights none of it, measured, but finds its references).
    const project = `${root}/alias`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, 'tsconfig.json'),
      '{ "compilerOptions": { "esModuleInterop": true }, "include": ["src"] }',
    );
    const plugin = join(project, 'node_modules', 'plugin');
    mkdirSync(join(plugin, 'cjs'), { recursive: true });
    writeFileSync(join(plugin, 'package.json'), '{ "name": "plugin", "types": "./index.d.ts" }');
    writeFileSync(join(plugin, 'index.d.ts'), "export * from './cjs/plugin';\n");
    writeFileSync(
      join(plugin, 'cjs', 'plugin.d.ts'),
      'declare const configs: { recommended: number };\nexport { configs };\n',
    );
    // Outside the project's files, as an eslint.config.js is.
    const main = {
      path: `${project}/main.js`,
      text: "import plugin from 'plugin';\nplugin.configs.recommended;\nplugin.configs;\n",
    };
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.highlights(project, main, at(1, 9))).toEqual([
      { from: { line: 1, column: 7 }, to: { line: 1, column: 14 }, write: false },
      { from: { line: 2, column: 7 }, to: { line: 2, column: 14 }, write: false },
    ]);
  }, 60_000);
});

describe('file structure, from the real servers', () => {
  it('is a TypeScript file’s types, their members, and its functions', async () => {
    const project = `${root}/ts`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    const shapes = {
      path: `${project}/shapes.ts`,
      text: [
        'export class Square {',
        '  side = 1;',
        '  area(): number { return this.side ** 2; }',
        '}',
        'export function make(): Square { return new Square(); }',
        '',
      ].join('\n'),
    };
    const found = await pool(undefined, { patience: 60_000 }).structure(project, shapes);
    expect(outline(found ?? [])).toEqual([
      'Square class',
      'Square.side property',
      'Square.area method',
      'make function',
    ]);
    expect(found?.[0]).toMatchObject({
      from: { line: 0, column: 0 },
      to: { line: 3, column: 1 },
      at: { line: 0, column: 13 },
    });
  }, 60_000);

  it('is a Python file’s classes, their methods, and its functions', async () => {
    const project = `${root}/py`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    const shapes = {
      path: `${project}/shapes.py`,
      text: 'class Square:\n    def area(self):\n        return 1\n\ndef make():\n    return Square()\n',
    };
    const found = await pool(undefined, { patience: 60_000 }).structure(project, shapes);
    expect(outline(found ?? [])).toEqual(
      expect.arrayContaining(['Square class', 'Square.area method', 'make function']),
    );
  }, 60_000);

  it('is a script’s functions, their variables in them, though the server lists them flat', async () => {
    const project = `${root}/sh`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    const script = {
      path: `${project}/structure.sh`,
      text: 'NAME=1\ngreet() { local who=$1; echo hi; }\nfunction bye { echo bye; }\n',
    };
    const found = await pool(undefined, { patience: 60_000 }).structure(project, script);
    expect(outline(found ?? [])).toEqual([
      'NAME variable',
      'greet function',
      'greet.who variable',
      'bye function',
    ]);
  }, 60_000);
});

describe('formatting, by the real servers', () => {
  const options = { tabSize: 2, insertSpaces: true };
  /** `text` with `edits` made, the last first. */
  const applied = (text: string, edits: FileEdits['edits']) => {
    const lines = text.split('\n');
    const offset = (at: { line: number; column: number }) =>
      lines.slice(0, at.line).reduce((n, line) => n + line.length + 1, 0) + at.column;
    return [...edits]
      .sort((a, b) => offset(b.from) - offset(a.from))
      .reduce((t, e) => t.slice(0, offset(e.from)) + e.text + t.slice(offset(e.to)), text);
  };

  it('formats a TypeScript file, or the lines selected', async () => {
    const project = `${root}/ts`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }');
    const text = 'function f( a:number ){\nreturn a+1}\nconst x={a:1}\n';
    const messy = { path: `${project}/messy.ts`, text };
    const servers = pool(undefined, { patience: 60_000 });
    const all = (await servers.format(project, messy, options)) as FileEdits['edits'];
    expect(applied(text, all)).toBe(
      'function f(a: number) {\n  return a + 1\n}\nconst x = { a: 1 }\n',
    );
    const third = { from: { line: 2, column: 0 }, to: { line: 2, column: 13 } };
    const part = (await servers.format(project, messy, options, third)) as FileEdits['edits'];
    expect(applied(text, part)).toBe('function f( a:number ){\nreturn a+1}\nconst x = { a: 1 }\n');
  }, 60_000);

  it('formats a YAML file; a Python file not, basedpyright doesn’t format', async () => {
    const yaml = { path: `${root}/yaml/messy.yaml`, text: 'a:   1\nb:\n    - x\n' };
    const { mkdirSync } = await import('node:fs');
    mkdirSync(`${root}/yaml`, { recursive: true });
    mkdirSync(`${root}/py`, { recursive: true });
    const servers = pool(undefined, { patience: 60_000 });
    const edits = (await servers.format(`${root}/yaml`, yaml, options)) as FileEdits['edits'];
    expect(applied(yaml.text, edits)).toBe('a: 1\nb:\n  - x\n');
    const python = { path: `${root}/py/messy.py`, text: 'x  =  1\n' };
    expect(await servers.format(`${root}/py`, python, options)).toEqual({
      refused: NO_FORMATTING,
    });
  }, 60_000);

  it('formats a script through shfmt, and nothing without it', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(`${root}/sh`, { recursive: true });
    const script = { path: `${root}/sh/messy.sh`, text: 'f() {\necho  hi\n}\n' };
    const servers = pool(undefined, { patience: 60_000 });
    const edits = (await servers.format(`${root}/sh`, script, options)) as FileEdits['edits'];
    // Without shfmt on the PATH, bash-language-server answers no edits (measured).
    const shfmt =
      spawnSync(process.platform === 'win32' ? 'where' : 'which', ['shfmt']).status === 0;
    expect(applied(script.text, edits)).toBe(shfmt ? 'f() {\n  echo hi\n}\n' : script.text);
  }, 60_000);
});

describe('folds, by the real servers', () => {
  it('fold a TypeScript file’s imports, comments, blocks and regions; a YAML file’s too', async () => {
    const project = `${root}/tsf`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'tsconfig.json'), '{}');
    const text = [
      "import { a } from './a';",
      "import { b } from './b';",
      '/**',
      ' * Docs.',
      ' */',
      'export function run() {',
      '  return 1;',
      '}',
      '// #region Setup',
      'const z = 1;',
      '// #endregion',
      '',
    ].join('\n');
    const servers = pool(undefined, { patience: 60_000 });
    // As measured: the block from the space before its brace, the region named.
    expect(await servers.folds(project, { path: `${project}/f.ts`, text })).toEqual([
      { from: { line: 0, column: 0 }, to: { line: 1, column: 24 }, kind: 'imports' },
      { from: { line: 2, column: 0 }, to: { line: 4, column: 3 }, kind: 'comment' },
      { from: { line: 5, column: 21 }, to: { line: 7, column: 1 } },
      {
        from: { line: 8, column: 0 },
        to: { line: 10, column: 13 },
        kind: 'region',
        collapsedText: 'Setup',
      },
    ]);
    mkdirSync(`${root}/yaml`, { recursive: true });
    const yaml = { path: `${root}/yaml/f.yaml`, text: 'a:\n  b: 1\n' };
    expect(await servers.folds(`${root}/yaml`, yaml)).toEqual([
      { from: { line: 0, column: 0 }, to: { line: 1, column: 6 } },
    ]);
  }, 60_000);

  it('are none for a Python file: basedpyright doesn’t fold', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(`${root}/py`, { recursive: true });
    const python = { path: `${root}/py/f.py`, text: 'def f():\n    pass\n' };
    expect(await pool(undefined, { patience: 60_000 }).folds(`${root}/py`, python)).toBeNull();
  }, 60_000);
});

describe('gutter markers, from TypeScript’s server', () => {
  it('marks what a member implements or overrides, and what implements or overrides it', async () => {
    const project = `${root}/tsm`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'tsconfig.json'), '{}');
    writeFileSync(
      join(project, 'shape.ts'),
      'export interface Shape {\n  area(): number;\n  name: string;\n}\n',
    );
    const base = [
      "import { Shape } from './shape';",
      'export abstract class Base implements Shape {',
      "  name = 'b';",
      '  abstract area(): number;',
      "  describe() { return 'x'; }",
      '}',
      '',
    ].join('\n');
    writeFileSync(join(project, 'base.ts'), base);
    writeFileSync(
      join(project, 'square.ts'),
      [
        "import { Base } from './base';",
        'export class Square extends Base {',
        '  area() { return 1; }',
        "  describe() { return 'sq'; }",
        '  own() {}',
        '}',
        '',
      ].join('\n'),
    );
    const servers = pool(undefined, { patience: 60_000 });
    const markers = await servers.markers(project, { path: `${project}/base.ts`, text: base });
    const at = (file: string, line: number, column: number) => ({
      path: `${project}/${file}`,
      line,
      column,
    });
    expect(markers).toEqual([
      {
        line: 1,
        kind: 'implemented',
        name: 'Base',
        targets: [at('square.ts', 1, 13)],
        owners: ['Square'],
      },
      {
        line: 2,
        kind: 'implements',
        name: 'name',
        targets: [at('shape.ts', 2, 2)],
        owners: ['Shape'],
      },
      {
        line: 3,
        kind: 'implements',
        name: 'area',
        targets: [at('shape.ts', 1, 2)],
        owners: ['Shape'],
      },
      {
        line: 3,
        kind: 'implemented',
        name: 'area',
        targets: [at('square.ts', 2, 2)],
        owners: ['Square'],
      },
      {
        line: 4,
        kind: 'overridden',
        name: 'describe',
        targets: [at('square.ts', 3, 2)],
        owners: ['Square'],
      },
    ]);
    // From the subclass, in a file never opened: up to the nearest base, through the files above.
    const square = await servers.markers(project, {
      path: `${project}/square.ts`,
      text: readFileSync(join(project, 'square.ts'), 'utf8'),
    });
    expect(square).toEqual([
      {
        line: 2,
        kind: 'implements',
        name: 'area',
        targets: [at('base.ts', 3, 11)],
        owners: ['Base'],
      },
      {
        line: 3,
        kind: 'overrides',
        name: 'describe',
        targets: [at('base.ts', 4, 2)],
        owners: ['Base'],
      },
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

  it('finds a file’s problems, in unsaved text too', async () => {
    const project = `${root}/py`;
    const bad = { path: `${project}/bad.py`, text: 'x: int = "s"\n' };
    writeFileSync(bad.path, bad.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.problems(project, bad)).toEqual([
      expect.objectContaining({
        from: { line: 0, column: 9 },
        to: { line: 0, column: 12 },
        severity: 'error',
        source: 'basedpyright',
        code: 'reportAssignmentType',
      }),
    ]);
    expect(await servers.problems(project, { ...bad, text: 'x: int = 1\n' })).toEqual([]);
  }, 60_000);

  it('completes a name from another file, with its import', async () => {
    const project = `${root}/py`;
    const main = { path: `${project}/complete.py`, text: 'targ\n' };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    const found = await servers.completions(project, main, at(0, 4));
    // Only what matches so far: asked again as typed.
    expect(found?.incomplete).toBe(true);
    expect(found?.items).toContainEqual(
      expect.objectContaining({
        label: 'target',
        kind: 'function',
        description: 'a',
        edit: { from: { line: 0, column: 0 }, to: { line: 0, column: 4 }, text: 'target' },
        extraEdits: [
          expect.objectContaining({
            text: expect.stringContaining('from a import target') as string,
          }),
        ],
      }),
    );
  }, 60_000);

  it('says what a symbol is: its definition, and its docstring, as Markdown', async () => {
    const project = `${root}/py`;
    writeFileSync(
      join(project, 'documented.py'),
      'def walk(n: int) -> str:\n    """Walks n steps."""\n    return ""\n',
    );
    const main = { path: `${project}/hover.py`, text: 'from documented import walk\nwalk(1)\n' };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.hover(project, main, at(1, 2))).toEqual({
      text: '```python\n(function) def walk(n: int) -> str\n```\n---\nWalks n steps.',
    });
  }, 60_000);

  it('renames a function where it’s defined and imported, as edits per file', async () => {
    const project = `${root}/py`;
    writeFileSync(`${project}/strolls.py`, 'def stroll():\n    pass\n');
    const user = { path: `${project}/walks.py`, text: 'from strolls import stroll\n\nstroll()\n' };
    writeFileSync(user.path, user.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.renaming(project, user, at(2, 1))).toEqual({
      from: { line: 2, column: 0 },
      to: { line: 2, column: 6 },
      name: 'stroll',
    });
    const edits = (await servers.rename(project, user, at(2, 1), 'amble')) as FileEdits[];
    expect(
      Object.fromEntries(edits.map((file) => [file.path, file.edits.map((e) => e.from)])),
    ).toEqual({
      [`${project}/strolls.py`]: [{ line: 0, column: 4 }],
      [user.path]: [
        { line: 0, column: 20 },
        { line: 2, column: 0 },
      ],
    });
  }, 60_000);

  it('says what’s called at a place: its signature, and the parameter the place is at', async () => {
    const project = `${root}/py`;
    const main = {
      path: `${project}/called.py`,
      text: 'def walk(n: int, fast: bool = False) -> str:\n    return ""\n\nwalk(1, \n',
    };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.signatures(project, main, at(3, 8))).toEqual({
      signatures: [
        {
          label: '(n: int, fast: bool = False) -> str',
          parameters: [
            { from: 1, to: 7 },
            { from: 9, to: 27 },
          ],
          active: 1,
        },
      ],
      active: 0,
    });
  }, 60_000);

  it('offers the fixes for the problem at the caret, as edits', async () => {
    const project = `${root}/py`;
    const main = { path: `${project}/fix.py`, text: 'target()\n' };
    writeFileSync(main.path, main.text);
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.contextActions(project, main, at(0, 2))).toContainEqual({
      title: 'from a import target',
      kind: 'quickfix',
      edits: [
        { from: { line: 0, column: 0 }, to: { line: 0, column: 6 }, text: 'target' },
        {
          from: { line: 0, column: 0 },
          to: { line: 0, column: 0 },
          // Two blank lines after it, as PEP 8 has after imports.
          text: 'from a import target\n\n\n',
        },
      ],
    });
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

describe('gutter markers, from basedpyright', () => {
  it('marks what a method overrides, and what overrides it', async () => {
    const project = `${root}/pym`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project, { recursive: true });
    const base = [
      'from abc import ABC, abstractmethod',
      '',
      'class Base(ABC):',
      '    @abstractmethod',
      '    def area(self):',
      '        pass',
      '',
      '    def describe(self):',
      '        return "x"',
      '',
    ].join('\n');
    writeFileSync(join(project, 'base.py'), base);
    const square = [
      'from base import Base',
      '',
      'class Square(Base):',
      '    def area(self):',
      '        return 1',
      '',
      '    def describe(self):',
      '        return "sq"',
      '',
    ].join('\n');
    writeFileSync(join(project, 'square.py'), square);
    const servers = pool(undefined, { patience: 60_000 });
    const at = (file: string, line: number, column: number) => ({
      path: `${project}/${file}`,
      line,
      column,
    });
    expect(await servers.markers(project, { path: `${project}/square.py`, text: square })).toEqual([
      {
        line: 3,
        kind: 'implements',
        name: 'area',
        targets: [at('base.py', 4, 8)],
        owners: ['Base'],
      },
      {
        line: 6,
        kind: 'overrides',
        name: 'describe',
        targets: [at('base.py', 7, 8)],
        owners: ['Base'],
      },
    ]);
    expect(await servers.markers(project, { path: `${project}/base.py`, text: base })).toEqual([
      {
        line: 2,
        kind: 'overridden',
        name: 'Base',
        targets: [at('square.py', 2, 6)],
        owners: ['Square'],
      },
      {
        line: 4,
        kind: 'implemented',
        name: 'area',
        targets: [at('square.py', 3, 8)],
        owners: ['Square'],
      },
      {
        line: 7,
        kind: 'overridden',
        name: 'describe',
        targets: [at('square.py', 6, 8)],
        owners: ['Square'],
      },
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

  it('renames a function in the scripts that source its own', async () => {
    const project = `${root}/sh`;
    const main = { path: `${project}/main.sh`, text: 'source ./lib.sh\n\ngreet\n' };
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.renaming(project, main, at(2, 1))).toEqual({
      from: { line: 2, column: 0 },
      to: { line: 2, column: 5 },
      name: 'greet',
    });
    const edits = (await servers.rename(project, main, at(2, 1), 'hello')) as FileEdits[];
    // In one never opened too (measured).
    expect(Object.fromEntries(edits.map((file) => [file.path, file.edits]))).toEqual({
      [`${project}/lib.sh`]: [
        { from: { line: 0, column: 0 }, to: { line: 0, column: 5 }, text: 'hello' },
      ],
      [`${project}/main.sh`]: [
        { from: { line: 2, column: 0 }, to: { line: 2, column: 5 }, text: 'hello' },
      ],
      [`${project}/other.sh`]: [
        { from: { line: 1, column: 0 }, to: { line: 1, column: 5 }, text: 'hello' },
      ],
    });
  }, 60_000);

  it('highlights a name where it is in its script', async () => {
    const project = `${root}/sh`;
    const main = { path: `${project}/main.sh`, text: 'source ./lib.sh\n\ngreet\ngreet\n' };
    const servers = pool(undefined, { patience: 60_000 });
    const found = await servers.highlights(project, main, at(2, 1));
    expect(found?.map((h) => h.from.line)).toEqual([2, 3]);
  }, 60_000);
});

describe('yaml-language-server, for YAML', () => {
  const project = `${root}/yaml`;
  // A schema of its own, named in the file (SchemaStore's come from the network).
  const SCHEMA = JSON.stringify({
    type: 'object',
    properties: {
      name: { type: 'string', description: 'What it’s called.' },
      count: { type: 'number' },
    },
    additionalProperties: false,
  });
  const header = '# yaml-language-server: $schema=./schema.json\n';

  it('finds a file’s problems: its syntax, and against its schema', async () => {
    rmSync(project, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(project);
    writeFileSync(join(project, 'schema.json'), SCHEMA);
    const servers = pool(undefined, { patience: 60_000 });
    expect(
      await servers.problems(project, { path: `${project}/a.yaml`, text: 'a: [1, 2\n' }),
    ).toEqual([expect.objectContaining({ severity: 'error', source: 'YAML' })]);
    const typo = { path: `${project}/b.yaml`, text: `${header}name: x\nnmae: y\n` };
    expect(await servers.problems(project, typo)).toEqual([
      expect.objectContaining({
        from: { line: 2, column: 0 },
        to: { line: 2, column: 4 },
        severity: 'error',
        message: 'Property nmae is not allowed.',
      }),
    ]);
  }, 60_000);

  it('says what a key is, and completes the keys its schema has', async () => {
    const main = { path: `${project}/c.yml`, text: `${header}name: x\n` };
    const servers = pool(undefined, { patience: 60_000 });
    expect((await servers.hover(project, main, at(1, 1)))?.text).toContain('What it’s called.');
    const found = await servers.completions(project, { ...main, text: `${main.text}co` }, at(2, 2));
    expect(found?.items.map((item) => item.label)).toEqual(['count']);
  }, 60_000);

  it('goes from an alias to its anchor', async () => {
    const main = { path: `${project}/d.yaml`, text: 'a: &shared 1\nb: *shared\n' };
    const servers = pool(undefined, { patience: 60_000 });
    expect(await servers.definitions(project, main, at(1, 5))).toEqual([
      { path: main.path, line: 0, column: 11 },
    ]);
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
    const started = performance.now();
    expect(await servers.definitions(root, file, at(0, 0))).toEqual([]);
    expect(performance.now() - started).toBeGreaterThanOrEqual(250);
    // Not loaded in time: no answer, so the name matches show.
    const slow = pool([loads], { patience: 100 });
    expect(await slow.definitions(root, file, at(0, 0))).toBeNull();
  });

  it('gives a server the settings its spec has, by section, when it asks', async () => {
    writeFileSync(log, '');
    const servers = pool([{ ...fake('links'), settings: { fake: { on: true } } }]);
    await servers.serverFor(root, file.path)?.server.ready;
    await vi.waitFor(() => {
      expect(readFileSync(log, 'utf8')).toContain('"id":"c1"');
    });
    const answers = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id?: string; result?: unknown });
    expect(answers.find((m) => m.id === 'c1')?.result).toEqual([null, { on: true }, null]);
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
    expect(answers.find((m) => m.id === 'c1')?.result).toEqual([null, null, null]);
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

  it('works markers out with files read from disk, or as the server has them', async () => {
    const a = { path: `${root}/a.fake`, text: 'class A extends B {\n  run() {}\n}\n' };
    writeFileSync(`${root}/b.fake`, 'class B {\n  run() {}\n}\n');
    const servers = pool([fake('symbols')]);
    const expected = [
      {
        line: 1,
        kind: 'overrides',
        name: 'run',
        targets: [{ path: `${root}/b.fake`, line: 1, column: 2 }],
        owners: ['B'],
      },
    ];
    expect(await servers.markers(root, a)).toEqual(expected);
    // b.fake is open now: as the server has it, not read again.
    rmSync(`${root}/b.fake`);
    expect(await servers.markers(root, a)).toEqual(expected);
    // None from a server with no symbols; nothing for a language without a server, an error, or no
    // answer in time.
    expect(await pool([fake('links')]).markers(root, a)).toEqual([]);
    expect(await servers.markers(root, { path: `${root}/a.txt`, text: '' })).toBeNull();
    expect(await pool([fake('fails')]).markers(root, a)).toBeNull();
    expect(await pool([fake('silent')], { markersPatience: 50 }).markers(root, a)).toBeNull();
  });

  it('names the symbol declared at each of several definitions, from its file’s symbols', async () => {
    writeFileSync(`${root}/a.fake`, 'class A {\n  run() {}\n}\n');
    const found = await pool([fake('declares')]).definitions(root, file, at(0, 0));
    expect(found).toEqual([
      { path: `${root}/a.fake`, line: 0, column: 6, name: 'A', kind: 'class' },
      // A kind LSP doesn't name: the name alone.
      { path: `${root}/a.fake`, line: 1, column: 2, name: 'run' },
      // No symbol there, or a file that can't be read: as it is.
      { path: `${root}/a.fake`, line: 2, column: 0 },
      { path: `${root}/gone.other`, line: 0, column: 0 },
    ]);
    // A file of a language the server's spec doesn't name, read: asked as the one asked about's.
    writeFileSync(`${root}/gone.other`, 'other\n');
    await pool([fake('declares')]).definitions(root, file, at(0, 0));
    expect(readFileSync(log, 'utf8')).toContain(
      '"languageId":"fake","version":1,"text":"other\\n"',
    );
    rmSync(`${root}/gone.other`);
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
