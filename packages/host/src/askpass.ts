// Asking for credentials, as IntelliJ's GitHandlerAuthenticationManager does: git's remote commands
// run with GIT_ASKPASS and SSH_ASKPASS set to scripts (a batch file on Windows, else a shell script,
// as IntelliJ's ScriptGeneratorUtil writes them) that run this host's own entry as Node,
// `main.js askpass git|ssh <prompt>`. That client asks the host over a local socket, naming the
// command's session; the host asks the page, which answers from the passwords it keeps or a dialog.
//
// Git's own credential helpers are left out (`-c credential.helper=`) unless asked for, as IntelliJ's
// "Use credential helper", off by default. When a command that asked fails as authentication does,
// and wasn't cancelled, the page forgets the password it gave, and the command runs once more; when the credential
// helper was chosen meanwhile, it runs again with it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Git } from './git.js';

/** Who asks: git (a username or a password over HTTP) or ssh (a passphrase, a password, a yes/no). */
export type AskKind = 'git' | 'ssh';

/** What the client sends the host. */
export interface AskMessage {
  session: string;
  kind: AskKind;
  prompt: string;
}

/** What the page answers: the text, or null when cancelled; and whether to use git's helper now. */
export interface Answer {
  answer: string | null;
  useCredentialHelper?: boolean;
}

/** A prompt for the page, of a command's session. */
export interface Prompt extends AskMessage {
  /** Only what's kept may answer: no dialog (IntelliJ's silent mode, for checks of its own). */
  silent: boolean;
  /** Whether git has a credential helper, which the login dialog offers (IntelliJ's). */
  helper: boolean;
}

/**
 * Writes the scripts git and ssh run into a new folder: a line that runs `command` (the host's
 * entry, as Node) with `askpass`, the kind, and the prompt it's given.
 */
export function writeAskPassScripts(
  command: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { folder: string; git: string; ssh: string } {
  const folder = mkdtempSync(join(tmpdir(), 'cerebro-askpass-'));
  const quoted = command.map((word) => `"${word}"`).join(' ');
  const write = (kind: AskKind) => {
    const windows = platform === 'win32';
    const path = join(folder, `${kind}${windows ? '.bat' : '.sh'}`);
    writeFileSync(
      path,
      windows
        ? `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${quoted} askpass ${kind} %*\r\n`
        : `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quoted} askpass ${kind} "$@"\n`,
      { mode: 0o755 },
    );
    return path;
  };
  return { folder, git: write('git'), ssh: write('ssh') };
}

/**
 * Listens for the clients' questions on `path`, each a line, answered with what `ask` gives (a
 * garbled one, with null), after which the connection ends. A line, not the client's end of the
 * connection: on Windows, a named pipe closed for writing is closed both ways (measured: the reply
 * failed with EPIPE).
 */
export function listenForAskPass(
  path: string,
  ask: (message: AskMessage) => Promise<string | null>,
  platform: NodeJS.Platform = process.platform,
): Server {
  const server = createServer((socket) => {
    let text = '';
    socket.setEncoding('utf8');
    // A client gone before its answer (its git killed): nobody to answer.
    socket.on('error', () => undefined);
    const read = (chunk: string) => {
      text += chunk;
      const end = text.indexOf('\n');
      if (end < 0) return;
      socket.off('data', read);
      void answer(text.slice(0, end)).then((reply) =>
        socket.end(JSON.stringify({ answer: reply })),
      );
    };
    socket.on('data', read);
  });
  const answer = async (text: string) => {
    let message: Partial<AskMessage>;
    try {
      message = JSON.parse(text) as Partial<AskMessage>;
    } catch {
      return null;
    }
    const { session, kind, prompt } = message;
    if (typeof session !== 'string' || typeof prompt !== 'string') return null;
    if (kind !== 'git' && kind !== 'ssh') return null;
    return ask({ session, kind, prompt });
  };
  // A socket file left by a host that crashed would stop the server listening.
  if (platform !== 'win32') rmSync(path, { force: true });
  server.listen(path);
  server.unref();
  return server;
}

/**
 * The client, as `main.js askpass <kind> <prompt>`: asks the host and writes its answer for git or
 * ssh to read. Cancelled, it writes nothing, as IntelliJ's GitAskPassApp; a host it can't reach is a
 * failure.
 */
export function askPassClient(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  out: { write: (text: string) => unknown },
  err: { write: (text: string) => unknown },
): Promise<number> {
  const message: AskMessage = {
    session: env['CEREBRO_ASKPASS_SESSION'] ?? '',
    kind: args[0] === 'ssh' ? 'ssh' : 'git',
    prompt: args[1] ?? '',
  };
  const path = env['CEREBRO_ASKPASS_SOCKET'];
  if (path === undefined) {
    err.write('Could not communicate with Cerebro: not run by its git\n');
    return Promise.resolve(1);
  }
  return new Promise((resolve) => {
    let reply = '';
    const socket = createConnection(path, () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      reply += chunk;
    });
    socket.on('end', () => {
      let answer: string | null;
      try {
        ({ answer } = JSON.parse(reply) as { answer: string | null });
      } catch {
        err.write('Could not communicate with Cerebro: no answer\n');
        resolve(1);
        return;
      }
      if (answer === null) err.write('Authentication request was cancelled\n');
      else out.write(`${answer}\n`);
      resolve(0);
    });
    socket.on('error', (error) => {
      err.write(`Could not communicate with Cerebro: ${error.message}\n`);
      resolve(1);
    });
  });
}

