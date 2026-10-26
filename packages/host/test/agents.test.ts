import { writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import {
  HOOK_STATES,
  hookSettings,
  listenForHooks,
  parseHookInput,
  sendHook,
  socketPath,
  type AgentStatus,
} from '../src/index.js';

/** Sends raw text to the socket, as a client that isn't the hook client would. */
const sendRaw = (path: string, text: string) =>
  new Promise<void>((resolve) => {
    const socket = createConnection(path, () => {
      socket.end(text);
    });
    socket.on('close', () => {
      resolve();
    });
  });

describe('agents’ hooks', () => {
  it('turns hook messages into agents’ states, ignoring ones it doesn’t know', async () => {
    const path = socketPath();
    const statuses: AgentStatus[] = [];
    const server = listenForHooks(path, (status) => {
      statuses.push(status);
    });
    await sendHook(path, {
      key: 'claude:/w',
      event: 'UserPromptSubmit',
      input: { session_id: 's1', prompt: 'Fix it' },
    });
    await sendHook(path, { key: 'claude:/w', event: 'Stop', input: {} });
    await sendHook(path, { key: 'claude:/w', event: 'SessionEnd', input: {} });
    await sendRaw(path, 'not json');
    await sendRaw(path, JSON.stringify({ key: 3, event: 'Stop', input: {} }));
    await vi.waitFor(() => {
      expect(statuses).toHaveLength(2);
    });
    expect(statuses).toEqual([
      {
        key: 'claude:/w',
        state: 'working',
        sessionId: 's1',
        event: 'UserPromptSubmit',
        prompt: 'Fix it',
      },
      { key: 'claude:/w', state: 'done', sessionId: undefined, event: 'Stop' },
    ]);
    server.close();
  });

  it('has the hook client wait until the host is done with its message', async () => {
    const path = socketPath();
    let done = false;
    const server = listenForHooks(path, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      done = true;
    });
    await sendHook(path, { key: 'k', event: 'Stop', input: {} });
    expect(done).toBe(true);
    server.close();
  });

  it('replaces a socket file left behind, except on Windows, whose pipes need none', async () => {
    const path = socketPath('linux');
    writeFileSync(path, '');
    const server = listenForHooks(path, () => undefined);
    await vi.waitFor(() => {
      expect(server.listening).toBe(true);
    });
    server.close();
    const other = listenForHooks(socketPath('linux'), () => undefined, 'win32');
    await vi.waitFor(() => {
      expect(other.listening).toBe(true);
    });
    other.close();
  });

  it('never fails the agent: a host that’s gone is ignored', async () => {
    await expect(
      sendHook(socketPath(), { key: 'k', event: 'Stop', input: {} }),
    ).resolves.toBeUndefined();
  });

  it('uses a named pipe on Windows, a new one each time', () => {
    const a = socketPath('win32');
    expect(a).toMatch(/^\\\\\.\\pipe\\cerebro-\d+-\d+$/);
    expect(socketPath('win32')).not.toBe(a);
    expect(socketPath('linux')).toMatch(/cerebro-\d+-\d+\.sock$/);
  });

  it('gives Claude Code its hooks, each running the command with its name', () => {
    const settings = JSON.parse(hookSettings('run hook')) as {
      hooks: Record<string, [{ hooks: [{ type: string; command: string }] }]>;
    };
    expect(Object.keys(settings.hooks)).toEqual(Object.keys(HOOK_STATES));
    expect(settings.hooks['Stop']?.[0].hooks).toEqual([
      { type: 'command', command: 'run hook Stop' },
    ]);
  });

  it('reads the hook’s input, if it’s a JSON object', () => {
    expect(parseHookInput('{"session_id":"s"}')).toEqual({ session_id: 's' });
    expect(parseHookInput('null')).toEqual({});
    expect(parseHookInput('')).toEqual({});
  });
});
