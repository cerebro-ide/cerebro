// The display scale: the OS's by default, or the user's choice (Appearance › Display scale). Chromium
// fixes the scale when it starts, so it's applied with its --force-device-scale-factor switch before
// the app is ready, and a change applies on the next start. macOS ignores that switch (measured in
// CI: the page's devicePixelRatio stayed 1 with 1.25 forced), so there the page is zoomed instead,
// by the scale chosen over the screen's: the page's devicePixelRatio is the screen's times the zoom.
//
// Under WSL, the app draws through WSLg, which doesn't pass Windows' scale on: Electron sees 1
// whatever Windows uses (measured: 1 under Windows at 150%). There, the OS scale is read from
// Windows' registry (AppliedDPI, 96 at 100%), through reg.exe (measured: 0.1 s; PowerShell 2.6 s).
//
// Until the settings files exist, the page sends the choice here, and it's kept in the app's data
// folder (display.json).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';

export const SET_SCALE = 'cerebro:display:scale';

/** The choices: the OS's scale, or a fixed one. */
export const SCALES = ['auto', '1', '1.25', '1.5', '1.75', '2', '2.5', '3'] as const;
export type ScaleChoice = (typeof SCALES)[number];

/** What the scale depends on, so it can be tested away from WSL and Windows. */
export interface System {
  platform: NodeJS.Platform;
  /** Reads a text file; undefined if it can't. */
  read(path: string): string | undefined;
  /** Runs a program and gives its output; undefined if it fails. */
  run(file: string, args: readonly string[]): string | undefined;
}

export const system: System = {
  platform: process.platform,
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
  run: (file, args) => {
    try {
      return execFileSync(file, args, { encoding: 'utf8', timeout: 2000 });
    } catch {
      return undefined;
    }
  },
};

/** Whether the app runs under WSL, whose kernel names Microsoft. */
export function isWsl(sys: System): boolean {
  return sys.platform === 'linux' && /microsoft/i.test(sys.read('/proc/version') ?? '');
}

/** The OS's scale where Electron can't see it (under WSL), else undefined: Electron's own. */
export function osScale(sys: System): number | undefined {
  if (!isWsl(sys)) return undefined;
  const output = sys.run('reg.exe', [
    'query',
    'HKCU\\Control Panel\\Desktop\\WindowMetrics',
    '/v',
    'AppliedDPI',
  ]);
  const dpi = /AppliedDPI\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output ?? '')?.[1];
  return dpi === undefined ? undefined : parseInt(dpi, 16) / 96;
}

/** The scale to force for a choice, or undefined to leave it to Electron. */
export function scaleFor(choice: ScaleChoice, sys: System): number | undefined {
  return choice === 'auto' ? osScale(sys) : Number(choice);
}

/**
 * The page's zoom: only on macOS, where the switch is ignored; there 1 when no scale is forced, since
 * a window without a zoom factor kept the zoom of the last run (measured in CI: 1.25 after going
 * back to auto).
 */
export function zoomFor(
  scale: number | undefined,
  platform: NodeJS.Platform,
  screenScale: number,
): number | undefined {
  if (platform !== 'darwin') return undefined;
  return scale === undefined ? 1 : scale / screenScale;
}

function isChoice(value: unknown): value is ScaleChoice {
  return SCALES.includes(value as ScaleChoice);
}

/** The choice kept in the app's data folder; auto when there is none, or it's unreadable. */
export function readChoice(folder: string, sys: System): ScaleChoice {
  try {
    const saved = (
      JSON.parse(sys.read(join(folder, 'display.json')) ?? '{}') as { scale?: unknown }
    ).scale;
    return isChoice(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
}

/**
 * Applies the saved choice (before the app is ready), and keeps the choices the page sends for the
 * next start. Returns the scale forced, if any.
 */
export function installDisplayScale(
  sys: System = system,
  write: (path: string, data: string) => void = writeFileSync,
): number | undefined {
  const folder = app.getPath('userData');
  const scale = scaleFor(readChoice(folder, sys), sys);
  if (scale !== undefined && sys.platform !== 'darwin') {
    app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
  }
  ipcMain.on(SET_SCALE, (_event, choice: unknown) => {
    if (!isChoice(choice)) return;
    try {
      write(join(folder, 'display.json'), JSON.stringify({ scale: choice }));
    } catch {
      // The data folder can't be written: the choice won't apply on the next start.
    }
  });
  return scale;
}
