// Terminals in the active worktree, run by its project's host: the Terminal tool window's shells, as
// tabs, and the Claude tool window's agent. Each worktree keeps its own, running while another is shown;
// a view made again for the same worktree (switching back, or after a reload) shows the same
// process.

import { makeObservable } from '@cerebro-ide/reactive';
import { TerminalView, type TerminalBackend } from '@cerebro-ide/ui-terminal';
import { agentArgs, agentEnded } from './agents.js';

type Listener<T extends unknown[]> = (...args: T) => void;

/**
 * A project's host's terminal methods and notifications, through the desktop app. Terminals are
 * numbered by each host: only the project's own notifications are its terminals'.
 */
function backend(host: NonNullable<Window['cerebro']>['host'], project: string): TerminalBackend {
  const data = new Set<Listener<[number, string]>>();
  const exits = new Set<Listener<[number, number]>>();
  host.onNotification((from, method, params) => {
    if (from !== project) return;
    const p = params as { id: number; data: string; exitCode: number };
    if (method === 'terminal.data') for (const listener of data) listener(p.id, p.data);
    if (method === 'terminal.exit') for (const listener of exits) listener(p.id, p.exitCode);
  });
  const send = (method: string, params: unknown) => {
    host.request(project, method, params).catch((error: unknown) => {
      console.error(`${method} failed`, error);
    });
  };
  return {
    open: (options) =>
      host.request(project, 'terminal.open', options) as Promise<{
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
/** Each project's terminals, by its path. */
const backends = new Map<string, TerminalBackend>();
let projectOf: (worktree: string) => string | undefined = () => undefined;

/** How a worktree's project is found: its terminals run on that project's host. */
export function setTerminalProject(resolve: (worktree: string) => string | undefined): void {
  projectOf = resolve;
}

/** The terminals of a worktree's project, in the desktop app. */
function backendFor(worktree: string): TerminalBackend | undefined {
  const project = projectOf(worktree);
  if (!host || project === undefined) return undefined;
  let found = backends.get(project);
  if (!found) {
    found = backend(host, project);
    backends.set(project, found);
  }
  return found;
}

const views = new Map<string, TerminalView>();
let passKey: (event: KeyboardEvent) => boolean = () => false;

/** Which keys terminals let through to the app: its shortcuts. */
export function setTerminalKeys(pass: (event: KeyboardEvent) => boolean): void {
  passKey = pass;
}

/**
 * The worktree's terminal under this key, made the first time it's asked for. A shell's `onExit`
 * runs when it ends.
 */
function terminal(
  kind: TerminalKind,
  worktree: string,
  key: string,
  onExit?: () => void,
): TerminalView | undefined {
  let view = views.get(key);
  if (!view) {
    const shared = backendFor(worktree);
    if (!shared) return undefined;
    view = new TerminalView(shared, {
      key,
      cwd: worktree,
      mac: window.cerebro?.platform === 'darwin',
      passKey: (event) => passKey(event),
      // The agent runs with the host's hooks, and resumes its last session.
      ...(kind === 'claude'
        ? {
            command: 'claude',
            args: () => agentArgs(worktree),
            agent: true,
            onExit: (exitCode: number) => {
              agentEnded(worktree, exitCode);
            },
          }
        : onExit
          ? { onExit }
          : {}),
    });
    views.set(key, view);
  }
  return view;
}

/** The worktree's agent, in the Claude tool window. */
export function agentTerminal(worktree: string): TerminalView | undefined {
  return terminal('claude', worktree, `claude:${worktree}`);
}

/** Where the Terminal tool window's tabs are kept between runs, by worktree. */
const SAVED = 'cerebro.terminals';

interface SavedShells {
  numbers: number[];
  active: number;
}

function loadShells(worktree: string): SavedShells | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Record<string, SavedShells>;
    const entry = saved[worktree];
    return entry && entry.numbers.length > 0 ? entry : undefined;
  } catch {
    return undefined;
  }
}

function saveShells(worktree: string, entry: SavedShells | undefined): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? '{}') as Record<string, SavedShells>;
    const others = Object.entries(saved).filter(([key]) => key !== worktree);
    const next = Object.fromEntries(entry ? [...others, [worktree, entry]] : others);
    localStorage.setItem(SAVED, JSON.stringify(next));
  } catch {
    // Storage unavailable: the tabs aren't kept, which only matters after a reload.
  }
}

/**
 * A worktree's shells, the Terminal tool window's tabs, as IntelliJ's: "Local", "Local (2)", each
 * numbered with the lowest number free. The first is there from the start; closing the last, or
 * its shell ending (exit), opens a new one, for the next time the tool window shows (`onLastClosed`
 * hides it, as IntelliJ does).
 * The tabs are kept between runs, so after a reload they show the same processes.
 */
export class Shells {
  numbers: number[];
  active: number;

  constructor(
    readonly worktree: string,
    private readonly onLastClosed: () => void,
  ) {
    const saved = loadShells(worktree);
    this.numbers = saved?.numbers ?? [1];
    this.active =
      saved && saved.numbers.includes(saved.active) ? saved.active : (this.numbers[0] as number);
    makeObservable(this);
  }

  static title(number: number): string {
    return number === 1 ? 'Local' : `Local (${String(number)})`;
  }

  /** The terminal of a tab, made when first shown. */
  view(number: number): TerminalView | undefined {
    // A shell that ends closes its tab, as IntelliJ's do.
    return terminal('shell', this.worktree, this.key(number), () => {
      this.close(number);
    });
  }

  /** Opens another shell, and shows it. */
  add(): void {
    let number = 1;
    while (this.numbers.includes(number)) number++;
    this.numbers = [...this.numbers, number];
    this.active = number;
    this.save();
  }

  select(number: number): void {
    this.active = number;
    this.save();
  }

  /** Ends a shell and removes its tab. */
  close(number: number): void {
    const index = this.numbers.indexOf(number);
    if (index < 0) return;
    const key = this.key(number);
    views.get(key)?.close();
    views.delete(key);
    const rest = this.numbers.filter((n) => n !== number);
    if (rest.length === 0) {
      this.numbers = [1];
      this.active = 1;
      this.save();
      this.onLastClosed();
      return;
    }
    this.numbers = rest;
    if (this.active === number) this.active = rest[Math.min(index, rest.length - 1)] as number;
    this.save();
  }

  /** Ends every shell, as when the worktree is removed. */
  closeAll(): void {
    for (const number of this.numbers) {
      views.get(this.key(number))?.close();
      views.delete(this.key(number));
    }
    saveShells(this.worktree, undefined);
  }

  private key(number: number): string {
    return `shell:${this.worktree}:${String(number)}`;
  }

  private save(): void {
    saveShells(this.worktree, { numbers: this.numbers, active: this.active });
  }
}

const shells = new Map<string, Shells>();
let lastClosed: () => void = () => undefined;

/** What closing a worktree's last shell does: hides the Terminal tool window. */
export function setLastShellClosed(handler: () => void): void {
  lastClosed = handler;
}

/** The worktree's shells, the Terminal tool window's tabs. */
export function shellsFor(worktree: string): Shells {
  let entry = shells.get(worktree);
  if (!entry) {
    entry = new Shells(worktree, () => {
      lastClosed();
    });
    shells.set(worktree, entry);
  }
  return entry;
}

/** Ends a worktree's terminals, as when it's removed. */
export function closeTerminals(worktree: string): void {
  shellsFor(worktree).closeAll();
  shells.delete(worktree);
  views.get(`claude:${worktree}`)?.close();
  views.delete(`claude:${worktree}`);
}
