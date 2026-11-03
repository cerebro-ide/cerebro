import { beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { NativeMenuItem } from '@cerebro-ide/ui-menu';
import { loadProjects } from '../src/projects.js';
import { host, installBridge } from './app-bridge.js';

// The page, as the desktop app shows it on macOS: its menu in the system's menu bar, its keys the
// Mac's. It's made once, as it's imported.

// A Mac, before the page's modules read it as they're imported (the keymap's default).
vi.hoisted(() => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
});

/** The menus the page gave the app, the last one current. */
const menus: NativeMenuItem[][] = [];

beforeAll(async () => {
  installBridge('darwin', {
    set: (items: NativeMenuItem[]) => void menus.push(items),
    onCommand: () => () => undefined,
    edit: () => undefined,
  });
  await loadProjects();
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/main.js');
});

/** A command's item, anywhere in the menu. */
const itemFor = (command: string, items = menus.at(-1) ?? []): NativeMenuItem | undefined => {
  for (const item of items) {
    const found = item.command === command ? item : itemFor(command, item.submenu ?? []);
    if (found) return found;
  }
  return undefined;
};

describe('the page on macOS', () => {
  it('puts its menu in the system’s menu bar, with the Mac’s keys', async () => {
    await expect.poll(() => itemFor('navigate.goToLine')?.accelerator).toBe('Command+L');
    expect(itemFor('navigate.back')?.accelerator).toBe('Command+[');
    expect(itemFor('navigate.forward')?.accelerator).toBe('Command+]');
    expect(document.querySelector('[aria-label="Main Menu"]')).toBeNull();
  });

  it('gives a terminal plain Ctrl+key unless the app has a use for it', async () => {
    const writes = () =>
      host('/r')
        .params('terminal.write')
        .map((p) => (p as { data: string }).data)
        .join('');
    await expect
      .poll(() =>
        document.querySelector('.cerebro-tool-window[data-id="terminal"] .cerebro-terminal'),
      )
      .not.toBeNull();
    await userEvent.click(
      document.querySelector(
        '.cerebro-tool-window[data-id="terminal"] .cerebro-terminal',
      ) as HTMLElement,
    );
    await userEvent.keyboard('{Control>}c{/Control}');
    await expect.poll(writes).toBe('\u0003');
  });
});
