import { describe, expect, it } from 'vitest';
import { TOOLBAR_HEIGHT, windowOptions } from '../src/window.js';

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

  it('zooms the page when told to', () => {
    expect(windowOptions('darwin', '/preload.cjs', 0.625).webPreferences?.zoomFactor).toBe(0.625);
  });
});
