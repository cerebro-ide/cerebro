import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  fuzzyFilter,
  openPicker,
  type PickerHandle,
  type PickerItem,
  type PickerOptions,
} from '../src/index.js';

const open: PickerHandle<unknown>[] = [];

afterEach(() => {
  for (const popup of open.splice(0)) popup.close();
  document.body.replaceChildren();
});

const FILES: PickerItem[] = [
  { label: 'README.md' },
  { label: 'main.ts', detail: 'src', shortcut: 'Ctrl+1' },
  { label: 'shell.tsx', detail: 'src' },
];

function picker(options: Partial<PickerOptions<PickerItem>> = {}) {
  const handle = openPicker<PickerItem>({
    label: 'Files',
    items: (query) => fuzzyFilter(FILES, query),
    position: 'top',
    ...options,
  });
  open.push(handle);
  return handle;
}

const popup = () => document.querySelector('.cerebro-popup') as HTMLElement;
const search = () => document.querySelector('.cerebro-popup__search') as HTMLInputElement;
const labels = () =>
  [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);
const highlightedLabel = () =>
  document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
    ?.textContent;

function type(text: string) {
  search().value = text;
  search().dispatchEvent(new Event('input', { bubbles: true }));
}

function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  search().dispatchEvent(event);
  return event;
}

