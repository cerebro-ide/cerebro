// The host: started as a child process running Electron's own Node (ELECTRON_RUN_AS_NODE, so no
// separate Node is needed), speaking JSON-RPC over its stdin and stdout, the transport WSL and ssh
// will use too. One per project open in a window (a window may show several, as tabs); the page
// reaches each through IPC, naming the project. A host ends with its project, its window, or the app.

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
 * The host of each project open in each window: a window's requests for a project go to that
 * project's host, and a host's notifications to its window alone, with its project. A window
 * without a project (the Welcome window) has none.
 */
export class Hosts {
  /** By window, then by project. */
  private readonly running = new Map<number, Map<string, ReturnType<typeof startHost>>>();

  constructor(private readonly spawn: typeof nodeSpawn = nodeSpawn) {}

  /** Starts a host for `repo` in `window`, stopping the one it had there. */
  attach(window: HostWindow, repo: string): void {
    this.detach(window, repo);
    const host = startHost(repo, this.spawn);
    for (const method of FORWARDED) {
      host.connection.onNotification(method, (params) => {
        window.send(HOST_NOTIFICATION, repo, method, params);
      });
    }
    let hosts = this.running.get(window.id);
    if (!hosts) this.running.set(window.id, (hosts = new Map()));
    hosts.set(repo, host);
  }

  /** Stops the host of a project in a window, or without one, all of the window's. */
  detach(window: HostWindow, repo?: string): void {
    const hosts = this.running.get(window.id);
    if (!hosts) return;
    for (const [path, host] of hosts) {
      if (repo !== undefined && path !== repo) continue;
      host.stop();
      hosts.delete(path);
    }
    if (hosts.size === 0) this.running.delete(window.id);
  }

  /** Sends a request to the host of the project `repo` in the window `id`. */
  request(id: number, repo: string, method: string, params: unknown): Promise<unknown> {
    const host = this.running.get(id)?.get(repo);
    if (!host) throw new Error(`This window has no project open at ${repo}`);
    return host.connection.request(method, params);
  }

  stopAll(): void {
    for (const hosts of this.running.values()) for (const host of hosts.values()) host.stop();
    this.running.clear();
  }
}

/**
 * Lets pages send requests to their windows' hosts; the hosts stop when the app quits. Windows get
 * their hosts through `attach`.
 */
export function installHosts(spawn: typeof nodeSpawn = nodeSpawn): Hosts {
  const hosts = new Hosts(spawn);
  ipcMain.handle(HOST_REQUEST, (event, repo: unknown, method: unknown, params: unknown) => {
    if (typeof repo !== 'string') throw new Error('A host request needs a project');
    if (typeof method !== 'string') throw new Error('A host request needs a method name');
    return hosts.request(event.sender.id, repo, method, params);
  });
  app.on('will-quit', () => {
    hosts.stopAll();
  });
  return hosts;
}
