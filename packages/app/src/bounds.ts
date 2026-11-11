// Windows keep their size and place, as IntelliJ's: a project's window (its `ProjectFrameBounds`:
// the bounds, maximized, full screen) and a project's diff window (`WindowStateService`, under the
// key "DiffContextDialog"), each opening as it was last left. As IntelliJ's, what's kept is for the
// screens as they are (`getAbsoluteKey` adds each screen's bounds to the key), and isn't used if it
// would be off every screen.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where a window was, and how. */
export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
  fullScreen: boolean;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The screens, as Electron's `screen.getAllDisplays()` gives them. */
export type Displays = readonly { bounds: Rectangle; workArea: Rectangle }[];

/** A window, as what's kept of it sees it (Electron's BrowserWindow). */
export interface KeptWindow {
  getNormalBounds(): Rectangle;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  show(): void;
  maximize(): void;
  setFullScreen(on: boolean): void;
  on(event: 'close', listener: () => void): void;
}

const isState = (value: unknown): value is WindowState => {
  const state = value as Partial<WindowState> | null;
  return (
    !!state &&
    (['x', 'y', 'width', 'height'] as const).every((k) => Number.isFinite(state[k])) &&
    typeof state.maximized === 'boolean' &&
    typeof state.fullScreen === 'boolean'
  );
};

/** The windows' states, kept in a file in the app's data folder. */
export class WindowStates {
  private states: Record<string, WindowState> = {};

  constructor(
    private readonly file: string,
    private readonly displays: () => Displays,
  ) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const [key, state] of Object.entries(saved))
        if (isState(state)) this.states[key] = state;
    } catch {
      // None kept yet, or unreadable: windows open at their sizes.
    }
  }

  /** `key` for the screens as they are now. */
  private keyOf(key: string): string {
    return [
      key,
      ...this.displays().map(
        ({ bounds: b }) => `${String(b.x)}.${String(b.y)}.${String(b.width)}.${String(b.height)}`,
      ),
    ].join('/');
  }

  /** How `key`'s window was left, if on a screen still. */
  get(key: string): WindowState | undefined {
    const state = this.states[this.keyOf(key)];
    if (!state) return undefined;
    // Some of it on a screen's work area, as IntelliJ's `isVisible`.
    const shown = this.displays().some(
      ({ workArea: a }) =>
        state.x < a.x + a.width &&
        state.x + state.width > a.x &&
        state.y < a.y + a.height &&
        state.y + state.height > a.y,
    );
    return shown ? state : undefined;
  }

  /** Keeps how `window` is left when it closes, as `key`'s. */
  keep(key: string, window: KeptWindow): void {
    window.on('close', () => {
      this.states[this.keyOf(key)] = {
        ...window.getNormalBounds(),
        maximized: window.isMaximized(),
        fullScreen: window.isFullScreen(),
      };
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(this.states));
      } catch (error) {
        // Not kept: the window opens at its size next time.
        console.error('Could not keep the window’s size and place', error);
      }
    });
  }
}

/**
 * Shows `window` maximized or full screen if it was left so (each also shows it: Electron's
 * `maximize` "will also show (but not focus) the window if it isn't already displayed").
 */
export function show(window: KeptWindow, state: WindowState | undefined): void {
  if (state?.fullScreen) window.setFullScreen(true);
  else if (state?.maximized) window.maximize();
  else window.show();
}
