import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openContextMenu, openMenu, visibleEntries, type MenuHandle } from '../src/index.js';

const handles: MenuHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function setup(withKeymap = true) {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap('other');
  const ran: [string, unknown][] = [];
  const toggled = signal(true);
  const allowed = signal(false);
  const add = (id: string, label: string, extra: object = {}) =>
    commands.register({ id, label, run: (c) => ran.push([id, c]), ...extra });
  add('new', '&New');
  add('open', '&Open', { dialog: true, icon: 'folder' });
  add('toggle', '&Toggle', { checked: () => toggled.get() });
  add('disabled', 'Dis&abled', { enabled: () => allowed.get() });
  add('delete', '&Delete');
  add('dup', '&Duplicate');
  add('plain', 'Plain');
  add('one', '&1 First');
  add('r1', '&Recent One');
  add('r2', 'Recent &Two');
  keymap.bindDefault('Ctrl+N', 'new');
  const item = (menu: string, command: string, group?: string) =>
    menus.contribute({ menu, item: { command }, ...(group === undefined ? {} : { group }) });
  item('test', 'new', 'a');
  item('test', 'open', 'a');
  menus.contribute({
    menu: 'test',
    item: { submenu: 'test/recent', label: '&Recent' },
    group: 'a',
  });
  item('test', 'toggle', 'b');
  item('test', 'disabled', 'b');
  item('test', 'missing', 'b');
  item('test', 'delete', 'c');
  item('test', 'dup', 'c');
  item('test', 'plain', 'c');
  item('test', 'one', 'c');
  menus.contribute({ menu: 'test', item: { submenu: 'test/empty', label: '&Empty' }, group: 'd' });
  item('test/recent', 'r1');
  item('test/recent', 'r2');
  const icon = (name: string) => <i class="test-icon">{name}</i>;
  const services = withKeymap ? { commands, menus, keymap, icon } : { commands, menus };
  return { services, commands, menus, ran, toggled, allowed };
}

function open(...args: Parameters<typeof openMenu>) {
  const handle = openMenu(...args);
  handles.push(handle);
  return handle;
}

const popups = () => [...document.querySelectorAll<HTMLElement>('.cerebro-menu')];
const items = (popup = popups().at(-1) as HTMLElement) => [
  ...popup.querySelectorAll<HTMLElement>('.cerebro-menu-item'),
];
const labels = (popup?: HTMLElement) =>
  items(popup).map(
    (i) => (i.querySelector('.cerebro-menu-item__label') as HTMLElement).textContent,
  );
const highlighted = () =>
  (
    popups()
      .at(-1)
      ?.querySelector(
        '.cerebro-menu-item--highlighted .cerebro-menu-item__label',
      ) as HTMLElement | null
  )?.textContent;
function key(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}
const letter = (char: string, init: KeyboardEventInit = {}) =>
  key(char.toLowerCase(), { code: /\d/.test(char) ? `Digit${char}` : `Key${char}`, ...init });

describe('contents', () => {
  it('hides unregistered commands, empty submenus and stranded separators', () => {
    const { services } = setup();
    expect(visibleEntries(services, 'test')).toEqual([
      { command: 'new', label: '&New', dialog: false },
      { command: 'open', label: '&Open', dialog: true, icon: 'folder' },
      { submenu: 'test/recent', label: '&Recent' },
      { separator: true },
      { command: 'toggle', label: '&Toggle', dialog: false },
      { command: 'disabled', label: 'Dis&abled', dialog: false },
      { separator: true },
      { command: 'delete', label: '&Delete', dialog: false },
      { command: 'dup', label: '&Duplicate', dialog: false },
      { command: 'plain', label: 'Plain', dialog: false },
      { command: 'one', label: '&1 First', dialog: false },
    ]);
  });

  it('shows labels, ellipses, shortcuts, check marks, submenus and disabled items', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    expect(labels()).toEqual([
      'New',
      'Open…',
      'Recent',
      'Toggle',
      'Disabled',
      'Delete',
      'Duplicate',
      'Plain',
      '1 First',
    ]);
    const [newItem, , recent, toggle, disabled] = items();
    expect(newItem?.querySelector('.cerebro-menu-item__shortcut')?.textContent).toBe('Ctrl+N');
    expect(newItem?.querySelector('.cerebro-mnemonic')?.textContent).toBe('N');
    expect(recent?.getAttribute('aria-haspopup')).toBe('menu');
    expect(recent?.querySelector('.cerebro-menu-item__arrow svg')).not.toBeNull();
    expect(toggle?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
    expect(toggle?.querySelector('.cerebro-menu-item__check svg')).not.toBeNull();
    expect(newItem?.getAttribute('role')).toBe('menuitem');
    expect(newItem?.hasAttribute('aria-checked')).toBe(false);
    expect(disabled?.classList.contains('cerebro-menu-item--disabled')).toBe(true);
    expect(disabled?.getAttribute('aria-disabled')).toBe('true');
    expect(popups()[0]?.querySelectorAll('.cerebro-menu-separator')).toHaveLength(2);
  });

  it('shows no shortcuts without a keymap', () => {
    const { services } = setup(false);
    open(services, 'test', { x: 10, y: 10 });
    expect(items()[0]?.querySelector('.cerebro-menu-item__shortcut')?.textContent).toBe('');
  });

  it('updates checked and enabled states while open', () => {
    const { services, toggled, allowed } = setup();
    open(services, 'test', { x: 10, y: 10 });
    toggled.set(false);
    allowed.set(true);
    expect(items()[3]?.getAttribute('aria-checked')).toBe('false');
    expect(items()[4]?.classList.contains('cerebro-menu-item--disabled')).toBe(false);
  });
});

