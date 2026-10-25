import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { MenuRegistry } from '../src/index.js';

describe('MenuRegistry', () => {
  it('orders by group, then order, then contribution, with separators between groups', () => {
    const menus = new MenuRegistry();
    menus.contribute({ menu: 'main/file', item: { command: 'file.exit' }, group: 'z-exit' });
    menus.contribute({ menu: 'main/file', item: { command: 'file.save' }, group: 'b-save' });
    menus.contribute({
      menu: 'main/file',
      item: { command: 'file.open' },
      group: 'a-open',
      order: 2,
    });
    menus.contribute({
      menu: 'main/file',
      item: { command: 'file.new' },
      group: 'a-open',
      order: 1,
    });
    menus.contribute({
      menu: 'main/file',
      item: { command: 'file.reopen' },
      group: 'a-open',
      order: 2,
    });
    menus.contribute({ menu: 'main/edit', item: { command: 'edit.undo' } });
    expect(menus.entries('main/file')).toEqual([
      { command: 'file.new' },
      { command: 'file.open' },
      { command: 'file.reopen' },
      { separator: true },
      { command: 'file.save' },
      { separator: true },
      { command: 'file.exit' },
    ]);
  });

  it('puts the default group first, and holds submenus', () => {
    const menus = new MenuRegistry();
    menus.contribute({ menu: 'main', item: { submenu: 'main/edit', label: '&Edit' }, group: 'b' });
    menus.contribute({ menu: 'main', item: { submenu: 'main/file', label: '&File' } });
    expect(menus.entries('main')).toEqual([
      { submenu: 'main/file', label: '&File' },
      { separator: true },
      { submenu: 'main/edit', label: '&Edit' },
    ]);
    expect(menus.entries('nothing')).toEqual([]);
  });

  it('removes a contribution on dispose, and is reactive', () => {
    const menus = new MenuRegistry();
    const seen: number[] = [];
    effect(() => {
      seen.push(menus.entries('main').length);
      return undefined;
    });
    const handle = menus.contribute({ menu: 'main', item: { command: 'a' } });
    handle.dispose();
    handle.dispose();
    expect(seen).toEqual([0, 1, 0]);
  });
});
