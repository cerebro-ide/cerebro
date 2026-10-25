// The key flows with real keyboard and mouse input (Playwright's, through Vitest).

import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '../src/index.js';

const open: PickerHandle<unknown>[] = [];

afterEach(() => {
  for (const popup of open.splice(0)) popup.close();
});

const FILES: PickerItem[] = [
  { label: 'README.md' },
  { label: 'main.ts', detail: 'src' },
  { label: 'shell.tsx', detail: 'src' },
  { label: 'styles.css', detail: 'src' },
];

function picker() {
  const handle = openPicker<PickerItem>({
    label: 'Files',
    items: (query) => fuzzyFilter(FILES, query),
    position: 'top',
  });
  open.push(handle);
  return handle;
}

const labels = () =>
  [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);
const item = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-popup-item')].find(
    (i) => i.querySelector('.cerebro-popup-item__label')?.textContent === label,
  ) as HTMLElement;

describe('popups, with real input', () => {
  it('filters as you type, moves with the arrows, and chooses with Enter', async () => {
    const handle = picker();
    await userEvent.keyboard('s');
    expect(labels()).toEqual(['shell.tsx', 'styles.css', 'main.ts']);
    await userEvent.keyboard('t');
    // main.ts through its directory: src/main.ts.
    expect(labels()).toEqual(['styles.css', 'shell.tsx', 'main.ts']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect((await handle.result)?.label).toBe('shell.tsx');
  });

  it('chooses with a click, the search field keeping the focus until then', async () => {
    const handle = picker();
    const search = document.querySelector('.cerebro-popup__search');
    await userEvent.hover(item('shell.tsx'));
    expect(document.querySelector('.cerebro-popup-item--highlighted')).toBe(item('shell.tsx'));
    expect(document.activeElement).toBe(search);
    await userEvent.click(item('shell.tsx'));
    expect((await handle.result)?.label).toBe('shell.tsx');
  });

  it('closes on Escape, or a press outside', async () => {
    const first = picker();
    await userEvent.keyboard('{Escape}');
    expect(await first.result).toBeUndefined();
    const second = picker();
    await userEvent.click(document.body, { position: { x: 5, y: 700 } });
    expect(await second.result).toBeUndefined();
  });
});
