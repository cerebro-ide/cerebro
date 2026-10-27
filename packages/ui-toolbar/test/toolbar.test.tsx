import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '../src/styles.css';
import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { render, type Child } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  badgeColour,
  FullScreenButtons,
  initials,
  MainToolbar,
  ToolbarButton,
  ToolbarDropdown,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(fn: () => Child) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; right: 0;';
  document.body.append(container);
  const handle = render(fn, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return container;
}

function setup() {
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const ran: [string, unknown][] = [];
  const allowed = signal(true);
  commands.register({
    id: 'settings',
    label: 'Se&ttings',
    dialog: true,
    enabled: () => allowed.get(),
    run: () => ran.push(['settings', undefined]),
  });
  for (const id of ['one', 'two']) {
    commands.register({ id, label: id, run: (c) => ran.push([id, c]) });
    menus.contribute({ menu: 'pick', item: { command: id } });
  }
  return { commands, menus, ran, allowed };
}

const menus = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-menu')].map((m) => m.dataset['menu']);
const press = (element: Element, button = 0) =>
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button }));
const key = (element: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
};

describe('initials and badge colours', () => {
  it('takes two initials, from two words or one', () => {
    expect(initials('data-viz')).toBe('DV');
    expect(initials('cerebro')).toBe('CE');
    expect(initials('cerebro-agent-1')).toBe('CA');
    expect(initials('x')).toBe('X');
    expect(initials('')).toBe('');
    expect(initials('עורך קוד')).toBe('עק');
  });

  it('gives a name the same colour every time', () => {
    expect(badgeColour('cerebro')).toBe(badgeColour('cerebro'));
    expect(badgeColour('cerebro')).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(badgeColour)).size).toBeGreaterThan(
      1,
    );
  });
});

describe('MainToolbar', () => {
  it('lays out a left and a right side, the right being optional', () => {
    const container = mount(() => (
      <MainToolbar
        left={() => <span class="l">left</span>}
        right={() => <span class="r">right</span>}
      />
    ));
    const left = (container.querySelector('.l') as HTMLElement).getBoundingClientRect();
    const right = (container.querySelector('.r') as HTMLElement).getBoundingClientRect();
    expect(left.left).toBeLessThan(20);
    expect(right.right).toBeGreaterThan(container.clientWidth - 20);
    cleanup?.();
    const only = mount(() => <MainToolbar left={() => 'left'} />);
    expect(only.querySelector('.cerebro-toolbar__side--right')?.textContent).toBe('');
  });
});

describe('ToolbarButton', () => {
  it('runs its command, named after it, disabled while it is', () => {
    const { commands, ran, allowed } = setup();
    const container = mount(() => (
      <ToolbarButton commands={commands} command="settings" icon={<i>gear</i>} />
    ));
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Settings…');
    button.click();
    expect(ran).toEqual([['settings', undefined]]);
    allowed.set(false);
    expect(button.disabled).toBe(true);
  });

  it('passes its context to its command, to run and to be enabled', () => {
    const { commands, ran } = setup();
    const seen: unknown[] = [];
    commands.register({
      id: 'scoped',
      label: 'Scoped',
      enabled: (context) => {
        seen.push(context);
        return context === 'here';
      },
      run: (context) => ran.push(['scoped', context]),
    });
    const container = mount(() => (
      <ToolbarButton commands={commands} command="scoped" icon="s" context={() => 'here'} />
    ));
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(ran).toEqual([['scoped', 'here']]);
    expect(seen).toContain('here');
  });

  it('falls back to the command id for an unknown command', () => {
    const { commands } = setup();
    const container = mount(() => <ToolbarButton commands={commands} command="missing" icon="?" />);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('missing');
    expect(button.disabled).toBe(true);
  });

  it('names the command and its shortcut in a tooltip', () => {
    vi.useFakeTimers();
    const { commands } = setup();
    const container = mount(() => (
      <ToolbarButton
        commands={commands}
        command="settings"
        icon="⚙"
        shortcut={() => 'Ctrl+Alt+S'}
      />
    ));
    const button = container.querySelector('button') as HTMLElement;
    button.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(document.querySelector('.cerebro-tooltip')?.textContent).toBe('Settings…Ctrl+Alt+S');
    button.dispatchEvent(new PointerEvent('pointerleave'));
    cleanup?.();
    const plain = mount(() => <ToolbarButton commands={commands} command="settings" icon="⚙" />);
    const second = plain.querySelector('button') as HTMLElement;
    second.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(document.querySelector('.cerebro-tooltip')?.textContent).toBe('Settings…');
    second.dispatchEvent(new PointerEvent('pointerleave'));
    vi.useRealTimers();
  });
});

