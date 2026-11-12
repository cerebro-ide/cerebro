// Diff windows: a diff opened from a project window shows in a window of its own, as IntelliJ's
// (Ido: "new window instead of as a tab"). Its page names what it shows in its URL's hash, asks the
// hosts of the window that opened it, as that window would, and sends Jump to Source back to it,
// and Show Diff in Editor Tab, which opens it there as a tab and closes it. A file as it is is that
// window's document, as IntelliJ's diff edits the file's one document: the diff window asks for it
// and edits it through that window, which tells its diff windows of its text. It closes with that
// window. The same diff opened again brings its window to the front. Show Diff in Editor Tab moves
// every diff window of that opener, as IntelliJ's moves every diff open.

import { BrowserWindow, type WebContents } from 'electron';
import type { Hosts } from './host.js';
import { handle } from './ipc.js';

export const DIFF_OPEN = 'cerebro:diff:open';
export const DIFF_JUMP = 'cerebro:diff:jump';
/** To the opener: go to this place in a file. */
export const DIFF_JUMPED = 'cerebro:diff:jumped';
export const DIFF_TAB = 'cerebro:diff:tab';
/** To the opener: show this diff as a tab. */
export const DIFF_TABBED = 'cerebro:diff:tabbed';
/** To a diff window: move to a tab, as another of its opener's did. */
export const DIFF_MOVE = 'cerebro:diff:move';
/** From a diff window, and on to its opener: a file's document, to be told of, or its new text. */
export const DIFF_DOCUMENT = 'cerebro:diff:document';
export const DIFF_DOCUMENT_ASKED = 'cerebro:diff:document-asked';
/** From an opener, and on to its diff windows: a file's document's text, or null if unread. */
export const DIFF_DOCUMENT_TEXT = 'cerebro:diff:document-text';
export const DIFF_DOCUMENT_SHOWN = 'cerebro:diff:document-shown';

/**
 * What a diff window shows: a file of a project's worktree, against its last commit, between two,
 * or against a branch or a tag as it is (a range without `to`).
 */
export interface DiffSpec {
  project: string;
  env: string;
  path: string;
  range?: { from: string; to?: string };
  /** The worktree's branch, against a branch or a tag: its side's title. None when detached. */
  branch?: string;
  /**
   * The files Compare Previous and Next File go through, `path` among them, as IntelliJ's diff
   * chain: the list the diff was opened from.
   */
  chain?: string[];
  /** The line of the file as it is the caret starts at (from 0): the editor's, for Show Diff. */
  line?: number;
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
  const line = spec?.line as unknown;
  const branch = spec?.branch as unknown;
  if (
    !spec ||
    !text(spec.project) ||
    !text(spec.env) ||
    !text(spec.path) ||
    (range !== undefined && !(text(range.from) && (range.to === undefined || text(range.to)))) ||
    (branch !== undefined && !text(branch)) ||
    (chain !== undefined &&
      !(Array.isArray(chain) && chain.every(text) && chain.includes(spec.path))) ||
    (line !== undefined && !(Number.isInteger(line) && (line as number) >= 0))
  ) {
    throw new Error(
      'A diff needs a project, a worktree, a path, commits if a range, its path in its files, and a line from 0',
    );
  }
  return {
    project: spec.project as string,
    env: spec.env as string,
    path: spec.path as string,
    ...(range
      ? { range: { from: range.from, ...(range.to === undefined ? {} : { to: range.to }) } }
      : {}),
    ...(branch === undefined ? {} : { branch: branch as string }),
    ...(chain ? { chain: [...(chain as string[])] } : {}),
    ...(line === undefined ? {} : { line: line as number }),
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

  /** From the diff window `id`: its opener is asked for a file's document, or edits it. */
  askDocument(id: number, path: unknown, text: unknown): void {
    this.openers.get(id)?.send(DIFF_DOCUMENT_ASKED, path, text);
  }

  /** From `opener`: a file's document's text, for each of its diff windows. */
  showDocument(opener: number, path: unknown, text: unknown): void {
    for (const window of this.open.values()) {
      if (this.openers.get(window.id)?.id === opener) {
        window.send(DIFF_DOCUMENT_SHOWN, path, text);
      }
    }
  }

  /**
   * Show Diff in Editor Tab from the diff `window`: its opener shows `spec` as a tab, in front.
   * With `all`, the opener's other diff windows are told to move too, as IntelliJ's
   * `reopenDiffEditorsForFiles` moves every diff open.
   */
  toTab(window: Window, spec: DiffSpec, all = false): void {
    const opener = this.openers.get(window.id);
    if (!opener) return;
    opener.send(DIFF_TABBED, spec);
    opener.focus();
    window.close();
    if (!all) return;
    for (const other of this.open.values()) {
      if (other.id !== window.id && this.openers.get(other.id)?.id === opener.id) {
        other.send(DIFF_MOVE);
      }
    }
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

/** Lets project windows open diff windows, and diff windows jump and move back to them. */
export function installDiffWindows(hosts: Hosts, create: (spec: DiffSpec) => Window): DiffWindows {
  const windows = new DiffWindows(hosts, create);
  handle(DIFF_OPEN, (event, spec: unknown) => {
    windows.show(windowOf(event.sender), diffSpec(spec));
  });
  handle(DIFF_JUMP, (event, at: unknown) => {
    windows.jump(event.sender.id, at);
  });
  handle(DIFF_TAB, (event, spec: unknown, all: unknown) => {
    windows.toTab(windowOf(event.sender), diffSpec(spec), all === true);
  });
  handle(DIFF_DOCUMENT, (event, path: unknown, text: unknown) => {
    windows.askDocument(event.sender.id, path, text);
  });
  handle(DIFF_DOCUMENT_TEXT, (event, path: unknown, text: unknown) => {
    windows.showDocument(event.sender.id, path, text);
  });
  return windows;
}
