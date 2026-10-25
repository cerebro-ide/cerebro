import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
import { MenuBar } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(initiallyVisible: boolean) {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const ran: [string, unknown][] = [];
  for (const [id, label] of [
    ['new', '&New'],
    ['open', '&Open'],
    ['undo', '&Undo'],
    ['toggle', '&Toggle'],
    ['top', '&Top Level'],
  ]) {
    commands.register({
      id: id as string,
      label: label as string,
      run: (c) => ran.push([id as string, c]),
    });
  }
  const main = (label: string, submenu: string, order: number) =>
    menus.contribute({ menu: 'main', item: { submenu, label }, order });
  main('&File', 'main/file', 1);
  main('&Edit', 'main/edit', 2);
  main('&View', 'main/view', 3);
  // A command directly in the main menu isn't one of the bar's menus.
  menus.contribute({ menu: 'main', item: { command: 'top' }, order: 4 });
  menus.contribute({ menu: 'main/file', item: { command: 'new' } });
  menus.contribute({ menu: 'main/file', item: { command: 'open' } });
  menus.contribute({ menu: 'main/edit', item: { command: 'undo' } });
  menus.contribute({ menu: 'main/view', item: { command: 'toggle' } });
  const visible = signal(initiallyVisible);
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; right: 0; height: 40px;';
  document.body.append(container);
  const handle = render(
    () => (
      <MenuBar services={{ commands, menus }} visible={() => visible.get()} context={() => 'ctx'} />
    ),
    container,
  );
  let disposed = false;
  cleanup = () => {
    if (!disposed) handle.dispose();
    disposed = true;
    container.remove();
  };
  const bar = () => container.querySelector('.cerebro-menubar') as HTMLElement;
  const button = () => container.querySelector('.cerebro-menubar__button') as HTMLElement;
  const item = (index: number) =>
    container.querySelector(`.cerebro-menubar__item[data-index="${String(index)}"]`) as HTMLElement;
  return {
    visible,
    ran,
    bar,
    button,
    item,
    dispose: () => {
      handle.dispose();
      disposed = true;
    },
  };
}

const menus = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-menu')].map((m) => m.dataset['menu']);
const highlighted = () =>
  document.querySelector(
    '.cerebro-menu:last-child .cerebro-menu-item--highlighted .cerebro-menu-item__label',
  )?.textContent;

function key(key: string, init: KeyboardEventInit = {}, type = 'keydown') {
  const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}
const alt = (letter: string) => key(letter.toLowerCase(), { code: `Key${letter}`, altKey: true });
function altAlone() {
  key('Alt', { altKey: true });
  key('Alt', {}, 'keyup');
}
const press = (element: Element) =>
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
const move = (element: Element, movementX = 2) =>
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, movementX }));

describe('hidden, behind a button', () => {
  it('opens all menus from the button, and closes on a second press', () => {
    const { button } = mount(false);
    expect(button().getAttribute('aria-expanded')).toBe('false');
    press(button());
    expect(menus()).toEqual(['main']);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    press(button());
    expect(menus()).toEqual([]);
    press(button());
    key('Escape');
    expect(menus()).toEqual([]);
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens a menu with Alt and its letter', () => {
    const { button } = mount(false);
    press(button());
    expect(alt('F').defaultPrevented).toBe(true);
    expect(menus()).toEqual(['main', 'main/file']);
    expect(highlighted()).toBe('New');
    expect(alt('Z').defaultPrevented).toBe(false);
  });

  it('opens with Alt alone, and closes with it', () => {
    mount(false);
    altAlone();
    expect(menus()).toEqual(['main']);
    expect(highlighted()).toBe('File');
    altAlone();
    expect(menus()).toEqual([]);
  });

  it('treats Alt with another key or modifier as not alone', () => {
    mount(false);
    key('Alt', { altKey: true, ctrlKey: true });
    key('Alt', {}, 'keyup');
    key('Alt', { altKey: true });
    key('x', { code: 'KeyX', altKey: true });
    key('Alt', {}, 'keyup');
    key('Alt', { altKey: true });
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    key('Alt', {}, 'keyup');
    key('Shift', {}, 'keyup');
    expect(menus()).toEqual([]);
  });
});

