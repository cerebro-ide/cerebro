import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '../src/styles.css';
import { onCleanup, render, type Child } from '@cerebro-ide/jsx';
import { Environments } from '@cerebro-ide/layout';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAG_THRESHOLD, EnvironmentEditors, EnvironmentTabs } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(fn: () => Child) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; right: 0; height: 300px;';
  document.body.append(container);
  const handle = render(fn, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return container;
}

function workspace(...ids: string[]) {
  const envs = new Environments();
  for (const id of ids) envs.openOrActivate({ id, name: id, branch: `feat/${id}` });
  return envs;
}

function tabs(container: HTMLElement) {
  const all = () => [...container.querySelectorAll<HTMLElement>('.cerebro-env-tab')];
  return {
    ids: () => all().map((t) => t.dataset['env']),
    tab: (id: string) =>
      container.querySelector(`.cerebro-env-tab[data-env="${id}"]`) as HTMLElement,
  };
}

function centre(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pointer(
  type: string,
  x: number,
  y: number,
  target: EventTarget = document.body,
  button = 0,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button,
      pointerId: 1,
    }),
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('EnvironmentTabs', () => {
  it('shows a tab per environment, with badge, name and branch, the active one marked', () => {
    const envs = workspace('a', 'b');
    const container = mount(() => (
      <EnvironmentTabs environments={envs} badge={(env) => <i class="test-badge">{env.name}</i>} />
    ));
    const { ids, tab } = tabs(container);
    expect(ids()).toEqual(['a', 'b']);
    expect(tab('a').querySelector('.test-badge')?.textContent).toBe('a');
    expect(tab('b').querySelector('.cerebro-env-tab__branch')?.textContent).toBe('feat/b');
    expect(tab('b').getAttribute('aria-selected')).toBe('true');
    expect(tab('a').classList.contains('cerebro-env-tab--active')).toBe(false);
    expect(container.querySelector('.cerebro-env-tabs__add')).toBeNull();
  });

  it('switches on click and from the keyboard', () => {
    const envs = workspace('a', 'b');
    const { tab } = tabs(mount(() => <EnvironmentTabs environments={envs} />));
    tab('a').click();
    expect(envs.activeId).toBe('a');
    for (const key of ['Enter', ' ']) {
      envs.activate('b');
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      tab('a').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(envs.activeId).toBe('a');
    }
    const other = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    tab('a').dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('closes with its button or a middle-click', () => {
    const envs = workspace('a', 'b', 'c');
    const { ids, tab } = tabs(mount(() => <EnvironmentTabs environments={envs} />));
    const close = tab('b').querySelector('.cerebro-env-tab__close') as HTMLElement;
    const at = centre(close);
    pointer('pointerdown', at.x, at.y, close);
    pointer('pointermove', at.x + 50, at.y);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
    pointer('pointerup', at.x + 50, at.y);
    close.click();
    expect(ids()).toEqual(['a', 'c']);
    tab('a').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    tab('a').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(ids()).toEqual(['c']);
  });

  it('reorders by dragging, showing where', async () => {
    const envs = workspace('a', 'b', 'c');
    const container = mount(() => <EnvironmentTabs environments={envs} />);
    const { ids, tab } = tabs(container);
    const from = centre(tab('a'));
    pointer('pointerdown', from.x, from.y, tab('a'));
    pointer('pointermove', from.x + DRAG_THRESHOLD + 5, from.y);
    const c = tab('c').getBoundingClientRect();
    pointer('pointermove', c.left + 3, from.y);
    expect(tab('a').classList.contains('cerebro-env-tab--dragged')).toBe(true);
    expect(tab('c').classList.contains('cerebro-env-tab--drop-before')).toBe(true);
    pointer('pointermove', c.right + 40, from.y);
    expect(container.querySelector('.cerebro-env-tabs__end--drop')).not.toBeNull();
    pointer('pointerup', c.right + 40, from.y);
    expect(ids()).toEqual(['b', 'c', 'a']);
    // The click that ends a drag doesn't switch; a later one does.
    tab('a').click();
    expect(envs.activeId).toBe('c');
    await tick();
    tab('a').click();
    expect(envs.activeId).toBe('a');
  });

  it('leaves the order alone when a drag is cancelled, or never starts', () => {
    const envs = workspace('a', 'b');
    const { ids, tab } = tabs(mount(() => <EnvironmentTabs environments={envs} />));
    const from = centre(tab('a'));
    pointer('pointerdown', from.x, from.y, tab('a'));
    pointer('pointermove', from.x + 200, from.y);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer('pointerdown', from.x, from.y, tab('a'), 1);
    pointer('pointermove', from.x + 200, from.y);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
    pointer('pointerup', from.x + 200, from.y);
    expect(ids()).toEqual(['a', 'b']);
  });

  it('calls back for the + button and context menus', () => {
    const envs = workspace('a');
    const onAdd = vi.fn();
    const onContextMenu = vi.fn();
    const container = mount(() => (
      <EnvironmentTabs environments={envs} onAdd={onAdd} onContextMenu={onContextMenu} />
    ));
    const add = container.querySelector('.cerebro-env-tabs__add') as HTMLElement;
    add.click();
    expect(onAdd).toHaveBeenCalledWith(add);
    tabs(container)
      .tab('a')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    expect((onContextMenu.mock.calls[0] as unknown[])[1]).toBe(envs.active);
  });

  it('does nothing on a right-click without a handler', () => {
    const envs = workspace('a');
    const { tab } = tabs(mount(() => <EnvironmentTabs environments={envs} />));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    tab('a').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('names the environment and branch in a tooltip, and Close on its button', () => {
    vi.useFakeTimers();
    const envs = workspace('a');
    const container = mount(() => <EnvironmentTabs environments={envs} onAdd={() => undefined} />);
    const hover = (element: Element) => {
      element.dispatchEvent(new PointerEvent('pointerenter'));
      vi.advanceTimersByTime(SHOW_DELAY);
      const text = document.querySelector('.cerebro-tooltip')?.textContent;
      element.dispatchEvent(new PointerEvent('pointerleave'));
      vi.advanceTimersByTime(1000);
      return text;
    };
    const tab = tabs(container).tab('a');
    expect(hover(tab)).toBe('a · feat/a');
    expect(hover(tab.querySelector('.cerebro-env-tab__close') as Element)).toBe('Close');
    expect(hover(container.querySelector('.cerebro-env-tabs__add') as Element)).toBe(
      'Open Environment',
    );
    vi.useRealTimers();
  });
});

describe('EnvironmentEditors', () => {
  it('shows the active environment’s editor, keeping the others alive', () => {
    const envs = workspace('a', 'b');
    const rendered: string[] = [];
    const container = mount(() => (
      <EnvironmentEditors
        environments={envs}
        editor={(env) => {
          rendered.push(env.id);
          return <p class="test-editor">{env.id}</p>;
        }}
      />
    ));
    const visible = () =>
      [
        ...container.querySelectorAll<HTMLElement>(
          '.cerebro-env-editor:not([hidden]) .test-editor',
        ),
      ].map((e) => e.textContent);
    expect(visible()).toEqual(['b']);
    const aView = container.querySelector('.cerebro-env-editor[data-env="a"] .test-editor');
    envs.activate('a');
    expect(visible()).toEqual(['a']);
    envs.activate('b');
    envs.activate('a');
    expect(container.querySelector('.cerebro-env-editor[data-env="a"] .test-editor')).toBe(aView);
    expect(rendered).toEqual(['a', 'b']);
  });

  it('disposes a closed environment’s editor, and all on dispose', () => {
    const envs = workspace('a', 'b');
    const disposed: string[] = [];
    const container = mount(() => (
      <EnvironmentEditors
        environments={envs}
        editor={(env) => {
          onCleanup(() => disposed.push(env.id));
          return env.id;
        }}
      />
    ));
    envs.close('a');
    expect(disposed).toEqual(['a']);
    expect(container.querySelector('.cerebro-env-editor[data-env="a"]')).toBeNull();
    cleanup?.();
    cleanup = undefined;
    expect(disposed).toEqual(['a', 'b']);
  });

  it('shows the empty view when none is open', () => {
    const envs = workspace('a');
    const container = mount(() => (
      <EnvironmentEditors
        environments={envs}
        editor={(env) => env.id}
        empty={() => <p class="test-empty">nothing open</p>}
      />
    ));
    expect(container.querySelector('.test-empty')).toBeNull();
    envs.close('a');
    expect(container.querySelector('.test-empty')?.textContent).toBe('nothing open');
    cleanup?.();
    const bare = mount(() => (
      <EnvironmentEditors environments={new Environments()} editor={() => null} />
    ));
    expect(bare.querySelector('.cerebro-env-empty')?.textContent).toBe('');
  });
});
