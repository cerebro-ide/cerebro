// The host: started as a child process running Electron's own Node (ELECTRON_RUN_AS_NODE, so no
// separate Node is needed), speaking JSON-RPC over its stdin and stdout, the transport WSL and ssh
// will use too. One per project window, for its project; the page reaches it through IPC. A host
// ends with its window, or with the app.

import { spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Connection, LineReader } from '@cerebro-ide/protocol';
import { app, ipcMain } from 'electron';

export const HOST_REQUEST = 'cerebro:host:request';
export const HOST_NOTIFICATION = 'cerebro:host:notification';

/** The host's notifications the page hears. */
export const FORWARDED = [
  'index.progress',
  'terminal.data',
  'terminal.exit',
  'agent.status',
] as const;

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

/** A window a host serves: its contents' id, and a way to send its page a message. */
export interface HostWindow {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
}

/**
 * Each window's host, for the project it shows: a window's requests go to its own host, and its
 * host's notifications to it alone. A window without a project (the Welcome window) has none.
 */
export class Hosts {
  private readonly running = new Map<number, ReturnType<typeof startHost>>();

  constructor(private readonly spawn: typeof nodeSpawn = nodeSpawn) {}

  /** Starts a host for `repo` serving `window`, stopping the one it had. */
  attach(window: HostWindow, repo: string): void {
    this.detach(window);
    const host = startHost(repo, this.spawn);
    for (const method of FORWARDED) {
      host.connection.onNotification(method, (params) => {
        window.send(HOST_NOTIFICATION, method, params);
      });
    }
    this.running.set(window.id, host);
  }

  /** Stops a window's host, if it has one. */
  detach(window: HostWindow): void {
    this.running.get(window.id)?.stop();
    this.running.delete(window.id);
  }

  /** Sends a request to the host of the window `id`. */
  request(id: number, method: string, params: unknown): Promise<unknown> {
    const host = this.running.get(id);
    if (!host) throw new Error('This window has no project open');
    return host.connection.request(method, params);
  }

  stopAll(): void {
    for (const host of this.running.values()) host.stop();
    this.running.clear();
  }
}

/**
 * Lets pages send requests to their windows' hosts; the hosts stop when the app quits. Windows get
 * their hosts through `attach`.
 */
export function installHosts(spawn: typeof nodeSpawn = nodeSpawn): Hosts {
  const hosts = new Hosts(spawn);
  ipcMain.handle(HOST_REQUEST, (event, method: unknown, params: unknown) => {
    if (typeof method !== 'string') throw new Error('A host request needs a method name');
    return hosts.request(event.sender.id, method, params);
  });
  app.on('will-quit', () => {
    hosts.stopAll();
  });
  return hosts;
}
