import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    picker({ items: () => Array.from({ length: 30 }, (_, i) => ({ label: `item ${String(i)}` })) });
    key('ArrowUp');
    expect(highlightedLabel()).toBe('item 29');
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

  it('shows a header, options beside the field, and the highlighted item in a preview', () => {
    const matchCase = signal(false);
    picker({
      header: () => <span class="test-title">Find in Files</span>,
      options: () => <button class="test-option">Aa</button>,
      preview: (item) => <p class="test-preview">{item?.label ?? 'none'}</p>,
      onKey: (event) => {
        if (event.key !== 'c' || !event.altKey) return false;
        matchCase.set(!matchCase.get());
        return true;
      },
    });
    expect(document.querySelector('.cerebro-popup__header')?.textContent).toBe('Find in Files');
    expect(document.querySelector('.cerebro-popup__search-row .test-option')).not.toBeNull();
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
