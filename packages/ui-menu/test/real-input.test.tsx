// The key flows with real keyboard and mouse input (Playwright's, through Vitest).

import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '../src/styles.css';
import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { MenuBar, openContextMenu } from '../src/index.js';

const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  // Releases keys and moves the pointer away, so one test's input doesn't carry into the next.
  await userEvent.cleanup();
});

function setup() {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const ran: string[] = [];
  for (const [id, label] of [
    ['new', '&New'],
    ['open', '&Open'],
    ['undo', '&Undo'],
  ] as const) {
    commands.register({ id, label, run: () => ran.push(id) });
  }
  menus.contribute({ menu: 'main', item: { submenu: 'main/file', label: '&File' }, order: 1 });
  menus.contribute({ menu: 'main', item: { submenu: 'main/edit', label: '&Edit' }, order: 2 });
  menus.contribute({ menu: 'main/file', item: { command: 'new' } });
  menus.contribute({ menu: 'main/file', item: { command: 'open' } });
  menus.contribute({ menu: 'main/edit', item: { command: 'undo' } });
  return { services: { commands, menus }, ran };
}

function bar(visible: boolean) {
  const { services, ran } = setup();
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; right: 0; height: 40px;';
  document.body.append(container);
  const handle = render(() => <MenuBar services={services} visible={() => visible} />, container);
  cleanups.push(() => {
    handle.dispose();
    container.remove();
  });
  return { container, ran, services };
}

const openMenus = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-menu')].map((m) => m.dataset['menu']);
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-menu-item')].find((i) =>
    i.textContent.includes(text),
  ) as HTMLElement;

describe('the menu bar, with real input', () => {
  it('opens on click, switches on hover, and runs a clicked command', async () => {
    const { container, ran } = bar(true);
    const names = container.querySelectorAll<HTMLElement>('.cerebro-menubar__item');
    await userEvent.click(names[0] as HTMLElement);
    expect(openMenus()).toEqual(['main/file']);
    await userEvent.hover(names[1] as HTMLElement);
    expect(openMenus()).toEqual(['main/edit']);
    await userEvent.click(menuItem('Undo'));
    expect(ran).toEqual(['undo']);
    expect(openMenus()).toEqual([]);
  });

  it('opens with Alt and a letter, then moves with arrows and runs with Enter', async () => {
    const { ran } = bar(false);
    await userEvent.keyboard('{Alt>}f{/Alt}');
    expect(openMenus()).toEqual(['main/file']);
    // The first item is highlighted; Down moves to the second.
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(ran).toEqual(['open']);
  });

  it('expands with Alt alone, and collapses with Escape', async () => {
    const { container } = bar(false);
    await userEvent.keyboard('{Alt}');
    expect(container.querySelector('.cerebro-menubar--takeover')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(container.querySelector('.cerebro-menubar--takeover')).toBeNull();
  });

  it('shows no tooltip over a menu opened before the tooltip’s delay', async () => {
    const { container } = bar(false);
    const button = container.querySelector('.cerebro-menubar__button') as HTMLElement;
    await userEvent.hover(button);
    await userEvent.click(button);
    expect(openMenus()).toEqual(['main/file']);
    await new Promise((resolve) => setTimeout(resolve, SHOW_DELAY + 200));
    expect(document.querySelector('.cerebro-tooltip')).toBeNull();
  });
});

describe('context menus, with real input', () => {
  it('open on a right-click and close on a click elsewhere', async () => {
    const { services } = setup();
    const target = document.createElement('div');
    target.style.cssText = 'position: fixed; left: 300px; top: 300px; width: 100px; height: 100px;';
    document.body.append(target);
    cleanups.push(() => {
      target.remove();
    });
    target.addEventListener('contextmenu', (event) => {
      openContextMenu(services, 'main/file', event);
    });
    await userEvent.click(target, { button: 'right' });
    expect(openMenus()).toEqual(['main/file']);
    await userEvent.click(document.body, { position: { x: 10, y: 700 } });
    expect(openMenus()).toEqual([]);
  });
});
