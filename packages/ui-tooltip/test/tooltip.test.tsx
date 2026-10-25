import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachTooltip, QUICK_WINDOW, SHOW_DELAY, tooltip } from '../src/index.js';

const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function control(css = 'left: 100px; top: 100px;') {
  const element = document.createElement('button');
  element.style.cssText = `position: fixed; width: 30px; height: 30px; ${css}`;
  document.body.append(element);
  cleanups.push(() => {
    element.remove();
  });
  return element;
}

function attach(element: Element, options: Parameters<typeof attachTooltip>[1]) {
  const handle = attachTooltip(element, options);
  cleanups.push(() => {
    handle.dispose();
  });
  return handle;
}

const tip = () => document.querySelector<HTMLElement>('.cerebro-tooltip');
const enter = (element: Element) => element.dispatchEvent(new PointerEvent('pointerenter'));
const leave = (element: Element) => element.dispatchEvent(new PointerEvent('pointerleave'));

describe('showing and hiding', () => {
  it('shows after a pause, with the shortcut, and hides on leaving', () => {
    const element = control();
    attach(element, { text: () => 'Services', shortcut: () => 'Alt+8' });
    enter(element);
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()?.getAttribute('role')).toBe('tooltip');
    expect(tip()?.querySelector('.cerebro-tooltip__text')?.textContent).toBe('Services');
    expect(tip()?.querySelector('.cerebro-tooltip__shortcut')?.textContent).toBe('Alt+8');
    leave(element);
    expect(tip()).toBeNull();
  });

  it('shows no shortcut part without one', () => {
    const element = control();
    attach(element, { text: () => 'Terminal', shortcut: () => undefined });
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()?.querySelector('.cerebro-tooltip__shortcut')).toBeNull();
  });

  it('shows nothing for empty text', () => {
    const element = control();
    attach(element, { text: () => '' });
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()).toBeNull();
  });

  it('cancels when the pointer leaves before the pause ends', () => {
    const element = control();
    attach(element, { text: () => 'A' });
    enter(element);
    leave(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()).toBeNull();
  });

  it('shows the next control’s at once while one shows, or right after', () => {
    const a = control('left: 100px; top: 100px;');
    const b = control('left: 100px; top: 140px;');
    attach(a, { text: () => 'A' });
    attach(b, { text: () => 'B' });
    enter(a);
    vi.advanceTimersByTime(SHOW_DELAY);
    enter(b);
    expect(tip()?.textContent).toBe('B');
    leave(a);
    expect(tip()?.textContent).toBe('B');
    leave(b);
    enter(a);
    expect(tip()?.textContent).toBe('A');
    leave(a);
    vi.advanceTimersByTime(QUICK_WINDOW + 1);
    enter(b);
    expect(tip()).toBeNull();
  });

  it('hides on a press, a key, scrolling or blur', () => {
    const element = control();
    attach(element, { text: () => 'A' });
    for (const hide of [
      () => element.dispatchEvent(new PointerEvent('pointerdown')),
      () => window.dispatchEvent(new KeyboardEvent('keydown')),
      () => window.dispatchEvent(new Event('scroll')),
      () => window.dispatchEvent(new Event('blur')),
    ]) {
      vi.advanceTimersByTime(QUICK_WINDOW + 1);
      enter(element);
      vi.advanceTimersByTime(SHOW_DELAY);
      expect(tip()).not.toBeNull();
      hide();
      expect(tip()).toBeNull();
    }
  });

  it('stops on dispose, hiding its tooltip', () => {
    const element = control();
    const handle = attach(element, { text: () => 'A' });
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    handle.dispose();
    expect(tip()).toBeNull();
    vi.advanceTimersByTime(QUICK_WINDOW + 1);
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()).toBeNull();
    const other = control('left: 300px; top: 300px;');
    const second = attach(other, { text: () => 'B' });
    enter(other);
    vi.advanceTimersByTime(SHOW_DELAY);
    attach(element, { text: () => 'A' }).dispose();
    expect(tip()?.textContent).toBe('B');
    second.dispose();
  });
});

describe('placement', () => {
  const rect = () => (tip() as HTMLElement).getBoundingClientRect();
  function shown(css: string, placement?: 'right' | 'left' | 'below' | 'above' | (() => 'left')) {
    const element = control(css);
    attach(element, { text: () => 'Tooltip', ...(placement ? { placement } : {}) });
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    return element.getBoundingClientRect();
  }

  it('goes below by default, centred', () => {
    const element = shown('left: 200px; top: 200px;');
    expect(rect().top).toBe(element.bottom + 6);
    expect(rect().left + rect().width / 2).toBeCloseTo(element.left + element.width / 2, 0);
  });

  it('goes beside, vertically centred, and reads a placement function', () => {
    const right = shown('left: 200px; top: 200px;', 'right');
    expect(rect().left).toBe(right.right + 6);
    expect(rect().top + rect().height / 2).toBeCloseTo(right.top + right.height / 2, 0);
    cleanups.pop()?.();
    cleanups.pop()?.();
    const left = shown('left: 400px; top: 200px;', () => 'left');
    expect(rect().right).toBe(left.left - 6);
  });

  it('flips to the other side without room, and stays in the window', () => {
    const above = shown(`left: 200px; top: ${String(window.innerHeight - 30)}px;`);
    expect(rect().bottom).toBe(above.top - 6);
    cleanups.pop()?.();
    cleanups.pop()?.();
    shown('left: 200px; top: 2px;', 'above');
    expect(rect().top).toBeGreaterThan(30);
    cleanups.pop()?.();
    cleanups.pop()?.();
    const edge = shown(`left: ${String(window.innerWidth - 30)}px; top: 200px;`, 'right');
    expect(rect().right).toBe(edge.left - 6);
    cleanups.pop()?.();
    cleanups.pop()?.();
    shown('left: 0px; top: 200px;', 'left');
    expect(rect().left).toBe(36);
    cleanups.pop()?.();
    cleanups.pop()?.();
    shown('left: -20px; top: 200px;');
    expect(rect().left).toBe(0);
  });

  it('keeps the side asked for when neither fits', () => {
    const element = control(`left: 200px; top: 0px; height: ${String(window.innerHeight)}px;`);
    attach(element, { text: () => 'Tall', placement: 'above' });
    enter(element);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(rect().top).toBe(0);
  });
});

describe('in JSX', () => {
  it('attaches through ref, for as long as the component lives', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => (
        <button
          ref={tooltip({ text: () => 'Hide' })}
          style="position: fixed; left: 50px; top: 50px;"
        >
          x
        </button>
      ),
      container,
    );
    const button = container.querySelector('button') as HTMLElement;
    enter(button);
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(tip()?.textContent).toBe('Hide');
    handle.dispose();
    expect(tip()).toBeNull();
    container.remove();
  });
});
