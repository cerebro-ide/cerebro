import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { EditorArea, EditorGroup, EditorSplit, MIN_PANE, type EditorNode } from '../src/index.js';

const tab = (id: string) => ({ id, title: id });
const ids = (group: EditorGroup) => group.tabs.map((t) => t.id);

/** A compact picture of the tree: groups as [tabs], splits as h(...) or v(...). */
function shape(node: EditorNode): string {
  if (node instanceof EditorGroup) return `[${ids(node).join(',')}]`;
  return `${node.orientation === 'horizontal' ? 'h' : 'v'}(${node.children.map(shape).join(' ')})`;
}

function split(area: EditorArea): EditorSplit {
  return area.root as EditorSplit;
}

describe('EditorArea: tabs', () => {
  it('starts with one empty group', () => {
    const area = new EditorArea();
    expect(shape(area.root)).toBe('[]');
    expect(area.activeGroup.activeTab).toBeUndefined();
  });

  it('opens after the active tab and activates', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.open(tab('b'));
    area.activate(area.activeGroupId, 'a');
    area.open(tab('c'));
    expect(ids(area.activeGroup)).toEqual(['a', 'c', 'b']);
    expect(area.activeGroup.activeTab?.id).toBe('c');
  });

  it('activates a tab that is already open', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.open(tab('b'));
    area.open(tab('a'));
    expect(ids(area.activeGroup)).toEqual(['a', 'b']);
    expect(area.activeGroup.active).toBe('a');
  });

  it('rejects unknown groups and tabs', () => {
    const area = new EditorArea();
    expect(() => area.group('nope')).toThrow('Unknown editor group');
    expect(() => {
      area.activate(area.activeGroupId, 'nope');
    }).toThrow('has no tab');
    expect(() => area.split(area.activeGroupId, 'right', 'nope')).toThrow('has no tab');
    expect(() => {
      area.move('nope', area.activeGroupId, area.activeGroupId);
    }).toThrow('has no tab');
    expect(() => {
      area.resize('nope', []);
    }).toThrow('Unknown editor split');
  });

  it('closes, activating the next tab, or the previous for the last', () => {
    const area = new EditorArea();
    for (const id of ['a', 'b', 'c']) area.open(tab(id));
    const group = area.activeGroup;
    area.activate(group.id, 'b');
    area.close(group.id, 'b');
    expect(group.active).toBe('c');
    area.close(group.id, 'c');
    expect(group.active).toBe('a');
    area.close(group.id, 'nope');
    area.open(tab('d'));
    area.activate(group.id, 'a');
    area.close(group.id, 'd');
    expect(group.active).toBe('a');
  });

  it('keeps the last group when its last tab closes', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.close(area.activeGroupId, 'a');
    expect(shape(area.root)).toBe('[]');
    expect(area.activeGroup.active).toBeUndefined();
  });
});

