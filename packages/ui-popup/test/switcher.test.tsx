// The Switcher, with real keyboard and mouse input (Playwright's, through Vitest).

import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openSwitcher,
  type SwitcherHandle,
  type SwitcherItem,
  type SwitcherOptions,
} from '../src/index.js';

const open: SwitcherHandle<unknown>[] = [];

afterEach(async () => {
  for (const switcher of open.splice(0)) switcher.close();
  await userEvent.cleanup();
});

const TOOLS: SwitcherItem[] = [
  { label: 'Commit', mnemonic: '0' },
  { label: 'Project', mnemonic: '1' },
];
const FILES: SwitcherItem[] = [
  { label: 'a.ts', status: '/r/src' },
  { label: 'b.ts', status: '/r' },
  { label: 'c.ts', detail: 'lib', status: '/r/lib' },
];

function switcher(options: Partial<SwitcherOptions<SwitcherItem>> = {}) {
  const handle = openSwitcher<SwitcherItem>({
    title: 'Switcher',
    left: TOOLS,
    right: FILES,
    initial: { side: 'right', index: 1 },
    ...options,
  });
  open.push(handle);
  return handle;
}

/** The selected item's label, and its side. */
const selected = () => {
  const row = document.querySelector('.cerebro-switcher .cerebro-popup-item--highlighted');
  const side = row?.closest('[data-side]')?.getAttribute('data-side');
  return `${String(side)}:${String(row?.querySelector('.cerebro-popup-item__label')?.textContent)}`;
};
const labels = (side: string) =>
  [...document.querySelectorAll(`[data-side="${side}"] .cerebro-popup-item__label`)].map(
    (label) => label.textContent,
  );
const status = () => document.querySelector('.cerebro-switcher__status')?.textContent;

