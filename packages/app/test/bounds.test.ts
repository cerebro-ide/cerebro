import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { show, WindowStates, type Displays, type KeptWindow } from '../src/bounds.js';

const screen = (x: number, width = 1920, height = 1080) => ({
  bounds: { x, y: 0, width, height },
  workArea: { x, y: 0, width, height: height - 40 },
});

/** A window left at `bounds`, its 'close' to be called by the test. */
function fake(bounds = { x: 100, y: 50, width: 900, height: 700 }, maximized = false) {
  let closed: (() => void) | undefined;
  const window = {
    getNormalBounds: () => bounds,
    isMaximized: () => maximized,
    isFullScreen: () => false,
    show: vi.fn(),
    maximize: vi.fn(),
    setFullScreen: vi.fn(),
    on: (_event: 'close', listener: () => void) => {
      closed = listener;
    },
  } satisfies KeptWindow;
  return { window, close: () => closed?.() };
}

const folder = () => mkdtempSync(join(tmpdir(), 'cerebro-bounds-'));

describe('WindowStates', () => {
  it('opens a window as it was left, after a restart, by what it is', () => {
    const file = join(folder(), 'data', 'windows.json');
    const displays = () => [screen(0)];
    const states = new WindowStates(file, displays);
    expect(states.get('project:/a')).toBeUndefined();
    const left = fake(undefined, true);
    states.keep('project:/a', left.window);
    left.close();
    const again = new WindowStates(file, displays);
    expect(again.get('project:/a')).toEqual({
      x: 100,
      y: 50,
      width: 900,
      height: 700,
      maximized: true,
      fullScreen: false,
    });
    expect(again.get('project:/b')).toBeUndefined();
  });

  it('keeps one for each layout of screens, as IntelliJ’s', () => {
    const file = join(folder(), 'windows.json');
    let displays: Displays = [screen(0)];
    const states = new WindowStates(file, () => displays);
    const one = fake({ x: 10, y: 10, width: 800, height: 600 });
    states.keep('diff:/a', one.window);
    one.close();
    // A second screen: none kept for it yet.
    displays = [screen(0), screen(1920)];
    expect(states.get('diff:/a')).toBeUndefined();
    const two = fake({ x: 2000, y: 10, width: 800, height: 600 });
    states.keep('diff:/a', two.window);
    two.close();
    expect(states.get('diff:/a')?.x).toBe(2000);
    displays = [screen(0)];
    expect(states.get('diff:/a')?.x).toBe(10);
  });

  it('opens a window that would be off every screen as if none were kept', () => {
    const file = join(folder(), 'windows.json');
    const displays = () => [screen(0)];
    const states = new WindowStates(file, displays);
    for (const [key, x, y] of [
      ['right', 1920, 0],
      ['left', -900, 0],
      ['below', 0, 1040],
      ['above', 0, -700],
    ] as const) {
      const left = fake({ x, y, width: 900, height: 700 });
      states.keep(key, left.window);
      left.close();
      expect(states.get(key)).toBeUndefined();
    }
    const edge = fake({ x: 1900, y: 1000, width: 900, height: 700 });
    states.keep('edge', edge.window);
    edge.close();
    expect(states.get('edge')).toBeDefined();
  });

  it('ignores what it can’t read, and says when it can’t keep one', () => {
    const dir = folder();
    const file = join(dir, 'windows.json');
    writeFileSync(file, 'not json');
    expect(new WindowStates(file, () => [screen(0)]).get('a')).toBeUndefined();
    const key = `a/${['0', '0', '1920', '1080'].join('.')}`;
    writeFileSync(file, JSON.stringify({ [key]: { x: 'no' }, other: null }));
    expect(new WindowStates(file, () => [screen(0)]).get('a')).toBeUndefined();
    // A folder where the file goes: it can't be written.
    const blocked = new WindowStates(dir, () => [screen(0)]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const left = fake();
    blocked.keep('a', left.window);
    left.close();
    expect(error).toHaveBeenCalledWith(
      'Could not keep the window’s size and place',
      expect.any(Error),
    );
    error.mockRestore();
    expect(readFileSync(file, 'utf8')).toContain('"x":"no"');
  });
});

describe('show', () => {
  it('shows a window full screen, maximized, or as it is, as it was left', () => {
    const state = { x: 0, y: 0, width: 1, height: 1, maximized: false, fullScreen: false };
    const full = fake().window;
    show(full, { ...state, maximized: true, fullScreen: true });
    expect(full.setFullScreen).toHaveBeenCalledWith(true);
    expect(full.maximize).not.toHaveBeenCalled();
    const max = fake().window;
    show(max, { ...state, maximized: true });
    expect(max.maximize).toHaveBeenCalled();
    expect(max.show).not.toHaveBeenCalled();
    for (const left of [state, undefined]) {
      const plain = fake().window;
      show(plain, left);
      expect(plain.show).toHaveBeenCalled();
    }
  });
});
