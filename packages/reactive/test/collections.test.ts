import { describe, expect, it } from 'vitest';
import {
  effect,
  ObservableArray,
  ObservableMap,
  ObservableSet,
  signal,
  type ArrayChange,
  type MapChange,
  type SetChange,
} from '../src/index.js';

function runs(fn: () => unknown) {
  const counter = { count: 0 };
  effect(() => {
    counter.count++;
    fn();
  });
  return counter;
}

describe('ObservableArray', () => {
  function setup(items: number[] = [1, 2, 3]) {
    const array = new ObservableArray(items);
    const changes: ArrayChange<number>[] = [];
    array.observeChanges((change) => changes.push(change));
    return { array, changes };
  }

  it('reads like an array', () => {
    const { array } = setup();
    expect(array.length).toBe(3);
    expect(array.get(1)).toBe(2);
    expect(array.get(5)).toBeUndefined();
    expect([...array]).toEqual([1, 2, 3]);
    expect(array.toArray()).toEqual([1, 2, 3]);
    expect(new ObservableArray().length).toBe(0);
  });

  it('toArray returns a copy', () => {
    const { array } = setup();
    array.toArray().push(4);
    expect(array.length).toBe(3);
  });

  it('sets by index, ignoring equal values', () => {
    const { array, changes } = setup();
    array.set(1, 2);
    array.set(1, 20);
    expect(array.toArray()).toEqual([1, 20, 3]);
    expect(changes).toEqual([{ type: 'update', index: 1, oldValue: 2, newValue: 20 }]);
  });

  it('rejects indexes out of range', () => {
    const { array } = setup();
    for (const index of [-1, 3, 1.5]) {
      expect(() => {
        array.set(index, 0);
      }).toThrow(RangeError);
    }
  });

  it('pushes, pops, unshifts and shifts', () => {
    const { array, changes } = setup();
    expect(array.push(4, 5)).toBe(5);
    expect(array.pop()).toBe(5);
    expect(array.unshift(0)).toBe(5);
    expect(array.shift()).toBe(0);
    expect(array.toArray()).toEqual([1, 2, 3, 4]);
    expect(changes).toEqual([
      { type: 'splice', index: 3, removed: [], added: [4, 5] },
      { type: 'splice', index: 4, removed: [5], added: [] },
      { type: 'splice', index: 0, removed: [], added: [0] },
      { type: 'splice', index: 0, removed: [0], added: [] },
    ]);
  });

  it('pop and shift on an empty array change nothing', () => {
    const { array, changes } = setup([]);
    expect(array.pop()).toBeUndefined();
    expect(array.shift()).toBeUndefined();
    expect(changes).toEqual([]);
  });

  it('splices like Array.prototype.splice', () => {
    const cases: [number, number | undefined, number[]][] = [
      [1, 1, []],
      [-2, 1, [9]],
      [-10, 1, []],
      [10, 0, [7]],
      [1, undefined, []],
      [1, -5, [8]],
      [1, 99, []],
    ];
    for (const [start, deleteCount, items] of cases) {
      const reference = [1, 2, 3, 4];
      const array = new ObservableArray(reference);
      const expected =
        deleteCount === undefined
          ? reference.splice(start)
          : reference.splice(start, deleteCount, ...items);
      const actual =
        deleteCount === undefined
          ? array.splice(start)
          : array.splice(start, deleteCount, ...items);
      expect(actual).toEqual(expected);
      expect(array.toArray()).toEqual(reference);
    }
  });

  it('reports a bulk change once, and effects run once', () => {
    const { array, changes } = setup([]);
    const counter = runs(() => array.length);
    array.push(...Array.from({ length: 40 }, (_, i) => i));
    expect(changes).toHaveLength(1);
    expect(counter.count).toBe(2);
  });

  it('replaces and clears', () => {
    const { array, changes } = setup();
    expect(array.replace([7, 8])).toEqual([1, 2, 3]);
    expect(array.clear()).toEqual([7, 8]);
    expect(array.clear()).toEqual([]);
    expect(changes).toEqual([
      { type: 'splice', index: 0, removed: [1, 2, 3], added: [7, 8] },
      { type: 'splice', index: 0, removed: [7, 8], added: [] },
    ]);
  });

  it('handles more items than fit in function arguments', () => {
    const big = Array.from({ length: 500_000 }, (_, i) => i);
    const array = new ObservableArray<number>();
    array.replace(big);
    expect(array.length).toBe(500_000);
    expect(array.get(499_999)).toBe(499_999);
  });

  it('every read depends on the array', () => {
    const { array } = setup();
    const readers = [
      () => array.length,
      () => array.get(0),
      () => array.toArray(),
      () => [...array],
    ];
    const counters = readers.map(runs);
    array.push(4);
    expect(counters.map((c) => c.count)).toEqual([2, 2, 2, 2]);
  });

  it('stops reporting changes once disposed', () => {
    const array = new ObservableArray<number>();
    const changes: ArrayChange<number>[] = [];
    const subscription = array.observeChanges((change) => changes.push(change));
    subscription.dispose();
    array.push(1);
    expect(changes).toEqual([]);
  });

  it('runs listeners untracked', () => {
    const array = new ObservableArray<number>();
    const other = signal(0);
    array.observeChanges(() => other.get());
    const counter = runs(() => array.push(1));
    other.set(1);
    expect(counter.count).toBe(1);
  });
});

