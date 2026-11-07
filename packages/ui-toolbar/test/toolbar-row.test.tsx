import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolbarRow } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** A row of buttons, at least 30px each, in a box `width` wide; a second "open" one says it's expanded. */
function mount(width: number, expanded = signal(false)) {
  const box = document.createElement('div');
  box.style.position = 'fixed';
  box.style.left = '10px';
  box.style.top = '10px';
  box.style.display = 'flex';
  box.style.width = `${String(width)}px`;
  document.body.append(box);
  const text = signal('a');
  const handle = render(
    () => (
      <ToolbarRow
        label="Actions"
        items={() =>
          ['a', 'b', 'c', 'd'].map((name) => (
            <button
              type="button"
              class="item"
              aria-expanded={() => String(name === 'b' && expanded.get())}
              ref={(b) => {
                b.style.minWidth = '30px';
                b.style.padding = '0';
                b.style.boxSizing = 'border-box';
                b.style.flex = 'none';
              }}
            >
              {() => (name === 'a' ? text.get() : name)}
            </button>
          ))
        }
      />
    ),
    box,
  );
  cleanup = () => {
    handle.dispose();
    box.remove();
  };
  return { box, text };
}

const frames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const row = () => document.querySelector('.cerebro-toolbar-row__items') as HTMLElement;
const shown = () =>
  [...row().children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent);
const more = () => document.querySelector('.cerebro-toolbar-row__more') as HTMLElement;
const popup = () => document.querySelector('.cerebro-toolbar-row__popup');

describe('a toolbar row', () => {
  it('shows every item while they fit, with no »', async () => {
    mount(200);
    await frames();
    expect(shown()).toEqual(['a', 'b', 'c', 'd']);
    expect(more().hidden).toBe(true);
  });

  it('hides the items that don’t fit, from the last, the » after the rest', async () => {
    // Four 30px items in 100: the » takes 20, so two fit.
    const { box } = mount(100);
    await frames();
    expect(shown()).toEqual(['a', 'b']);
    expect(more().hidden).toBe(false);
    expect(more().getBoundingClientRect().right).toBeLessThanOrEqual(110);
    box.style.width = '200px';
    await frames();
    expect(shown()).toEqual(['a', 'b', 'c', 'd']);
    expect(more().hidden).toBe(true);
  });

  it('fits again when an item’s text changes', async () => {
    const { text } = mount(130);
    await frames();
    expect(shown()).toEqual(['a', 'b', 'c', 'd']);
    // The first item now overflows its 30px: the row is wider than the box.
    text.set('a much longer text than fits');
    await frames();
    expect(more().hidden).toBe(false);
    expect(shown()).not.toContain('d');
  });

  it('shows the whole row over it when the » is pointed at, kept on the screen', async () => {
    mount(100);
    await frames();
    more().dispatchEvent(new PointerEvent('pointerenter'));
    expect([...(popup()?.querySelectorAll('.item') ?? [])].map((c) => c.textContent)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(popup()?.getAttribute('aria-label')).toBe('Actions');
    expect((popup() as HTMLElement).style.top).toBe('10px');
    expect((popup() as HTMLElement).style.left).toBe('10px');
    // Pointing at it again leaves the one there.
    more().click();
    expect(document.querySelectorAll('.cerebro-toolbar-row__popup')).toHaveLength(1);
  });

  it('closes the popup on Escape, on a click outside, and when the pointer leaves it', async () => {
    mount(100);
    await frames();
    more().click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    expect(popup()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(popup()).toBeNull();
    more().click();
    (popup() as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(popup()).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(popup()).toBeNull();
    more().click();
    (popup() as HTMLElement).dispatchEvent(new PointerEvent('pointerleave'));
    expect(popup()).toBeNull();
  });

  it('keeps the popup while a dropdown in it is open', async () => {
    const expanded = signal(false);
    mount(100, expanded);
    await frames();
    more().click();
    expanded.set(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (popup() as HTMLElement).dispatchEvent(new PointerEvent('pointerleave'));
    expect(popup()).not.toBeNull();
    expanded.set(false);
    (popup() as HTMLElement).dispatchEvent(new PointerEvent('pointerleave'));
    expect(popup()).toBeNull();
  });

  it('keeps the popup on the screen, and closes it with the row', async () => {
    const { box } = mount(100);
    box.style.left = `${String(window.innerWidth - 100)}px`;
    await frames();
    more().click();
    const placed = (popup() as HTMLElement).getBoundingClientRect();
    expect(placed.right).toBeLessThanOrEqual(window.innerWidth);
    cleanup?.();
    cleanup = undefined;
    expect(popup()).toBeNull();
  });
});