describe('EditorArea: splits', () => {
  it('splits right and down, with a copy of a tab', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const first = area.activeGroupId;
    const right = area.split(first, 'right', 'a');
    expect(shape(area.root)).toBe('h([a] [a])');
    expect(area.activeGroupId).toBe(right.id);
    area.split(right.id, 'down');
    expect(shape(area.root)).toBe('h([a] v([a] []))');
  });

  it('splits left and up, putting the new group first', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const first = area.activeGroupId;
    const left = area.split(first, 'left');
    expect(shape(area.root)).toBe('h([] [a])');
    expect(area.groups[0]).toBe(left);
    area.split(left.id, 'left');
    expect(shape(area.root)).toBe('h([] [] [a])');
    expect(split(area).sizes).toEqual([0.25, 0.25, 0.5]);
    area.split(first, 'up');
    expect(shape(area.root)).toBe('h([] [] v([] [a]))');
  });

  it('moves a tab into a new split', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.open(tab('b'));
    const first = area.activeGroupId;
    area.moveToSplit('b', first, first, 'right');
    expect(shape(area.root)).toBe('h([a] [b])');
    expect(area.activeGroup.active).toBe('b');
    const right = area.activeGroupId;
    area.moveToSplit('a', first, right, 'down');
    expect(shape(area.root)).toBe('v([b] [a])');
  });

  it('does not split a group’s only tab off itself', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.moveToSplit('a', area.activeGroupId, area.activeGroupId, 'left');
    expect(shape(area.root)).toBe('[a]');
  });

  it('adds a sibling for a split in the same direction, sharing its space', () => {
    const area = new EditorArea();
    const first = area.activeGroupId;
    const second = area.split(first, 'right');
    area.split(second.id, 'right');
    expect(shape(area.root)).toBe('h([] [] [])');
    expect(split(area).sizes).toEqual([0.5, 0.25, 0.25]);
  });

  it('removes an emptied group and collapses its split', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const right = area.split(area.activeGroupId, 'right', 'a');
    area.close(right.id, 'a');
    expect(shape(area.root)).toBe('[a]');
    expect(area.activeGroup).toBe(area.root);
  });

  it('merges a collapsed split into a parent of the same direction', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const a = area.activeGroupId;
    const b = area.split(a, 'right', 'a');
    const c = area.split(b.id, 'down', 'a');
    area.split(c.id, 'right', 'a');
    expect(shape(area.root)).toBe('h([a] v([a] h([a] [a])))');
    area.close(b.id, 'a');
    expect(shape(area.root)).toBe('h([a] [a] [a])');
    const sizes = split(area).sizes;
    expect(sizes.reduce((x, y) => x + y)).toBeCloseTo(1);
    expect(sizes[0]).toBeCloseTo(0.5);
  });

  it('activates the neighbour that took a removed group’s space', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const first = area.activeGroupId;
    const second = area.split(first, 'right', 'a');
    const third = area.split(second.id, 'right', 'a');
    area.close(second.id, 'a');
    expect(area.activeGroupId).toBe(third.id);
    area.activate(third.id, 'a');
    area.close(third.id, 'a');
    expect(area.activeGroupId).toBe(first);
  });

  it('activates the first group of a following neighbour', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    const first = area.activeGroupId;
    const second = area.split(first, 'right', 'a');
    const below = area.split(second.id, 'down', 'a');
    area.activate(first, 'a');
    area.close(first, 'a');
    expect(area.activeGroupId).toBe(second.id);
    expect(shape(area.root)).toBe('v([a] [a])');
    expect(area.groups.map((g) => g.id)).toEqual([second.id, below.id]);
  });

  it('resizes, with a minimum and normalized', () => {
    const area = new EditorArea();
    area.split(area.activeGroupId, 'right');
    const id = split(area).id;
    area.resize(id, [3, 1]);
    expect(split(area).sizes).toEqual([0.75, 0.25]);
    area.resize(id, [1, 0]);
    expect(split(area).sizes[1]).toBeCloseTo(MIN_PANE / (1 + MIN_PANE));
    expect(() => {
      area.resize(id, [1]);
    }).toThrow('has 2 children, got 1 sizes');
  });
});

describe('EditorArea: moving tabs', () => {
  it('reorders within a group', () => {
    const area = new EditorArea();
    for (const id of ['a', 'b', 'c']) area.open(tab(id));
    const g = area.activeGroupId;
    area.move('a', g, g);
    expect(ids(area.activeGroup)).toEqual(['b', 'c', 'a']);
    area.move('a', g, g, 0);
    expect(ids(area.activeGroup)).toEqual(['a', 'b', 'c']);
    area.move('c', g, g, 99);
    expect(ids(area.activeGroup)).toEqual(['a', 'b', 'c']);
  });

  it('moves to another group, removing an emptied source', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.open(tab('b'));
    const left = area.activeGroupId;
    const right = area.split(left, 'right', 'a');
    area.move('b', left, right.id, 0);
    expect(shape(area.root)).toBe('h([a] [b,a])');
    expect(area.activeGroupId).toBe(right.id);
    expect(right.active).toBe('b');
    area.move('a', left, right.id);
    expect(shape(area.root)).toBe('[b,a]');
    expect(right.active).toBe('a');
  });
});

describe('EditorArea: moving to the end', () => {
  it('appends when no index is given', () => {
    const area = new EditorArea();
    area.open(tab('a'));
    area.open(tab('b'));
    const left = area.activeGroupId;
    const right = area.split(left, 'right', 'a');
    area.move('b', left, right.id);
    expect(ids(right)).toEqual(['a', 'b']);
  });
});

describe('EditorArea: reactivity', () => {
  it('updates effects that read the tree', () => {
    const area = new EditorArea();
    const seen: string[] = [];
    effect(() => {
      seen.push(`${shape(area.root)} ${area.activeGroup.activeTab?.id ?? '-'}`);
      return undefined;
    });
    area.open(tab('a'));
    area.split(area.activeGroupId, 'right', 'a');
    expect(seen).toEqual(['[] -', '[a] a', 'h([a] [a]) a']);
  });
});
