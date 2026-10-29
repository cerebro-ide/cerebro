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
const track = (axis: 'x' | 'y') =>
  document.querySelector<HTMLElement>(`.cerebro-scrollbar-track--${axis}`);
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

  it('draws an area’s thumbs at its own level: under a popup over it, over the popup’s own', async () => {
    install();
    const under = area(100, 400);
    under.scrollTop = 10;
    await expect.poll(() => shown('y')).toBe(true);
    // A popup opened over the area, as a search popup over the editor.
    const popup = document.createElement('div');
    Object.assign(popup.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '950',
      background: 'white',
    });
    document.body.append(popup);
    cleanup.push(() => {
      popup.remove();
    });
    const centre = (element: HTMLElement) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return document.elementFromPoint(left + width / 2, top + height / 2);
    };
    expect(centre(thumb('y') as HTMLElement)).toBe(popup);
    // The popup's own list shows its thumb over the popup.
    const list = area(100, 400, 'auto', popup);
    list.scrollTop = 10;
    const own = () =>
      [...document.querySelectorAll<HTMLElement>('.cerebro-scrollbar--y')].find(
        (t) => t !== thumb('y'),
      );
    await expect.poll(() => own()?.classList.contains('cerebro-scrollbar--shown')).toBe(true);
    expect(centre(own() as HTMLElement)).toBe(own());
  });

  it('keeps an area’s thumbs under a popup opened since, when another area gets thumbs', async () => {
    install();
    /** A popup over the page, at the popups' level, as Search Everywhere. */
    const popup = () => {
      const element = document.createElement('div');
      Object.assign(element.style, { position: 'fixed', inset: '0', zIndex: '950' });
      document.body.append(element);
      cleanup.push(() => {
        element.remove();
      });
      return element;
    };
    const first = area(100, 400, 'auto', popup());
    first.scrollTop = 10;
    await expect.poll(() => shown('y')).toBe(true);
    const below = thumb('y') as HTMLElement;
    // A second popup over the first, whose list then scrolls: its thumbs come after the popup.
    const over = popup();
    over.style.background = 'white';
    const second = area(100, 400, 'auto', over);
    second.style.left = '400px';
    second.scrollTop = 10;
    await expect.poll(() => document.querySelectorAll('.cerebro-scrollbar--y').length).toBe(2);
    // The first popup's thumb is under the second popup.
    const { left, top, width, height } = below.getBoundingClientRect();
    expect(document.elementFromPoint(left + width / 2, top + height / 2)).toBe(over);
  });

  it('brightens a thumb under the pointer and back off it, over 125ms, without a pause', async () => {
    install();
    const scroller = area(100, 400);
    await userEvent.hover(scroller);
    const bar = thumb('y') as HTMLElement;
    expect(getComputedStyle(bar).transitionDuration).toBe('0.2s, 0.125s');
    expect(getComputedStyle(bar).transitionDelay).toBe('0s, 0s');
    const colour = () => getComputedStyle(bar).backgroundColor;
    const resting = colour();
    await userEvent.hover(bar);
    await expect.poll(colour, { timeout: 1_000 }).toBe('rgba(128, 128, 128, 0.55)');
    expect(getComputedStyle(bar).transitionDelay).toBe('0s, 0s');
    await userEvent.hover(scroller, { position: { x: 20, y: 20 } });
    await expect.poll(colour, { timeout: 1_000 }).toBe(resting);
  });

  it('keeps a bar’s track unseen, the arrow over it, and pages towards a press on it', async () => {
    install();
    // Over text, as in an editor: the arrow over the bar shows it's there.
    document.body.style.cursor = 'text';
    cleanup.push(() => {
      document.body.style.cursor = '';
    });
    const scroller = area(100, 400);
    await userEvent.hover(scroller);
    const rail = track('y') as HTMLElement;
    // Along the whole track, under the thumb.
    expect(box(rail)).toEqual({ left: 288, top: 100, width: 10, height: 100 });
    const unseen = () => getComputedStyle(rail).backgroundColor === 'rgba(0, 0, 0, 0)';
    await userEvent.hover(rail, { position: { x: 5, y: 80 } });
    expect(unseen()).toBe(true);
    expect(getComputedStyle(rail).cursor).toBe('default');
    await userEvent.hover(thumb('y') as HTMLElement);
    expect(unseen()).toBe(true);
    expect(getComputedStyle(thumb('y') as HTMLElement).cursor).toBe('default');
    // Below the thumb: a page on, what the area shows.
    await userEvent.click(rail, { position: { x: 5, y: 80 }, modifiers: [] });
    expect(unseen()).toBe(true);
    expect(scroller.scrollTop).toBe(100);
    // Above it, a page back.
    await expect.poll(() => box(thumb('y')).top).toBe(125);
    await userEvent.click(rail, { position: { x: 5, y: 10 }, modifiers: [] });
    expect(scroller.scrollTop).toBe(0);
  });

  it('pages across too', async () => {
    install();
    const scroller = area(800, 100);
    await userEvent.hover(scroller);
    const rail = track('x') as HTMLElement;
    await userEvent.click(rail, { position: { x: 150, y: 5 }, modifiers: [] });
    expect(scroller.scrollLeft).toBe(200);
    await expect.poll(() => box(thumb('x')).left).toBe(150);
    await userEvent.click(rail, { position: { x: 20, y: 5 }, modifiers: [] });
    expect(scroller.scrollLeft).toBe(0);
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

  it('shows no thumbs over an area marked as wanting none, hovered or scrolled', async () => {
    install();
    const scroller = area(800, 100, 'auto hidden');
    scroller.dataset['scrollbar'] = 'none';
    await userEvent.hover(scroller);
    scroller.scrollLeft = 200;
    await wait(50);
    expect(thumb('x')).toBeNull();
    expect(scroller.scrollLeft).toBe(200);
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
    // 186px of track (the vertical bar's corner kept clear), a 46.5px thumb: 139.5px for 600px.
    expect(scroller.scrollLeft).toBeCloseTo((20 * 600) / 139.5, 0);
  });

  it('keeps the corner clear: neither bar reaches the other', async () => {
    install();
    const scroller = area(800, 400);
    await userEvent.hover(scroller);
    scroller.scrollTop = 300;
    scroller.scrollLeft = 600;
    // Each track stops 14px short of the far edge: 12px for the other bar, 2px between them. (The
    // vertical thumb is its shortest, 24px.)
    await expect
      .poll(() => box(thumb('y')))
      .toEqual({ left: 288, top: 100 + 86 - 24, width: 10, height: 24 });
    expect(box(thumb('x'))).toEqual({ left: 100 + 186 - 46.5, top: 188, width: 46.5, height: 10 });
  });

  it('starts or stops a bar’s track short of what’s marked as in its way', async () => {
    install();
    const scroller = area(800, 400);
    /** An obstacle at a place in the area, staying there as it scrolls, as an editor's gutter. */
    const obstacle = (left: number, top: number, width: number, height: number) => {
      const element = document.createElement('div');
      element.dataset['scrollbarObstacle'] = '';
      Object.assign(element.style, {
        position: 'fixed',
        left: `${String(100 + left)}px`,
        top: `${String(100 + top)}px`,
        width: `${String(width)}px`,
        height: `${String(height)}px`,
      });
      scroller.append(element);
      return element;
    };
    // A gutter down the left: the horizontal bar starts after it.
    obstacle(0, 0, 40, 400);
    // A toolbar over the top right: the vertical bar starts below it.
    obstacle(150, 0, 50, 20);
    // Nearer the end of the vertical track: it stops before it.
    obstacle(190, 70, 10, 5);
    // Not across either bar: nothing.
    obstacle(60, 30, 20, 20);
    await userEvent.hover(scroller);
    // Vertical: from 20 to 70 (not 86), 50px, scrolled to the end: the thumb's end at 70.
    scroller.scrollTop = 300;
    await expect
      .poll(() => box(thumb('y')))
      .toEqual({ left: 288, top: 100 + 70 - 24, width: 10, height: 24 });
    // Across: from 40 to 186, 146px.
    expect(box(thumb('x'))).toEqual({ left: 140, top: 188, width: 36.5, height: 10 });
    // Dragged along the shorter track: 26px of it left for 300px.
    const y = thumb('y') as HTMLElement;
    y.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 295, clientY: 160 }));
    y.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 295, clientY: 147 }));
    expect(scroller.scrollTop).toBeCloseTo(150, 0);
    y.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
    // A bar whose whole track is in the way shows nothing.
    obstacle(190, 0, 10, 100);
    scroller.scrollTop = 10;
    await expect.poll(() => thumb('y')?.hidden).toBe(true);
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
