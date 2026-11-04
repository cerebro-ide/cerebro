// The Switcher's command apart from the app: no environment, no keymap, other modifiers held. The
// app's tests (main-app) cover it with real keys.

import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { EditorArea, ToolWindows, type Tab } from '@cerebro-ide/layout';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { setupSwitcher } from '../src/switcher.js';

const commands = new CommandRegistry();
const tools = new ToolWindows();
tools.register({ id: 'plain', title: 'plain', anchor: 'left' });
tools.register({ id: 'more', title: 'More', anchor: 'left', icon: 'folder' });
let area: EditorArea | undefined;
const opened: Tab[] = [];
setupSwitcher(
  { commands, menus: new MenuRegistry() },
  { editor: () => area, tools, open: (tab) => void opened.push(tab) },
);

afterEach(async () => {
  await userEvent.keyboard('{Escape}');
  area = undefined;
});

const labels = (side: string) =>
  [...document.querySelectorAll(`[data-side="${side}"] .cerebro-popup-item`)].map((row) =>
    [...row.querySelectorAll('span')].map((part) => part.textContent).join('|'),
  );
const selected = () =>
  document.querySelector(
    '.cerebro-switcher .cerebro-popup-item--highlighted .cerebro-popup-item__label',
  )?.textContent;

describe('the Switcher’s command', () => {
  it('lists the tool windows alone with no environment, by their capitals or the next free key', () => {
    commands.execute('view.switcher');
    // No keymap: no numbers; "plain" has no capital.
    expect(labels('left')).toEqual(['|More||M', '|plain||0']);
    expect(labels('right')).toEqual([]);
    expect(selected()).toBe('More');
  });

  it('shows a tool window chosen, its content focused', async () => {
    commands.execute('view.switcher');
    await userEvent.keyboard('{Enter}');
    expect(tools.isVisible('more')).toBe(true);
  });

  it('closes on the release of any modifier it opened with', async () => {
    area = new EditorArea();
    area.open({ id: '/r/a.ts', title: 'a.ts' });
    // Only the tab shown: it's selected, there's nothing before it.
    const press = new KeyboardEvent('keydown', { key: 'Tab', altKey: true, metaKey: true });
    const run = () => commands.execute('view.switcher');
    window.addEventListener('keydown', run, { once: true });
    window.dispatchEvent(press);
    expect(selected()).toBe('a.ts');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Meta' }));
    await expect.poll(() => opened.at(-1)?.id).toBe('/r/a.ts');
  });

  it('gives no mnemonic once 0-9 and A-Z are taken', () => {
    const many = new ToolWindows();
    for (let i = 0; i < 40; i++)
      many.register({ id: `w${String(i)}`, title: `w${String(i)}`, anchor: 'left' });
    const own = new CommandRegistry();
    setupSwitcher(
      { commands: own, menus: new MenuRegistry() },
      { editor: () => undefined, tools: many, open: () => undefined },
    );
    own.execute('view.switcher');
    const keys = [
      ...document.querySelectorAll('[data-side="left"] .cerebro-popup-item__shortcut'),
    ].map((key) => key.textContent);
    expect(keys.filter((key) => key !== '')).toHaveLength(36);
    expect(keys.filter((key) => key === '')).toHaveLength(4);
  });

  it('closes a tab in the groups that have it', async () => {
    area = new EditorArea();
    area.open({ id: '/r/a.ts', title: 'a.ts' });
    area.open({ id: '/r/b.ts', title: 'b.ts' });
    area.split(area.activeGroupId, 'right', '/r/b.ts');
    commands.execute('view.switcher');
    expect(selected()).toBe('a.ts');
    await userEvent.keyboard('{Delete}');
    expect(area.groups.map((group) => group.tabs.map((tab) => tab.id))).toEqual([
      ['/r/b.ts'],
      ['/r/b.ts'],
    ]);
  });
});
