// A language server that misbehaves as asked (its first argument), for the LSP client's tests:
// "exit" exits at once; "silent" never answers a definition; "stubborn" ignores shutdown;
// "links" answers definitions with location links; "fails" answers them with an error; "loads"
// logs other lines, then "Loaded", after it's initialized; "symbols" answers a.fake's and b.fake's
// symbols (class A extends B, each with a method run), and goes from a.fake's B to b.fake's and to a
// file that isn't there. The others answer no symbols, "fails" an error and "silent" nothing.
// "pulls" answers a file's problems when asked (one error, its text in the message); "pushes"
// sends them as the file changes, for its version; for text "late", the version before's, then
// its own with no version; the others send none. Each answers code actions with one per diagnostic
// it's given, named by its message. "completes" offers two completions, the second's import
// given only when it's asked about (as TypeScript's server); the others offer none. A rename is
// refused by "fails", and "dies" exits as it's asked; the others answer none.
// Every message it gets is appended to the file named by its second argument.

import { Buffer } from 'node:buffer';
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers';

const [mode, log] = process.argv.slice(2);
if (mode === 'exit') process.exit(1);

let buffer = Buffer.alloc(0);
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const handle = (message) => {
  if (log) appendFileSync(log, `${JSON.stringify(message)}\n`);
  const { id, method } = message;
  if (method === 'initialize') {
    const pulls = mode === 'pulls' ? { diagnosticProvider: { interFileDependencies: false } } : {};
    const completes = mode === 'completes' ? { completionProvider: { resolveProvider: true } } : {};
    send({ id, result: { capabilities: { ...pulls, ...completes } } });
    // Asks what a server may ask of its client.
    send({
      id: 'c1',
      method: 'workspace/configuration',
      params: { items: [{}, { section: 'fake' }, { section: 'other' }] },
    });
    send({ id: 'c2', method: 'workspace/configuration' });
    send({ id: 'c3', method: 'client/registerCapability', params: {} });
    send({ id: 'c4', method: 'workspace/workspaceFolders' });
  } else if (method === 'initialized' && mode === 'loads') {
    send({ method: 'window/logMessage', params: { type: 3, message: 'Loading' } });
    send({ method: 'window/logMessage', params: null });
    setTimeout(() => {
      send({ method: 'window/logMessage', params: { type: 3, message: 'Loaded 2 files' } });
    }, 300);
  } else if (method === 'textDocument/diagnostic') {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    send({ id, result: { kind: 'full', items: [{ range, severity: 1, message: 'pulled' }] } });
  } else if (
    mode === 'pushes' &&
    (method === 'textDocument/didOpen' || method === 'textDocument/didChange')
  ) {
    const { uri, version } = message.params.textDocument;
    const text = message.params.textDocument.text ?? message.params.contentChanges[0].text;
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
    const diagnostics = [{ range, severity: 2, message: text, tags: [1, 2], code: 7 }];
    if (text === 'late') {
      // First, the version before's, late: not this one's.
      send({
        method: 'textDocument/publishDiagnostics',
        params: { uri, version: version - 1, diagnostics: [] },
      });
      setTimeout(
        () => send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } }),
        100,
      );
    } else {
      send({ method: 'textDocument/publishDiagnostics', params: { uri, version, diagnostics } });
    }
  } else if (method === 'textDocument/completion') {
    if (mode !== 'completes') {
      send({ id, result: null });
      return;
    }
    send({
      id,
      result: [
        { label: 'alpha', kind: 10 },
        { label: 'beta', kind: 3, data: { which: 'beta' } },
      ],
    });
  } else if (method === 'completionItem/resolve') {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const edits = message.params.data ? [{ range, newText: 'import beta;\n' }] : undefined;
    send({ id, result: { ...message.params, additionalTextEdits: edits } });
  } else if (method === 'textDocument/codeAction') {
    const { uri } = message.params.textDocument;
    send({
      id,
      result: message.params.context.diagnostics.map(({ range, message: title }) => ({
        title,
        edit: { changes: { [uri]: [{ range, newText: title }] } },
      })),
    });
  } else if (method === 'textDocument/documentSymbol') {
    if (mode === 'silent') return;
    if (mode === 'fails') send({ id, error: { code: -32603, message: 'no' } });
    if (mode !== 'symbols') {
      send({ id, result: null });
      return;
    }
    const at = (line, character) => ({ start: { line, character }, end: { line, character } });
    const name = message.params.textDocument.uri.endsWith('a.fake') ? 'A' : 'B';
    const run = { name: 'run', kind: 6, range: at(1, 2), selectionRange: at(1, 2) };
    const type = { name, kind: 5, range: at(0, 0), selectionRange: at(0, 6), children: [run] };
    send({ id, result: [type] });
  } else if (method === 'textDocument/prepareRename' || method === 'textDocument/rename') {
    if (mode === 'dies') process.exit(1);
    if (mode === 'fails') send({ id, error: { code: -32803, message: 'Not here.' } });
    else send({ id, result: null });
  } else if (method === 'textDocument/implementation') {
    send({ id, result: null });
  } else if (method === 'textDocument/definition') {
    if (mode === 'silent') return;
    if (mode === 'symbols') {
      const folder = message.params.textDocument.uri.replace(/[^/]*$/, '');
      const range = { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } };
      send({
        id,
        result: [
          { uri: `${folder}b.fake`, range },
          { uri: `${folder}gone.other`, range },
        ],
      });
      return;
    }
    if (mode === 'fails') send({ id, error: { code: -32603, message: 'no' } });
    else if (mode === 'links') {
      const range = { start: { line: 4, character: 2 }, end: { line: 4, character: 3 } };
      send({
        id,
        result: [{ targetUri: 'file:///x/y.ts', targetRange: range, targetSelectionRange: range }],
      });
    } else send({ id, result: null });
  } else if (method === 'shutdown') {
    if (mode !== 'stubborn') send({ id, result: null });
  } else if (method === 'exit') process.exit(0);
};
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    handle(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()));
    buffer = buffer.subarray(end + 4 + length);
  }
});
