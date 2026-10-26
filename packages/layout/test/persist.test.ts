// Restoring saved layouts: what's still valid is kept, the rest dropped, and the result is always
// a sound layout. (Saving and restoring valid layouts is covered by the randomized tests.)

import { describe, expect, it } from 'vitest';
import {
  EditorArea,
  EditorGroup,
  Environments,
  ToolWindows,
  type EditorNode,
} from '../src/index.js';

function shape(node: EditorNode): string {
  if (node instanceof EditorGroup) return `[${node.tabs.map((t) => t.id).join(',')}]`;
  const sizes = node.sizes.map((s) => s.toFixed(2)).join('/');
  return `${node.orientation === 'horizontal' ? 'h' : 'v'}${sizes}(${node.children.map(shape).join(' ')})`;
}

const tab = (id: string) => ({ id, title: id });
const group = (ids: string[], active?: string) => ({ kind: 'group', tabs: ids.map(tab), active });

describe('EditorArea.restore', () => {
  it('leaves one empty group for nothing valid', () => {
    for (const saved of [undefined, 5, {}, { root: 'x' }, { root: { kind: 'other' } }]) {
      const area = new EditorArea();
      area.open(tab('old'));
      area.restore(saved);
      expect(shape(area.root)).toBe('[]');
      expect(area.activeGroupId).toBe(area.groups[0]?.id);
    }
  });

  it('keeps valid, existing tabs once each, and an active one among them', () => {
    const area = new EditorArea();
    area.restore(
      {
        root: {
          kind: 'group',
          tabs: [tab('a'), tab('gone'), { id: 3 }, tab('a'), tab('b')],
          active: 'gone',
        },
      },
      (t) => t.id !== 'gone',
    );
    expect(shape(area.root)).toBe('[a,b]');
    expect(area.activeGroup.active).toBe('a');
    area.restore({ root: { kind: 'group', tabs: [tab('a'), tab('b')], active: 'b' } });
    expect(area.activeGroup.active).toBe('b');
    area.restore({ root: { kind: 'group', tabs: 'nope' } });
    expect(shape(area.root)).toBe('[]');
  });

  it('drops empty groups and collapses splits left with one child', () => {
    const area = new EditorArea();
    area.restore({
      root: {
        kind: 'split',
        orientation: 'horizontal',
        children: [group([]), group(['a'])],
        sizes: [0.5, 0.5],
      },
    });
    expect(shape(area.root)).toBe('[a]');
    area.restore({ root: { kind: 'split', orientation: 'diagonal', children: [group(['a'])] } });
    expect(shape(area.root)).toBe('[]');
    area.restore({ root: { kind: 'split', orientation: 'vertical' } });
    expect(shape(area.root)).toBe('[]');
  });

  it('merges a split into a parent of the same direction, sharing its size', () => {
    const area = new EditorArea();
    area.restore({
      root: {
        kind: 'split',
        orientation: 'horizontal',
        children: [
          group(['a']),
          {
            kind: 'split',
            orientation: 'horizontal',
            children: [group(['b']), group(['c'])],
            sizes: [0.5, 0.5],
          },
        ],
        sizes: [0.5, 0.5],
      },
    });
    expect(shape(area.root)).toBe('h0.50/0.25/0.25([a] [b] [c])');
  });

  it('gives children without a valid size an equal share', () => {
    const area = new EditorArea();
    area.restore({
      root: {
        kind: 'split',
        orientation: 'vertical',
        children: [group(['a']), group(['b']), group(['c'])],
        sizes: [0.5, 'x', -1],
      },
    });
    // 0.5, then a third each for the others, scaled to sum to 1.
    expect(shape(area.root)).toBe('v0.43/0.29/0.29([a] [b] [c])');
    area.restore({
      root: { kind: 'split', orientation: 'vertical', children: [group(['a']), group(['b'])] },
    });
    expect(shape(area.root)).toBe('v0.50/0.50([a] [b])');
  });

  it('activates the saved group, else the first', () => {
    const saved = {
      root: {
        kind: 'split',
        orientation: 'horizontal',
        children: [group(['a']), group(['b'])],
        sizes: [0.5, 0.5],
      },
      activeGroup: 1,
    };
    const area = new EditorArea();
    area.restore(saved);
    expect(area.activeGroup.active).toBe('b');
    area.restore({ ...saved, activeGroup: 7 });
    expect(area.activeGroup.active).toBe('a');
    area.restore({ ...saved, activeGroup: 'x' });
    expect(area.activeGroup.active).toBe('a');
  });
});