describe('ObservableMap', () => {
  function setup() {
    const map = new ObservableMap<string, number>([['a', 1]]);
    const changes: MapChange<string, number>[] = [];
    map.observeChanges((change) => changes.push(change));
    return { map, changes };
  }

  it('reads like a Map', () => {
    const { map } = setup();
    expect(map.size).toBe(1);
    expect(map.get('a')).toBe(1);
    expect(map.has('a')).toBe(true);
    expect([...map.keys()]).toEqual(['a']);
    expect([...map.values()]).toEqual([1]);
    expect([...map.entries()]).toEqual([['a', 1]]);
    expect([...map]).toEqual([['a', 1]]);
    expect(new ObservableMap().size).toBe(0);
  });

  it('adds, updates and deletes', () => {
    const { map, changes } = setup();
    expect(map.set('b', 2)).toBe(map);
    map.set('b', 2);
    map.set('b', 3);
    expect(map.delete('b')).toBe(true);
    expect(map.delete('b')).toBe(false);
    expect(changes).toEqual([
      { type: 'add', key: 'b', newValue: 2 },
      { type: 'update', key: 'b', oldValue: 2, newValue: 3 },
      { type: 'delete', key: 'b', oldValue: 3 },
    ]);
  });

  it('clears in one batch', () => {
    const { map, changes } = setup();
    map.set('b', 2);
    const counter = runs(() => map.size);
    map.clear();
    map.clear();
    expect(counter.count).toBe(2);
    expect(changes.slice(1)).toEqual([
      { type: 'delete', key: 'a', oldValue: 1 },
      { type: 'delete', key: 'b', oldValue: 2 },
    ]);
  });

  it('every read depends on the map', () => {
    const { map } = setup();
    const readers = [
      () => map.size,
      () => map.get('a'),
      () => map.has('z'),
      () => [...map.keys()],
      () => [...map.values()],
      () => [...map],
    ];
    const counters = readers.map(runs);
    map.set('z', 26);
    expect(counters.map((c) => c.count)).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

describe('ObservableSet', () => {
  function setup() {
    const set = new ObservableSet(['a']);
    const changes: SetChange<string>[] = [];
    set.observeChanges((change) => changes.push(change));
    return { set, changes };
  }

  it('reads like a Set', () => {
    const { set } = setup();
    expect(set.size).toBe(1);
    expect(set.has('a')).toBe(true);
    expect([...set.values()]).toEqual(['a']);
    expect([...set]).toEqual(['a']);
    expect(new ObservableSet().size).toBe(0);
  });

  it('adds and deletes, ignoring no-ops', () => {
    const { set, changes } = setup();
    expect(set.add('b')).toBe(set);
    set.add('b');
    expect(set.delete('b')).toBe(true);
    expect(set.delete('b')).toBe(false);
    expect(changes).toEqual([
      { type: 'add', value: 'b' },
      { type: 'delete', value: 'b' },
    ]);
  });

  it('clears in one batch', () => {
    const { set, changes } = setup();
    set.add('b');
    const counter = runs(() => set.size);
    set.clear();
    set.clear();
    expect(counter.count).toBe(2);
    expect(changes.slice(1)).toEqual([
      { type: 'delete', value: 'a' },
      { type: 'delete', value: 'b' },
    ]);
  });

  it('every read depends on the set', () => {
    const { set } = setup();
    const counters = [() => set.size, () => set.has('z'), () => [...set]].map(runs);
    set.add('z');
    expect(counters.map((c) => c.count)).toEqual([2, 2, 2]);
  });
});
