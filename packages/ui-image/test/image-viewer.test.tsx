import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { fitZoom, GRID_FROM, ImageView, ImageViewer } from '../src/index.js';
import '../src/styles.css';

/** A PNG of this size, drawn on a canvas. */
function pngOf(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.toDataURL('image/png');
}

let host: HTMLElement | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  host = undefined;
});

/** The viewer in an area of this size. */
function show(view: ImageView, src: string, size = { width: 400, height: 300 }) {
  host = document.createElement('div');
  host.style.width = `${String(size.width)}px`;
  host.style.height = `${String(size.height)}px`;
  document.body.append(host);
  const handle = render(() => <ImageViewer view={view} src={src} label="a.png" />, host);
  dispose = () => {
    handle.dispose();
  };
  return host.querySelector('.cerebro-image') as HTMLElement;
}

const img = () => host?.querySelector('img') as HTMLImageElement;

describe('the zoom that fits', () => {
  it('enlarges a small image to about 128 pixels', () => {
    expect(fitZoom({ width: 4, height: 2 }, { width: 400, height: 300 })).toBe(48);
    expect(fitZoom({ width: 100, height: 100 }, { width: 400, height: 300 })).toBe(2);
  });

  it('shrinks one larger than its area, less 2px each side; else 1:1', () => {
    expect(fitZoom({ width: 800, height: 200 }, { width: 404, height: 300 })).toBe(0.5);
    expect(fitZoom({ width: 200, height: 200 }, { width: 400, height: 300 })).toBe(1);
  });

  it('has none for an empty image or area', () => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 400, height: 300 })).toBeUndefined();
    expect(fitZoom({ width: 200, height: 200 }, { width: 4, height: 300 })).toBeUndefined();
  });
});

describe('the zoom', () => {
  const loaded = (width = 200, height = 200) => {
    const view = new ImageView();
    view.resize(400, 300);
    view.load(width, height);
    return view;
  };

  it('goes in by 2 above 1:1 and by 1.5 below it, up to 32', () => {
    const view = loaded();
    expect(view.zoom).toBe(1);
    view.zoomIn();
    expect(view.zoom).toBe(2);
    for (let i = 0; i < 5; i++) view.zoomIn();
    expect(view.zoom).toBe(32);
    expect(view.canZoomIn).toBe(false);
    view.zoom = 0.5;
    view.zoomIn();
    expect(view.zoom).toBe(0.75);
    view.zoomIn();
    expect(view.zoom).toBe(1);
  });

  it('goes out by 2 to 1:1, then by 1.5, down to a pixel’s width', () => {
    const view = loaded(4, 4);
    view.zoom = 3;
    view.zoomOut();
    expect(view.zoom).toBe(1.5);
    view.zoomOut();
    expect(view.zoom).toBe(1);
    view.zoomOut();
    expect(view.zoom).toBeCloseTo(1 / 1.5);
    for (let i = 0; i < 5; i++) view.zoomOut();
    expect(view.zoom).toBe(0.25);
    expect(view.canZoomOut).toBe(false);
  });

  it('stops at 1.5⁻⁸ for a large image', () => {
    const view = loaded(100_000, 100_000);
    for (let i = 0; i < 20; i++) view.zoomOut();
    expect(view.zoom).toBeCloseTo((1 / 1.5) ** 8);
  });

  it('isn’t fitted again once changed by hand, until Fit', () => {
    const view = loaded(800, 600);
    expect(view.zoom).toBeCloseTo(296 / 600);
    view.actualSize();
    expect(view.zoom).toBe(1);
    view.resize(200, 200);
    expect(view.zoom).toBe(1);
    view.fit();
    expect(view.zoom).toBeCloseTo(196 / 800);
    expect(view.zoomChanged).toBe(false);
    view.resize(4, 4);
    // No room: as it was.
    expect(view.zoom).toBeCloseTo(196 / 800);
    view.resize(404, 404);
    expect(view.zoom).toBeCloseTo(0.5);
  });

  it('is 1:1 when the image loads before its area is measured, then fitted to it', () => {
    // The image's load can come before the area's first resize: their order is the browser's.
    const view = new ImageView();
    view.load(800, 600);
    expect(view.zoom).toBe(1);
    view.resize(404, 404);
    expect(view.zoom).toBe(0.5);
  });

  it('can’t zoom before the image has loaded; Fit makes it 1:1', () => {
    const view = new ImageView();
    expect(view.canZoomIn).toBe(false);
    expect(view.canZoomOut).toBe(false);
    view.resize(400, 300);
    view.fit();
    expect(view.zoom).toBe(1);
  });

  it('turns the chessboard and the grid on and off', () => {
    const view = new ImageView({ chessboard: true });
    expect([view.chessboard, view.grid]).toEqual([true, false]);
    view.toggleChessboard();
    view.toggleGrid();
    expect([view.chessboard, view.grid]).toEqual([false, true]);
  });
});