describe('keyboard', () => {
  it('moves with the arrows, wrapping and skipping separators, and Home/End', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    expect(highlighted()).toBeUndefined();
    key('ArrowDown');
    expect(highlighted()).toBe('New');
    key('ArrowUp');
    expect(highlighted()).toBe('1 First');
    key('ArrowDown');
    expect(highlighted()).toBe('New');
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(highlighted()).toBe('Toggle');
    key('End');
    expect(highlighted()).toBe('1 First');
    key('Home');
    expect(highlighted()).toBe('New');
  });

  it('runs a command with Enter or Space, closing the menu', () => {
    const { services, ran } = setup();
    const handle = open(services, 'test', { x: 10, y: 10 }, { context: 'ctx' });
    key('ArrowDown');
    key('Enter');
    expect(ran).toEqual([['new', 'ctx']]);
    expect(handle.open).toBe(false);
    expect(popups()).toHaveLength(0);
    open(services, 'test', { x: 10, y: 10 });
    key('ArrowDown');
    key(' ');
    expect(ran).toHaveLength(2);
  });

  it('opens a submenu with Right or Enter, and closes it with Left or Escape', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowRight');
    expect(popups()).toHaveLength(2);
    expect(highlighted()).toBe('Recent One');
    key('ArrowLeft');
    expect(popups()).toHaveLength(1);
    key('Enter');
    expect(popups()).toHaveLength(2);
    key('Escape');
    expect(popups()).toHaveLength(1);
    key('Escape');
    expect(popups()).toHaveLength(0);
  });

  it('reports Left at the top menu and Right on an item without a submenu', () => {
    const { services } = setup();
    const onNavigate = vi.fn();
    open(services, 'test', { x: 10, y: 10 }, { onNavigate });
    key('ArrowLeft');
    key('ArrowDown');
    key('ArrowRight');
    expect(onNavigate.mock.calls).toEqual([[-1], [1]]);
    handles.pop()?.close();
    open(services, 'test', { x: 10, y: 10 });
    key('ArrowLeft');
    key('ArrowRight');
    expect(popups()).toHaveLength(1);
  });

  it('activates by mnemonic, and cycles between items sharing one', () => {
    const { services, ran } = setup();
    open(services, 'test', { x: 10, y: 10 });
    letter('D');
    expect(highlighted()).toBe('Delete');
    letter('D');
    expect(highlighted()).toBe('Duplicate');
    letter('D');
    expect(highlighted()).toBe('Delete');
    letter('R');
    expect(popups()).toHaveLength(2);
    letter('T');
    expect(ran).toEqual([['r2', undefined]]);
    open(services, 'test', { x: 10, y: 10 });
    letter('1');
    expect(ran.at(-1)?.[0]).toBe('one');
  });

  it('does nothing for a disabled item, a letter no item uses, or Tab', () => {
    const { services, ran } = setup();
    const handle = open(services, 'test', { x: 10, y: 10 });
    letter('A');
    letter('Z');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(ran).toEqual([]);
    expect(handle.open).toBe(true);
  });

  it('keeps the keys it handles from the app, and passes on the rest', () => {
    const { services } = setup();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    open(services, 'test', { x: 10, y: 10 });
    key('ArrowDown');
    expect(seen).not.toHaveBeenCalled();
    letter('N', { ctrlKey: true });
    key('/', { code: 'Slash' });
    expect(seen).toHaveBeenCalledTimes(2);
    window.removeEventListener('keydown', seen);
  });

  it('handles an empty menu', () => {
    const { services } = setup();
    const onNavigate = vi.fn();
    const handle = open(services, 'nothing', { x: 10, y: 10 }, { onNavigate });
    key('ArrowDown');
    key('Enter');
    key('ArrowRight');
    expect(onNavigate).toHaveBeenCalledWith(1);
    expect(handle.open).toBe(true);
  });
});

