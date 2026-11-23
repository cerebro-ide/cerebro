// A tree's state, apart from how it's drawn: which nodes are expanded, the children loaded so far
// (lazily, the first time a node is expanded), the rows that show, and the selection. The rows are a
// flat list (each node with its depth), which a virtualised view draws a window of. Several rows
// may be selected, as in IntelliJ's trees: `selected` is the lead, the one the keys move from.
//
// Children come from a source, synchronously or not, so a file tree can ask a host for a folder's
// entries only when the folder is opened.

import { makeObservable, ObservableMap, ObservableSet, untracked } from '@cerebro-ide/reactive';

export interface TreeSource<T> {
  /** A node's children; the roots for `undefined`. May be asynchronous. */
  children(node: T | undefined): readonly T[] | Promise<readonly T[]>;
  /** A key unique within the tree, stable across loads. */
  key(node: T): string;
  /** Whether a node can't have children: a file, not a folder. */
  isLeaf(node: T): boolean;
}

export interface TreeRow<T> {
  node: T;
  key: string;
  depth: number;
  leaf: boolean;
  expanded: boolean;
  /** Expanded, with its children still loading the first time. */
  loading: boolean;
}

/** The roots' key in the children cache. */
const ROOT = '\u0000root';

export class TreeModel<T> {
  readonly expanded = new ObservableSet<string>();
  /** Children loaded so far, by their parent's key. */
  readonly loaded = new ObservableMap<string, readonly T[]>();
  /** Parents whose children are loading. */
  readonly loading = new ObservableSet<string>();
  /** The lead selected row: the one the keys move from, and the last clicked. */
  selected: string | undefined = undefined;
  /** Every row selected, the lead among them. */
  readonly selection = new ObservableSet<string>();
  /** Where a range taken with Shift starts: the row last selected without it. */
  #anchor: string | undefined = undefined;
  /** Why loading failed, by parent's key. */
  readonly errors = new ObservableMap<string, string>();
  /** Loads under way, by parent's key. */
  readonly #pending = new Map<string, Promise<void>>();
  /** Reloads asked for while a load was under way, by parent's key: one read after it. */
  readonly #again = new Map<string, Promise<void>>();

  constructor(private readonly source: TreeSource<T>) {
    makeObservable(this);
    // Loading reads what it writes: not as part of whatever makes the model, which would run again.
    void untracked(() => this.load(undefined));
  }

  /** The rows that show, in order: each loaded node under its expanded ancestors. */
  get rows(): TreeRow<T>[] {
    const rows: TreeRow<T>[] = [];
    const walk = (parent: string, depth: number) => {
      for (const node of this.loaded.get(parent) ?? []) {
        const key = this.source.key(node);
        const leaf = this.source.isLeaf(node);
        const expanded = !leaf && this.expanded.has(key);
        rows.push({ node, key, depth, leaf, expanded, loading: expanded && this.loading.has(key) });
        if (expanded) walk(key, depth + 1);
      }
    };
    walk(ROOT, 0);
    return rows;
  }

  /**
   * Every node loaded, shown or under a collapsed parent, in order (a parent, then its children),
   * each with the keys from its root down to it: what IntelliJ's next and previous occurrence walk
   * (`DefaultMutableTreeNode.getNextNode`).
   */
  get loadedNodes(): { node: T; keys: string[] }[] {
    const nodes: { node: T; keys: string[] }[] = [];
    const walk = (parent: string, above: string[]) => {
      for (const node of this.loaded.get(parent) ?? []) {
        const keys = [...above, this.source.key(node)];
        nodes.push({ node, keys });
        walk(keys.at(-1) as string, keys);
      }
    };
    walk(ROOT, []);
    return nodes;
  }

  /** The selected rows' keys, in the order they show; hidden ones left out. */
  get selectedKeys(): string[] {
    return this.rows.filter((row) => this.selection.has(row.key)).map((row) => row.key);
  }

  /** The selected rows' nodes, in the order they show. */
  get selectedNodes(): T[] {
    return this.rows.filter((row) => this.selection.has(row.key)).map((row) => row.node);
  }

  /** The selected row's index among the rows, or -1. */
  get selectedIndex(): number {
    return this.rows.findIndex((r) => r.key === this.selected);
  }

