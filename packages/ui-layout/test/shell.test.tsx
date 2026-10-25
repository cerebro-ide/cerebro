import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
import { afterEach, describe, expect, it } from 'vitest';
import { DRAG_THRESHOLD, findTarget, MIN_EDITOR, ShellLayout, stripeGroups } from '../src/index.js';

const WINDOWS: ToolWindowSpec[] = [
  { id: 'project', title: 'Project', anchor: 'left', icon: 'folder' },
  { id: 'commit', title: 'Commit', anchor: 'left' },
  { id: 'structure', title: 'Structure', anchor: 'left', slot: 'secondary' },
  { id: 'terminal', title: 'Terminal', anchor: 'bottom' },
  { id: 'services', title: 'Services', anchor: 'bottom', slot: 'secondary' },
  { id: 'notifications', title: 'Notifications', anchor: 'right' },
];

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(options: { windows?: ToolWindowSpec[]; icons?: boolean } = {}) {
  const layout = new Layout();
  for (const spec of options.windows ?? WINDOWS) layout.toolWindows.register(spec);
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(container);
  const handle = render(
    () => (
      <ShellLayout
        layout={layout}
        content={(id) => <p class="test-content">{id} body</p>}
        editor={() => <p class="test-editor">editor</p>}
        {...(options.icons === false
          ? {}
          : { icon: (name: string) => <i class="test-icon">{name}</i> })}
      />
    ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const tools = layout.toolWindows;
  const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
  const button = (id: string) => $(`.cerebro-stripe-button[data-id="${id}"]`);
  const group = (anchor: string, slot: string) =>
    $(`[data-anchor="${anchor}"][data-slot="${slot}"]`);
  const ids = (anchor: string, slot: string) =>
    [...group(anchor, slot).querySelectorAll<HTMLElement>('[data-id]')].map((b) => b.dataset['id']);
  return { layout, tools, container, $, button, group, ids };
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

/** Presses on `from`, moves through `points`, and releases unless told not to. */
function drag(from: Element, points: { x: number; y: number }[], release = true) {
  const start = centre(from);
  pointer('pointerdown', start.x, start.y, from);
  for (const point of points) pointer('pointermove', point.x, point.y);
  if (release) {
    const last = points.at(-1) ?? start;
    pointer('pointerup', last.x, last.y);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('stripes', () => {
  it('lists each side’s groups top to bottom, the bottom area’s at the bottom', () => {
    const { ids, group } = mount();
    expect(stripeGroups('left').map((g) => `${g.anchor}-${g.slot}`)).toEqual([
      'left-primary',
      'left-secondary',
      'bottom-primary',
    ]);
    expect(stripeGroups('right').at(-1)).toEqual({ anchor: 'bottom', slot: 'secondary' });
    expect(ids('left', 'primary')).toEqual(['project', 'commit']);
    expect(ids('left', 'secondary')).toEqual(['structure']);
    expect(ids('bottom', 'primary')).toEqual(['terminal']);
    expect(ids('bottom', 'secondary')).toEqual(['services']);
    expect(ids('right', 'primary')).toEqual(['notifications']);
    // The bottom group sits at the bottom of the stripe.
    const stripe = group('bottom', 'primary').parentElement as HTMLElement;
    expect(group('bottom', 'primary').getBoundingClientRect().bottom).toBeCloseTo(
      stripe.getBoundingClientRect().bottom - 5,
    );
  });

  it('draws icons through the icon prop, else the title’s first letter', () => {
    const { button } = mount();
    expect(button('project').querySelector('.test-icon')?.textContent).toBe('folder');
    expect(button('commit').textContent).toBe('C');
  });

  it('shows letters when no icon prop is given', () => {
    const { button } = mount({ icons: false });
    expect(button('project').textContent).toBe('P');
  });

  it('hides a stripe with no windows, except while dragging', () => {
    const { $, button } = mount({ windows: [WINDOWS[0] as ToolWindowSpec] });
    const right = $('.cerebro-stripe--right');
    expect(right.hidden).toBe(true);
    const from = centre(button('project'));
    drag(button('project'), [{ x: from.x + 20, y: from.y + 20 }], false);
    expect(right.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(right.hidden).toBe(true);
  });
});

describe('opening and closing', () => {
  it('toggles a window with its button, showing its content', () => {
    const { tools, button, $ } = mount();
    const project = button('project');
    expect(project.getAttribute('aria-pressed')).toBe('false');
    expect($('.cerebro-area--left').hidden).toBe(true);
    project.click();
    expect(tools.isVisible('project')).toBe(true);
    expect(project.getAttribute('aria-pressed')).toBe('true');
    expect(project.classList.contains('cerebro-stripe-button--active')).toBe(true);
    expect($('.cerebro-area--left').hidden).toBe(false);
    expect($('.cerebro-tool-window[data-id="project"] .test-content').textContent).toBe(
      'project body',
    );
    project.click();
    expect(tools.isVisible('project')).toBe(false);
  });

  it('hides a window from its header', () => {
    const { tools, $ } = mount();
    tools.show('terminal');
    $('.cerebro-tool-window[data-id="terminal"] .cerebro-tool-window__hide').click();
    expect(tools.isVisible('terminal')).toBe(false);
  });

  it('replaces the window in a slot, and shows both slots split', () => {
    const { tools, $ } = mount();
    tools.show('project');
    tools.show('commit');
    expect($('.cerebro-tool-window[data-id="project"]')).toBeNull();
    tools.show('structure');
    const area = $('.cerebro-area--left');
    const panes = area.querySelectorAll<HTMLElement>('.cerebro-tool-window');
    expect([...panes].map((p) => p.dataset['id'])).toEqual(['commit', 'structure']);
    expect(area.querySelector('.cerebro-splitter--horizontal')).not.toBeNull();
    // Primary above secondary, sharing the height.
    const [top, bottom] = [...panes].map((p) => p.getBoundingClientRect());
    expect(top?.bottom).toBeLessThanOrEqual(bottom?.top ?? 0);
    expect(top?.height).toBeCloseTo(bottom?.height ?? 0, -1);
  });

  it('puts the bottom area’s slots side by side', () => {
    const { tools, $ } = mount();
    tools.show('terminal');
    tools.show('services');
    const [left, right] = [
      ...$('.cerebro-area--bottom').querySelectorAll('.cerebro-tool-window'),
    ].map((p) => p.getBoundingClientRect());
    expect(left?.right).toBeLessThanOrEqual(right?.left ?? 0);
    expect($('.cerebro-area--bottom .cerebro-splitter--vertical')).not.toBeNull();
  });

  it('places the editor and areas', () => {
    const { tools, $ } = mount();
    tools.show('project');
    tools.show('terminal');
    tools.show('notifications');
    const editor = $('.cerebro-shell__editor').getBoundingClientRect();
    expect($('.test-editor').textContent).toBe('editor');
    expect($('.cerebro-area--left').getBoundingClientRect().right).toBeLessThanOrEqual(editor.left);
    expect($('.cerebro-area--right').getBoundingClientRect().left).toBeGreaterThanOrEqual(
      editor.right,
    );
    expect($('.cerebro-area--bottom').getBoundingClientRect().top).toBeGreaterThanOrEqual(
      editor.bottom,
    );
    // The bottom area spans the full width, under the left and right areas.
    const bottom = $('.cerebro-area--bottom').getBoundingClientRect();
    expect($('.cerebro-area--left').getBoundingClientRect().bottom).toBeLessThanOrEqual(bottom.top);
    expect(bottom.left).toBe($('.cerebro-area--left').getBoundingClientRect().left);
    expect(bottom.right).toBe($('.cerebro-area--right').getBoundingClientRect().right);
    expect($('.cerebro-area--left').getBoundingClientRect().width).toBe(280);
    expect($('.cerebro-area--bottom').getBoundingClientRect().height).toBe(220);
  });
});

describe('drag and drop', () => {
  it('moves a window to another group, at the indicated position', () => {
    const { tools, button, group, ids, container } = mount();
    tools.show('commit');
    const services = button('services');
    const before = { x: centre(services).x, y: services.getBoundingClientRect().top + 3 };
    const from = centre(button('commit'));
    drag(button('commit'), [{ x: from.x + 10, y: from.y + 10 }, before], false);
    expect(container.querySelector('.cerebro-shell--dragging')).not.toBeNull();
    expect(button('commit').classList.contains('cerebro-stripe-button--dragged')).toBe(true);
    expect(services.classList.contains('cerebro-stripe-button--drop-before')).toBe(true);
    expect(document.querySelector('.cerebro-drag-ghost')?.textContent).toBe('Commit');
    pointer('pointerup', before.x, before.y);
    expect(ids('bottom', 'secondary')).toEqual(['commit', 'services']);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
    // A visible window stays visible where it lands.
    expect(tools.areas.bottom.secondary).toBe('commit');
    expect(group('left', 'primary').classList.contains('cerebro-stripe__group--drop-end')).toBe(
      false,
    );
  });

  it('marks the end of a group, including an empty one', () => {
    const { group, button, ids } = mount();
    const empty = group('right', 'secondary');
    const from = centre(button('project'));
    drag(button('project'), [{ x: from.x, y: from.y + 20 }, centre(empty)], false);
    expect(empty.classList.contains('cerebro-stripe__group--drop-end')).toBe(true);
    const point = centre(empty);
    pointer('pointerup', point.x, point.y);
    expect(ids('right', 'secondary')).toEqual(['project']);
  });

  it('reorders within a group', () => {
    const { button, ids } = mount();
    const project = button('project').getBoundingClientRect();
    const commit = button('commit').getBoundingClientRect();
    drag(button('project'), [
      { x: project.left + 5, y: project.top + 20 },
      { x: commit.left + 5, y: commit.bottom - 2 },
    ]);
    expect(ids('left', 'primary')).toEqual(['commit', 'project']);
  });

  it('drops in the nearest group from the stripe’s empty space', () => {
    const { container, button, ids } = mount();
    const spacer = container.querySelector(
      '.cerebro-stripe--left .cerebro-stripe__spacer',
    ) as HTMLElement;
    const rect = spacer.getBoundingClientRect();
    const from = centre(button('notifications'));
    drag(button('notifications'), [
      { x: from.x - 30, y: from.y + 30 },
      { x: rect.left + rect.width / 2, y: rect.bottom - 2 },
    ]);
    // Above the group's buttons, so first in it.
    expect(ids('bottom', 'primary')).toEqual(['notifications', 'terminal']);
    drag(button('notifications'), [
      { x: rect.left + 5, y: rect.top + 50 },
      { x: rect.left + rect.width / 2, y: rect.top + 2 },
    ]);
    expect(ids('left', 'secondary')).toEqual(['structure', 'notifications']);
  });

  it('finds no target outside the stripes', () => {
    const { tools, button, $ } = mount();
    const editor = centre($('.cerebro-shell__editor'));
    expect(findTarget(editor.x, editor.y)).toBeUndefined();
    expect(findTarget(-10, -10)).toBeUndefined();
    drag(button('project'), [editor, { x: editor.x + 5, y: editor.y }]);
    expect(tools.windows.get('project')?.anchor).toBe('left');
  });

  it('is a click below the drag threshold', async () => {
    const { tools, button } = mount();
    const from = centre(button('project'));
    drag(button('project'), [{ x: from.x + DRAG_THRESHOLD - 1, y: from.y }]);
    button('project').click();
    expect(tools.isVisible('project')).toBe(true);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
    await tick();
  });

  it('ignores the click that ends a drag, then clicks normally', async () => {
    const { tools, button } = mount();
    const from = centre(button('commit'));
    drag(button('commit'), [{ x: from.x, y: from.y + 30 }, from]);
    button('commit').click();
    expect(tools.isVisible('commit')).toBe(false);
    await tick();
    button('commit').click();
    expect(tools.isVisible('commit')).toBe(true);
  });

  it('cancels with Escape or pointercancel', () => {
    const { button, ids } = mount();
    const target = centre(button('notifications'));
    const from = centre(button('project'));
    drag(button('project'), [{ x: from.x + 10, y: from.y + 10 }, target], false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(ids('left', 'primary')).toEqual(['project', 'commit']);
    drag(button('project'), [{ x: from.x + 10, y: from.y + 10 }, target], false);
    pointer('pointercancel', target.x, target.y);
    expect(ids('left', 'primary')).toEqual(['project', 'commit']);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
  });

  it('ignores buttons other than the main one', () => {
    const { button } = mount();
    const from = centre(button('project'));
    pointer('pointerdown', from.x, from.y, button('project'), 2);
    pointer('pointermove', from.x + 50, from.y + 50);
    expect(document.querySelector('.cerebro-drag-ghost')).toBeNull();
  });

  it('keeps the drag label inside the window', () => {
    const { button } = mount();
    const from = centre(button('project'));
    drag(button('project'), [{ x: from.x + 10, y: from.y + 10 }], false);
    const ghost = document.querySelector('.cerebro-drag-ghost') as HTMLElement;
    expect(ghost.getBoundingClientRect().left).toBeGreaterThan(from.x);
    pointer('pointermove', window.innerWidth - 2, window.innerHeight - 2);
    const rect = ghost.getBoundingClientRect();
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
});

describe('resizing', () => {
  function outer(container: HTMLElement, anchor: string) {
    const area = container.querySelector(`.cerebro-area--${anchor}`) as HTMLElement;
    const splitter = (
      anchor === 'left' ? area.nextElementSibling : area.previousElementSibling
    ) as HTMLElement;
    return { area, splitter };
  }

  it('resizes the left area with the pointer, and the right and bottom against it', () => {
    const { tools, container } = mount();
    tools.show('project');
    tools.show('notifications');
    tools.show('terminal');
    const left = outer(container, 'left');
    const from = centre(left.splitter);
    drag(left.splitter, [{ x: from.x + 40, y: from.y }]);
    expect(tools.areas.left.size).toBe(320);
    const right = outer(container, 'right');
    const r = centre(right.splitter);
    drag(right.splitter, [{ x: r.x - 30, y: r.y }]);
    expect(tools.areas.right.size).toBe(310);
    const bottom = outer(container, 'bottom');
    const b = centre(bottom.splitter);
    drag(bottom.splitter, [{ x: b.x, y: b.y - 50 }]);
    expect(tools.areas.bottom.size).toBe(270);
    expect(bottom.area.getBoundingClientRect().height).toBe(270);
  });

  it('keeps room for the editor, counting an open opposite area', () => {
    const { tools, container } = mount();
    tools.show('project');
    const left = outer(container, 'left');
    const main = left.splitter.parentElement as HTMLElement;
    const from = centre(left.splitter);
    drag(left.splitter, [{ x: from.x + 5000, y: from.y }]);
    expect(tools.areas.left.size).toBe(main.clientWidth - MIN_EDITOR);
    tools.show('notifications');
    drag(left.splitter, [{ x: centre(left.splitter).x + 5000, y: from.y }]);
    expect(tools.areas.left.size).toBe(main.clientWidth - tools.areas.right.size - MIN_EDITOR);
    tools.show('terminal');
    const bottom = outer(container, 'bottom');
    const b = centre(bottom.splitter);
    drag(bottom.splitter, [{ x: b.x, y: b.y - 5000 }]);
    const column = bottom.splitter.parentElement as HTMLElement;
    expect(tools.areas.bottom.size).toBe(column.clientHeight - MIN_EDITOR);
  });

  it('moves the split between two slots', () => {
    const { tools, container } = mount();
    tools.show('project');
    tools.show('structure');
    const inner = container.querySelector('.cerebro-area--left .cerebro-splitter') as HTMLElement;
    const area = inner.parentElement as HTMLElement;
    const from = centre(inner);
    drag(inner, [{ x: from.x, y: from.y + area.clientHeight * 0.2 }]);
    expect(tools.areas.left.split).toBeCloseTo(0.7, 1);
    tools.show('terminal');
    tools.show('services');
    const sideways = container.querySelector(
      '.cerebro-area--bottom .cerebro-splitter',
    ) as HTMLElement;
    const width = (sideways.parentElement as HTMLElement).clientWidth;
    const s = centre(sideways);
    drag(sideways, [{ x: s.x - width * 0.1, y: s.y }]);
    expect(tools.areas.bottom.split).toBeCloseTo(0.4, 1);
  });

  it('marks the shell while resizing, and ignores other buttons', () => {
    const { tools, container } = mount();
    tools.show('project');
    const { splitter } = outer(container, 'left');
    const from = centre(splitter);
    pointer('pointerdown', from.x, from.y, splitter, 2);
    expect(container.querySelector('.cerebro-shell--resizing')).toBeNull();
    pointer('pointerdown', from.x, from.y, splitter);
    expect(container.querySelector('.cerebro-shell--resizing')).not.toBeNull();
    pointer('pointerup', from.x, from.y);
    expect(container.querySelector('.cerebro-shell--resizing')).toBeNull();
  });
});

describe('desktop conventions', () => {
  it('uses the arrow cursor and no text selection, except in selectable content', () => {
    const { tools, button, $ } = mount();
    tools.show('project');
    for (const element of [
      button('project'),
      $('.cerebro-tool-window__hide'),
      $('.cerebro-tool-window__title'),
    ]) {
      const style = getComputedStyle(element);
      expect(style.cursor).toBe('default');
      expect(style.userSelect).toBe('none');
    }
    const content = $('.test-content');
    content.classList.add('cerebro-selectable');
    expect(getComputedStyle(content).userSelect).toBe('text');
    expect(getComputedStyle(content).cursor).toBe('text');
  });

  it('selects nothing while dragging', () => {
    const { tools, button, $ } = mount();
    tools.show('project');
    const content = $('.test-content');
    content.classList.add('cerebro-selectable');
    const from = centre(button('commit'));
    drag(button('commit'), [{ x: from.x + 20, y: from.y + 20 }], false);
    expect(getComputedStyle(content).userSelect).toBe('none');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(getComputedStyle(content).userSelect).toBe('text');
  });
});
