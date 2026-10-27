import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FADE, installScrollbars } from '../src/index.js';

const HIDE = 100;
let cleanup: (() => void)[] = [];

afterEach(async () => {
  for (const clean of cleanup) clean();
  cleanup = [];
  await userEvent.unhover(document.body);
  await userEvent.cleanup();
});

/** A 200×100 area at (100, 100) with content `width`×`height`, scrolling as `overflow` says. */
function area(width: number, height: number, overflow = 'auto', parent: Node = document.body) {
  const scroller = document.createElement('div');
  Object.assign(scroller.style, {
    position: 'fixed',
    left: '100px',
    top: '100px',
    width: '200px',
    height: '100px',
    overflow,
  });
  const content = document.createElement('div');
  Object.assign(content.style, { width: `${String(width)}px`, height: `${String(height)}px` });
  scroller.append(content);
  parent.appendChild(scroller);
  cleanup.push(() => {
    scroller.remove();
  });
  return scroller;
}

function install(): void {
  cleanup.push(installScrollbars(HIDE));
}

const thumb = (axis: 'x' | 'y') =>
  document.querySelector<HTMLElement>(`.cerebro-scrollbar--${axis}`);
const shown = (axis: 'x' | 'y') =>
  thumb(axis)?.classList.contains('cerebro-scrollbar--shown') ?? false;
const box = (element: HTMLElement | null) => {
  const { left, top, width, height } = (element as HTMLElement).getBoundingClientRect();
  return { left, top, width, height };
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('installScrollbars', () => {
  it('takes no room, and shows a thumb over the content while the area is hovered', async () => {
    install();
    const scroller = area(100, 400);
    // The browser's scrollbar is hidden.
    expect(scroller.offsetWidth - scroller.clientWidth).toBe(0);
    expect(thumb('y')).toBeNull();
    await userEvent.hover(scroller);
    expect(shown('y')).toBe(true);
    // A quarter shows: a quarter as long, 2px from the right edge, 10px wide.
    expect(box(thumb('y'))).toEqual({ left: 288, top: 100, width: 10, height: 25 });
    // All the content fits across: no thumb.
    expect(thumb('x')?.hidden).toBe(true);
    // Scrolled to the end: the thumb at the bottom.
    scroller.scrollTop = 300;
    await expect.poll(() => box(thumb('y')).top).toBe(175);
    // Under the pointer, the area stays hovered.
    await userEvent.hover(thumb('y') as HTMLElement);
    expect(shown('y')).toBe(true);
    // Left: it fades out, then it's gone.
    await userEvent.unhover(thumb('y') as HTMLElement);
    await userEvent.hover(document.body, { position: { x: 5, y: 5 } });
    expect(shown('y')).toBe(false);
    await wait(FADE + 50);
    expect(thumb('y')).toBeNull();
  });

  it('shows the thumbs of an area while it scrolls, and a while after', async () => {
    install();
    const scroller = area(800, 100, 'auto hidden');
    scroller.scrollLeft = 200;
    await expect.poll(() => shown('x')).toBe(true);
    // Across only: what's hidden down doesn't scroll.
    expect(thumb('y')?.hidden).toBe(true);
    expect(box(thumb('x'))).toEqual({ left: 150, top: 188, width: 50, height: 10 });
    scroller.scrollLeft = 300;
    await expect.poll(() => box(thumb('x')).left).toBe(175);
    await wait(HIDE + FADE + 50);
    expect(thumb('x')).toBeNull();
  });

  it('scrolls as a thumb is dragged', async () => {
    install();
    const scroller = area(100, 400);
    await userEvent.hover(scroller);
    const y = thumb('y') as HTMLElement;
    // 75px of track for 300px of scrolling.
    y.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 295, clientY: 110 }));
    expect(y.classList.contains('cerebro-scrollbar--dragging')).toBe(true);
    y.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 295, clientY: 130 }));
    expect(scroller.scrollTop).toBe(80);
    y.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    expect(y.classList.contains('cerebro-scrollbar--dragging')).toBe(false);
  });

  it('drags across too', async () => {
    install();
    const scroller = area(800, 400);
    await userEvent.hover(scroller);
    const x = thumb('x') as HTMLElement;
    x.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 110, clientY: 195 }));
    x.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 130, clientY: 195 }));
    expect(scroller.scrollLeft).toBe(80);
  });

  it('hides when the pointer leaves the window, and ignores what doesn’t scroll', async () => {
    install();
    const scroller = area(100, 400);
    const still = area(100, 400, 'hidden');
    still.style.left = '400px';
    const short = area(100, 50);
    short.style.left = '700px';
    // Down only: what's hidden across doesn't scroll.
    const down = area(800, 400, 'hidden auto');
    down.style.top = '300px';
    await userEvent.hover(down);
    expect(thumb('x')?.hidden).toBe(true);
    await userEvent.hover(scroller);
    document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }));
    expect(shown('y')).toBe(false);
    // An event from another element's way out isn't leaving the window.
    document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: scroller }));
    await userEvent.hover(still);
    await userEvent.hover(short);
    await wait(FADE + 50);
    expect(thumb('y')).toBeNull();
    // Nor does the page itself.
    document.body.dispatchEvent(new Event('scroll'));
    expect(thumb('y')).toBeNull();
  });

  it('works in a shadow root, once the pointer or the focus has been in it', async () => {
    install();
    const host = document.createElement('div');
    document.body.append(host);
    cleanup.push(() => {
      host.remove();
    });
    const root = host.attachShadow({ mode: 'open' });
    const scroller = area(100, 400, 'auto', root);
    const input = document.createElement('input');
    root.append(input);
    input.focus();
    // Again: once is enough.
    input.blur();
    input.focus();
    scroller.scrollTop = 100;
    await expect.poll(() => shown('y')).toBe(true);
    expect(box(thumb('y')).top).toBe(125);
  });

  it('removes everything when uninstalled, its thumbs included', async () => {
    const uninstall = installScrollbars(HIDE);
    const scroller = area(100, 400);
    const host = document.createElement('div');
    document.body.append(host);
    cleanup.push(() => {
      host.remove();
    });
    host.attachShadow({ mode: 'open' }).append(document.createElement('input'));
    (host.shadowRoot?.firstChild as HTMLElement).focus();
    await userEvent.hover(scroller);
    expect(thumb('y')).not.toBeNull();
    uninstall();
    expect(document.querySelector('.cerebro-scrollbars')).toBeNull();
    scroller.scrollTop = 100;
    await wait(50);
    expect(thumb('y')).toBeNull();
  });
});