describe('the image viewer', () => {
  it('shows the image fitted to its area, centred, its pixels as squares when enlarged', async () => {
    const view = new ImageView();
    const element = show(view, pngOf(4, 2));
    await expect.poll(() => view.loaded).toBe(true);
    expect(view.zoom).toBe(48);
    expect([img().width, img().height]).toEqual([192, 96]);
    expect(img().classList.contains('cerebro-image__img--pixels')).toBe(true);
    // Centred, 2px in.
    const box = element.getBoundingClientRect();
    const drawn = img().getBoundingClientRect();
    expect(drawn.left - box.left).toBe((400 - 192) / 2);
    view.actualSize();
    expect(img().width).toBe(4);
    expect(img().classList.contains('cerebro-image__img--pixels')).toBe(false);
  });

  it('fits it again as its area is resized', async () => {
    const view = new ImageView();
    show(view, pngOf(800, 400));
    await expect.poll(() => view.loaded).toBe(true);
    expect(view.zoom).toBeCloseTo(396 / 800);
    (host as HTMLElement).style.width = '204px';
    await expect.poll(() => view.zoom).toBeCloseTo(0.25);
  });

  it('draws the chessboard under it and the grid between its pixels, from a zoom of 3', async () => {
    const view = new ImageView({ chessboard: true, grid: true });
    show(view, pngOf(4, 2));
    await expect.poll(() => view.loaded).toBe(true);
    const canvas = host?.querySelector('.cerebro-image__canvas') as HTMLElement;
    expect(canvas.classList.contains('cerebro-image__canvas--chessboard')).toBe(true);
    const grid = host?.querySelector<HTMLElement>('.cerebro-image__grid');
    // 48px pixels: lines from the second to the last.
    expect(grid?.style.left).toBe('50px');
    expect(grid?.style.width).toBe('144px');
    expect(grid?.style.height).toBe('48px');
    expect(grid?.style.backgroundSize).toBe('48px 48px');
    view.zoom = GRID_FROM - 1;
    expect(host?.querySelector('.cerebro-image__grid')).toBeNull();
    view.toggleChessboard();
    expect(canvas.classList.contains('cerebro-image__canvas--chessboard')).toBe(false);
  });

  it('zooms about the pointer with Ctrl and the wheel; without Ctrl it scrolls', async () => {
    const view = new ImageView();
    const element = show(view, pngOf(300, 300));
    await expect.poll(() => view.loaded).toBe(true);
    view.actualSize();
    const box = element.getBoundingClientRect();
    const wheel = (deltaY: number, ctrlKey: boolean) => {
      const event = new WheelEvent('wheel', {
        deltaY,
        ctrlKey,
        clientX: box.left + 100,
        clientY: box.top + 50,
        cancelable: true,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(wheel(-100, false)).toBe(false);
    expect(view.zoom).toBe(1);
    expect(wheel(-100, true)).toBe(true);
    expect(view.zoom).toBe(2);
    // The point under the pointer stays: (0 + 100) * 2 - 100.
    expect(element.scrollLeft).toBe(100);
    expect(element.scrollTop).toBe(50);
    wheel(100, true);
    expect(view.zoom).toBe(1);
    expect(wheel(0, true)).toBe(false);
  });

  it('doesn’t zoom with the wheel before the image has loaded', () => {
    const view = new ImageView();
    const element = show(view, 'data:image/png;base64,');
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true }));
    expect(view.zoomChanged).toBe(false);
  });

  it('says so when the image can’t be read', async () => {
    const view = new ImageView();
    show(view, 'data:image/png;base64,AAAA');
    await expect
      .poll(() => host?.querySelector('.cerebro-image__error')?.textContent)
      .toBe('Image not loaded');
  });
});