describe('the Switcher', () => {
  it('shows its title, the two lists and the selected item’s status, in the window’s centre', () => {
    switcher();
    const popup = document.querySelector('.cerebro-switcher') as HTMLElement;
    expect(document.activeElement).toBe(popup);
    expect(popup.getAttribute('aria-label')).toBe('Switcher');
    expect(document.querySelector('.cerebro-switcher__title')?.textContent).toBe('Switcher');
    expect(labels('left')).toEqual(['Commit', 'Project']);
    expect(labels('right')).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(
      [...document.querySelectorAll('[data-side="left"] .cerebro-popup-item__shortcut')].map(
        (m) => m.textContent,
      ),
    ).toEqual(['0', '1']);
    expect(selected()).toBe('right:b.ts');
    expect(status()).toBe('/r');
    const box = popup.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top + box.height / 2 - window.innerHeight / 2)).toBeLessThanOrEqual(1);
  });

  it('moves on with Tab while Ctrl is held, from one list’s end into the other, and opens what’s selected as Ctrl goes', async () => {
    const handle = switcher({ held: ['Control'] });
    await userEvent.keyboard('{Control>}{Tab}');
    expect(selected()).toBe('right:c.ts');
    expect(status()).toBe('/r/lib');
    await userEvent.keyboard('{Tab}');
    expect(selected()).toBe('left:Commit');
    expect(status()).toBe('');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(selected()).toBe('right:c.ts');
    await userEvent.keyboard('{Tab}{Tab}{Tab}');
    expect(selected()).toBe('right:a.ts');
    // Other keys going up don't choose.
    await userEvent.keyboard('{Shift}');
    expect(handle.open).toBe(true);
    await userEvent.keyboard('{/Control}');
    expect(await handle.result).toBe(FILES[0]);
    expect(document.querySelector('.cerebro-switcher')).toBeNull();
  });

  it('stays open without modifiers held: the arrows move, Enter opens, Escape closes', async () => {
    let handle = switcher();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(selected()).toBe('right:a.ts');
    await userEvent.keyboard('{ArrowUp}');
    expect(selected()).toBe('right:c.ts');
    await userEvent.keyboard('{ArrowLeft}');
    expect(selected()).toBe('left:Project');
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}');
    expect(selected()).toBe('right:b.ts');
    await userEvent.keyboard('{PageDown}');
    expect(selected()).toBe('right:c.ts');
    await userEvent.keyboard('{PageUp}');
    expect(selected()).toBe('right:a.ts');
    await userEvent.keyboard('{Enter}');
    expect(await handle.result).toBe(FILES[0]);
    handle = switcher();
    await userEvent.keyboard('{Escape}');
    expect(await handle.result).toBeUndefined();
  });

  it('gives the focus back when it closes, inside a shadow root too (an editor’s content)', async () => {
    const host = document.createElement('div');
    const before = document.createElement('button');
    host.attachShadow({ mode: 'open' }).append(before);
    document.body.append(host);
    before.focus();
    const handle = switcher();
    await userEvent.keyboard('{Escape}');
    await handle.result;
    expect(host.shadowRoot?.activeElement).toBe(before);
    host.remove();
  });

  it('closes the selected item with Delete or Backspace, if it goes', async () => {
    const closed: string[] = [];
    switcher({
      close: (item) => {
        closed.push(item.label);
        return item.label !== 'Project';
      },
    });
    await userEvent.keyboard('{Delete}');
    expect(labels('right')).toEqual(['a.ts', 'c.ts']);
    expect(selected()).toBe('right:c.ts');
    await userEvent.keyboard('{Backspace}{Backspace}');
    // The files all gone, the tool windows take the selection.
    expect(labels('right')).toEqual([]);
    expect(selected()).toBe('left:Commit');
    await userEvent.keyboard('{ArrowDown}{Delete}');
    expect(labels('left')).toEqual(['Commit', 'Project']);
    await userEvent.keyboard('{ArrowUp}{Delete}');
    expect(labels('left')).toEqual(['Project']);
    expect(selected()).toBe('left:Project');
    expect(closed).toEqual(['b.ts', 'c.ts', 'a.ts', 'Project', 'Commit']);
    // Nothing moves in an empty list.
    await userEvent.keyboard('{ArrowRight}');
    expect(selected()).toBe('left:Project');
  });

  it('does nothing on Delete when nothing closes', async () => {
    switcher();
    await userEvent.keyboard('{Delete}');
    expect(labels('right')).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('chooses an item by its mnemonic, with the modifiers held as it opened', async () => {
    let handle = switcher({ held: ['Control'] });
    await userEvent.keyboard('{Control>}');
    // Not with other modifiers, nor a key with no item.
    await userEvent.keyboard('{Alt>}1{/Alt}5');
    expect(handle.open).toBe(true);
    await userEvent.keyboard('1');
    expect(await handle.result).toBe(TOOLS[1]);
    await userEvent.keyboard('{/Control}');
    // Opened without: the key alone.
    handle = switcher();
    await userEvent.keyboard('0');
    expect(await handle.result).toBe(TOOLS[0]);
  });

  it('chooses an item clicked, and closes on a press outside or as the window loses the focus', async () => {
    let handle = switcher();
    const row = [
      ...document.querySelectorAll<HTMLElement>('.cerebro-switcher .cerebro-popup-item'),
    ].at(-1) as HTMLElement;
    await userEvent.click(row);
    expect(await handle.result).toBe(FILES[2]);
    handle = switcher();
    await userEvent.click(document.body, { position: { x: 2, y: 2 } });
    expect(await handle.result).toBeUndefined();
    handle = switcher();
    window.dispatchEvent(new Event('blur'));
    expect(await handle.result).toBeUndefined();
    // Closing again does nothing.
    handle.close();
  });

  it('has no tool window list when there are none, and starts where it’s told', () => {
    switcher({ left: [], right: FILES, initial: { side: 'right', index: 0 } });
    expect(document.querySelector('[data-side="left"]')).toBeNull();
    expect(selected()).toBe('right:a.ts');
  });

  it('goes round one list when the other is empty, and does nothing with both empty', async () => {
    switcher({ left: [], right: FILES.slice(0, 1), initial: { side: 'right', index: 0 } });
    await userEvent.keyboard('{Tab}');
    expect(selected()).toBe('right:a.ts');
    await userEvent.keyboard('{Escape}');
    const handle = switcher({
      left: TOOLS.slice(0, 1),
      right: [],
      initial: { side: 'left', index: 0 },
      close: () => true,
    });
    await userEvent.keyboard('{Delete}');
    expect(labels('left')).toEqual([]);
    await userEvent.keyboard('{ArrowDown}{Tab}{Enter}');
    expect(await handle.result).toBeUndefined();
  });

  it('keeps keys from the app’s shortcuts while it’s open', async () => {
    const reached: string[] = [];
    const listen = (event: KeyboardEvent) => reached.push(event.key);
    window.addEventListener('keydown', listen);
    switcher();
    await userEvent.keyboard('x{ArrowDown}');
    window.removeEventListener('keydown', listen);
    expect(reached).toEqual([]);
  });
});
