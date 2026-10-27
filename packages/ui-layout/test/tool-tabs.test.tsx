import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-popup/styles.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ToolTabs, type ToolTabsProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.querySelector('.cerebro-popup')?.remove();
});

/** Sessions as a tool window keeps them: numbered, one active. */
class Sessions {
  numbers = [1, 2];
  active = 1;

  constructor() {
    makeObservable(this);
  }
}

/** A header `width` pixels wide holding the tabs of `sessions`, with a + button unless `add` is false. */
function mount(
  sessions: Sessions,
  options: { width?: number; add?: boolean; close?: boolean } = {},
) {
  const added = vi.fn(() => {
    sessions.numbers = [...sessions.numbers, sessions.numbers.length + 1];
  });
  const props: ToolTabsProps = {
    tabs: () =>
      sessions.numbers.map((number) => ({
        id: String(number),
        title: `Local (${String(number)})`,
        active: sessions.active === number,
        select: () => {
          sessions.active = number;
        },
        ...(options.close === false
          ? {}
          : {
              close: () => {
                sessions.numbers = sessions.numbers.filter((n) => n !== number);
              },
            }),
        ...(number === 1 ? { icon: () => <i class="test-icon" /> } : {}),
      })),
    ...(options.add === false ? {} : { add: { label: 'New Tab', run: added } }),
  };
  const container = document.createElement('div');
  container.className = 'cerebro-tool-window__header';
  container.style.position = 'fixed';
  container.style.inset = '0 auto auto 0';
  container.style.width = `${String(options.width ?? 600)}px`;
  document.body.append(container);
  const handle = render(() => <ToolTabs {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const tab = (number: number) =>
    container.querySelector(`[data-tab="${String(number)}"]`) as HTMLElement;
  const titles = () =>
    [...container.querySelectorAll('.cerebro-tool-tab__title')].map((t) => t.textContent);
  return { container, tab, titles, added };
}

it('shows each tab, the active one marked; a click shows another', async () => {
  const sessions = new Sessions();
  const { tab, titles, container } = mount(sessions);
  expect(titles()).toEqual(['Local (1)', 'Local (2)']);
  expect(tab(1).getAttribute('aria-selected')).toBe('true');
  expect(tab(1).classList.contains('cerebro-tool-tab--active')).toBe(true);
  expect(tab(2).getAttribute('aria-selected')).toBe('false');
  expect(container.querySelectorAll('.cerebro-tool-tab .test-icon')).toHaveLength(1);
  await userEvent.click(tab(2));
  expect(sessions.active).toBe(2);
  expect(tab(2).classList.contains('cerebro-tool-tab--active')).toBe(true);
});

it('opens another tab with +', async () => {
  const sessions = new Sessions();
  const { container, titles, added } = mount(sessions);
  await userEvent.click(container.querySelector('[aria-label="New Tab"]') as HTMLElement);
  expect(added).toHaveBeenCalledOnce();
  expect(titles()).toEqual(['Local (1)', 'Local (2)', 'Local (3)']);
});

it('closes a tab with its button, without showing it, or with the middle button', async () => {
  const sessions = new Sessions();
  const { tab, titles } = mount(sessions);
  await userEvent.click(tab(2).querySelector('.cerebro-tool-tab__close') as HTMLElement);
  expect(titles()).toEqual(['Local (1)']);
  expect(sessions.active).toBe(1);
  sessions.numbers = [1, 2];
  // Other buttons leave it.
  tab(2).dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
  expect(titles()).toEqual(['Local (1)', 'Local (2)']);
  tab(2).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
  expect(titles()).toEqual(['Local (1)']);
});

it('shows no + or close buttons when not given', () => {
  const sessions = new Sessions();
  const { container, tab } = mount(sessions, { add: false, close: false });
  expect(container.querySelector('.cerebro-tool-tabs__add')).toBeNull();
  expect(container.querySelector('.cerebro-tool-tab__close')).toBeNull();
  // The middle button does nothing then.
  tab(2).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
  expect(sessions.numbers).toEqual([1, 2]);
});

it('names the buttons in tooltips', () => {
  vi.useFakeTimers();
  const { container, tab } = mount(new Sessions());
  const hover = (element: HTMLElement) => {
    element.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHOW_DELAY);
    const text = document.querySelector('.cerebro-tooltip')?.textContent;
    element.dispatchEvent(new PointerEvent('pointerleave'));
    return text;
  };
  expect(hover(container.querySelector('.cerebro-tool-tabs__add') as HTMLElement)).toBe('New Tab');
  expect(hover(tab(1).querySelector('.cerebro-tool-tab__close') as HTMLElement)).toBe('Close');
  vi.useRealTimers();
});

it('scrolls tabs that don’t fit, and lists them from the chevron', async () => {
  const sessions = new Sessions();
  sessions.numbers = Array.from({ length: 10 }, (_, i) => i + 1);
  sessions.active = 10;
  const { container, tab } = mount(sessions, { width: 300 });
  const strip = container.querySelector('.cerebro-tool-tabs__strip') as HTMLElement;
  const more = container.querySelector('.cerebro-tabs-more') as HTMLElement;
  await vi.waitFor(() => {
    expect(more.hidden).toBe(false);
  });
  expect(strip.classList.contains('cerebro-tool-tabs__strip--cut-start')).toBe(true);
  const box = tab(10).getBoundingClientRect();
  const view = strip.getBoundingClientRect();
  expect(box.left >= view.left && box.right <= view.right).toBe(true);
  await userEvent.click(more);
  await userEvent.keyboard('(3)');
  await userEvent.keyboard('{Enter}');
  expect(sessions.active).toBe(3);
});
