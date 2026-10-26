import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ErrorCodes } from '@cerebro-ide/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

const electron = vi.hoisted(() => {
  const handlers = new Map<string, Listener>();
  const appListeners = new Map<string, Listener>();
  return {
    handlers,
    appListeners,
    ipcMain: {
      handle: (channel: string, handler: Listener) => {
        handlers.set(channel, handler);
      },
    },
    app: {
      on: (event: string, listener: Listener) => {
        appListeners.set(event, listener);
      },
    },
    sent: [] as unknown[][],
    BrowserWindow: {
      getAllWindows: () => [
        {
          webContents: {
            send: (...args: unknown[]) => {
              electron.sent.push(args);
            },
          },
        },
      ],
    },
  };
});

vi.mock('electron', () => ({
  ipcMain: electron.ipcMain,
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
}));

const { HOST_NOTIFICATION, HOST_REQUEST, installHost, startHost } = await import('../src/host.js');

/** A child process whose stdin the test reads and whose stdout it writes. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  child.stdin.setEncoding('utf8');
  const spawn = vi.fn(() => child);
  /** The next line the app sent the host. */
  const sent = () =>
    new Promise<Record<string, unknown>>((resolve) => {
      child.stdin.once('data', (chunk: string) => {
        resolve(JSON.parse(chunk) as Record<string, unknown>);
      });
    });
  return { child, spawn, sent };
}

beforeEach(() => {
  electron.handlers.clear();
  electron.appListeners.clear();
});

describe('startHost', () => {
  it('runs the host on Electron’s own Node, in the repository, over stdio', () => {
    const { spawn } = fakeChild();
    startHost('/repo', spawn as never);
    const [file, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; env: Record<string, string>; stdio: string[] },
    ];
    expect(file).toBe(process.execPath);
    expect(args[0]).toMatch(/host[/\\]dist[/\\]main\.js$/);
    expect(options.cwd).toBe('/repo');
    expect(options.env['ELECTRON_RUN_AS_NODE']).toBe('1');
    expect(options.env['CEREBRO_REPO']).toBe('/repo');
    expect(options.stdio).toEqual(['pipe', 'pipe', 'inherit']);
  });

  it('sends requests as lines and reads the answers, even split across chunks', async () => {
    const { child, spawn, sent } = fakeChild();
    const { connection } = startHost('/repo', spawn as never);
    const next = sent();
    const answer = connection.request('host.ping');
    expect(await next).toEqual({ jsonrpc: '2.0', id: 1, method: 'host.ping' });
    child.stdout.write('{"jsonrpc":"2.0","id":1,');
    child.stdout.write('"result":{"version":1}}\n');
    expect(await answer).toEqual({ version: 1 });
  });

  it('fails waiting requests when the host exits, and stops it on request', async () => {
    const { child, spawn } = fakeChild();
    const host = startHost('/repo', spawn as never);
    const waiting = host.connection.request('slow');
    child.emit('exit', 1);
    await expect(waiting).rejects.toMatchObject({ code: ErrorCodes.ConnectionClosed });
    child.stdin.emit('error', new Error('EPIPE'));
    host.stop();
    expect(child.kill).toHaveBeenCalled();
  });
});

describe('installHost', () => {
  it('forwards the page’s requests, and stops the host when the app quits', async () => {
    const { child, spawn, sent } = fakeChild();
    installHost('/repo', spawn as never);
    const handle = electron.handlers.get(HOST_REQUEST) as Listener;
    const next = sent();
    const answer = handle({}, 'git.worktrees', { repo: '/x' }) as Promise<unknown>;
    expect(await next).toMatchObject({ method: 'git.worktrees', params: { repo: '/x' } });
    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":[]}\n');
    expect(await answer).toEqual([]);
    expect(() => handle({}, 5)).toThrow('needs a method name');
    (electron.appListeners.get('will-quit') as Listener)();
    expect(child.kill).toHaveBeenCalled();
  });

  it('passes the host’s progress notifications on to the windows', async () => {
    const { child, spawn } = fakeChild();
    installHost('/repo', spawn as never);
    child.stdout.write('{"jsonrpc":"2.0","method":"index.progress","params":{"done":1}}\n');
    await vi.waitFor(() => {
      expect(electron.sent).toContainEqual([HOST_NOTIFICATION, 'index.progress', { done: 1 }]);
    });
  });

  it('opens CEREBRO_REPO, else the folder the app started in', () => {
    const first = fakeChild();
    vi.stubEnv('CEREBRO_REPO', '/chosen');
    installHost(undefined, first.spawn as never);
    vi.unstubAllEnvs();
    expect(
      (first.spawn.mock.calls[0] as unknown as [string, string[], { cwd: string }])[2].cwd,
    ).toBe('/chosen');
    const second = fakeChild();
    vi.stubEnv('CEREBRO_REPO', undefined);
    installHost(undefined, second.spawn as never);
    vi.unstubAllEnvs();
    expect(
      (second.spawn.mock.calls[0] as unknown as [string, string[], { cwd: string }])[2].cwd,
    ).toBe(process.cwd());
  });
});
