// What the desktop app's preload script gives the page (packages/app/src/preload.cts):
// `window.cerebro`, undefined in a browser.

import type { NativeMenuBridge } from '@cerebro-ide/ui-menu';
import type { EditAction } from './edit.js';

/** A project: a folder opened in a window, which may show several, as tabs. */
export interface Project {
  path: string;
  name: string;
}

export interface RecentProject extends Project {
  /** When it was last opened, in milliseconds since the epoch. */
  opened: number;
  /** Whether its folder is still there. */
  exists: boolean;
}

/**
 * Where a project opens from a project's window: in the place of its active project ('this'), or
 * as more tabs ('new').
 */
export type OpenIn = 'this' | 'new';

/** What a diff window shows: a file of a project's worktree, against its last commit or between two. */
export interface DiffSpec {
  project: string;
  env: string;
  path: string;
  range?: { from: string; to?: string };
  /**
   * The worktree's branch, for a diff against another branch or a tag: its local side's title.
   * Undefined when HEAD is detached.
   */
  branch?: string | undefined;
  /**
   * The files Compare Previous and Next File go through, `path` among them, as IntelliJ's diff
   * chain: the list the diff was opened from.
   */
  chain?: string[];
  /** The line of the file as it is the caret starts at: the editor's, for its Show Diff. */
  line?: number;
}

/** Where Jump to Source goes from a diff window: a place in a file of its worktree. */
export interface DiffJump {
  env: string;
  path: string;
  line: number;
  column: number;
}

declare global {
  interface Window {
    cerebro?: {
      app: boolean;
      platform: string;
      /** The menu, and the system's edit actions on the focused field. */
      menu: NativeMenuBridge & { edit(action: EditAction): void };
      display: { setScale(choice: string): void };
      /** Shows a file in the system's file manager (Finder, Explorer), its folder open. */
      shell: { reveal(path: string): void };
      window: {
        setColours(frame: string, text: string, fullScreenButtons: string): void;
      };
      project: {
        /** The window's projects, in the order they were opened; none in the Welcome window. */
        current(): Promise<Project[]>;
        recent(): Promise<RecentProject[]>;
        pick(): Promise<string | null>;
        /** From a project's window: as more tabs ('new'), or in the place of `replacing`. */
        open(path: string, where: OpenIn, replacing?: string): Promise<void>;
        /** Closes one of the window's projects; its last closes the window. */
        close(path: string): Promise<void>;
        forget(path: string): Promise<void>;
        /** A project joined the window; in the place of `replaces`, if it says. */
        onAdded(listener: (project: Project & { replaces?: string }) => void): () => void;
        /** One of the window's projects was asked to open again: show it. */
        onShow(listener: (path: string) => void): () => void;
      };
      /** Diffs in windows of their own. */
      diff: {
        /** Shows a file's diff in a window of its own. */
        open(spec: DiffSpec): Promise<void>;
        /** From a diff window: its opener goes to a place in a file. */
        jump(at: DiffJump): Promise<void>;
        /** In a project's window: each place its diff windows jump to. */
        onJump(listener: (at: unknown) => void): () => void;
        /**
         * From a diff window: its opener shows the diff as a tab, and it closes; with `all`, the
         * opener's other diff windows are told to move too.
         */
        toTab(spec: DiffSpec, all?: boolean): Promise<void>;
        /** In a diff window: each time it's to move to a tab, as another diff window did. */
        onMove(listener: () => void): () => void;
        /** In a project's window: each diff its diff windows move to tabs. */
        onTab(listener: (spec: unknown) => void): () => void;
        /** From a diff window: asks its opener for a file's document (`text` null), or edits it. */
        document(path: string, text: string | null): Promise<void>;
        /** In a diff window: each text its opener tells of a document (null if unread). */
        onDocument(listener: (path: unknown, text: unknown) => void): () => void;
        /** In a project's window: each document a diff window asks for, or edits. */
        onDocumentAsked(listener: (path: unknown, text: unknown) => void): () => void;
        /** From a project's window: a document's text (null if unread), for its diff windows. */
        documentText(path: string, text: string | null): Promise<void>;
      };
      /** Passwords kept by key, encrypted by the system's keychain; null forgets one. */
      passwords: {
        get(key: string): Promise<string | null>;
        set(key: string, password: string | null): Promise<void>;
      };
      /** Each project's host, by the project's path. */
      host: {
        request(project: string, method: string, params?: unknown): Promise<unknown>;
        onNotification(
          listener: (project: string, method: string, params: unknown) => void,
        ): () => void;
      };
    };
  }
}
