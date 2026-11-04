import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-languageserver/node';
import {
  CATALOG,
  catalogSchemas,
  plainText,
  serveWeb,
  withChanges,
  withoutSnippet,
  type Fetch,
  type WebOptions,
} from '../src/web.js';

const root = mkdtempSync(join(tmpdir(), 'cerebro-web-'));
let clients: MessageConnection[] = [];

afterEach(() => {
  for (const client of clients) client.dispose();
  clients = [];
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Problem {
  range: { start: { line: number; character: number } };
  message: string;
  source?: string;
}

/** The server, in this process, and a client of it that takes no snippets unless told. */
async function start(options: WebOptions = { catalog: null }, snippetSupport = false) {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  serveWeb(toServer, toClient, options);
  const client = createMessageConnection(
    new StreamMessageReader(toClient),
    new StreamMessageWriter(toServer),
  );
  clients.push(client);
  const problems = new Map<string, Problem[]>();
  const waiting = new Map<string, () => void>();
  client.onNotification(
    'textDocument/publishDiagnostics',
    (params: { uri: string; diagnostics: Problem[] }) => {
      problems.set(params.uri, params.diagnostics);
      waiting.get(params.uri)?.();
    },
  );
  client.listen();
  await client.sendRequest('initialize', {
    processId: null,
    rootUri: null,
    capabilities: { textDocument: { completion: { completionItem: { snippetSupport } } } },
  });
  void client.sendNotification('initialized', {});
  let version = 0;
  return {
    client,
    /** Opens a file with `text`, as `languageId`, and waits for its problems. */
    open: async (name: string, languageId: string, text: string) => {
      const uri = pathToFileURL(join(root, name)).href;
      const sent = new Promise<void>((resolve) => waiting.set(uri, resolve));
      version += 1;
      await client.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId, version, text },
      });
      await sent;
      return { uri, problems: problems.get(uri) ?? [] };
    },
    /** The problems sent next for a file. */
    next: (uri: string) =>
      new Promise<Problem[]>((resolve) =>
        waiting.set(uri, () => {
          resolve(problems.get(uri) ?? []);
        }),
      ),
    ask: <T>(method: string, uri: string, line: number, character: number, more = {}) =>
      client.sendRequest<T>(method, {
        textDocument: { uri },
        position: { line, character },
        ...more,
      }),
  };
}

const messages = (list: Problem[]) => list.map((p) => [p.range.start.line, p.message]);
const texts = (list: { items: { textEdit?: { newText: string }; insertText?: string }[] }) =>
  list.items.map((item) => item.textEdit?.newText ?? item.insertText);

