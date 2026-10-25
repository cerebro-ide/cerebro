// Observable collections with explicit methods: without proxies, `array[i] = x` can't be tracked.
// Reading any part of a collection depends on the whole collection. Each mutation is one change,
// reported to `observeChanges` listeners synchronously and in bulk (a splice of many items is one
// change), then to effects when the outermost batch ends.

import { Atom, batch, untracked, type Disposable } from './core.js';

export type ArrayChange<T> =
  | { type: 'splice'; index: number; removed: T[]; added: T[] }
  | { type: 'update'; index: number; oldValue: T; newValue: T };

export type MapChange<K, V> =
  | { type: 'add'; key: K; newValue: V }
  | { type: 'update'; key: K; oldValue: V; newValue: V }
  | { type: 'delete'; key: K; oldValue: V };

export type SetChange<T> = { type: 'add'; value: T } | { type: 'delete'; value: T };

class Changes<C> {
  private readonly atom = new Atom();
  private readonly listeners = new Set<(change: C) => void>();

  observed(): void {
    this.atom.reportObserved();
  }

  emit(changes: C[]): void {
    if (changes.length === 0) return;
    batch(() => {
      this.atom.reportChanged();
      for (const change of changes) {
        for (const listener of [...this.listeners])
          untracked(() => {
            listener(change);
          });
      }
    });
  }

  observe(listener: (change: C) => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

export class ObservableArray<T> implements Iterable<T> {
  private readonly items: T[];
  private readonly changes = new Changes<ArrayChange<T>>();

  constructor(items: Iterable<T> = []) {
    this.items = Array.from(items);
  }

  get length(): number {
    this.changes.observed();
    return this.items.length;
  }

  get(index: number): T | undefined {
    this.changes.observed();
    return this.items[index];
  }

  set(index: number, value: T): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      throw new RangeError(`Index ${String(index)} is out of range`);
    }
    const oldValue = this.items[index] as T;
    if (Object.is(oldValue, value)) return;
    this.items[index] = value;
    this.changes.emit([{ type: 'update', index, oldValue, newValue: value }]);
  }

  push(...items: T[]): number {
    this.spliceArray(this.items.length, 0, items);
    return this.items.length;
  }

  pop(): T | undefined {
    return this.spliceArray(this.items.length - 1, 1, [])[0];
  }

  unshift(...items: T[]): number {
    this.spliceArray(0, 0, items);
    return this.items.length;
  }

  shift(): T | undefined {
    return this.spliceArray(0, 1, [])[0];
  }

  /** Like `Array.prototype.splice`. */
  splice(start: number, deleteCount?: number, ...items: T[]): T[] {
    return this.spliceArray(start, deleteCount, items);
  }

  /** Replaces all items; one change. */
  replace(items: Iterable<T>): T[] {
    return this.spliceArray(0, this.items.length, Array.from(items));
  }

  clear(): T[] {
    return this.spliceArray(0, this.items.length, []);
  }

  /** A copy of the items. */
  toArray(): T[] {
    this.changes.observed();
    return this.items.slice();
  }

  [Symbol.iterator](): Iterator<T> {
    this.changes.observed();
    return this.items[Symbol.iterator]();
  }

  observeChanges(listener: (change: ArrayChange<T>) => void): Disposable {
    return this.changes.observe(listener);
  }

  /** Splices without spreading `added` into arguments, so large arrays are safe. */
  private spliceArray(start: number, deleteCount: number | undefined, added: T[]): T[] {
    const items = this.items;
    const length = items.length;
    const index = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
    const count = Math.min(Math.max(deleteCount ?? length - index, 0), length - index);
    if (count === 0 && added.length === 0) return [];
    const removed = items.slice(index, index + count);
    const tail = items.slice(index + count);
    items.length = index;
    for (const item of added) items.push(item);
    for (const item of tail) items.push(item);
    this.changes.emit([{ type: 'splice', index, removed, added: added.slice() }]);
    return removed;
  }
}

export class ObservableMap<K, V> implements Iterable<[K, V]> {
  private readonly map: Map<K, V>;
  private readonly changes = new Changes<MapChange<K, V>>();

  constructor(entries: Iterable<readonly [K, V]> = []) {
    this.map = new Map(entries);
  }

  get size(): number {
    this.changes.observed();
    return this.map.size;
  }

  get(key: K): V | undefined {
    this.changes.observed();
    return this.map.get(key);
  }

  has(key: K): boolean {
    this.changes.observed();
    return this.map.has(key);
  }

  set(key: K, value: V): this {
    if (this.map.has(key)) {
      const oldValue = this.map.get(key) as V;
      if (Object.is(oldValue, value)) return this;
      this.map.set(key, value);
      this.changes.emit([{ type: 'update', key, oldValue, newValue: value }]);
    } else {
      this.map.set(key, value);
      this.changes.emit([{ type: 'add', key, newValue: value }]);
    }
    return this;
  }

  delete(key: K): boolean {
    if (!this.map.has(key)) return false;
    const oldValue = this.map.get(key) as V;
    this.map.delete(key);
    this.changes.emit([{ type: 'delete', key, oldValue }]);
    return true;
  }

  /** Deletes every entry; one batch, one delete change per entry. */
  clear(): void {
    const removed = [...this.map].map(([key, oldValue]) => ({
      type: 'delete' as const,
      key,
      oldValue,
    }));
    this.map.clear();
    this.changes.emit(removed);
  }

  keys(): MapIterator<K> {
    this.changes.observed();
    return this.map.keys();
  }

  values(): MapIterator<V> {
    this.changes.observed();
    return this.map.values();
  }

  entries(): MapIterator<[K, V]> {
    this.changes.observed();
    return this.map.entries();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  observeChanges(listener: (change: MapChange<K, V>) => void): Disposable {
    return this.changes.observe(listener);
  }
}

export class ObservableSet<T> implements Iterable<T> {
  private readonly set = new Set<T>();
  private readonly changes = new Changes<SetChange<T>>();

  constructor(values: Iterable<T> = []) {
    for (const value of values) this.set.add(value);
  }

  get size(): number {
    this.changes.observed();
    return this.set.size;
  }

  has(value: T): boolean {
    this.changes.observed();
    return this.set.has(value);
  }

  add(value: T): this {
    if (this.set.has(value)) return this;
    this.set.add(value);
    this.changes.emit([{ type: 'add', value }]);
    return this;
  }

  delete(value: T): boolean {
    if (!this.set.delete(value)) return false;
    this.changes.emit([{ type: 'delete', value }]);
    return true;
  }

  /** Deletes every value; one batch, one delete change per value. */
  clear(): void {
    const removed = [...this.set].map((value) => ({ type: 'delete' as const, value }));
    this.set.clear();
    this.changes.emit(removed);
  }

  values(): SetIterator<T> {
    this.changes.observed();
    return this.set.values();
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }

  observeChanges(listener: (change: SetChange<T>) => void): Disposable {
    return this.changes.observe(listener);
  }
}
