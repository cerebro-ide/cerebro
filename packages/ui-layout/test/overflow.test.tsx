import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-popup/styles.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { EditorArea } from '@cerebro-ide/layout';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EditorAreaView, MoreTabs, TabOverflow } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  document.querySelector('.cerebro-popup')?.remove();
});

/** An editor area `width` pixels wide, with tabs of these names, the last one active. */
function mount(names: string[], width = 320, icons = true) {
  const area = new EditorArea();
  for (const id of names) area.open({ id, title: `${id}.ts` });
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.inset = '0 auto 0 0';
  container.style.width = `${String(width)}px`;
  document.body.append(container);
  const handle = render(
    () => (
      <EditorAreaView
        area={area}
        content={() => null}
        {...(icons ? { icon: (tab) => <i class="test-icon" data-for={tab.id} /> } : {})}
      />
    ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const strip = container.querySelector('.cerebro-editor-tabs') as HTMLElement;
  const more = container.querySelector('.cerebro-tabs-more') as HTMLButtonElement;
  const tabEl = (id: string) => container.querySelector(`[data-tab="${id}"]`) as HTMLElement;
  /** Whether a tab shows whole within the strip. */
  const inView = (id: string) => {
    const box = tabEl(id).getBoundingClientRect();
    const view = strip.getBoundingClientRect();
    return box.left >= view.left && box.right <= view.right;
  };
  return { area, container, strip, more, tabEl, inView };
}

const LONG = Array.from({ length: 12 }, (_, i) => `file-number-${String(i)}`);
const listed = () =>
  [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);

it('shows no chevron and no fade while every tab fits', async () => {
  const { strip, more, container } = mount(['a', 'b']);
  await new Promise(requestAnimationFrame);
  expect(more.hidden).toBe(true);
  expect(strip.className).not.toMatch(/cut/);
  // Each tab has its icon.
  expect(container.querySelectorAll('.cerebro-editor-tab .test-icon')).toHaveLength(2);
});

it('keeps tabs whole and the active one in view, fading the cut edges', async () => {
  const { area, strip, more, tabEl, inView } = mount(LONG);
  const last = LONG.at(-1) as string;
  await vi.waitFor(() => {
    expect(inView(last)).toBe(true);
  });
  // Not squeezed: a tab is as wide as its title needs.
  expect(tabEl(LONG[0] as string).scrollWidth).toBe(tabEl(LONG[0] as string).clientWidth);
  expect(more.hidden).toBe(false);
  expect(strip.classList.contains('cerebro-editor-tabs--cut-start')).toBe(true);
  expect(strip.classList.contains('cerebro-editor-tabs--cut-end')).toBe(false);
  // Another tab activated: scrolled to.
  area.activate(area.groups[0]?.id as string, LONG[0] as string);
  await vi.waitFor(() => {
    expect(inView(LONG[0] as string)).toBe(true);
  });
  expect(strip.classList.contains('cerebro-editor-tabs--cut-start')).toBe(false);
  expect(strip.classList.contains('cerebro-editor-tabs--cut-end')).toBe(true);
});

it('scrolls the tabs with the mouse wheel, either way, when they overflow', async () => {
  const { strip } = mount(LONG);
  await vi.waitFor(() => {
    expect(strip.scrollLeft).toBeGreaterThan(0);
  });
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    strip.dispatchEvent(event);
    return event;
  };
  const before = strip.scrollLeft;
  expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(true);
  expect(strip.scrollLeft).toBe(before - 100);
  wheel({ deltaX: 40 });
  expect(strip.scrollLeft).toBe(before - 60);
  // Nothing to scroll by: left to the page.
  expect(wheel({ deltaX: 0, deltaY: 0 }).defaultPrevented).toBe(false);
  cleanup?.();
  const { strip: short } = mount(['a']);
  const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  short.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('lists every tab from the chevron, the active one highlighted, and goes to the one chosen', async () => {
  const { area, more, inView } = mount(LONG);
  await vi.waitFor(() => {
    expect(more.hidden).toBe(false);
  });
  await userEvent.click(more);
  expect(listed()).toEqual(LONG.map((id) => `${id}.ts`));
  expect(
    document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
      ?.textContent,
  ).toBe(`${LONG.at(-1) as string}.ts`);
  expect(document.querySelectorAll('.cerebro-popup .test-icon')).toHaveLength(LONG.length);
  // A second press closes it.
  await userEvent.click(more);
  expect(document.querySelector('.cerebro-popup')).toBeNull();
  await userEvent.click(more);
  await userEvent.keyboard('number-3');
  await userEvent.keyboard('{Enter}');
  expect(area.groups[0]?.active).toBe('file-number-3');
  await vi.waitFor(() => {
    expect(inView('file-number-3')).toBe(true);
  });
});

it('closes a tab from the list, which stays open', async () => {
  const { area, more } = mount(LONG);
  await vi.waitFor(() => {
    expect(more.hidden).toBe(false);
  });
  await userEvent.click(more);
  // The list's, not the tab's own.
  const close = document.querySelector(
    '.cerebro-popup [aria-label="Close file-number-0.ts"]',
  ) as HTMLElement;
  // Shown on the item hovered.
  await userEvent.hover(close.parentElement as HTMLElement);
  await userEvent.click(close);
  expect(area.groups[0]?.tabs.map((t) => t.id)).not.toContain('file-number-0');
  expect(listed()).not.toContain('file-number-0.ts');
  expect(document.querySelector('.cerebro-popup')).not.toBeNull();
});

it('lists tabs without icons when the editor is given none', async () => {
  const { more } = mount(LONG, 320, false);
  await vi.waitFor(() => {
    expect(more.hidden).toBe(false);
  });
  await userEvent.click(more);
  expect(listed()).toHaveLength(LONG.length);
  expect(
    document.querySelectorAll('.cerebro-popup .cerebro-popup-item__icon svg, .test-icon'),
  ).toHaveLength(0);
});

it('serves any strip: tabs without icons or close buttons, none active; Escape chooses none', async () => {
  const overflow = new TabOverflow();
  overflow.end = true;
  const select = vi.fn();
  const tabs = ['one', 'two'].map((id) => ({ id, title: id, active: false, select }));
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(() => <MoreTabs overflow={overflow} tabs={() => tabs} />, container);
  const button = container.querySelector('.cerebro-tabs-more') as HTMLButtonElement;
  vi.useFakeTimers();
  button.dispatchEvent(new PointerEvent('pointerenter'));
  vi.advanceTimersByTime(SHOW_DELAY);
  expect(document.querySelector('.cerebro-tooltip')?.textContent).toBe('Show Hidden Tabs');
  button.dispatchEvent(new PointerEvent('pointerleave'));
  vi.useRealTimers();
  await userEvent.click(button);
  expect(listed()).toEqual(['one', 'two']);
  // None active: the first is highlighted.
  expect(
    document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
      ?.textContent,
  ).toBe('one');
  expect(document.querySelector('.cerebro-popup .cerebro-popup-item__close')).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('.cerebro-popup')).toBeNull();
  expect(select).not.toHaveBeenCalled();
  handle.dispose();
  container.remove();
});