describe('JSON', () => {
  it('finds a file’s problems: its syntax, and against the schema it names', async () => {
    writeFileSync(
      join(root, 'schema.json'),
      JSON.stringify({
        type: 'object',
        properties: { name: { type: 'string', description: 'What it’s called.' } },
      }),
    );
    const server = await start();
    const { problems } = await server.open('bad.json', 'json', '{ "a": 1, }\n');
    expect(messages(problems)).toEqual([[0, 'Trailing comma']]);
    const named = await server.open(
      'named.json',
      'json',
      '{\n  "$schema": "./schema.json",\n  "name": 1\n}\n',
    );
    expect(messages(named.problems)).toEqual([[2, 'Incorrect type. Expected "string".']]);
    // Comments, where its tools read them.
    const config = await server.open('c.jsonc', 'jsonc', '{\n  // a comment\n  "a": 1,\n}\n');
    expect(config.problems).toEqual([]);
    const hover = await server.ask('textDocument/hover', named.uri, 2, 4);
    expect(JSON.stringify(hover)).toContain('What it’s called');
  });

  it('completes a schema’s keys, as plain text unless the client takes snippets', async () => {
    writeFileSync(
      join(root, 'keys.schema.json'),
      JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } }),
    );
    const text = '{\n  "$schema": "./keys.schema.json",\n  \n}\n';
    const plain = await start();
    const { uri } = await plain.open('keys.json', 'json', text);
    expect(texts(await plain.ask('textDocument/completion', uri, 2, 2))).toContain('"name": ""');
    const snippets = await start({ catalog: null }, true);
    await snippets.open('keys.json', 'json', text);
    expect(texts(await snippets.ask('textDocument/completion', uri, 2, 2))).toContain(
      '"name": "$1"',
    );
  });

  it('checks a file against SchemaStore’s schema for its name, once it has the catalog', async () => {
    writeFileSync(
      join(root, 'package.schema.json'),
      JSON.stringify({ type: 'object', properties: { version: { type: 'string' } } }),
    );
    let answer: (text: string) => void = () => undefined;
    const fetched: string[] = [];
    const fetch: Fetch = async (uri) => {
      fetched.push(uri);
      if (uri === 'catalog') {
        return new Promise((resolve) => {
          answer = resolve;
        });
      }
      const { readFile } = await import('node:fs/promises');
      return readFile(new URL(uri), 'utf8');
    };
    const server = await start({ fetch, catalog: 'catalog' });
    const { uri, problems } = await server.open('package.json', 'json', '{ "version": 1 }\n');
    expect(problems).toEqual([]);
    // Checked again then.
    const checked = server.next(uri);
    answer(
      JSON.stringify({
        schemas: [
          {
            url: pathToFileURL(join(root, 'package.schema.json')).href,
            fileMatch: ['package.json'],
          },
          { name: 'no files' },
        ],
      }),
    );
    expect(messages(await checked)).toEqual([[0, 'Incorrect type. Expected "string".']]);
    expect(fetched[0]).toBe('catalog');
  });

  it('sends a file’s problems only for the text they were found in', async () => {
    // Its schema is held back until the file's been edited: the first text's problems are found
    // after that.
    let release: (text: string) => void = () => undefined;
    const held = new Promise<string>((resolve) => {
      release = resolve;
    });
    const server = await start({ catalog: null, fetch: () => held });
    const uri = pathToFileURL(join(root, 'edited.json')).href;
    const sent = server.next(uri);
    const text = (name: string) => `{ "$schema": "./held.json", "name": ${name} }`;
    await server.client.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId: 'json', version: 1, text: text('1') },
    });
    await server.client.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: 2 },
      contentChanges: [{ text: text('"x"') }],
    });
    // Answered once the edit's been read: messages are handled in order.
    await server.ask('textDocument/documentHighlight', uri, 0, 0);
    release(JSON.stringify({ properties: { name: { type: 'string' } } }));
    expect(messages(await sent)).toEqual([]);
  });

  it('fetches SchemaStore’s catalog over the network, and does without it when it fails', async () => {
    const fetched: string[] = [];
    const answers = [
      new Response(JSON.stringify({ schemas: [] })),
      new Response('', { status: 503 }),
    ];
    vi.stubGlobal('fetch', (url: string) => {
      fetched.push(url);
      return Promise.resolve(answers.shift());
    });
    for (let i = 0; i < 2; i++) {
      const server = await start({});
      const { problems } = await server.open('package.json', 'json', '{ "version": 1 }\n');
      expect(problems).toEqual([]);
    }
    vi.unstubAllGlobals();
    expect(fetched).toEqual([CATALOG, CATALOG]);
  });

  it('does without the catalog when it can’t be had', async () => {
    const fetch: Fetch = () => Promise.reject(new Error('offline'));
    const server = await start({ fetch });
    const { problems } = await server.open('package.json', 'json', '{ "version": 1 }\n');
    expect(problems).toEqual([]);
  });

  it('reads the catalog’s schemas, with the files each is for', () => {
    expect(
      catalogSchemas(
        JSON.stringify({
          schemas: [
            { url: 'u', fileMatch: ['a.json'] },
            { url: 'v', fileMatch: [] },
            { fileMatch: ['b.json'] },
          ],
        }),
      ),
    ).toEqual([{ uri: 'u', fileMatch: ['a.json'] }]);
    expect(catalogSchemas('{}')).toEqual([]);
  });
});

describe('CSS', () => {
  const text = '.a { colr: red; --x: 1; }\n.b { width: var(--x); }\n';

  it('finds unknown properties, and offers their fixes as edits', async () => {
    const server = await start();
    const { uri, problems } = await server.open('a.css', 'css', text);
    expect(messages(problems)).toEqual([[0, "Unknown property: 'colr'"]]);
    const actions = await server.client.sendRequest<
      { title: string; edit: { changes: Record<string, { newText: string }[]> } }[]
    >('textDocument/codeAction', {
      textDocument: { uri },
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 6 } },
      context: { diagnostics: problems },
    });
    expect(actions[0]?.title).toBe("Rename to 'color'");
    expect(actions[0]?.edit.changes[uri]?.map((edit) => edit.newText)).toEqual(['color']);
  });

  it('goes to a variable’s definition, finds its usages, and highlights them', async () => {
    const server = await start();
    const { uri } = await server.open('b.scss', 'scss', text);
    const at = (line: number) => ({ start: { line, character: 16 } });
    const definition = await server.ask<{ range: unknown }>('textDocument/definition', uri, 1, 18);
    expect(definition.range).toMatchObject(at(0));
    const usages = await server.ask<{ range: unknown }[]>('textDocument/references', uri, 0, 17, {
      context: { includeDeclaration: true },
    });
    expect(usages.map((usage) => usage.range)).toEqual([
      expect.objectContaining(at(0)),
      expect.objectContaining(at(1)),
    ]);
    const highlights = await server.ask<unknown[]>('textDocument/documentHighlight', uri, 0, 17);
    expect(highlights).toHaveLength(2);
  });

  it('renames a custom property where it’s defined and used, saying where its name is first', async () => {
    const server = await start();
    const { uri } = await server.open('r.css', 'css', text);
    const at = (line: number) => ({ line, character: 16 });
    expect(await server.ask('textDocument/prepareRename', uri, 1, 18)).toEqual({
      start: at(1),
      end: { line: 1, character: 19 },
    });
    const edit = await server.ask<{ changes: Record<string, { newText: string }[]> }>(
      'textDocument/rename',
      uri,
      1,
      18,
      { newName: '--y' },
    );
    expect(edit.changes[uri]?.map((change) => change.newText)).toEqual(['--y', '--y']);
    // Not on a name: none.
    expect(await server.ask('textDocument/prepareRename', uri, 0, 3)).toBeNull();
  });

  it('says what a property is, and completes properties, as plain text', async () => {
    const server = await start();
    const { uri } = await server.open('c.less', 'less', '.a { width: 1px; }\n');
    const hover = await server.ask<{ contents: { value: string } }>(
      'textDocument/hover',
      uri,
      0,
      7,
    );
    expect(hover.contents.value).toContain('width');
    const typed = await server.open('d.css', 'css', '.a { colo }\n');
    expect(texts(await server.ask('textDocument/completion', typed.uri, 0, 9))).toContain(
      'color: ;',
    );
  });
});