describe('headings', () => {
  function withHeadings() {
    const setupped = setup();
    const { menus } = setupped;
    menus.contribute({ menu: 'view', item: { heading: 'Group By' }, group: 'a' });
    menus.contribute({ menu: 'view', item: { command: 'toggle' }, group: 'a' });
    menus.contribute({ menu: 'view', item: { heading: 'Show' }, group: 'b' });
    menus.contribute({ menu: 'view', item: { command: 'new' }, group: 'b' });
    return setupped;
  }

  it('titles a group, between its separator and its items', () => {
    const { services } = withHeadings();
    open(services, 'view', { x: 10, y: 10 });
    const popup = popups().at(-1) as HTMLElement;
    expect(
      [...popup.children].map((child) =>
        child.classList.contains('cerebro-menu-heading')
          ? `# ${String(child.textContent)}`
          : child.classList.contains('cerebro-menu-separator')
            ? '---'
            : String(child.querySelector('.cerebro-menu-item__label')?.textContent),
      ),
    ).toEqual(['# Group By', 'Toggle', '---', '# Show', 'New']);
    expect(visibleEntries(services, 'view')[0]).toEqual({ heading: 'Group By' });
  });

  it('is skipped by the keys, and can’t be chosen', () => {
    const { services, ran } = withHeadings();
    open(services, 'view', { x: 10, y: 10 });
    key('ArrowDown');
    expect(highlighted()).toBe('Toggle');
    key('ArrowDown');
    expect(highlighted()).toBe('New');
    key('ArrowDown');
    expect(highlighted()).toBe('Toggle');
    key('End');
    expect(highlighted()).toBe('New');
    // Its letter isn't a mnemonic, and clicking it does nothing.
    letter('G');
    (document.querySelector('.cerebro-menu-heading') as HTMLElement).click();
    expect(ran).toEqual([]);
    expect(popups()).toHaveLength(1);
  });
});

