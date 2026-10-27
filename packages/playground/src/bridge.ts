// What the desktop app's preload script gives the page (packages/app/src/preload.cts):
// `window.cerebro`, undefined in a browser.

import type { NativeMenuBridge } from '@cerebro-ide/ui-menu';

/** A project: a folder opened in a window. */
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

/** Where a project opens: in this window, or a new one. */
export type OpenIn = 'this' | 'new';

declare global {
  interface Window {
    cerebro?: {
      app: boolean;
      platform: string;
      menu: NativeMenuBridge;
      display: { setScale(choice: string): void };
      window: { setColours(frame: string, text: string): void };
      project: {
        current(): Promise<Project | null>;
        recent(): Promise<RecentProject[]>;
        pick(): Promise<string | null>;
        open(path: string, where: OpenIn): Promise<void>;
        close(): Promise<void>;
        forget(path: string): Promise<void>;
      };
      host: {
        request(method: string, params?: unknown): Promise<unknown>;
        onNotification(listener: (method: string, params: unknown) => void): () => void;
      };
    };
  }
}
