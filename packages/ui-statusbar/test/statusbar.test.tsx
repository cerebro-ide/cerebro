import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '../src/styles.css';
import { CommandRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusBar, StatusBarView, type Progress } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(bar: StatusBar, extra: Partial<Parameters<typeof StatusBarView>[0]> = {}) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0;';
  document.body.append(container);
  const handle = render(() => <StatusBarView bar={bar} {...extra} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const item = (id: string) => container.querySelector(`[data-id="${id}"]`) as HTMLElement;
  const ids = (side: string) =>
    [...container.querySelectorAll<HTMLElement>(`.cerebro-statusbar__side--${side} [data-id]`)].map(
      (e) => e.dataset['id'],
    );
  return { container, item, ids };
}

describe('StatusBar', () => {
  it('sorts each side by order, then contribution, right by default', () => {
    const bar = new StatusBar();
    bar.add({ id: 'encoding', text: () => 'UTF-8', order: 2 });
    bar.add({ id: 'env', side: 'left', text: () => 'cerebro' });
    bar.add({ id: 'position', text: () => '1:1', order: 1 });
    bar.add({ id: 'separator', text: () => 'LF', order: 2 });
    bar.add({ id: 'file', side: 'left', text: () => 'main.ts', order: 1 });
    expect(bar.side('left').map((i) => i.id)).toEqual(['env', 'file']);
    expect(bar.side('right').map((i) => i.id)).toEqual(['position', 'encoding', 'separator']);
  });

  it('rejects a duplicate id, and removes an item on dispose', () => {
    const bar = new StatusBar();
    const handle = bar.add({ id: 'a', text: () => 'A' });
    expect(() => bar.add({ id: 'a', text: () => 'A' })).toThrow('already added');
    handle.dispose();
    handle.dispose();
    expect(bar.side('right')).toEqual([]);
  });
});

describe('StatusBarView', () => {
  it('lays items out on both sides, spanning the width', () => {
    const bar = new StatusBar();
    bar.add({ id: 'env', side: 'left', text: () => 'cerebro' });
    bar.add({ id: 'encoding', text: () => 'UTF-8' });
    const { container, item, ids } = mount(bar);
    expect(ids('left')).toEqual(['env']);
    expect(ids('right')).toEqual(['encoding']);
    expect(item('env').getBoundingClientRect().left).toBeLessThan(20);
    expect(item('encoding').getBoundingClientRect().right).toBeGreaterThan(
      container.clientWidth - 20,
    );
    expect(item('encoding').tagName).toBe('SPAN');
  });

  it('updates text, and items as they come and go', () => {
    const bar = new StatusBar();
    const file = signal('a.ts');
    bar.add({ id: 'file', text: () => file.get() });
    const { item, ids } = mount(bar);
    file.set('b.ts');
    expect(item('file').textContent).toBe('b.ts');
    const handle = bar.add({ id: 'more', text: () => 'more' });
    expect(ids('right')).toEqual(['file', 'more']);
    handle.dispose();
    expect(ids('right')).toEqual(['file']);
  });

  it('runs an item’s command on click, as a button', () => {
    const bar = new StatusBar();
    const commands = new CommandRegistry();
    const run = vi.fn();
    commands.register({ id: 'encoding.change', label: 'Change Encoding', run });
    bar.add({ id: 'encoding', text: () => 'UTF-8', command: 'encoding.change' });
    const { item } = mount(bar, { commands });
    expect(item('encoding').tagName).toBe('BUTTON');
    item('encoding').click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is not clickable without a command registry', () => {
    const bar = new StatusBar();
    bar.add({ id: 'encoding', text: () => 'UTF-8', command: 'encoding.change' });
    const { item } = mount(bar);
    expect(item('encoding').tagName).toBe('SPAN');
  });

  it('draws icons through the icon prop only', () => {
    const bar = new StatusBar();
    bar.add({ id: 'git', text: () => 'main', icon: 'branch' });
    const first = mount(bar, { icon: (name) => <i class="test-icon">{name}</i> });
    expect(first.item('git').querySelector('.test-icon')?.textContent).toBe('branch');
    cleanup?.();
    const second = mount(bar);
    expect(second.item('git').querySelector('.cerebro-statusbar__icon')).toBeNull();
  });

  it('shows progress, determinate or not, and hides it when done', () => {
    const bar = new StatusBar();
    const progress = signal<Progress>(0.25);
    bar.add({ id: 'task', side: 'left', text: () => 'Indexing', progress: () => progress.get() });
    const { item } = mount(bar);
    const element = item('task').querySelector('[role="progressbar"]') as HTMLElement;
    const fill = element.querySelector('.cerebro-statusbar__progress-fill') as HTMLElement;
    expect(element.getAttribute('aria-valuenow')).toBe('25');
    expect(fill.style.width).toBe('25%');
    progress.set(2);
    expect(fill.style.width).toBe('100%');
    progress.set('indeterminate');
    expect(element.classList.contains('cerebro-statusbar__progress--indeterminate')).toBe(true);
    expect(element.hasAttribute('aria-valuenow')).toBe(false);
    expect(fill.style.width).toBe('');
    progress.set(undefined);
    expect(element.hidden).toBe(true);
  });

  it('shows a tooltip with the command’s shortcut, above the item', () => {
    vi.useFakeTimers();
    const bar = new StatusBar();
    const commands = new CommandRegistry();
    commands.register({ id: 'go', label: 'Go', run: () => undefined });
    bar.add({ id: 'pos', text: () => '1:1', tooltip: () => 'Go to Line', command: 'go' });
    bar.add({ id: 'plain', text: () => 'LF', tooltip: () => 'Line Separator' });
    bar.add({ id: 'silent', text: () => 'x' });
    const { item } = mount(bar, {
      commands,
      shortcut: (id) => (id === 'go' ? 'Ctrl+G' : undefined),
    });
    const hover = (id: string) => {
      item(id).dispatchEvent(new PointerEvent('pointerenter'));
      vi.advanceTimersByTime(SHOW_DELAY);
      const tip = document.querySelector('.cerebro-tooltip');
      const result = { text: tip?.textContent, bottom: tip?.getBoundingClientRect().bottom };
      item(id).dispatchEvent(new PointerEvent('pointerleave'));
      vi.advanceTimersByTime(1000);
      return result;
    };
    const pos = hover('pos');
    expect(pos.text).toBe('Go to LineCtrl+G');
    expect(pos.bottom).toBeLessThanOrEqual(item('pos').getBoundingClientRect().top);
    expect(hover('plain').text).toBe('Line Separator');
    expect(hover('silent').text).toBeUndefined();
    cleanup?.();
    const noShortcuts = mount(bar, { commands });
    noShortcuts.item('pos').dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(SHOW_DELAY);
    expect(document.querySelector('.cerebro-tooltip')?.textContent).toBe('Go to Line');
    noShortcuts.item('pos').dispatchEvent(new PointerEvent('pointerleave'));
    vi.useRealTimers();
  });
});
