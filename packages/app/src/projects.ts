// Projects: folders opened in windows, as tabs, each project with its own host (host.ts). A project
// opened from a window joins it as more tabs (New Window), or takes the place of its active project
// (This Window); one already open is brought to the front instead. The app keeps the projects opened recently and the ones open when
// it quit, by window, in its data folder (projects.json), and reopens those at the next start; with
// none, or once the last project is closed, it shows the Welcome window.
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

/** A project's name: its folder's, or the path for a root. */
export function projectName(path: string): string {
  return basename(path) || path;
}

/** A window's projects as saved: their paths, in the order of their tabs. */
function isGroup(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((path) => typeof path === 'string');
}

/**
 * The projects opened recently, the latest first, and the ones open now, by window, saved to a
 * file.
 */
export class ProjectStore {
  private recentList: RecentProject[] = [];
  private openList: string[][] = [];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { recent?: unknown; open?: unknown };
      if (Array.isArray(saved.recent)) this.recentList = saved.recent.filter(isRecent);
      if (Array.isArray(saved.open)) {
        // A path alone is a window of its own, as saved before windows had several projects.
        this.openList = saved.open
          .map((entry: unknown) => (typeof entry === 'string' ? [entry] : entry))
          .filter((group): group is string[] => isGroup(group) && group.length > 0);
      }
    } catch {
      // None saved yet, or unreadable: nothing recent.
    }
  }

  get recent(): readonly RecentProject[] {
    return this.recentList;
  }

  /** The projects open, by window. */
  get open(): readonly (readonly string[])[] {
    return this.openList;
  }

  /** A project was opened: first among the recent ones. */
  opened(path: string): void {
    const recent = { path, name: projectName(path), opened: this.now() };
    this.recentList = [recent, ...this.recentList.filter((r) => r.path !== path)].slice(
      0,
      MAX_RECENT,
    );
    this.save();
  }

  /** The projects open now, by window: those that reopen at the next start. */
  setOpen(windows: readonly (readonly string[])[]): void {
    this.openList = windows.map((group) => [...group]);
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

/**
 * Tells a page a project joined its window, as tabs: `{ path, name }`, with `replaces`, the path
 * of the project whose place it takes, if it does.
 */
export const PROJECT_ADDED = 'cerebro:project:added';
/** Tells a page to show one of its projects, asked to open again: its path. */
export const PROJECT_SHOW = 'cerebro:project:show';

/** A window, as projects need it. */
export interface ProjectWindow {
  /** Its contents' id: what IPC messages from its page carry. */
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  focus(): void;
  close(): void;
  onClosed(listener: () => void): void;
}

export interface ProjectDeps {
  store: ProjectStore;
  /** Starts and stops windows' hosts (host.ts). */
  hosts: {
    attach(window: ProjectWindow, repo: string): void;
    /** Stops a project's host in a window, or without one, all of the window's. */
    detach(window: ProjectWindow, repo?: string): void;
  };
  /** A new window, for projects or, smaller, the Welcome window. */
  create(welcome: boolean): ProjectWindow;
  /** Whether a folder is there to open. */
  exists(path: string): boolean;
}

/**
 * Where to open a project from a window: in the place of its active project ('this'), or as more
 * tabs ('new'), as IntelliJ's windows merged into tabs.
 */
export type OpenIn = 'this' | 'new';

interface Entry {
  window: ProjectWindow;
  /** Its projects, in the order they were opened; none for the Welcome window. */
  projects: string[];
}

/** The windows and the projects they show. */
export class ProjectWindows {
  private readonly windows = new Map<number, Entry>();
  private quitting = false;

  constructor(private readonly deps: ProjectDeps) {}

  /**
   * Opens the first windows: `repo`'s project when given (CEREBRO_REPO), else the projects open
   * when the app last quit that are still there, by window, else the Welcome window.
   */
  start(repo?: string): void {
    const groups =
      repo === undefined
        ? this.deps.store.open
            .map((group) => group.filter((p) => this.deps.exists(p)))
            .filter((group) => group.length > 0)
        : [[resolve(repo)]];
    if (groups.length === 0) this.welcome();
    for (const group of groups) this.openWindow(group);
    this.save();
  }

  /** The projects a window shows; none for the Welcome window, or a window not known. */
  projectsOf(id: number): readonly string[] {
    return this.windows.get(id)?.projects ?? [];
  }

  /**
   * Opens a project, from the window `from` if a page asked: as more tabs in it ('new'), or in the
   * place of its project `replacing` ('this'), whose host stops. One already open comes to the
   * front. Without a page asking, or from the Welcome window, a project gets a window of its own,
   * and the Welcome window closes.
   */
  open(path: string, where: OpenIn, from?: number, replacing?: string): void {
    const project = resolve(path);
    if (!this.deps.exists(project))
      throw new Error(`${project} is not a folder that can be opened`);
    for (const entry of this.windows.values()) {
      if (entry.projects.includes(project)) {
        entry.window.focus();
        entry.window.send(PROJECT_SHOW, project);
        return;
      }
    }
    const asking = from === undefined ? undefined : this.windows.get(from);
    if (asking && asking.projects.length > 0) {
      // In its place, else after the others.
      const index =
        where === 'this' && replacing !== undefined ? asking.projects.indexOf(replacing) : -1;
      if (index < 0) asking.projects.push(project);
      else {
        asking.projects[index] = project;
        this.deps.hosts.detach(asking.window, replacing);
      }
      this.deps.hosts.attach(asking.window, project);
      this.deps.store.opened(project);
      this.save();
      asking.window.send(PROJECT_ADDED, {
        path: project,
        name: projectName(project),
        ...(index < 0 ? {} : { replaces: replacing }),
      });
      return;
    }
    this.openWindow([project]);
    this.save();
    if (asking && asking.projects.length === 0) asking.window.close();
  }

  /**
   * Closes a project in a window, stopping its host. Its last project closes the window, and the
   * Welcome window shows if it was the last.
   */
  close(id: number, path: string): void {
    const entry = this.windows.get(id);
    if (!entry?.projects.includes(path)) return;
    if (entry.projects.length > 1) {
      entry.projects.splice(entry.projects.indexOf(path), 1);
      this.deps.hosts.detach(entry.window, path);
      this.save();
      return;
    }
    entry.projects = [];
    this.save();
    if (this.projectWindows() === 0) this.welcome();
    entry.window.close();
  }

  /** The app is quitting: the projects open now stay open for the next start. */
  quit(): void {
    this.quitting = true;
  }

  private projectWindows(): number {
    return [...this.windows.values()].filter((entry) => entry.projects.length > 0).length;
  }

  /** Keeps the projects open now, by window, for the next start. */
  private save(): void {
    this.deps.store.setOpen(
      [...this.windows.values()]
        .map((entry) => entry.projects)
        .filter((projects) => projects.length > 0),
    );
  }

  private openWindow(projects: string[]): void {
    const window = this.track(this.deps.create(false), projects);
    for (const project of projects) {
      this.deps.hosts.attach(window, project);
      this.deps.store.opened(project);
    }
  }

  private welcome(): void {
    this.track(this.deps.create(true), []);
  }

  private track(window: ProjectWindow, projects: string[]): ProjectWindow {
    const entry: Entry = { window, projects: [...projects] };
    this.windows.set(window.id, entry);
    window.onClosed(() => {
      this.windows.delete(window.id);
      this.deps.hosts.detach(window);
      // Closing the last project's window quits the app (or, on macOS, leaves it running): its
      // projects reopen next time, as IntelliJ's do. Closing one of several forgets its projects.
      if (!this.quitting && this.projectWindows() > 0) this.save();
    });
    return window;
  }
}