  /**
   * Loads a node's children (the roots for `undefined`), once, unless `reload`. While they're
   * loading, resolves when they've loaded. Children loaded before stay while they're read again,
   * not marked loading, and stay as they were if they're the same, so a tree read again and again
   * (to follow the disk) doesn’t change under the pointer. A reload asked for while they load reads
   * them again after.
   */
  load(node: T | undefined, reload = false): Promise<void> {
    const key = node === undefined ? ROOT : this.source.key(node);
    const pending = this.#pending.get(key);
    if (pending && !reload) return pending;
    if (pending) {
      // That load read the children before whatever made this one asked for, so read them again
      // once it's done: once, for every reload asked for meanwhile.
      const again =
        this.#again.get(key) ??
        pending.then(() => {
          this.#again.delete(key);
          return this.load(node, true);
        });
      this.#again.set(key, again);
      return again;
    }
    const before = this.loaded.get(key);
    if (before && !reload) return Promise.resolve();
    if (!before) this.loading.add(key);
    this.errors.delete(key);
    // Read from the next microtask, so a source that throws at once still finds this load pending
    // when it ends, and clears it.
    const loading = (async () => {
      await Promise.resolve();
      try {
        const children = await this.source.children(node);
        if (!before || !sameNodes(before, children)) this.loaded.set(key, [...children]);
        // Children marked expanded before they showed (a view opening folders as they first
        // show) load too, or they'd show open and empty.
        for (const child of children) {
          if (!this.source.isLeaf(child) && this.expanded.has(this.source.key(child))) {
            void this.load(child);
          }
        }
      } catch (error) {
        this.errors.set(key, error instanceof Error ? error.message : String(error));
      } finally {
        this.loading.delete(key);
        this.#pending.delete(key);
      }
    })();
    this.#pending.set(key, loading);
    return loading;
  }

  /**
   * Reads the tree again: the roots, and the children of every node loaded before that's still
   * there, so what was expanded stays expanded, with what it holds now. Nodes marked expanded
   * before they were ever loaded are loaded too.
   */
  async refresh(): Promise<void> {
    const before = new Set(this.loaded.keys());
    const reload = async (parent: string): Promise<void> => {
      const children = this.loaded.get(parent) ?? [];
      await Promise.all(
        children.map(async (node) => {
          const key = this.source.key(node);
          if (this.source.isLeaf(node) || !(before.has(key) || this.expanded.has(key))) return;
          await this.load(node, true);
          await reload(key);
        }),
      );
    };
    await this.load(undefined, true);
    await reload(ROOT);
  }

  /** Expands every node, loading children as needed, down to the leaves. */
  async expandAll(): Promise<void> {
    for (;;) {
      const closed = this.rows.filter((row) => !row.leaf && !row.expanded);
      if (closed.length === 0) return;
      await Promise.all(
        closed.map((row) => {
          this.expanded.add(row.key);
          return this.load(row.node);
        }),
      );
    }
  }

  /**
   * Collapses every node; the lead inside one moves to its root, as in IntelliJ, and only roots stay
   * selected.
   */
  collapseAll(): void {
    const rows = this.rows;
    const roots = rows.filter((row) => row.depth === 0 && this.selection.has(row.key));
    for (let i = this.selectedIndex; i >= 0; i--) {
      const row = rows[i] as TreeRow<T>;
      if (row.depth === 0) {
        this.select(row.key);
        break;
      }
    }
    for (const row of roots) this.selection.add(row.key);
    this.expanded.clear();
  }

  /** Expands a node, loading its children the first time. */
  expand(node: T): void {
    if (this.source.isLeaf(node)) return;
    this.expanded.add(this.source.key(node));
    void this.load(node);
  }

  /**
   * Collapses a node; rows selected inside it are no longer, and the lead among them moves to it,
   * as in IntelliJ (Swing's `JTree.removeDescendantSelectedPaths`).
   */
  collapse(node: T): void {
    const key = this.source.key(node);
    const rows = this.rows;
    const index = rows.findIndex((r) => r.key === key);
    const row = rows[index];
    if (row) {
      let lead = false;
      for (let i = index + 1; i < rows.length && (rows[i] as TreeRow<T>).depth > row.depth; i++) {
        const inside = (rows[i] as TreeRow<T>).key;
        if (inside === this.selected) lead = true;
        this.selection.delete(inside);
      }
      if (lead) {
        this.selection.add(key);
        this.selected = key;
      }
    }
    this.expanded.delete(key);
  }

  toggle(node: T): void {
    if (this.expanded.has(this.source.key(node))) this.collapse(node);
    else this.expand(node);
  }

  /** Selects one row alone (none for `undefined`), where a range taken with Shift starts. */
  select(key: string | undefined): void {
    this.selected = key;
    this.#anchor = key;
    this.selection.clear();
    if (key !== undefined) this.selection.add(key);
  }