/** Git's words for authentication that failed, as IntelliJ looks for them (in lower case). */
export function authFailed(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('authentication failed') ||
    text.includes('403 forbidden') ||
    text.includes('but was used to access one of realms') ||
    text.includes('error: 400') ||
    (text.includes('fatal: repository') && text.includes('not found')) ||
    (text.includes('fatal: unable to access') &&
      text.includes('the requested url returned error: 403')) ||
    text.includes('[remote rejected] (permission denied)')
  );
}

/** Where to ask, and how a command's prompts and its end reach the page. */
export interface AskPassOptions {
  socket: string;
  scripts: { git: string; ssh: string };
  /** Asks the page. */
  prompt: (prompt: Prompt) => Promise<Answer>;
  /** Tells the page how a command that asked ended: whether its authentication failed. */
  done: (session: string, failed: boolean) => void;
  /** The environment's DISPLAY, which ssh before 8.4 needs to use SSH_ASKPASS at all. */
  display?: string | undefined;
}

/** A command under way, by its session. */
interface Session {
  cwd: string;
  silent: boolean;
  asked: boolean;
  /** A prompt was cancelled: not a failure of authentication (IntelliJ's `wasCancelled`). */
  cancelled: boolean;
}

export class AskPass {
  /** IntelliJ's "Use credential helper": git's own helpers answer instead. */
  useCredentialHelper = false;
  private readonly sessions = new Map<string, Session>();
  private count = 0;
  // Not a parameter property: Node runs this file as it is, stripping its types, in the tests.
  private readonly options: AskPassOptions;

  constructor(options: AskPassOptions) {
    this.options = options;
  }

  /** Answers a client: the page's answer, for a command under way; else nothing. */
  async ask(message: AskMessage, run: Git): Promise<string | null> {
    const session = this.sessions.get(message.session);
    // Cancelled, git still asks for the rest (a password after a username): nothing, unasked.
    if (!session || session.cancelled) return null;
    session.asked = true;
    // IntelliJ's GitConfigUtil.isCredentialHelperUsed: git's config, without the command's reset.
    const helper = await run(session.cwd, ['config', '--get', 'credential.helper']).then(
      (value) => value.trim() !== '',
      () => false,
    );
    const answer = await this.options.prompt({ ...message, silent: session.silent, helper });
    if (answer.useCredentialHelper === true) this.useCredentialHelper = true;
    if (answer.answer === null) session.cancelled = true;
    return answer.answer;
  }

  /**
   * `run`, for git's remote commands: asking for credentials, without git's helpers unless they're
   * used. `silent` asks only what's kept, as IntelliJ's checks of the remote do.
   */
  git(run: Git, silent = false): Git {
    return async (cwd, args, env, ...input) => {
      let attempts = 0;
      for (;;) {
        const helper = this.useCredentialHelper;
        const id = String(++this.count);
        const session: Session = { cwd, silent, asked: false, cancelled: false };
        this.sessions.set(id, session);
        let failed = false;
        try {
          return await run(
            cwd,
            [...(helper ? [] : ['-c', 'credential.helper=']), ...args],
            { ...env, ...this.env(id) },
            ...input,
          );
        } catch (error) {
          failed = session.asked && !session.cancelled && authFailed((error as Error).message);
          // Chosen meanwhile, git's helper answers: not an attempt.
          if (helper !== this.useCredentialHelper) continue;
          // Asked again, as IntelliJ's: the password that failed is forgotten.
          if (failed && !silent && ++attempts < 2) continue;
          throw error;
        } finally {
          this.sessions.delete(id);
          if (session.asked) this.options.done(id, failed);
        }
      }
    };
  }

  private env(session: string): Record<string, string> {
    return {
      GIT_ASKPASS: this.options.scripts.git,
      SSH_ASKPASS: this.options.scripts.ssh,
      // ssh 8.4 and later use it without a terminal; earlier ones, only with a DISPLAY (IntelliJ's).
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: this.options.display ?? ':0.0',
      CEREBRO_ASKPASS_SOCKET: this.options.socket,
      CEREBRO_ASKPASS_SESSION: session,
      // Never a terminal's prompt, which would wait for ever: the scripts ask instead.
      GIT_TERMINAL_PROMPT: '0',
    };
  }
}
