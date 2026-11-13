import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  fuzzyFilter,
  openPicker,
  SearchHistoryButton,
  showSearchHistory,
  showsHistory,
  type PickerHandle,
  type PickerItem,
} from '../src/index.js';

const handles: PickerHandle<unknown>[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
  for (const popup of document.querySelectorAll<HTMLElement>('.cerebro-popup')) {
    popup.querySelector<HTMLInputElement>('.cerebro-popup__search')?.focus();
  }
  document.body.replaceChildren();
});

const popups = () => [...document.querySelectorAll('.cerebro-popup')];
const labels = (popup: Element | undefined) =>
  [...(popup?.querySelectorAll('.cerebro-popup-item__label') ?? [])].map((l) => l.textContent);

describe('a search field’s history', () => {
  it('lists the texts below the field, at least a list’s width, and gives the one chosen', async () => {
    const field = document.createElement('input');
    field.style.boxSizing = 'border-box';
    field.style.width = '500px';
    document.body.append(field);
    const chosen = showSearchHistory({ label: 'Search History', texts: ['b', 'a'], below: field });
    const list = popups()[0] as HTMLElement;
    expect(list.getAttribute('aria-label')).toBe('Search History');
    expect(labels(list)).toEqual(['b', 'a']);
    expect(list.getBoundingClientRect().width).toBe(500);
    expect(list.getBoundingClientRect().top).toBeGreaterThan(field.getBoundingClientRect().bottom);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(await chosen).toBe('a');
    field.style.width = '100px';
    const none = showSearchHistory({ label: 'Search History', texts: ['b'], below: field });
    expect((popups()[0] as HTMLElement).getBoundingClientRect().width).toBe(360);
    await userEvent.keyboard('{Escape}');
    expect(await none).toBeUndefined();
  });

  it('shows nothing with no history', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    expect(await showSearchHistory({ label: 'Search History', texts: [], below: field })).toBe(
      undefined,
    );
    expect(popups()).toEqual([]);
  });

  it('is shown by Alt+Down alone', () => {
    const down = (init: KeyboardEventInit) =>
      new KeyboardEvent('keydown', { key: 'ArrowDown', ...init });
    expect(showsHistory(down({ altKey: true }))).toBe(true);
    expect(showsHistory(down({}))).toBe(false);
    for (const other of ['ctrlKey', 'metaKey', 'shiftKey']) {
      expect(showsHistory(down({ altKey: true, [other]: true }))).toBe(false);
    }
    expect(showsHistory(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }))).toBe(
      false,
    );
  });

  it('has a button that shows it, the field keeping the focus', async () => {
    const show = vi.fn();
    const box = document.createElement('div');
    document.body.append(box);
    render(
      () => [
        <SearchHistoryButton label="Search History" icon="H" show={show} />,
        <input class="field" />,
      ],
      box,
    );
    const field = box.querySelector('.field') as HTMLInputElement;
    field.focus();
    const button = box.querySelector('.cerebro-popup__history') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Search History');
    expect(button.title).toBe('Search History');
    await userEvent.click(button);
    expect(show).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(field);
  });
});

describe('a picker’s search field with a history', () => {
  const ITEMS: PickerItem[] = [{ label: 'alpha' }, { label: 'beta' }];

  function picker(texts: string[]) {
    const queries: string[] = [];
    const handle = openPicker<PickerItem>({
      label: 'Find',
      position: 'top',
      items: (query) => fuzzyFilter(ITEMS, query),
      onQueryChange: (query) => queries.push(query),
      history: { label: 'Search History', icon: 'H', texts: () => texts },
    });
    handles.push(handle);
    return { handle, queries };
  }
  const search = () => document.querySelector('.cerebro-popup__search') as HTMLInputElement;

  it('puts the text chosen in the field, searching it, from the button or Alt+Down', async () => {
    const { handle, queries } = picker(['beta', 'alp']);
    const button = document.querySelector('.cerebro-popup__history') as HTMLElement;
    expect(button.nextElementSibling).toBe(search());
    await userEvent.click(button);
    expect(popups()).toHaveLength(2);
    // A press in the history doesn't close the popup it's over.
    await userEvent.click(popups()[1]?.querySelectorAll('.cerebro-popup-item')[1] as HTMLElement);
    expect(handle.open).toBe(true);
    expect(search().value).toBe('alp');
    expect(queries).toEqual(['alp']);
    expect(labels(popups()[0])).toEqual(['alpha']);
    expect(document.activeElement).toBe(search());
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(labels(popups()[1])).toEqual(['beta', 'alp']);
    await userEvent.keyboard('{Enter}');
    expect(search().value).toBe('beta');
    // Escape in the history closes it alone; nothing changes.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}{Escape}');
    expect(popups()).toHaveLength(1);
    expect(search().value).toBe('beta');
    // A press elsewhere still closes it.
    await userEvent.click(document.body);
    expect(handle.open).toBe(false);
  });

  it('is a plain field without one, Alt+Down moving down the list', async () => {
    const handle = openPicker<PickerItem>({
      label: 'Files',
      position: 'top',
      items: (query) => fuzzyFilter(ITEMS, query),
    });
    handles.push(handle);
    expect(document.querySelector('.cerebro-popup__history')).toBeNull();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(popups()).toHaveLength(1);
  });
});
