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

const { HOST_NOTIFICATION, HOST_REQUEST, Hosts, installHosts, startHost } =
  await import('../src/host.js');

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

/** A window as hosts see it, recording what its page was sent. */
function fakeWindow(id: number) {
  return { id, send: vi.fn() };
}

describe('Hosts', () => {
  it('starts a host per project in a window, routing requests and notifications by both', async () => {
    const one = fakeChild();
    const hosts = new Hosts(one.spawn as never);
    const window = fakeWindow(1);
    hosts.attach(window, '/repo');
    expect((one.spawn.mock.calls[0] as unknown as [string, string[], { cwd: string }])[2].cwd).toBe(
      '/repo',
    );
    const next = one.sent();
    const answer = hosts.request(1, '/repo', 'git.worktrees', { repo: '/x' });
    expect(await next).toMatchObject({ method: 'git.worktrees', params: { repo: '/x' } });
    one.child.stdout.write('{"jsonrpc":"2.0","id":1,"result":[]}\n');
    expect(await answer).toEqual([]);
    one.child.stdout.write('{"jsonrpc":"2.0","method":"index.progress","params":{"done":1}}\n');
    await vi.waitFor(() => {
      expect(window.send).toHaveBeenCalledWith(HOST_NOTIFICATION, '/repo', 'index.progress', {
        done: 1,
      });
    });
    expect(() => hosts.request(2, '/repo', 'host.ping', undefined)).toThrow('no project open');
    expect(() => hosts.request(1, '/other', 'host.ping', undefined)).toThrow(
      'no project open at /other',
    );
  });

  it('stops a project’s host when it starts again, when it closes, with its window, and at the end', () => {
    const first = fakeChild();
    const hosts = new Hosts(first.spawn as never);
    const window = fakeWindow(1);
    hosts.attach(window, '/a');
    const again = fakeChild();
    first.spawn.mockImplementation(() => again.child);
    hosts.attach(window, '/a');
    expect(first.child.kill).toHaveBeenCalled();
    const second = fakeChild();
    first.spawn.mockImplementation(() => second.child);
    hosts.attach(window, '/b');
    // Closing one project stops its host alone.
    hosts.detach(window, '/b');
    expect(second.child.kill).toHaveBeenCalled();
    expect(again.child.kill).not.toHaveBeenCalled();
    hosts.detach(window, '/b');
    // The window closing stops the rest.
    hosts.detach(window);
    expect(again.child.kill).toHaveBeenCalled();
    hosts.detach(window);
    const third = fakeChild();
    first.spawn.mockImplementation(() => third.child);
    hosts.attach(fakeWindow(2), '/c');
    hosts.stopAll();
    expect(third.child.kill).toHaveBeenCalled();
  });
});

describe('installHosts', () => {
  it('forwards a page’s requests to its project’s host, and stops the hosts when the app quits', async () => {
    const { child, spawn, sent } = fakeChild();
    const hosts = installHosts(spawn as never);
    hosts.attach(fakeWindow(7), '/repo');
    const handle = electron.handlers.get(HOST_REQUEST) as Listener;
    const next = sent();
    const answer = handle({ sender: { id: 7 } }, '/repo', 'host.ping') as Promise<unknown>;
    expect(await next).toMatchObject({ method: 'host.ping' });
    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"version":1}}\n');
    expect(await answer).toEqual({ version: 1 });
    expect(() => handle({ sender: { id: 7 } }, '/repo', 5)).toThrow('needs a method name');
    expect(() => handle({ sender: { id: 7 } }, 5, 'host.ping')).toThrow('needs a project');
    (electron.appListeners.get('will-quit') as Listener)();
    expect(child.kill).toHaveBeenCalled();
  });
});
