// Diff windows: a diff opened from a project window shows in a window of its own, as IntelliJ's
// (Ido: "new window instead of as a tab"). Its page names what it shows in its URL's hash, asks the
// hosts of the window that opened it, as that window would, and sends Jump to Source back to it.
// It closes with that window. The same diff opened again brings its window to the front.

import { BrowserWindow, type WebContents } from 'electron';
import type { Hosts } from './host.js';
import { handle } from './ipc.js';

export const DIFF_OPEN = 'cerebro:diff:open';
export const DIFF_JUMP = 'cerebro:diff:jump';
/** To the opener: go to this place in a file. */
export const DIFF_JUMPED = 'cerebro:diff:jumped';

/** What a diff window shows: a file of a project's worktree, against its last commit or between two. */
export interface DiffSpec {
  project: string;
  env: string;
  path: string;
  range?: { from: string; to: string };
  /**
   * The files Compare Previous and Next File go through, `path` among them, as IntelliJ's diff
   * chain: the list the diff was opened from.
   */
  chain?: string[];
}

/** A window, as diff windows see it: the one that opens them, or one of them. */
export interface Window {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  focus(): void;
  close(): void;
  onClosed(listener: () => void): void;
}

/** The URL hash a diff window's page reads what it shows from. */
export const diffHash = (spec: DiffSpec): string =>
  `diff=${encodeURIComponent(JSON.stringify(spec))}`;

/** A diff window's spec from the page, checked: it names the files the window reads. */
export function diffSpec(value: unknown): DiffSpec {
  const text = (v: unknown) => typeof v === 'string' && v !== '';
  const spec = value as Partial<DiffSpec> | null;
  const range = spec?.range;
  const chain = spec?.chain as unknown;
  if (
    !spec ||
    !text(spec.project) ||
    !text(spec.env) ||
    !text(spec.path) ||
    (range !== undefined && !(text(range.from) && text(range.to))) ||
    (chain !== undefined &&
      !(Array.isArray(chain) && chain.every(text) && chain.includes(spec.path)))
  ) {
    throw new Error(
      'A diff needs a project, a worktree, a path, commits if a range, and its path in its files',
    );
  }
  return {
    project: spec.project as string,
    env: spec.env as string,
    path: spec.path as string,
    ...(range ? { range: { from: range.from, to: range.to } } : {}),
    ...(chain ? { chain: [...(chain as string[])] } : {}),
  };
}

export class DiffWindows {
  /** Each diff window's opener, by the diff window's id. */
  private readonly openers = new Map<number, Window>();
  /** The diff windows open, by their opener and spec. */
  private readonly open = new Map<string, Window>();

  constructor(
    private readonly hosts: Pick<Hosts, 'share' | 'unshare'>,
    private readonly create: (spec: DiffSpec) => Window,
  ) {}

  /** Shows the diff `spec` names for `opener`: in a new window, or the one that shows it. */
  show(opener: Window, spec: DiffSpec): void {
    const key = `${String(opener.id)} ${JSON.stringify(spec)}`;
    const shown = this.open.get(key);
    if (shown) {
      shown.focus();
      return;
    }
    const window = this.create(spec);
    this.hosts.share(window.id, opener.id);
    this.openers.set(window.id, opener);
    this.open.set(key, window);
    opener.onClosed(() => {
      window.close();
    });
    window.onClosed(() => {
      this.hosts.unshare(window.id);
      this.openers.delete(window.id);
      this.open.delete(key);
    });
  }

  /** Jump to Source from the diff window `id`: its opener goes to the place, in front. */
  jump(id: number, at: unknown): void {
    const opener = this.openers.get(id);
    if (!opener) return;
    opener.send(DIFF_JUMPED, at);
    opener.focus();
  }
}

/** A window's contents as a diff window's opener or a diff window. */
export function windowOf(contents: WebContents): Window {
  // Its window, while it has one: Electron throws for contents destroyed ("Object has been
  // destroyed"), as a diff window's are when its opener closes after it.
  const owner = () => (contents.isDestroyed() ? null : BrowserWindow.fromWebContents(contents));
  return {
    id: contents.id,
    send: (channel, ...args) => {
      if (!contents.isDestroyed()) contents.send(channel, ...args);
    },
    focus: () => {
      const window = owner();
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    },
    close: () => {
      owner()?.close();
    },
    onClosed: (listener) => {
      contents.once('destroyed', listener);
    },
  };
}

/** Lets project windows open diff windows, and diff windows jump back to them. */
export function installDiffWindows(hosts: Hosts, create: (spec: DiffSpec) => Window): DiffWindows {
  const windows = new DiffWindows(hosts, create);
  handle(DIFF_OPEN, (event, spec: unknown) => {
    windows.show(windowOf(event.sender), diffSpec(spec));
  });
  handle(DIFF_JUMP, (event, at: unknown) => {
    windows.jump(event.sender.id, at);
  });
  return windows;
}
