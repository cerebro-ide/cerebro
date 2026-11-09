import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { SET_COLOURS } from '../src/colours.js';
import { SET_SCALE } from '../src/display.js';
import { HOST_NOTIFICATION, HOST_REQUEST } from '../src/host.js';
import type { Answer } from '../src/ipc.js';
import {
  PROJECT_CLOSE,
  PROJECT_CURRENT,
  PROJECT_FORGET,
  PROJECT_OPEN,
  PROJECT_PICK,
  PROJECT_RECENT,
} from '../src/main.js';
import { EDIT, MENU_COMMAND, SET_MENU } from '../src/menu.js';
import { PROJECT_ADDED, PROJECT_SHOW } from '../src/projects.js';
import { PASSWORD_GET, PASSWORD_SET } from '../src/passwords.js';
import { REVEAL } from '../src/reveal.js';

// The preload, which a sandboxed window runs as CommonJS, can't import the modules whose channels
// it uses: what it sends and listens on is checked against theirs here.

vi.mock('electron', () => ({}));

type Listener = (event: unknown, ...args: unknown[]) => void;
const sent: unknown[][] = [];
/** What the main process answers an `invoke`. */
let answer: Answer = { result: undefined };
const listeners = new Map<string, Listener>();
const ipcRenderer = {
  send: (...args: unknown[]) => void sent.push(['send', ...args]),
  invoke: (...args: unknown[]) => {
    sent.push(['invoke', ...args]);
    return Promise.resolve(answer);
  },
  on: (channel: string, listener: Listener) => void listeners.set(channel, listener),
  off: (channel: string) => void listeners.delete(channel),
};
const exposed: Record<string, unknown> = {};
const contextBridge = {
  exposeInMainWorld: (key: string, api: unknown) => {
    exposed[key] = api;
  },
};
const source = readFileSync(new URL('../src/preload.cts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
// The preload, as the window runs it: with electron's modules, and the process's platform.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const run = new Function('require', 'process', 'exports', outputText) as (
  require: () => unknown,
  process: { platform: string },
  exports: object,
) => void;
run(() => ({ ipcRenderer, contextBridge }), { platform: 'linux' }, {});

type Api = Record<string, Record<string, (...args: unknown[]) => unknown>>;
const api = exposed['cerebro'] as Api & { app: boolean; platform: string };
/** The message a bridge function sends. */
const call = (part: string, fn: string, ...args: unknown[]) => {
  sent.length = 0;
  void (api[part]?.[fn] as (...a: unknown[]) => unknown)(...args);
  return sent[0];
};

describe('the preload', () => {
  it('tells the page it runs in the app, and on which platform', () => {
    expect(api.app).toBe(true);
    expect(api.platform).toBe('linux');
  });

  it('sends on the channels the main process listens on', () => {
    expect(call('display', 'setScale', '1.5')).toEqual(['send', SET_SCALE, '1.5']);
    expect(call('shell', 'reveal', '/r/a')).toEqual(['send', REVEAL, '/r/a']);
    expect(call('window', 'setColours', 'f', 't', 'b')).toEqual([
      'send',
      SET_COLOURS,
      'f',
      't',
      'b',
    ]);
    expect(call('menu', 'set', [])).toEqual(['send', SET_MENU, []]);
    expect(call('menu', 'edit', 'undo')).toEqual(['send', EDIT, 'undo']);
    expect(call('project', 'current')).toEqual(['invoke', PROJECT_CURRENT]);
    expect(call('project', 'recent')).toEqual(['invoke', PROJECT_RECENT]);
    expect(call('project', 'pick')).toEqual(['invoke', PROJECT_PICK]);
    expect(call('project', 'open', '/r', 'this', '/q')).toEqual([
      'invoke',
      PROJECT_OPEN,
      '/r',
      'this',
      '/q',
    ]);
    expect(call('project', 'close', '/r')).toEqual(['invoke', PROJECT_CLOSE, '/r']);
    expect(call('project', 'forget', '/r')).toEqual(['invoke', PROJECT_FORGET, '/r']);
    expect(call('passwords', 'get', 'k')).toEqual(['invoke', PASSWORD_GET, 'k']);
    expect(call('passwords', 'set', 'k', 'p')).toEqual(['invoke', PASSWORD_SET, 'k', 'p']);
    expect(call('host', 'request', '/r', 'fs.read', { path: 'a' })).toEqual([
      'invoke',
      HOST_REQUEST,
      '/r',
      'fs.read',
      { path: 'a' },
    ]);
  });

  it('gives the page a request’s result, or its error with only its message', async () => {
    answer = { result: { version: 1 } };
    expect(await api.host?.request?.('/r', 'host.ping')).toEqual({ version: 1 });
    answer = { error: 'fatal: no such remote' };
    const failed = api.project?.open?.('/r', 'new') as Promise<unknown>;
    await expect(failed).rejects.toThrow(new Error('fatal: no such remote'));
    answer = { result: undefined };
  });

  it('listens on the channels the main process sends on, until stopped', () => {
    const heard: unknown[][] = [];
    const stops = [
      api['project']?.['onAdded']?.((p: unknown) => void heard.push(['added', p])),
      api['project']?.['onShow']?.((p: unknown) => void heard.push(['show', p])),
      api['menu']?.['onCommand']?.((c: unknown) => void heard.push(['command', c])),
      api['host']?.['onNotification']?.(
        (...n: unknown[]) => void heard.push(['notification', ...n]),
      ),
    ] as (() => void)[];
    const emit = (channel: string, ...args: unknown[]) => listeners.get(channel)?.({}, ...args);
    emit(PROJECT_ADDED, { path: '/r' });
    emit(PROJECT_SHOW, '/r');
    emit(MENU_COMMAND, 'file.open');
    // What isn't a command, or a notification from a project's host, is dropped.
    emit(MENU_COMMAND, 1);
    emit(HOST_NOTIFICATION, '/r', 'index.progress', { done: 1 });
    emit(HOST_NOTIFICATION, 1, 'index.progress');
    expect(heard).toEqual([
      ['added', { path: '/r' }],
      ['show', '/r'],
      ['command', 'file.open'],
      ['notification', '/r', 'index.progress', { done: 1 }],
    ]);
    for (const stop of stops) stop();
    expect(listeners.size).toBe(0);
  });
});