describe('ToolWindows.restore', () => {
  function tools() {
    const t = new ToolWindows();
    t.register({ id: 'project', title: 'Project', anchor: 'left' });
    t.register({ id: 'commit', title: 'Commit', anchor: 'left' });
    t.register({ id: 'terminal', title: 'Terminal', anchor: 'bottom' });
    return t;
  }

  it('ignores what isn’t a state', () => {
    const t = tools();
    const before = JSON.stringify(t.state());
    t.restore(undefined);
    t.restore('x');
    t.restore({});
    expect(JSON.stringify(t.state())).toBe(before);
  });

  it('places known windows as saved, the others after them', () => {
    const t = tools();
    t.restore({
      windows: {
        commit: { anchor: 'right', slot: 'secondary', order: 0 },
        terminal: { anchor: 'left', slot: 'primary', order: 0 },
        project: { anchor: 'top', slot: 'primary', order: 0 },
        removed: { anchor: 'left', slot: 'primary', order: 0 },
        bad: 'x',
      },
    });
    expect(t.group('right', 'secondary').map((w) => w.id)).toEqual(['commit']);
    expect(t.group('left', 'primary').map((w) => w.id)).toEqual(['terminal', 'project']);
  });

  it('keeps an order that isn’t a number as the window’s own', () => {
    const t = tools();
    t.restore({
      windows: {
        project: { anchor: 'left', slot: 'primary', order: 'first' },
        commit: { anchor: 'left', slot: 'primary', order: 0 },
      },
    });
    expect(t.group('left', 'primary').map((w) => w.id)).toEqual(['commit', 'project']);
  });

  it('restores sizes clamped, and only open windows that are in that slot', () => {
    const t = tools();
    t.show('terminal');
    t.restore({
      areas: {
        left: { size: 10, split: 2, primary: 'commit', secondary: 'project' },
        bottom: { size: 'big', primary: 'removed' },
        right: 'x',
      },
    });
    expect(t.areas.left.size).toBe(80);
    expect(t.areas.left.split).toBe(0.9);
    expect(t.isVisible('commit')).toBe(true);
    // Project is in the primary slot, not the secondary.
    expect(t.areas.left.secondary).toBeUndefined();
    expect(t.areas.bottom.size).toBe(220);
    expect(t.isVisible('terminal')).toBe(false);
  });
});

describe('Environments.restore', () => {
  const editor = { root: group(['a', 'b'], 'b'), activeGroup: 0 };

  it('opens what was open, as the caller resolves it, and activates the saved one', () => {
    const envs = new Environments();
    envs.openOrActivate({ id: 'old', name: 'old', branch: 'main' });
    envs.restore(
      {
        open: [
          { id: 'x', name: 'x', branch: 'main', editor },
          { id: 'gone', name: 'gone', branch: 'main', editor },
          { id: 'y', name: 'y', branch: 'feat', editor },
          { id: 'x', name: 'x again', branch: 'main', editor },
          { id: 1, name: 'bad', branch: 'main' },
          'bad',
        ],
        active: 'y',
      },
      (spec) => (spec.id === 'gone' ? undefined : { ...spec, branch: `${spec.branch}!` }),
      (env, t) => env.id !== 'x' || t.id !== 'b',
    );
    expect(envs.open.map((e) => `${e.id}@${e.branch}`)).toEqual(['x@main!', 'y@feat!']);
    expect(envs.activeId).toBe('y');
    expect(envs.get('x').editor.activeGroup.tabs.map((t) => t.id)).toEqual(['a']);
    expect(envs.get('y').editor.activeGroup.active).toBe('b');
  });

  it('activates the first without a valid active one, and opens nothing from nothing', () => {
    const envs = new Environments();
    envs.restore({ open: [{ id: 'x', name: 'x', branch: 'main' }], active: 'nope' }, (s) => s);
    expect(envs.activeId).toBe('x');
    expect(envs.get('x').editor.activeGroup.tabs).toEqual([]);
    // Without a filter, every saved tab stays.
    envs.restore({ open: [{ id: 'x', name: 'x', branch: 'main', editor }] }, (s) => s);
    expect(envs.get('x').editor.activeGroup.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    for (const saved of [undefined, {}, { open: 'x' }]) {
      envs.restore(saved, (s) => s);
      expect(envs.open).toEqual([]);
      expect(envs.activeId).toBeUndefined();
    }
  });
});
