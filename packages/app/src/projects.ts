// Projects: a folder opened in a window, each window with its own host for it (host.ts). As in
// IntelliJ, a project opens in its own window or replaces the one asking; one already open is
// brought to the front instead. The app keeps the projects opened recently and the ones open when
// it quit, in its data folder (projects.json), and reopens those at the next start; with none, or
// once the last project is closed, it shows the Welcome window.
//
// Electron stays out of this file: main.ts gives it windows as `ProjectWindow`s.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export interface RecentProject {
  path: string;
  name: string;
  /** When it was last opened, in milliseconds since the epoch. */
  opened: number;
}

/** How many recent projects are kept. */
const MAX_RECENT = 20;

function isRecent(value: unknown): value is RecentProject {
  const recent = value as Partial<RecentProject> | null;
  return (
    typeof recent?.path === 'string' &&
    typeof recent.name === 'string' &&
    typeof recent.opened === 'number'
  );
}

/** The projects opened recently, the latest first, and the ones open now, saved to a file. */
export class ProjectStore {
  private recentList: RecentProject[] = [];
  private openList: string[] = [];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { recent?: unknown; open?: unknown };
      if (Array.isArray(saved.recent)) this.recentList = saved.recent.filter(isRecent);
      if (Array.isArray(saved.open)) {
        this.openList = saved.open.filter((path): path is string => typeof path === 'string');
      }
    } catch {
      // None saved yet, or unreadable: nothing recent.
    }
  }

  get recent(): readonly RecentProject[] {
    return this.recentList;
  }

  get open(): readonly string[] {
    return this.openList;
  }

  /** A project was opened: first among the recent ones, and open. */
  opened(path: string): void {
    const recent = { path, name: basename(path) || path, opened: this.now() };
    this.recentList = [recent, ...this.recentList.filter((r) => r.path !== path)].slice(
      0,
      MAX_RECENT,
    );
    if (!this.openList.includes(path)) this.openList.push(path);
    this.save();
  }

  /** A project was closed: it won't reopen at the next start. */
  closed(path: string): void {
    this.openList = this.openList.filter((p) => p !== path);
    this.save();
  }

  /** Removes a project from the recent ones. */
  forget(path: string): void {
    this.recentList = this.recentList.filter((r) => r.path !== path);
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ recent: this.recentList, open: this.openList }));
    } catch (error) {
      // Not kept: the app still works, it just won't remember.
      console.error('Could not save the projects', error);
    }
  }
}

/** A window, as projects need it. */
export interface ProjectWindow {
  /** Its contents' id: what IPC messages from its page carry. */
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  focus(): void;
  close(): void;
  /** Loads its page again: after its project changed. */
  reload(): void;
  onClosed(listener: () => void): void;
}

export interface ProjectDeps {
  store: ProjectStore;
  /** Starts and stops windows' hosts (host.ts). */
  hosts: {
    attach(window: ProjectWindow, repo: string): void;
    detach(window: ProjectWindow): void;
  };
  /** A new window, for a project or, without one, the Welcome window. */
  create(project: string | undefined): ProjectWindow;
  /** Whether a folder is there to open. */
  exists(path: string): boolean;
}

/** Where to open a project: in the window asking, or a new one. */
export type OpenIn = 'this' | 'new';

/** The windows and the projects they show. */
export class ProjectWindows {
  private readonly windows = new Map<number, { window: ProjectWindow; project?: string }>();
  private quitting = false;

  constructor(private readonly deps: ProjectDeps) {}

  /**
   * Opens the first windows: `repo`'s project when given (CEREBRO_REPO), else the projects open
   * when the app last quit that are still there, else the Welcome window.
   */
  start(repo?: string): void {
    const paths =
      repo === undefined
        ? this.deps.store.open.filter((p) => this.deps.exists(p))
        : [resolve(repo)];
    if (paths.length === 0) this.welcome();
    for (const path of paths) this.openWindow(path);
  }

  /** The project a window shows; undefined for the Welcome window, or a window not known. */
  projectOf(id: number): string | undefined {
    return this.windows.get(id)?.project;
  }

  /**
   * Opens a project, from the window `from` if a page asked. One already open comes to the front.
   * In the Welcome window, a project always gets a new window, and the Welcome window closes.
   */
  open(path: string, where: OpenIn, from?: number): void {
    const project = resolve(path);
    if (!this.deps.exists(project))
      throw new Error(`${project} is not a folder that can be opened`);
    for (const entry of this.windows.values()) {
      if (entry.project === project) {
        entry.window.focus();
        return;
      }
    }
    const asking = from === undefined ? undefined : this.windows.get(from);
    if (asking?.project !== undefined && where === 'this') {
      this.deps.store.closed(asking.project);
      asking.project = project;
      this.deps.hosts.attach(asking.window, project);
      this.deps.store.opened(project);
      asking.window.reload();
      return;
    }
    this.openWindow(project);
    if (asking && asking.project === undefined) asking.window.close();
  }

  /** Closes a window's project: its window closes, and the Welcome window shows if it was the last. */
  close(id: number): void {
    const entry = this.windows.get(id);
    if (entry?.project === undefined) return;
    this.deps.store.closed(entry.project);
    if (this.projectWindows() === 1) this.welcome();
    entry.window.close();
  }

  /** The app is quitting: the projects open now stay open for the next start. */
  quit(): void {
    this.quitting = true;
  }

  private projectWindows(): number {
    return [...this.windows.values()].filter((entry) => entry.project !== undefined).length;
  }

  private openWindow(project: string): void {
    const window = this.track(this.deps.create(project), project);
    this.deps.hosts.attach(window, project);
    this.deps.store.opened(project);
  }

  private welcome(): void {
    this.track(this.deps.create(undefined), undefined);
  }

  private track(window: ProjectWindow, project: string | undefined): ProjectWindow {
    const entry: { window: ProjectWindow; project?: string } = { window };
    if (project !== undefined) entry.project = project;
    this.windows.set(window.id, entry);
    window.onClosed(() => {
      this.windows.delete(window.id);
      this.deps.hosts.detach(window);
      // Closing the last project's window quits the app (or, on macOS, leaves it running): that
      // project reopens next time, as IntelliJ's does. Closing one of several closes it.
      if (entry.project !== undefined && !this.quitting && this.projectWindows() > 0) {
        this.deps.store.closed(entry.project);
      }
    });
    return window;
  }
}
