// A language server that misbehaves as asked (its first argument), for the LSP client's tests:
// "exit" exits at once; "silent" never answers a definition; "stubborn" ignores shutdown;
// "links" answers definitions with location links; "fails" answers them with an error; "loads"
// logs other lines, then "Loaded", after it's initialized.
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
    send({ id, result: { capabilities: {} } });
    // Asks what a server may ask of its client.
    send({ id: 'c1', method: 'workspace/configuration', params: { items: [{}, {}] } });
    send({ id: 'c2', method: 'workspace/configuration' });
    send({ id: 'c3', method: 'client/registerCapability', params: {} });
    send({ id: 'c4', method: 'workspace/workspaceFolders' });
  } else if (method === 'initialized' && mode === 'loads') {
    send({ method: 'window/logMessage', params: { type: 3, message: 'Loading' } });
    send({ method: 'window/logMessage', params: null });
    setTimeout(() => {
      send({ method: 'window/logMessage', params: { type: 3, message: 'Loaded 2 files' } });
    }, 300);
  } else if (method === 'textDocument/definition') {
    if (mode === 'silent') return;
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
