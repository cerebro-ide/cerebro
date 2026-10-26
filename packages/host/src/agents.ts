// Agents' status, from Claude Code's hooks. The host starts `claude` with hooks (through
// `--settings`) that run the host's own entry point as a small client: it reads the hook's input
// and tells the host, over a local socket, which agent did what. The host turns that into a state
// for the UI: working on a turn, waiting for the user (a permission prompt, say), or done with it.

import { rmSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type AgentState = 'working' | 'waiting' | 'done';

/** The hooks Cerebro listens to, and the state each means. */
export const HOOK_STATES: Readonly<Record<string, AgentState>> = {
  UserPromptSubmit: 'working',
  PostToolUse: 'working',
  Notification: 'waiting',
  Stop: 'done',
};

/** What the hook client sends: the agent's terminal key, the hook, and Claude Code's input. */
export interface HookMessage {
  key: string;
  event: string;
  input: { session_id?: unknown; prompt?: unknown };
}

/** An agent's status, as the UI hears it. */
export interface AgentStatus {
  key: string;
  state: AgentState;
  sessionId: string | undefined;
  /** The hook that told it. */
  event: string;
  /** For a prompt sent: the prompt. */
  prompt?: string;
}

let sockets = 0;

/** A socket path for this host: a named pipe on Windows, else a file in the temporary folder. */
export function socketPath(platform: NodeJS.Platform = process.platform): string {
  const name = `cerebro-${String(process.pid)}-${String(++sockets)}`;
  return platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

/** `--settings` for `claude`: each hook runs `command` with the hook's name after it. */
export function hookSettings(command: string): string {
  const hooks = Object.fromEntries(
    Object.keys(HOOK_STATES).map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: `${command} ${event}` }] }],
    ]),
  );
  return JSON.stringify({ hooks });
}

/**
 * Listens for hook messages on `path`; a message for an unknown hook, or garbled, is ignored. The
 * hook client waits until `notify` is done with its message, so the agent goes on after it.
 */
export function listenForHooks(
  path: string,
  notify: (status: AgentStatus) => void | Promise<void>,
  platform: NodeJS.Platform = process.platform,
): Server {
  // Half open: the client has sent all of its message, and waits for the end of the reply.
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    let text = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      text += chunk;
    });
    socket.on('end', () => {
      void handle(text).finally(() => socket.end());
    });
  });
  const handle = async (text: string) => {
    let message: HookMessage;
    try {
      message = JSON.parse(text) as HookMessage;
    } catch {
      return;
    }
    const state = HOOK_STATES[message.event];
    if (state === undefined || typeof message.key !== 'string') return;
    const { session_id: id, prompt } = message.input;
    await notify({
      key: message.key,
      state,
      sessionId: typeof id === 'string' ? id : undefined,
      event: message.event,
      ...(typeof prompt === 'string' ? { prompt } : {}),
    });
  };
  // A socket file left by a host that crashed would stop the server listening. (Windows' named
  // pipes go with their process.)
  if (platform !== 'win32') rmSync(path, { force: true });
  server.listen(path);
  // The host lives as long as its connection to the UI, not for the socket.
  server.unref();
  return server;
}

/**
 * The hook client: sends a hook's message to the host at `path`, and waits for the host to be done
 * with it. Never fails, so a host that's gone can't hold up the agent: it resolves either way.
 */
export function sendHook(path: string, message: HookMessage): Promise<void> {
  return new Promise((resolve) => {
    const socket = createConnection(path, () => {
      socket.end(JSON.stringify(message));
    });
    socket.on('close', () => {
      resolve();
    });
    socket.on('error', () => {
      resolve();
    });
  });
}

/** The hook client's input: Claude Code's JSON on stdin, or nothing if it isn't JSON. */
export function parseHookInput(text: string): HookMessage['input'] {
  try {
    const input: unknown = JSON.parse(text);
    return typeof input === 'object' && input !== null ? input : {};
  } catch {
    return {};
  }
}
