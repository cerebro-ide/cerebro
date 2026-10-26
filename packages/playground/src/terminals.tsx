// Terminals in the active worktree, run by the host: the Terminal tool window's shell, and the
// Claude tool window's agent. Each worktree keeps its own, running while another is shown; a view
// made again for the same worktree (switching back, or after a reload) shows the same process.

import { TerminalView, type TerminalBackend } from '@cerebro-ide/ui-terminal';

type Listener<T extends unknown[]> = (...args: T) => void;

/** The host's terminal methods and notifications, through the desktop app. */
function backend(host: NonNullable<Window['cerebro']>['host']): TerminalBackend {
  const data = new Set<Listener<[number, string]>>();
  const exits = new Set<Listener<[number, number]>>();
  host.onNotification((method, params) => {
    const p = params as { id: number; data: string; exitCode: number };
    if (method === 'terminal.data') for (const listener of data) listener(p.id, p.data);
    if (method === 'terminal.exit') for (const listener of exits) listener(p.id, p.exitCode);
  });
  const send = (method: string, params: unknown) => {
    host.request(method, params).catch((error: unknown) => {
      console.error(`${method} failed`, error);
    });
  };
  return {
    open: (options) =>
      host.request('terminal.open', options) as Promise<{
        id: number;
        buffer: string;
        exitCode?: number;
      }>,
    write: (id, text) => {
      send('terminal.write', { id, data: text });
    },
    resize: (id, cols, rows) => {
      send('terminal.resize', { id, cols, rows });
    },
    close: (id) => {
      send('terminal.close', { id });
    },
    onData: (listener) => {
      data.add(listener);
      return () => data.delete(listener);
    },
    onExit: (listener) => {
      exits.add(listener);
      return () => exits.delete(listener);
    },
  };
}

export type TerminalKind = 'shell' | 'claude';

const host = window.cerebro?.host;
const shared = host ? backend(host) : undefined;
const views = new Map<string, TerminalView>();
let passKey: (event: KeyboardEvent) => boolean = () => false;

/** Which keys terminals let through to the app: its shortcuts. */
export function setTerminalKeys(pass: (event: KeyboardEvent) => boolean): void {
  passKey = pass;
}

/** The worktree's terminal of this kind, made the first time it's asked for. */
export function terminalFor(kind: TerminalKind, worktree: string): TerminalView | undefined {
  if (!shared) return undefined;
  const key = `${kind}:${worktree}`;
  let view = views.get(key);
  if (!view) {
    view = new TerminalView(shared, {
      key,
      cwd: worktree,
      mac: window.cerebro?.platform === 'darwin',
      passKey: (event) => passKey(event),
      ...(kind === 'claude' ? { command: 'claude' } : {}),
    });
    views.set(key, view);
  }
  return view;
}

/** Ends a worktree's terminals, as when it's removed. */
export function closeTerminals(worktree: string): void {
  for (const kind of ['shell', 'claude'] as const) {
    const key = `${kind}:${worktree}`;
    views.get(key)?.close();
    views.delete(key);
  }
}