describe('openPicker', () => {
  it('opens at the top centre, its search field focused, the first item highlighted', () => {
    picker({ placeholder: 'Type a name' });
    const rect = popup().getBoundingClientRect();
    expect(rect.width).toBe(600);
    expect(rect.left + rect.width / 2).toBeCloseTo(window.innerWidth / 2, 0);
    expect(rect.top).toBeCloseTo(window.innerHeight * 0.15, 0);
    expect(document.activeElement).toBe(search());
    expect(search().placeholder).toBe('Type a name');
    expect(popup().getAttribute('aria-label')).toBe('Files');
    expect(labels()).toEqual(['README.md', 'main.ts', 'shell.tsx']);
    expect(highlightedLabel()).toBe('README.md');
  });

  it('opens with another item highlighted when asked, until the query changes', () => {
    picker({ initial: 1 });
    expect(highlightedLabel()).toBe('main.ts');
    type('s');
    expect(highlightedLabel()).toBe(labels()[0]);
  });

  it('highlights the item chosen from those listed, as it opens and for each query', () => {
    picker({ initial: (items) => items.findIndex((item) => item.label === 'main.ts') });
    expect(highlightedLabel()).toBe('main.ts');
    // Not listed: the first.
    type('e');
    expect(labels()).not.toContain('main.ts');
    expect(highlightedLabel()).toBe(labels()[0]);
    type('t');
    expect(highlightedLabel()).toBe('main.ts');
  });

  it('indents an item by its depth in a tree', () => {
    picker({
      items: () => [{ label: 'Square' }, { label: 'area', depth: 1 }],
    });
    const [type, member] = [...document.querySelectorAll('.cerebro-popup-item')] as HTMLElement[];
    expect(
      parseFloat(getComputedStyle(member as HTMLElement).paddingLeft) -
        parseFloat(getComputedStyle(type as HTMLElement).paddingLeft),
    ).toBe(19);
  });

  it('highlights what there is, asked for more than there is', () => {
    picker({ initial: 9 });
    expect(highlightedLabel()).toBe('shell.tsx');
  });

  it('opens below an element, kept inside the window', () => {
    const button = document.createElement('button');
    button.style.cssText = 'position: fixed; left: 100px; top: 10px; width: 80px; height: 30px;';
    document.body.append(button);
    picker({ position: { below: button } });
    expect(popup().getBoundingClientRect()).toEqual(
      expect.objectContaining({ left: 100, top: 44, width: 360 }),
    );
    popup().remove();
    button.style.left = `${String(window.innerWidth - 50)}px`;
    picker({ position: { below: button }, width: 300 });
    expect(popup().getBoundingClientRect().right).toBe(window.innerWidth - 4);
  });

  it('filters as you type, showing what matched, and says when nothing does', () => {
    picker({ empty: 'No files' });
    type('sh');
    expect(labels()).toEqual(['shell.tsx']);
    expect(document.querySelector('.cerebro-popup-item__match')?.textContent).toBe('sh');
    expect(document.querySelector('.cerebro-popup-item__detail')?.textContent).toBe('src');
    type('zzz');
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe('No files');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(key('ArrowDown').defaultPrevented).toBe(true);
  });

  it('says Nothing found by default', () => {
    picker();
    type('zzz');
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe('Nothing found');
  });

  it('moves with the arrows, wrapping, and pages', () => {
    const handle = picker({
      items: () => Array.from({ length: 30 }, (_, i) => ({ label: `item ${String(i)}` })),
    });
    key('ArrowUp');
    expect(highlightedLabel()).toBe('item 29');
    expect(handle.highlighted()?.label).toBe('item 29');
    key('ArrowDown');
    expect(highlightedLabel()).toBe('item 0');
    key('PageDown');
    expect(highlightedLabel()).toBe('item 10');
    key('PageDown');
    key('PageDown');
    key('PageDown');
    expect(highlightedLabel()).toBe('item 29');
    key('PageUp');
    expect(highlightedLabel()).toBe('item 19');
    key('PageUp');
    key('PageUp');
    expect(highlightedLabel()).toBe('item 0');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(key('a').defaultPrevented).toBe(false);
    expect(key('ArrowDown', { isComposing: true }).defaultPrevented).toBe(false);
  });

  it('chooses with Enter or a click, giving the focus back', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const first = picker();
    key('ArrowDown');
    key('Enter');
    expect(await first.result).toEqual(FILES[1]);
    expect(document.querySelector('.cerebro-popup')).toBeNull();
    expect(document.activeElement).toBe(before);
    const second = picker();
    const item = document.querySelectorAll('.cerebro-popup-item')[2] as HTMLElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    item.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    item.click();
    expect(await second.result).toEqual(FILES[2]);
    second.close();
  });

  it('draws at most its limit of rows, counting the rest, and moves only among them', () => {
    picker({
      items: () => Array.from({ length: 205 }, (_, i) => ({ label: `item ${String(i)}` })),
    });
    expect(labels()).toHaveLength(200);
    expect(document.querySelector('.cerebro-popup__more')?.textContent).toBe(
      '5 more; type more to narrow them down',
    );
    key('ArrowUp');
    expect(highlightedLabel()).toBe('item 199');
    popup().remove();
    picker({ items: () => FILES, limit: 2 });
    expect(labels()).toEqual(['README.md', 'main.ts']);
    expect(document.querySelector('.cerebro-popup__more')?.textContent).toContain('1 more');
  });

  it('tells of query changes, for a search whose results its items read', () => {
    const results = signal<PickerItem[]>([]);
    const queries: string[] = [];
    picker({
      items: () => results.get(),
      onQueryChange: (query) => {
        queries.push(query);
        results.set([{ label: `result for ${query}` }]);
      },
    });
    type('ab');
    expect(queries).toEqual(['ab']);
    expect(labels()).toEqual(['result for ab']);
  });

  it('highlights under a moving pointer only', () => {
    picker();
    const items = document.querySelectorAll<HTMLElement>('.cerebro-popup-item');
    const move = (index: number, clientY: number) =>
      (items[index] as HTMLElement).dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY }),
      );
    move(0, 30);
    expect(highlightedLabel()).toBe('README.md');
    // The list shifted under a still pointer: no movement of its own.
    move(2, 30);
    expect(highlightedLabel()).toBe('README.md');
    move(2, 32);
    expect(highlightedLabel()).toBe('shell.tsx');
  });

  it('closes on Escape, a press outside, or leaving the window, but not a press inside', async () => {
    const owner = document.createElement('button');
    document.body.append(owner);
    const press = (target: EventTarget) =>
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const how of ['escape', 'outside', 'blur', 'resize']) {
      const handle = picker({ owner });
      press(search());
      press(owner);
      expect(handle.open).toBe(true);
      if (how === 'escape') key('Escape');
      else if (how === 'outside') press(document.body);
      else window.dispatchEvent(new Event(how));
      expect(await handle.result).toBeUndefined();
    }
  });

  it('keeps keys from the app behind it', () => {
    const app = vi.fn();
    window.addEventListener('keydown', app);
    picker();
    key('n', { ctrlKey: true, shiftKey: true });
    window.removeEventListener('keydown', app);
    expect(app).not.toHaveBeenCalled();
  });

  it('shows groups, icons and shortcuts, and follows what its items read', () => {
    const extra = signal(false);
    picker({
      items: () => [
        { label: 'New Branch…', icon: () => <i class="test-icon" /> },
        { label: 'main', group: 'Local' },
        { label: 'feat/x', group: 'Local' },
        ...(extra.get() ? [{ label: 'origin/main', group: 'Remote', shortcut: 'R' }] : []),
      ],
    });
    const groups = () =>
      [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent);
    expect(groups()).toEqual(['Local']);
    expect(document.querySelectorAll('.test-icon')).toHaveLength(1);
    extra.set(true);
    expect(groups()).toEqual(['Local', 'Remote']);
    expect(
      [...document.querySelectorAll('.cerebro-popup-item__shortcut')].at(-1)?.textContent,
    ).toBe('R');
  });

  it('keeps the rows its items had when others come in, a press on one choosing it', async () => {
    // Search Everywhere's results arrive one kind at a time; a row held across one (Playwright's
    // click in CI) was a row no longer in the page.
    const late = signal<PickerItem[]>([]);
    const handle = picker({ items: () => [...late.get(), ...FILES] });
    const row = () =>
      [...document.querySelectorAll('.cerebro-popup-item')].find((r) =>
        r.textContent.includes('shell.tsx'),
      ) as HTMLElement;
    const held = row();
    key('ArrowDown');
    key('ArrowDown');
    expect(held.classList).toContain('cerebro-popup-item--highlighted');
    late.set([{ label: 'Layout', group: 'Classes' }]);
    expect(row()).toBe(held);
    expect(held.dataset['index']).toBe('3');
    // The highlight stays at its index, as before.
    expect(highlightedLabel()).toBe('main.ts');
    expect(held.getAttribute('aria-selected')).toBe('false');
    // A row that's gone goes, and the same item again is a row again.
    late.set([]);
    late.set([{ label: 'Layout', group: 'Classes' }]);
    expect(labels()).toEqual(['Layout', 'README.md', 'main.ts', 'shell.tsx']);
    await userEvent.click(held);
    expect(await handle.result).toEqual(FILES[2]);
  });

  it('keeps a row for each of two items that read the same', () => {
    picker({ items: () => [{ label: 'a' }, { label: 'a' }] });
    expect(labels()).toEqual(['a', 'a']);
  });

  it('shows more of a group with its “more” item, by Enter or a click, staying open', async () => {
    const shown = signal(1);
    const handle = picker({
      items: () => [
        ...['a', 'b', 'c'].slice(0, shown.get()).map((label) => ({ label, group: 'Letters' })),
        ...(shown.get() < 3
          ? [
              {
                label: '… more',
                group: 'Letters',
                more: () => {
                  shown.set(shown.peek() + 1);
                },
              },
            ]
          : []),
      ],
    });
    // Small and muted, as the group's header.
    const more = document.querySelector('.cerebro-popup-item--more') as HTMLElement;
    const header = document.querySelector('.cerebro-popup__group') as HTMLElement;
    expect(getComputedStyle(more).fontSize).toBe(getComputedStyle(header).fontSize);
    expect(getComputedStyle(more).color).toBe(getComputedStyle(header).color);
    key('ArrowDown');
    key('Enter');
    expect(labels()).toEqual(['a', 'b', '… more']);
    expect(handle.open).toBe(true);
    await userEvent.click(document.querySelector('.cerebro-popup-item--more') as HTMLElement);
    expect(labels()).toEqual(['a', 'b', 'c']);
    expect(handle.open).toBe(true);
  });

  it('opens an item’s submenu beside its row, staying open unless it says to close', async () => {
    let answer: (close: boolean) => void = () => undefined;
    const submenu = vi.fn<(row: HTMLElement) => Promise<boolean>>(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    );
    const handle = picker({
      items: () => [{ label: 'main' }, { label: 'side', submenu }],
    });
    expect(document.querySelectorAll('.cerebro-popup-item__arrow')).toHaveLength(1);
    // Right moves the caret in the field until it's at the end.
    type('x');
    search().setSelectionRange(0, 0);
    key('ArrowDown');
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    search().setSelectionRange(1, 1);
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(submenu).toHaveBeenCalledTimes(1);
    expect(submenu.mock.calls[0]?.[0].textContent).toBe('side');
    // Open: once only, and presses outside are its own.
    key('Enter');
    expect(submenu).toHaveBeenCalledTimes(1);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(handle.open).toBe(true);
    answer(false);
    await vi.waitFor(() => {
      expect(handle.open).toBe(true);
    });
    // A click opens it too; something chosen there closes the popup.
    await userEvent.click(document.querySelectorAll('.cerebro-popup-item')[1] as Element);
    expect(submenu).toHaveBeenCalledTimes(2);
    answer(true);
    expect(await handle.result).toBeUndefined();
    expect(handle.open).toBe(false);
  });

  it('closes an item with its close button, keeping the popup open', async () => {
    const tabs = signal(['a.ts', 'b.ts']);
    const handle = picker({
      items: () =>
        tabs.get().map((label) => ({
          label,
          close: {
            label: `Close ${label}`,
            run: () => {
              tabs.set(tabs.get().filter((t) => t !== label));
            },
          },
        })),
    });
    const close = document.querySelector('[aria-label="Close b.ts"]') as HTMLElement;
    // Shown on the highlighted item, and the one hovered.
    expect(getComputedStyle(close).visibility).toBe('hidden');
    await userEvent.hover(close.parentElement as HTMLElement);
    expect(getComputedStyle(close).visibility).toBe('visible');
    await userEvent.click(close);
    expect(labels()).toEqual(['a.ts']);
    expect(handle.open).toBe(true);
    expect(document.querySelectorAll('.cerebro-popup-item__close')).toHaveLength(1);
  });

  it('shows a header, options beside the field, and the highlighted item in a preview', () => {
    const matchCase = signal(false);
    picker({
      altKeys: 'CWX',
      header: () => <span class="test-title">Find in Files</span>,
      options: () => <button class="test-option">Aa</button>,
      toolbar: () => <button class="test-scope">Directory</button>,
      preview: (item) => <p class="test-preview">{item?.label ?? 'none'}</p>,
      onKey: (event) => {
        if (event.key !== 'c' || !event.altKey) return false;
        matchCase.set(!matchCase.get());
        return true;
      },
    });
    expect(document.querySelector('.cerebro-popup__header')?.textContent).toBe('Find in Files');
    // Its Alt keys, which the menu bar leaves to it.
    expect((document.querySelector('.cerebro-popup') as HTMLElement).dataset['altKeys']).toBe(
      'CWX',
    );
    expect(document.querySelector('.cerebro-popup__search-row .test-option')).not.toBeNull();
    // The toolbar between the field and the list.
    const toolbar = document.querySelector('.cerebro-popup__toolbar') as HTMLElement;
    expect(toolbar.querySelector('.test-scope')).not.toBeNull();
    expect(toolbar.previousElementSibling?.classList.contains('cerebro-popup__search-row')).toBe(
      true,
    );
    expect(toolbar.nextElementSibling?.classList.contains('cerebro-popup__list')).toBe(true);
    const preview = () => document.querySelector('.test-preview')?.textContent;
    expect(preview()).toBe('README.md');
    key('ArrowDown');
    expect(preview()).toBe('main.ts');
    type('nothing like it');
    expect(preview()).toBe('none');
    // The caller's keys first: handled, they go no further.
    expect(key('c', { altKey: true }).defaultPrevented).toBe(true);
    expect(matchCase.get()).toBe(true);
    expect(key('x', { altKey: true }).defaultPrevented).toBe(false);
  });
});