  /**
   * Ctrl+click's: adds a row to the selection, or takes it out. The last one stays (Claude's choice,
   * open to change: IntelliJ's trees can be left with none); one taken out leaves the lead to the
   * first still selected.
   */
  toggleSelected(key: string): void {
    this.#anchor = key;
    if (!this.selection.has(key)) {
      this.selection.add(key);
      this.selected = key;
      return;
    }
    if (this.selection.size === 1) return;
    this.selection.delete(key);
    if (this.selected === key) this.selected = this.selectedKeys[0];
  }

  /** Shift's: the rows from where the range starts to `key`, `key` the lead. */
  extendTo(key: string): void {
    const keys = this.rows.map((row) => row.key);
    const to = keys.indexOf(key);
    if (to < 0) return;
    const at = this.#anchor === undefined ? -1 : keys.indexOf(this.#anchor);
    const from = at < 0 ? to : at;
    if (at < 0) this.#anchor = key;
    this.selection.clear();
    for (const k of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) this.selection.add(k);
    this.selected = key;
  }

  /** Every row that shows selected, as IntelliJ's Select All in a tree; the lead stays. */
  selectAll(): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    if (this.selectedIndex < 0) this.select((rows[0] as TreeRow<T>).key);
    for (const row of rows) this.selection.add(row.key);
  }

  /**
   * Selects a node given the keys from its root down to it, expanding (and loading) the folders on
   * the way: IntelliJ's Select Opened File. Resolves with whether it was found.
   */
  async reveal(keys: readonly string[]): Promise<boolean> {
    await this.load(undefined);
    let parent = ROOT;
    for (const [index, key] of keys.entries()) {
      const node = this.loaded.get(parent)?.find((n) => this.source.key(n) === key);
      if (node === undefined) return false;
      if (index === keys.length - 1) {
        this.select(key);
        return true;
      }
      this.expanded.add(key);
      await this.load(node);
      parent = key;
    }
    return false;
  }

  /**
   * Moves the selection by `delta` rows, stopping at the ends; with none, starts at the first. With
   * `extend` (Shift), the rows from where the range starts to there are selected.
   */
  move(delta: number, extend = false): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    const from = this.selectedIndex;
    const to = from < 0 ? 0 : Math.min(Math.max(from + delta, 0), rows.length - 1);
    this.#go((rows[to] as TreeRow<T>).key, extend);
  }

  /** Selects the first row or the last, or, with `extend`, the rows up to it. */
  edge(last: boolean, extend = false): void {
    const rows = this.rows;
    const row = last ? rows.at(-1) : rows[0];
    if (row) this.#go(row.key, extend);
  }

  #go(key: string, extend: boolean) {
    if (extend) this.extendTo(key);
    else this.select(key);
  }

  /** Right: expands the selected folder, or moves into it when it's open. */
  right(): void {
    const rows = this.rows;
    const index = this.selectedIndex;
    const row = rows[index];
    if (!row || row.leaf) return;
    if (!row.expanded) this.expand(row.node);
    else {
      const child = rows[index + 1];
      if (child && child.depth > row.depth) this.select(child.key);
    }
  }

  /** Left: collapses the selected folder, or moves to its parent. */
  left(): void {
    const rows = this.rows;
    const index = this.selectedIndex;
    const row = rows[index];
    if (!row) return;
    if (row.expanded) {
      this.collapse(row.node);
      return;
    }
    for (let i = index - 1; i >= 0; i--) {
      const above = rows[i] as TreeRow<T>;
      if (above.depth < row.depth) {
        this.select(above.key);
        return;
      }
    }
  }
}

/**
 * Whether two lists hold the same nodes: each with the same fields, holding the same values, a
 * group's children too, as plain data (arrays and plain objects) all the way down.
 */
function sameNodes<T>(a: readonly T[], b: readonly T[]): boolean {
  return same(a, b, new Set());
}

/** Whether two values are the same data; `path` holds the objects compared above, against cycles. */
function same(a: unknown, b: unknown, path: Set<object>): boolean {
  if (a === b) return true;
  if (!plain(a) || !plain(b) || Array.isArray(a) !== Array.isArray(b) || path.has(a)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  path.add(a);
  const all = keys.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path),
  );
  path.delete(a);
  return all;
}

/** An array, or an object made as a literal: data, compared by what it holds. */
const plain = (value: unknown): value is object =>
  Array.isArray(value) ||
  (typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype);
