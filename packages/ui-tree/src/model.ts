// A tree's state, apart from how it's drawn: which nodes are expanded, the children loaded so far
// (lazily, the first time a node is expanded), the rows that show, and the selection. The rows are a
// flat list (each node with its depth), which a virtualised view draws a window of.
//
// Children come from a source, synchronously or not, so a file tree can ask a host for a folder's
// entries only when the folder is opened.

import { makeObservable, ObservableMap, ObservableSet } from '@cerebro-ide/reactive';

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
  /** Expanded, with its children still loading. */
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
  selected: string | undefined = undefined;
  /** Why loading failed, by parent's key. */
  readonly errors = new ObservableMap<string, string>();

  constructor(private readonly source: TreeSource<T>) {
    makeObservable(this);
    void this.load(undefined);
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

  /** The selected row's index among the rows, or -1. */
  get selectedIndex(): number {
    return this.rows.findIndex((r) => r.key === this.selected);
  }

  /** Loads a node's children (the roots for `undefined`), once, unless `reload`. */
  async load(node: T | undefined, reload = false): Promise<void> {
    const key = node === undefined ? ROOT : this.source.key(node);
    if ((this.loaded.has(key) && !reload) || this.loading.has(key)) return;
    this.loading.add(key);
    this.errors.delete(key);
    try {
      const children = await this.source.children(node);
      this.loaded.set(key, [...children]);
    } catch (error) {
      this.errors.set(key, error instanceof Error ? error.message : String(error));
    } finally {
      this.loading.delete(key);
    }
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

  /** Collapses every node; a selection inside one moves to its root, as in IntelliJ. */
  collapseAll(): void {
    const rows = this.rows;
    for (let i = this.selectedIndex; i >= 0; i--) {
      const row = rows[i] as TreeRow<T>;
      if (row.depth === 0) {
        this.selected = row.key;
        break;
      }
    }
    this.expanded.clear();
  }

  /** Expands a node, loading its children the first time. */
  expand(node: T): void {
    if (this.source.isLeaf(node)) return;
    this.expanded.add(this.source.key(node));
    void this.load(node);
  }

  /** Collapses a node; a selection inside it moves to it, as in IntelliJ. */
  collapse(node: T): void {
    const key = this.source.key(node);
    const rows = this.rows;
    const index = rows.findIndex((r) => r.key === key);
    const row = rows[index];
    if (row) {
      for (let i = index + 1; i < rows.length && (rows[i] as TreeRow<T>).depth > row.depth; i++) {
        if ((rows[i] as TreeRow<T>).key === this.selected) this.selected = key;
      }
    }
    this.expanded.delete(key);
  }

  toggle(node: T): void {
    if (this.expanded.has(this.source.key(node))) this.collapse(node);
    else this.expand(node);
  }

  select(key: string | undefined): void {
    this.selected = key;
  }

  /** Moves the selection by `delta` rows, stopping at the ends; with none, starts at the first. */
  move(delta: number): void {
    const rows = this.rows;
    if (rows.length === 0) return;
    const from = this.selectedIndex;
    const to = from < 0 ? 0 : Math.min(Math.max(from + delta, 0), rows.length - 1);
    this.selected = (rows[to] as TreeRow<T>).key;
  }

  /** Selects the first row or the last. */
  edge(last: boolean): void {
    const rows = this.rows;
    const row = last ? rows.at(-1) : rows[0];
    if (row) this.selected = row.key;
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
      if (child && child.depth > row.depth) this.selected = child.key;
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
        this.selected = above.key;
        return;
      }
    }
  }
}