describe('mouse', () => {
  const enter = (element: Element, movementX = 1) =>
    element.dispatchEvent(new PointerEvent('pointermove', { movementX }));

  it('highlights on hover, opens submenus, and closes them on another item', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    const [first, , recent] = items();
    enter(first as HTMLElement);
    expect(highlighted()).toBe('New');
    enter(recent as HTMLElement);
    expect(popups()).toHaveLength(2);
    const sub = popups()[1];
    enter(recent as HTMLElement);
    expect(popups()[1]).toBe(sub);
    // A pointer that hasn't moved (the menu appeared under it) changes nothing.
    enter(first as HTMLElement, 0);
    expect(popups()).toHaveLength(2);
    enter(first as HTMLElement);
    expect(popups()).toHaveLength(1);
  });

  it('keeps an open submenu open when its item is clicked again', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    (items()[2] as HTMLElement).click();
    const sub = popups()[1];
    (items(popups()[0])[2] as HTMLElement).click();
    expect(popups()[1]).toBe(sub);
  });

  it('runs commands and opens submenus on click', () => {
    const { services, ran } = setup();
    open(services, 'test', { x: 10, y: 10 });
    (items()[2] as HTMLElement).click();
    expect(popups()).toHaveLength(2);
    (items()[0] as HTMLElement).click();
    expect(ran).toEqual([['r1', undefined]]);
  });

  it('closes on a press outside, not inside', () => {
    const { services } = setup();
    const onClose = vi.fn();
    const handle = open(services, 'test', { x: 10, y: 10 }, { onClose });
    items()[0]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(handle.open).toBe(true);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(handle.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    handle.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the window loses focus or resizes', () => {
    const { services } = setup();
    const first = open(services, 'test', { x: 10, y: 10 });
    window.dispatchEvent(new Event('blur'));
    expect(first.open).toBe(false);
    const second = open(services, 'test', { x: 10, y: 10 });
    window.dispatchEvent(new Event('resize'));
    expect(second.open).toBe(false);
  });

  it('gives focus back when it closes', () => {
    const { services } = setup();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    open(services, 'test', { x: 10, y: 10 });
    key('Escape');
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

describe('placement', () => {
  const rect = () => (popups().at(-1) as HTMLElement).getBoundingClientRect();

  it('opens at a point, flipping at the window’s right and bottom', () => {
    const { services } = setup();
    open(services, 'test', { x: 20, y: 30 });
    expect(rect().left).toBe(20);
    expect(rect().top).toBe(30);
    handles.pop()?.close();
    open(services, 'test', { x: window.innerWidth - 5, y: window.innerHeight - 5 });
    expect(rect().right).toBeCloseTo(window.innerWidth - 5, 0);
    expect(rect().bottom).toBeCloseTo(window.innerHeight - 5, 0);
  });

  it('stays inside the window', () => {
    const { services } = setup();
    open(services, 'test', { x: 5, y: window.innerHeight - 20 });
    expect(rect().top).toBeGreaterThanOrEqual(0);
    handles.pop()?.close();
    const tall = setup();
    for (let i = 0; i < 60; i++) {
      tall.commands.register({ id: `x${String(i)}`, label: `X${String(i)}`, run: () => undefined });
      tall.menus.contribute({ menu: 'tall', item: { command: `x${String(i)}` } });
    }
    open(tall.services, 'tall', { x: 5, y: 300 });
    expect(rect().top).toBe(0);
  });

  it('opens below an anchor, or above it without room', () => {
    const { services } = setup();
    const anchor = document.createElement('div');
    anchor.style.cssText = 'position: fixed; left: 100px; top: 50px; width: 40px; height: 20px;';
    document.body.append(anchor);
    open(services, 'test', { anchor, placement: 'below' });
    expect(rect().left).toBe(100);
    expect(rect().top).toBe(70);
    handles.pop()?.close();
    anchor.style.top = `${String(window.innerHeight - 30)}px`;
    open(services, 'test', { anchor, placement: 'below' });
    expect(rect().bottom).toBeCloseTo(window.innerHeight - 30, 0);
    anchor.remove();
  });

  it('opens submenus to the right, or to the left without room', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    letter('R');
    const [parent, sub] = popups().map((p) => p.getBoundingClientRect()) as [DOMRect, DOMRect];
    expect(sub.left).toBeCloseTo(parent.right, 0);
    handles.pop()?.close();
    open(services, 'test', { x: window.innerWidth - 5, y: 10 });
    letter('R');
    const [parent2, sub2] = popups().map((p) => p.getBoundingClientRect()) as [DOMRect, DOMRect];
    expect(sub2.right).toBeCloseTo(parent2.left, 0);
  });
});

describe('context menus', () => {
  it('opens at the pointer for a context, suppressing the browser’s menu', () => {
    const { services, ran } = setup();
    const event = new MouseEvent('contextmenu', { clientX: 40, clientY: 60, cancelable: true });
    handles.push(openContextMenu(services, 'test', event, { tab: 'a' }));
    expect(event.defaultPrevented).toBe(true);
    expect(popups()[0]?.getBoundingClientRect().left).toBe(40);
    letter('N');
    expect(ran).toEqual([['new', { tab: 'a' }]]);
  });
});

describe('opening options', () => {
  it('highlights the first item', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 }, { focusFirst: true });
    expect(highlighted()).toBe('New');
  });

  it('opens with a submenu open', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 }, { submenu: 'test/recent' });
    expect(popups()).toHaveLength(2);
    expect(highlighted()).toBe('Recent One');
  });

  it('ignores a submenu it doesn’t have', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 }, { submenu: 'nope' });
    expect(popups()).toHaveLength(1);
    expect(highlighted()).toBeUndefined();
  });
});

describe('icons', () => {
  it('draws a command’s icon in the check column, through the services', () => {
    const { services } = setup();
    open(services, 'test', { x: 10, y: 10 });
    const [, openItem, , toggle] = items();
    expect(openItem?.querySelector('.cerebro-menu-item__check .test-icon')?.textContent).toBe(
      'folder',
    );
    expect(toggle?.querySelector('.cerebro-menu-item__check svg')).not.toBeNull();
  });

  it('draws no icons without an icon callback', () => {
    const { services } = setup(false);
    open(services, 'test', { x: 10, y: 10 });
    expect(items()[1]?.querySelector('.cerebro-menu-item__check')?.children).toHaveLength(0);
  });
});
