// The host: started as a child process running Electron's own Node (ELECTRON_RUN_AS_NODE, so no
// separate Node is needed), speaking JSON-RPC over its stdin and stdout, the transport WSL and ssh
// will use too. The page reaches it through IPC; the host ends with the app.

import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Connection, LineReader } from '@cerebro-ide/protocol';
import { app, ipcMain } from 'electron';

export const HOST_REQUEST = 'cerebro:host:request';

/** The host's entry point, built beside this app. */
const HOST = fileURLToPath(new URL('../../host/dist/main.js', import.meta.url));

/** Starts the host for `repo`, returning the connection to it and a way to stop it. */
export function startHost(
  repo: string,
  spawn: typeof nodeSpawn = nodeSpawn,
): { connection: Connection; stop: () => void } {
  const child = spawn(process.execPath, [HOST], {
    cwd: repo,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CEREBRO_REPO: repo },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const { stdin, stdout } = child as unknown as {
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
  };
  const connection = new Connection((line) => {
    stdin.write(`${line}\n`);
  });
  // A host that died can't be written to; its requests fail as the connection closes.
  stdin.on('error', () => undefined);
  const reader = new LineReader((line) => {
    connection.receive(line);
  });
  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    reader.push(chunk);
  });
  child.on('exit', () => {
    connection.close();
  });
  return {
    connection,
    stop: () => {
      connection.close();
      child.kill();
    },
  };
}

/** Starts the host and lets the page send it requests; it stops when the app quits. */
export function installHost(
  repo = process.env['CEREBRO_REPO'] ?? process.cwd(),
  spawn: typeof nodeSpawn = nodeSpawn,
): void {
  const host = startHost(repo, spawn);
  ipcMain.handle(HOST_REQUEST, (_event, method: unknown, params: unknown) => {
    if (typeof method !== 'string') throw new Error('A host request needs a method name');
    return host.connection.request(method, params);
  });
  app.on('will-quit', host.stop);
}