describe('visible, as a bar', () => {
  it('shows its menus with mnemonics underlined while Alt is held', () => {
    const { bar } = mount(true);
    expect([...bar().querySelectorAll('.cerebro-menubar__item')].map((i) => i.textContent)).toEqual(
      ['File', 'Edit', 'View'],
    );
    expect(bar().classList.contains('cerebro-menubar--mnemonics')).toBe(false);
    key('Alt', { altKey: true });
    expect(bar().classList.contains('cerebro-menubar--mnemonics')).toBe(true);
    key('x', { code: 'KeyX', altKey: true });
    key('Alt', {}, 'keyup');
    expect(bar().classList.contains('cerebro-menubar--mnemonics')).toBe(false);
  });

  it('opens a menu below its name on press, and closes on a second press', () => {
    const { item } = mount(true);
    press(item(1));
    expect(menus()).toEqual(['main/edit']);
    expect(item(1).getAttribute('aria-expanded')).toBe('true');
    const name = item(1).getBoundingClientRect();
    const popup = (document.querySelector('.cerebro-menu') as HTMLElement).getBoundingClientRect();
    expect(popup.left).toBe(name.left);
    expect(popup.top).toBe(name.bottom);
    press(item(1));
    expect(menus()).toEqual([]);
  });

  it('switches menus when the pointer moves to another name, only while one is open', () => {
    const { item } = mount(true);
    move(item(2));
    expect(menus()).toEqual([]);
    press(item(0));
    move(item(0));
    move(item(2), 0);
    expect(menus()).toEqual(['main/file']);
    move(item(2));
    expect(menus()).toEqual(['main/view']);
  });

  it('opens with Alt and a letter, and moves with Left and Right', () => {
    mount(true);
    alt('E');
    expect(menus()).toEqual(['main/edit']);
    expect(highlighted()).toBe('Undo');
    key('ArrowRight');
    expect(menus()).toEqual(['main/view']);
    key('ArrowRight');
    expect(menus()).toEqual(['main/file']);
    key('ArrowLeft');
    expect(menus()).toEqual(['main/view']);
  });

  it('gives the bar the keyboard with Alt alone', () => {
    const { item, bar } = mount(true);
    altAlone();
    expect(item(0).classList.contains('cerebro-menubar__item--active')).toBe(true);
    expect(bar().classList.contains('cerebro-menubar--mnemonics')).toBe(true);
    key('ArrowRight');
    expect(item(1).classList.contains('cerebro-menubar__item--active')).toBe(true);
    key('ArrowLeft');
    key('ArrowLeft');
    expect(item(2).classList.contains('cerebro-menubar__item--active')).toBe(true);
    expect(key('q', { code: 'KeyQ' }).defaultPrevented).toBe(true);
    key('ArrowDown');
    expect(menus()).toEqual(['main/view']);
    key('Escape');
    altAlone();
    key('Enter');
    expect(menus()).toEqual(['main/file']);
    key('Escape');
    altAlone();
    key(' ');
    expect(menus()).toEqual(['main/file']);
    key('Escape');
    altAlone();
    key('e', { code: 'KeyE' });
    expect(menus()).toEqual(['main/edit']);
    key('Escape');
    altAlone();
    key('Escape');
    expect(item(0).classList.contains('cerebro-menubar__item--active')).toBe(false);
    altAlone();
    altAlone();
    expect(item(0).classList.contains('cerebro-menubar__item--active')).toBe(false);
    altAlone();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(item(0).classList.contains('cerebro-menubar__item--active')).toBe(false);
  });

  it('closes an open menu with Alt alone', () => {
    mount(true);
    alt('F');
    altAlone();
    expect(menus()).toEqual([]);
  });

  it('runs commands with its context', () => {
    const { ran } = mount(true);
    alt('F');
    key('Enter');
    expect(ran).toEqual([['new', 'ctx']]);
  });
});

describe('switching modes and cleanup', () => {
  it('switches between bar and button', () => {
    const { visible, button, bar } = mount(false);
    expect(button()).not.toBeNull();
    visible.set(true);
    expect(bar().querySelector('.cerebro-menubar__button')).toBeNull();
    expect(bar().querySelectorAll('.cerebro-menubar__item')).toHaveLength(3);
  });

  it('stops listening and closes its menu when removed', () => {
    const { dispose } = mount(true);
    alt('F');
    dispose();
    expect(menus()).toEqual([]);
    expect(alt('F').defaultPrevented).toBe(false);
    expect(menus()).toEqual([]);
  });
});

describe('names without a mnemonic', () => {
  it('shows them plain, and Alt letters skip them', () => {
    const commands = new CommandRegistry();
    const menus = new MenuRegistry();
    commands.register({ id: 'a', label: 'A', run: () => undefined });
    menus.contribute({ menu: 'main', item: { submenu: 'main/window', label: 'Window' } });
    menus.contribute({ menu: 'main/window', item: { command: 'a' } });
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <MenuBar services={{ commands, menus }} visible={() => true} />,
      container,
    );
    const name = container.querySelector('.cerebro-menubar__item') as HTMLElement;
    expect(name.textContent).toBe('Window');
    expect(name.querySelector('.cerebro-mnemonic')).toBeNull();
    expect(alt('W').defaultPrevented).toBe(false);
    handle.dispose();
    container.remove();
  });
});
