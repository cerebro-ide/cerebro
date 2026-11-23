import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCK_ICON, sizeFrom, TOOLBAR_HEIGHT, windowIcon, windowOptions } from '../src/window.js';

describe('windowOptions', () => {
  it('hides the title bar, drawing the window controls over the toolbar', () => {
    const options = windowOptions('win32', '/preload.cjs');
    expect(options.titleBarStyle).toBe('hidden');
    expect(options.titleBarOverlay).toEqual(expect.objectContaining({ height: TOOLBAR_HEIGHT }));
    expect(options.show).toBe(false);
  });

  it('places the traffic lights on macOS instead', () => {
    const options = windowOptions('darwin', '/preload.cjs');
    expect(options.titleBarOverlay).toBeUndefined();
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 13 });
  });

  it('isolates the page, giving it only the preload script', () => {
    expect(windowOptions('linux', '/preload.cjs').webPreferences).toEqual({
      preload: '/preload.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });

  it('gives a window its icon: an ICO on Windows, a PNG on Linux, none on macOS (the Dock’s)', () => {
    expect(windowOptions('win32', '/preload.cjs').icon).toMatch(/icons\/cerebro\.ico$/);
    expect(windowOptions('linux', '/preload.cjs').icon).toMatch(/icons\/cerebro\.png$/);
    expect(windowOptions('darwin', '/preload.cjs')).not.toHaveProperty('icon');
    // Where the built app finds them: dist's sibling, as src's.
    for (const icon of [windowIcon('win32'), windowIcon('linux'), DOCK_ICON]) {
      expect(existsSync(icon as string)).toBe(true);
    }
  });

  it('zooms the page when told to', () => {
    expect(windowOptions('darwin', '/preload.cjs', 0.625).webPreferences?.zoomFactor).toBe(0.625);
  });

  it('reads a size as the tests give it, ignoring anything else', () => {
    expect(sizeFrom('1024x768')).toEqual({ width: 1024, height: 768 });
    expect(sizeFrom(undefined)).toBeUndefined();
    expect(sizeFrom('')).toBeUndefined();
    expect(sizeFrom('wide')).toBeUndefined();
  });
});
