import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { onCleanup, render } from '@cerebro-ide/jsx';
import { EditorArea, EditorGroup, type EditorNode } from '@cerebro-ide/layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAG_THRESHOLD, EditorAreaView, findTabTarget, SPLIT_EDGE } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const tab = (id: string) => ({ id, title: id });

/** A compact picture of the tree: groups as [tabs], splits as h(...) or v(...). */
function shape(node: EditorNode): string {
  if (node instanceof EditorGroup) return `[${node.tabs.map((t) => t.id).join(',')}]`;
  return `${node.orientation === 'horizontal' ? 'h' : 'v'}(${node.children.map(shape).join(' ')})`;
}

function mount(tabs: string[] = ['a', 'b', 'c'], options: { empty?: boolean } = {}) {
  const area = new EditorArea();
  for (const id of tabs) area.open(tab(id));
  const disposed: string[] = [];
  const content = vi.fn((t: { id: string }) => {
    onCleanup(() => disposed.push(t.id));
    return <p class="test-content">{t.id} content</p>;
  });
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(container);
  const handle = render(
    () => (
      <EditorAreaView
        area={area}
        content={content}
        {...(options.empty === false ? {} : { empty: () => <p class="test-empty">empty</p> })}
      />
    ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const tabEl = (id: string, group = area.groups[0]?.id) =>
    $(`[data-group="${String(group)}"] [data-tab="${id}"]`);
  const strip = (group: string) => $(`[data-strip="${group}"]`);
  const contentEl = (group: string) => $(`[data-content="${group}"]`);
  return {
    area,
    container,
    content,
    disposed,
    $,
    tabEl,
    strip,
    contentEl,
    dispose: () => {
      handle.dispose();
    },
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

function drag(from: Element, points: { x: number; y: number }[], release = true) {
  const start = centre(from);
  pointer('pointerdown', start.x, start.y, from);
  pointer('pointermove', start.x + DRAG_THRESHOLD + 10, start.y + DRAG_THRESHOLD + 10);
  for (const point of points) pointer('pointermove', point.x, point.y);
  if (release) {
    const last = points.at(-1) ?? start;
    pointer('pointerup', last.x, last.y);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('rendering', () => {
  it('shows tabs and the active tab’s content', () => {
    const { area, $, tabEl, content } = mount();
    expect(shape(area.root)).toBe('[a,b,c]');
    expect(tabEl('c').classList.contains('cerebro-editor-tab--active')).toBe(true);
    expect(tabEl('c').getAttribute('aria-selected')).toBe('true');
    expect(tabEl('a').getAttribute('aria-selected')).toBe('false');
    expect($('.test-content').textContent).toBe('c content');
    expect(content).toHaveBeenCalledTimes(1);
    expect($('.cerebro-editor-group').classList.contains('cerebro-editor-group--active')).toBe(
      true,
    );
  });

  it('shows the empty content without tabs, or nothing without one', () => {
    const { $ } = mount([]);
    expect($('.test-empty').textContent).toBe('empty');
    cleanup?.();
    const second = mount([], { empty: false });
    expect(second.$('.cerebro-editor-content').textContent).toBe('');
  });

  it('renders nested splits, with groups side by side or stacked', () => {
    const { area, container } = mount(['a']);
    const first = area.activeGroupId;
    const right = area.split(first, 'right', 'a');
    area.split(right.id, 'down', 'a');
    expect(container.querySelector('.cerebro-editor-split--horizontal')).not.toBeNull();
    expect(container.querySelector('.cerebro-editor-split--vertical')).not.toBeNull();
    const groups = [...container.querySelectorAll('.cerebro-editor-group')].map((g) =>
      g.getBoundingClientRect(),
    );
    expect(groups).toHaveLength(3);
    const [left, top, bottom] = groups as [DOMRect, DOMRect, DOMRect];
    expect(left.right).toBeLessThanOrEqual(top.left);
    expect(top.bottom).toBeLessThanOrEqual(bottom.top);
  });
});

describe('activating and closing', () => {
  it('activates a tab on click, and its group', () => {
    const { area, tabEl, $ } = mount(['a']);
    const first = area.activeGroupId;
    const right = area.split(first, 'right', 'a');
    area.open(tab('b'), right.id);
    tabEl('a', first).click();
    expect(area.activeGroupId).toBe(first);
    tabEl('a', right.id).click();
    expect(area.group(right.id).active).toBe('a');
    expect($(`[data-group="${right.id}"] .test-content`).textContent).toBe('a content');
  });

  it('activates a group when its content is pressed', () => {
    const { area, contentEl } = mount(['a']);
    const first = area.activeGroupId;
    area.split(first, 'right', 'a');
    const point = centre(contentEl(first));
    pointer('pointerdown', point.x, point.y, contentEl(first));
    expect(area.activeGroupId).toBe(first);
  });

  it('closes with the close button, without activating or dragging', () => {
    const { area, tabEl } = mount();
    const close = tabEl('a').querySelector('.cerebro-editor-tab__close') as HTMLElement;
    const point = centre(close);
    pointer('pointerdown', point.x, point.y, close);
    pointer('pointermove', point.x + 40, point.y + 40);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
    pointer('pointerup', point.x + 40, point.y + 40);
    close.click();
    expect(shape(area.root)).toBe('[b,c]');
    expect(area.activeGroup.active).toBe('c');
  });

  it('closes with a middle-click, and ignores other buttons', () => {
    const { area, tabEl } = mount();
    tabEl('b').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    expect(shape(area.root)).toBe('[a,b,c]');
    tabEl('b').dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(shape(area.root)).toBe('[a,c]');
  });
});

describe('group views', () => {
  it('keeps a group’s content through splits and moves elsewhere', () => {
    const { area, container, content } = mount(['a', 'b']);
    const first = area.activeGroupId;
    const before = container.querySelector(`[data-group="${first}"] .test-content`);
    area.moveToSplit('a', first, first, 'right');
    const right = area.activeGroupId;
    area.split(right, 'down', 'a');
    expect(container.querySelector(`[data-group="${first}"] .test-content`)).toBe(before);
    expect(content.mock.calls.filter(([t]) => t.id === 'b')).toHaveLength(1);
  });

  it('disposes the view of a group that is gone, and all views on dispose', () => {
    const { area, disposed, dispose } = mount(['a', 'b']);
    const first = area.activeGroupId;
    area.moveToSplit('b', first, first, 'right');
    // The first group now shows a, so its b content is disposed.
    expect(disposed).toEqual(['b']);
    const right = area.activeGroupId;
    area.close(right, 'b');
    // The right group is gone, and its view with it.
    expect(disposed).toEqual(['b', 'b']);
    dispose();
    expect(disposed).toEqual(['b', 'b', 'a']);
  });
});

describe('dragging tabs', () => {
  it('reorders within a strip, showing where', () => {
    const { area, tabEl, strip } = mount();
    const group = area.activeGroupId;
    const c = tabEl('c').getBoundingClientRect();
    drag(tabEl('a'), [{ x: c.left + 3, y: c.top + c.height / 2 }], false);
    expect(tabEl('a').classList.contains('cerebro-editor-tab--dragged')).toBe(true);
    expect(tabEl('c').classList.contains('cerebro-editor-tab--drop-before')).toBe(true);
    pointer('pointermove', c.right + 50, c.top + c.height / 2);
    expect(strip(group).classList.contains('cerebro-editor-tabs--drop-end')).toBe(true);
    pointer('pointerup', c.right + 50, c.top + c.height / 2);
    expect(shape(area.root)).toBe('[b,c,a]');
  });

  it('moves into another group’s strip at a position, or into its content', () => {
    const { area, tabEl, contentEl } = mount(['a', 'b', 'c']);
    const first = area.activeGroupId;
    const right = area.split(first, 'right', 'c');
    const target = tabEl('c', right.id).getBoundingClientRect();
    drag(tabEl('a', first), [{ x: target.left + 2, y: target.top + target.height / 2 }]);
    expect(shape(area.root)).toBe('h([b,c] [a,c])');
    drag(tabEl('b', first), [centre(contentEl(right.id))], false);
    expect(
      contentEl(right.id).querySelector('.cerebro-editor-drop')?.getAttribute('data-zone'),
    ).toBe('center');
    const point = centre(contentEl(right.id));
    pointer('pointerup', point.x, point.y);
    expect(shape(area.root)).toBe('h([c] [a,c,b])');
  });

  it('leaves a tab dropped on its own group’s content where it was', () => {
    const { area, tabEl, contentEl } = mount();
    drag(tabEl('a'), [centre(contentEl(area.activeGroupId))]);
    expect(shape(area.root)).toBe('[a,b,c]');
  });

  it('splits a group when dropped near an edge, showing the half it will take', () => {
    const cases = [
      ['left', 'h([a] [b,c])'],
      ['right', 'h([b,c] [a])'],
      ['up', 'v([a] [b,c])'],
      ['down', 'v([b,c] [a])'],
    ] as const;
    for (const [direction, expected] of cases) {
      const { area, tabEl, contentEl } = mount();
      const group = area.activeGroupId;
      const rect = contentEl(group).getBoundingClientRect();
      const inset = SPLIT_EDGE / 2;
      const point = {
        left: { x: rect.left + rect.width * inset, y: rect.top + rect.height / 2 },
        right: { x: rect.right - rect.width * inset, y: rect.top + rect.height / 2 },
        up: { x: rect.left + rect.width / 2, y: rect.top + rect.height * inset },
        down: { x: rect.left + rect.width / 2, y: rect.bottom - rect.height * inset },
      }[direction];
      drag(tabEl('a'), [point], false);
      const overlay = contentEl(group).querySelector('.cerebro-editor-drop') as HTMLElement;
      expect(overlay.hidden).toBe(false);
      expect(overlay.dataset['zone']).toBe(direction);
      pointer('pointerup', point.x, point.y);
      expect(shape(area.root)).toBe(expected);
      expect(overlay.hidden).toBe(true);
      cleanup?.();
      cleanup = undefined;
    }
  });

  it('finds no target outside the editor area', () => {
    const { area, tabEl } = mount();
    expect(findTabTarget(-5, -5)).toBeUndefined();
    const outside = document.createElement('div');
    outside.style.cssText =
      'position: fixed; left: 0; top: 0; width: 20px; height: 20px; z-index: 9;';
    document.body.append(outside);
    expect(findTabTarget(10, 10)).toBeUndefined();
    drag(tabEl('a'), [{ x: 10, y: 10 }]);
    outside.remove();
    expect(shape(area.root)).toBe('[a,b,c]');
  });

  it('cancels with Escape', () => {
    const { area, tabEl, contentEl } = mount();
    const point = centre(contentEl(area.activeGroupId));
    drag(
      tabEl('a'),
      [
        { x: point.x, y: point.y + 1000 },
        { x: 999, y: point.y },
      ],
      false,
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shape(area.root)).toBe('[a,b,c]');
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
  });

  it('is a click below the threshold, and ignores the click that ends a drag', async () => {
    const { area, tabEl } = mount();
    const a = centre(tabEl('a'));
    pointer('pointerdown', a.x, a.y, tabEl('a'));
    pointer('pointermove', a.x + 1, a.y);
    pointer('pointerup', a.x + 1, a.y);
    tabEl('a').click();
    expect(area.activeGroup.active).toBe('a');
    drag(tabEl('b'), [centre(tabEl('b'))]);
    tabEl('b').click();
    expect(area.activeGroup.active).toBe('a');
    await tick();
    tabEl('b').click();
    expect(area.activeGroup.active).toBe('b');
  });

  it('ignores buttons other than the main one', () => {
    const { tabEl } = mount();
    const a = centre(tabEl('a'));
    pointer('pointerdown', a.x, a.y, tabEl('a'), 1);
    pointer('pointermove', a.x + 50, a.y + 50);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
  });
});

describe('resizing', () => {
  it('moves the line between groups', () => {
    const { area, container } = mount(['a']);
    area.split(area.activeGroupId, 'right', 'a');
    area.split(area.activeGroupId, 'down', 'a');
    const vertical = container.querySelector(
      '.cerebro-editor-split--horizontal > .cerebro-splitter',
    ) as HTMLElement;
    const width = (vertical.parentElement as HTMLElement).clientWidth;
    const from = centre(vertical);
    pointer('pointerdown', from.x, from.y, vertical);
    expect(container.querySelector('.cerebro-editor-area--resizing')).not.toBeNull();
    pointer('pointermove', from.x + width * 0.1, from.y);
    pointer('pointerup', from.x + width * 0.1, from.y);
    expect(container.querySelector('.cerebro-editor-area--resizing')).toBeNull();
    const root = area.root as { sizes: readonly number[] };
    expect(root.sizes[0]).toBeCloseTo(0.6, 1);
    const horizontal = container.querySelector(
      '.cerebro-editor-split--vertical > .cerebro-splitter',
    ) as HTMLElement;
    const height = (horizontal.parentElement as HTMLElement).clientHeight;
    const h = centre(horizontal);
    pointer('pointerdown', h.x, h.y, horizontal);
    pointer('pointermove', h.x, h.y - height * 0.2);
    pointer('pointerup', h.x, h.y - height * 0.2);
    const nested = (area.root as { children: readonly { sizes: readonly number[] }[] }).children[1];
    expect(nested?.sizes[0]).toBeCloseTo(0.3, 1);
  });
});
