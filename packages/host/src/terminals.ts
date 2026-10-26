// Terminals: processes on a pseudo-terminal (node-pty), each in a folder, their output sent to the
// UI as notifications. A terminal is opened under a key the UI chooses (such as the agent's for a
// worktree): opening the same key again returns the running one with its recent output, so a
// reloaded page picks its terminals up where they were, and an agent keeps running.

/** The part of node-pty's process that terminals use. */
export interface Pty {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export type SpawnPty = (
  file: string,
  args: string[],
  options: { cwd: string; cols: number; rows: number; env: Record<string, string | undefined> },
) => Pty;

export interface OpenOptions {
  key: string;
  cwd: string;
  /** The program to run, else the user's shell. */
  command?: string;
  args?: string[];
  /** Added to the host's environment. */
  env?: Record<string, string>;
  cols: number;
  rows: number;
}

export interface Opened {
  id: number;
  /** The recent output, for a terminal that was already running; empty for a new one. */
  buffer: string;
  /** Undefined while it runs. */
  exitCode: number | undefined;
}

/** How much recent output each terminal keeps for a page that picks it up again, in characters. */
export const BUFFER_LIMIT = 256 * 1024;

interface Terminal {
  id: number;
  key: string;
  pty: Pty;
  buffer: string;
  /** Output not yet sent: sent together, so a burst of small chunks makes few notifications. */
  pending: string;
  exitCode: number | undefined;
}

/**
 * Variables of the process that started the app, not for its terminals: Electron's, which makes
 * Electron run as Node, and a Claude Code session's (when the app was started from one), with which
 * a `claude` in a terminal kept no transcript to resume (measured: with them, no session file;
 * without, `--resume` found it).
 */
export const UNINHERITED = [
  'ELECTRON_RUN_AS_NODE',
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
] as const;

/** The user's shell. */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') return env['COMSPEC'] ?? 'powershell.exe';
  return env['SHELL'] ?? '/bin/bash';
}

export class Terminals {
  private readonly byId = new Map<number, Terminal>();
  private readonly byKey = new Map<string, Terminal>();
  private next = 1;

  constructor(
    private readonly spawn: SpawnPty,
    private readonly notify: (method: string, params: unknown) => void,
    private readonly shell: () => string = defaultShell,
  ) {}

  open(options: OpenOptions): Opened {
    const running = this.byKey.get(options.key);
    if (running) {
      running.pty.resize(options.cols, options.rows);
      return { id: running.id, buffer: running.buffer, exitCode: running.exitCode };
    }
    const pty = this.spawn(options.command ?? this.shell(), options.args ?? [], {
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: {
        ...process.env,
        ...Object.fromEntries(UNINHERITED.map((name) => [name, undefined])),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ...options.env,
      },
    });
    const terminal: Terminal = {
      id: this.next++,
      key: options.key,
      pty,
      buffer: '',
      pending: '',
      exitCode: undefined,
    };
    this.byId.set(terminal.id, terminal);
    this.byKey.set(terminal.key, terminal);
    pty.onData((data) => {
      terminal.buffer = (terminal.buffer + data).slice(-BUFFER_LIMIT);
      if (terminal.pending === '') {
        setTimeout(() => {
          this.flush(terminal);
        }, 4);
      }
      terminal.pending += data;
    });
    pty.onExit(({ exitCode }) => {
      this.flush(terminal);
      terminal.exitCode = exitCode;
      this.notify('terminal.exit', { id: terminal.id, exitCode });
    });
    return { id: terminal.id, buffer: '', exitCode: undefined };
  }

  write(id: number, data: string): void {
    this.get(id).pty.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    const terminal = this.get(id);
    if (terminal.exitCode === undefined) terminal.pty.resize(cols, rows);
  }

  /** Ends the terminal's process, if it still runs, and forgets it. */
  close(id: number): void {
    const terminal = this.get(id);
    this.byId.delete(id);
    this.byKey.delete(terminal.key);
    if (terminal.exitCode === undefined) terminal.pty.kill();
  }

  closeAll(): void {
    for (const id of [...this.byId.keys()]) this.close(id);
  }

  private flush(terminal: Terminal): void {
    if (terminal.pending === '') return;
    this.notify('terminal.data', { id: terminal.id, data: terminal.pending });
    terminal.pending = '';
  }

  private get(id: number): Terminal {
    const terminal = this.byId.get(id);
    if (!terminal) throw new Error(`No terminal ${String(id)}`);
    return terminal;
  }
}
