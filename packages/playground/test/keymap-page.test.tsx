import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { keymapPage, loadUserKeymaps, userKeymaps } from '../src/keymap-page.js';

const STORAGE_KEY = 'cerebro.keymap.user';
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  localStorage.clear();
  userKeymaps.set({});
});

/** The Keymap page, with Close Tab in the menus, showing the keymap `chosen()` names. */
function page(chosen: () => string) {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  commands.register({ id: 'editor.close', label: 'Close Tab', run: () => undefined });
  menus.contribute({ menu: 'main', item: { submenu: 'main/window', label: 'Window' } });
  menus.contribute({ menu: 'main/window', item: { command: 'editor.close' } });
  const custom = keymapPage(new Keymap('other'), commands, menus);
  const handle = render(() => custom.render(() => chosen()), document.body);
  dispose = () => {
    handle.dispose();
  };
  return custom;
}

const keys = () =>
  document.querySelector('[data-command="editor.close"] .cerebro-keymap__keys')?.textContent;

async function remove(shortcut: string): Promise<void> {
  await userEvent.click(document.querySelector('[data-command="editor.close"]') as HTMLElement);
  const button = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === `Remove ${shortcut}`,
  ) as HTMLButtonElement;
  await userEvent.click(button);
}

describe('the user’s keymaps', () => {
  it('are read from storage, or are none where it holds nothing readable', () => {
    expect(loadUserKeymaps()).toEqual({});
    localStorage.setItem(STORAGE_KEY, '{unreadable');
    expect(loadUserKeymaps()).toEqual({});
    const saved = { intellij: [{ key: 'F1', command: 'editor.close' }] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    expect(loadUserKeymaps()).toEqual(saved);
  });
});

describe('the Keymap page', () => {
  it('shows the chosen keymap with the user’s changes to it', () => {
    userKeymaps.set({ intellij: [{ key: 'F1', command: 'editor.close' }] });
    page(() => 'intellij');
    expect(keys()).toBe('F1, Ctrl+F4');
    expect(document.body.textContent).toContain('Close Tab');
  });

  it('keeps each keymap’s changes on its own, and saves them all on Apply', async () => {
    const chosen = signal('intellij');
    const custom = page(() => chosen.get());
    expect(custom.changed()).toBe(false);
    await remove('Ctrl+F4');
    expect(custom.changed()).toBe(true);
    chosen.set('vscode');
    await expect.poll(keys).toBe('Ctrl+W');
    expect(custom.changed()).toBe(true);
    custom.apply();
    expect(custom.changed()).toBe(false);
    const removed = [{ key: 'Ctrl+F4', command: 'editor.close', remove: true }];
    expect(userKeymaps.get()).toEqual({ intellij: removed, vscode: [] });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
      intellij: removed,
      vscode: [],
    });
    chosen.set('intellij');
    await expect.poll(keys).toBe('');
  });

  it('still applies the keys when they can’t be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const custom = page(() => 'intellij');
    await remove('Ctrl+F4');
    custom.apply();
    expect(userKeymaps.get()['intellij']).toHaveLength(1);
  });
});
