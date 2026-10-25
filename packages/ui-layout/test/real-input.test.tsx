// Dragging with the real mouse (Playwright's, through Vitest). Positions are the window's, given
// relative to the body, so each drag goes exactly where it says.

import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import '../src/styles.css';
import { render, type Child } from '@cerebro-ide/jsx';
import { EditorArea, Environments, Layout, type EditorNode } from '@cerebro-ide/layout';
import { userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorAreaView, EnvironmentTabs, ShellLayout, SPLIT_EDGE } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(fn: () => Child) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; inset: 0;';
  document.body.append(container);
  const handle = render(fn, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return container;
}

/** A point in the window, as a position relative to the body. */
function at(x: number, y: number) {
  const body = document.body.getBoundingClientRect();
  return { x: x - body.left, y: y - body.top };
}

function centre(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** Presses at `from`, moves to `to` and releases, with the real mouse. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
  await userEvent.dragAndDrop(document.body, document.body, {
    sourcePosition: at(from.x, from.y),
    targetPosition: at(to.x, to.y),
  });
}

function shape(node: EditorNode): string {
  if (node.kind === 'group') return `[${node.tabs.map((t) => t.id).join(',')}]`;
  return `${node.orientation === 'horizontal' ? 'h' : 'v'}(${node.children.map(shape).join(' ')})`;
}

describe('dragging, with the real mouse', () => {
  it('reorders environment tabs', async () => {
    const envs = new Environments();
    for (const id of ['a', 'b', 'c']) envs.openOrActivate({ id, name: id, branch: 'main' });
    const container = mount(() => <EnvironmentTabs environments={envs} />);
    const tab = (id: string) => container.querySelector(`[data-env="${id}"]`) as HTMLElement;
    const c = tab('c').getBoundingClientRect();
    await drag(centre(tab('a')), { x: c.right - 5, y: c.top + c.height / 2 });
    expect(envs.open.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    // The drag didn't count as a click on the tab it started on.
    expect(envs.activeId).toBe('c');
  });

  it('moves a tool window to another stripe', async () => {
    const layout = new Layout();
    layout.toolWindows.register({ id: 'project', title: 'Project', anchor: 'left' });
    layout.toolWindows.register({ id: 'notes', title: 'Notes', anchor: 'right' });
    const container = mount(() => (
      <ShellLayout
        layout={layout}
        content={(id) => id}
        editor={() => 'editor'}
        icon={(name) => name}
      />
    ));
    const button = container.querySelector('[data-id="project"]') as HTMLElement;
    const right = container.querySelector(
      '[data-anchor="right"][data-slot="primary"]',
    ) as HTMLElement;
    const notes = (right.querySelector('[data-id="notes"]') as HTMLElement).getBoundingClientRect();
    await drag(centre(button), { x: notes.left + notes.width / 2, y: notes.bottom - 2 });
    expect(layout.toolWindows.windows.get('project')?.anchor).toBe('right');
    expect(layout.toolWindows.group('right', 'primary').map((w) => w.id)).toEqual([
      'notes',
      'project',
    ]);
  });

  it('splits an editor group when a tab is dropped near its edge', async () => {
    const area = new EditorArea();
    for (const id of ['a', 'b']) area.open({ id, title: id });
    const container = mount(() => <EditorAreaView area={area} content={(t) => t.id} />);
    const group = area.activeGroupId;
    const tab = container.querySelector(`[data-tab="a"]`) as HTMLElement;
    const content = (
      container.querySelector(`[data-content="${group}"]`) as HTMLElement
    ).getBoundingClientRect();
    await drag(centre(tab), {
      x: content.right - (content.width * SPLIT_EDGE) / 2,
      y: content.top + content.height / 2,
    });
    expect(shape(area.root)).toBe('h([b] [a])');
  });
});
