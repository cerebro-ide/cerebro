// What the desktop app's preload script gives the page (packages/app/src/preload.cts):
// `window.cerebro`, undefined in a browser.

import type { NativeMenuBridge } from '@cerebro-ide/ui-menu';

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

/** Where a project opens: in this window, as more tabs, or a new one. */
export type OpenIn = 'this' | 'new';

declare global {
  interface Window {
    cerebro?: {
      app: boolean;
      platform: string;
      menu: NativeMenuBridge;
      display: { setScale(choice: string): void };
      window: {
        setColours(frame: string, text: string, fullScreenButtons: string): void;
      };
      project: {
        /** The window's projects, in the order they were opened; none in the Welcome window. */
        current(): Promise<Project[]>;
        recent(): Promise<RecentProject[]>;
        pick(): Promise<string | null>;
        open(path: string, where: OpenIn): Promise<void>;
        /** Closes one of the window's projects; its last closes the window. */
        close(path: string): Promise<void>;
        forget(path: string): Promise<void>;
        /** A project joined the window. */
        onAdded(listener: (project: Project) => void): () => void;
        /** One of the window's projects was asked to open again: show it. */
        onShow(listener: (path: string) => void): () => void;
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
