import { afterEach, describe, expect, it, vi } from 'vitest';
import { installAppScrollbars } from '../src/scrollbars.js';

const jumpToSpot = vi.fn(() => Promise.resolve(true));
const removes: (() => void)[] = [];

afterEach(() => {
  for (const remove of removes.splice(0)) remove();
  delete window.cerebro;
  jumpToSpot.mockClear();
});

/** A page with a scrolling area and its vertical track under the pointer. */
async function track(): Promise<{ scroller: HTMLElement; rail: HTMLElement }> {
  const scroller = document.createElement('div');
  scroller.style.cssText = 'position:fixed;left:0;top:0;width:100px;height:100px;overflow:auto';
  const content = document.createElement('div');
  content.style.height = '400px';
  scroller.append(content);
  document.body.append(scroller);
  removes.push(() => {
    scroller.remove();
  });
  scroller.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await vi.waitFor(() => {
    expect(document.querySelector('.cerebro-scrollbar-track--y')).not.toBeNull();
  });
  return { scroller, rail: document.querySelector('.cerebro-scrollbar-track--y') as HTMLElement };
}

const press = (rail: HTMLElement) =>
  rail.dispatchEvent(
    new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 95, clientY: 80 }),
  );

describe('the app’s scrollbars', () => {
  it('on macOS, jump to a press on a track as the system says, read again on focus', async () => {
    window.cerebro = { scrollbars: { jumpToSpot } } as never;
    removes.push(installAppScrollbars(true));
    expect(jumpToSpot).toHaveBeenCalledTimes(1);
    const { scroller, rail } = await track();
    await vi.waitFor(() => {
      scroller.scrollTop = 0;
      press(rail);
      expect(scroller.scrollTop).toBeGreaterThan(100);
    });
    jumpToSpot.mockReturnValue(Promise.resolve(false));
    window.dispatchEvent(new Event('focus'));
    expect(jumpToSpot).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      scroller.scrollTop = 0;
      press(rail);
      // A page: what it shows.
      expect(scroller.scrollTop).toBe(100);
    });
  });

  it('elsewhere, and outside the app, page without asking', async () => {
    window.cerebro = { scrollbars: { jumpToSpot } } as never;
    removes.push(installAppScrollbars(false));
    delete window.cerebro;
    removes.push(installAppScrollbars(true));
    expect(jumpToSpot).not.toHaveBeenCalled();
    const { scroller, rail } = await track();
    press(rail);
    expect(scroller.scrollTop).toBe(100);
  });
});