describe('ToolbarDropdown', () => {
  function dropdown(extra: Partial<Parameters<typeof ToolbarDropdown>[0]> = {}) {
    const { commands, menus: registry, ran } = setup();
    const value = signal('one');
    const container = mount(() => (
      <ToolbarDropdown
        services={{ commands, menus: registry }}
        menu="pick"
        label="Choice"
        text={() => value.get()}
        context={() => 'ctx'}
        {...extra}
      />
    ));
    return { button: container.querySelector('button') as HTMLElement, ran, value };
  }

  it('opens its menu below on press, and closes on a second press', () => {
    const { button } = dropdown();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    press(button);
    expect(menus()).toEqual(['pick']);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.classList.contains('cerebro-toolbar-dropdown--open')).toBe(true);
    const popup = (document.querySelector('.cerebro-menu') as HTMLElement).getBoundingClientRect();
    expect(popup.left).toBe(button.getBoundingClientRect().left);
    expect(popup.top).toBe(button.getBoundingClientRect().bottom);
    press(button);
    expect(menus()).toEqual([]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores other mouse buttons', () => {
    const { button } = dropdown();
    press(button, 2);
    expect(menus()).toEqual([]);
  });

  it('opens from the keyboard with the first item highlighted', () => {
    const { button } = dropdown();
    for (const k of ['Enter', ' ', 'ArrowDown']) {
      expect(key(button, k).defaultPrevented).toBe(true);
      expect(document.querySelector('.cerebro-menu-item--highlighted')?.textContent).toBe('one');
      // The open menu has the keyboard now; Escape closes it.
      key(document.body, 'Escape');
      expect(menus()).toEqual([]);
    }
    expect(key(button, 'a').defaultPrevented).toBe(false);
  });

  it('runs a choice with its context, and closes', () => {
    const { button, ran } = dropdown();
    press(button);
    (document.querySelectorAll('.cerebro-menu-item')[1] as HTMLElement).click();
    expect(ran).toEqual([['two', 'ctx']]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows its text, a badge of initials or an icon, and names itself', () => {
    const { button, value } = dropdown({ badge: () => 'data viz' });
    const badge = button.querySelector('.cerebro-toolbar-dropdown__badge') as HTMLElement;
    expect(badge.textContent).toBe('DV');
    expect(badge.style.background).not.toBe('');
    expect(button.getAttribute('aria-label')).toBe('Choice: one');
    value.set('two');
    expect(button.querySelector('.cerebro-toolbar-dropdown__text')?.textContent).toBe('two');
    cleanup?.();
    const withIcon = dropdown({ icon: <i class="test-icon">branch</i> });
    expect(withIcon.button.querySelector('.test-icon')).not.toBeNull();
    expect(withIcon.button.querySelector('.cerebro-toolbar-dropdown__badge')).toBeNull();
  });

  it('opens a popup instead of a menu, closing it on a second press', async () => {
    let settle: () => void = () => undefined;
    const close = vi.fn(() => {
      settle();
    });
    const popup = vi.fn(() => ({
      close,
      result: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    }));
    const { button } = dropdown({ popup });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    press(button);
    expect(popup).toHaveBeenCalledWith(button);
    expect(menus()).toEqual([]);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    press(button);
    expect(close).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
    // Closing by itself (a choice made) frees the button for the next press.
    press(button);
    settle();
    await vi.waitFor(() => {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
    press(button);
    expect(popup).toHaveBeenCalledTimes(3);
  });

  it('names what is chosen in its tooltip', () => {
    vi.useFakeTimers();
    const { button } = dropdown();
    button.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(document.querySelector('.cerebro-tooltip')?.textContent).toBe('Choice');
    button.dispatchEvent(new PointerEvent('pointerleave'));
    vi.useRealTimers();
  });
});

describe('FullScreenButtons', () => {
  it('closes and leaves full screen, grey until the pointer is over them', async () => {
    const close = vi.fn();
    const leave = vi.fn();
    const container = mount(() => <FullScreenButtons close={close} leave={leave} />);
    const buttons = [...container.querySelectorAll<HTMLElement>('.cerebro-fullscreen-button')];
    const colours = () => buttons.map((b) => getComputedStyle(b).backgroundColor);
    const grey = 'rgb(87, 90, 92)';
    expect(colours()).toEqual([grey, grey, grey]);
    await userEvent.hover(buttons[0] as HTMLElement);
    // Close red, minimize still grey (it can't be done in full screen), leaving green.
    expect(colours()).toEqual(['rgb(255, 95, 87)', grey, 'rgb(40, 200, 64)']);
    expect(getComputedStyle(buttons[0]?.querySelector('svg') as Element).visibility).toBe(
      'visible',
    );
    await userEvent.click(container.querySelector('[aria-label="Close"]') as HTMLElement);
    expect(close).toHaveBeenCalledOnce();
    await userEvent.click(
      container.querySelector('[aria-label="Exit Full Screen"]') as HTMLElement,
    );
    expect(leave).toHaveBeenCalledOnce();
  });
});