describe('HTML', () => {
  it('says what an element is, highlights its tags, and completes elements', async () => {
    const server = await start();
    const { uri, problems } = await server.open('a.html', 'html', '<div><span></span></div>\n');
    expect(problems).toEqual([]);
    const hover = await server.ask<{ contents: { value: string } }>(
      'textDocument/hover',
      uri,
      0,
      2,
    );
    expect(hover.contents.value).toContain('div element');
    const highlights = await server.ask<unknown[]>('textDocument/documentHighlight', uri, 0, 2);
    expect(highlights).toHaveLength(2);
    const typed = await server.open('b.html', 'html', '<di');
    expect(texts(await server.ask('textDocument/completion', typed.uri, 0, 3))).toContain('div');
  });

  it('answers nothing it has no answer for: navigation outside style sheets, unknown files', async () => {
    const server = await start();
    const { uri } = await server.open('e.html', 'html', '<div></div>\n');
    expect(await server.ask('textDocument/definition', uri, 0, 2)).toBeNull();
    expect(await server.ask('textDocument/references', uri, 0, 2, { context: {} })).toBeNull();
    expect(await server.ask('textDocument/prepareRename', uri, 0, 2)).toBeNull();
    expect(await server.ask('textDocument/rename', uri, 0, 2, { newName: 'p' })).toBeNull();
    expect(
      await server.client.sendRequest('textDocument/codeAction', {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [] },
      }),
    ).toBeNull();
    const json = await server.open('f.json', 'json', '{}');
    expect(await server.ask('textDocument/documentHighlight', json.uri, 0, 0)).toBeNull();
    const unknown = 'file:///nowhere.css';
    for (const method of [
      'textDocument/hover',
      'textDocument/completion',
      'textDocument/documentHighlight',
    ]) {
      expect(await server.ask(method, unknown, 0, 0)).toBeNull();
    }
  });
});

describe('withoutSnippet', () => {
  it('puts in plain text, where it’s put or as its edit, and leaves plain text alone', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    expect(withoutSnippet({ label: 'a', insertText: 'a($1)', insertTextFormat: 2 })).toEqual({
      label: 'a',
      insertText: 'a()',
      insertTextFormat: 1,
    });
    expect(
      withoutSnippet({ label: 'b', textEdit: { range, newText: 'b: $0' }, insertTextFormat: 2 }),
    ).toEqual({ label: 'b', textEdit: { range, newText: 'b: ' }, insertTextFormat: 1 });
    const plain = { label: 'c', insertText: '$1' };
    expect(withoutSnippet(plain)).toBe(plain);
  });
});

describe('withChanges', () => {
  it('gives an action’s edits by file, leaving out what isn’t an edit to a file’s text', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const textDocument = { uri: 'file:///a.css', version: 1 };
    expect(
      withChanges({
        title: 'Fix',
        edit: {
          documentChanges: [
            {
              textDocument,
              edits: [
                { range, newText: 'x' },
                { range, snippet: { kind: 'snippet', value: 'y' } },
              ],
            },
            { kind: 'create', uri: 'file:///b.css' },
          ],
        },
      }),
    ).toEqual({ title: 'Fix', edit: { changes: { 'file:///a.css': [{ range, newText: 'x' }] } } });
    expect(withChanges({ title: 'None' })).toEqual({ title: 'None', edit: { changes: {} } });
  });
});

describe('plainText', () => {
  it('puts in a snippet’s text: placeholders’ text, a choice’s first, no tab stops', () => {
    expect(plainText('"name": "$1"')).toBe('"name": ""');
    expect(plainText('width: $0;')).toBe('width: ;');
    expect(plainText('${1:a ${2:b}} ${3|x,y|} ${4} \\$5 \\}')).toBe('a b x  $5 }');
  });
});
