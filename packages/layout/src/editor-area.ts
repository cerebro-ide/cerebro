// The editor area: a tree of splits whose leaves are tab groups. A group left empty is removed, and a
// split left with one child is replaced by it, so the tree stays minimal. The last group always stays.

import { makeObservable } from '@cerebro-ide/reactive';

export interface Tab {
  id: string;
  title: string;
}

/** `horizontal`: children side by side. `vertical`: stacked. */
export type Orientation = 'horizontal' | 'vertical';
/** Where a new group goes, relative to the one being split. */
export type Direction = 'left' | 'right' | 'up' | 'down';

/** The smallest share of a split one child can be resized to. */
export const MIN_PANE = 0.05;

export class EditorGroup {
  readonly kind = 'group';
  readonly id: string;
  tabs: readonly Tab[] = [];
  active: string | undefined = undefined;

  constructor(id: string) {
    this.id = id;
    makeObservable(this);
  }

  get activeTab(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.active);
  }
}

export class EditorSplit {
  readonly kind = 'split';
  readonly id: string;
  readonly orientation: Orientation;
  children: readonly EditorNode[];
  /** Each child's share, summing to 1. */
  sizes: readonly number[];

  constructor(id: string, orientation: Orientation, children: EditorNode[], sizes: number[]) {
    this.id = id;
    this.orientation = orientation;
    this.children = children;
    this.sizes = sizes;
    makeObservable(this);
  }
}

export type EditorNode = EditorGroup | EditorSplit;

export class EditorArea {
  root: EditorNode;
  activeGroupId: string;
  #nextId = 1;

  constructor() {
    const group = this.createGroup();
    this.root = group;
    this.activeGroupId = group.id;
    makeObservable(this);
  }

  /** All groups, in reading order. */
  get groups(): EditorGroup[] {
    return groupsOf(this.root);
  }

  get activeGroup(): EditorGroup {
    return this.group(this.activeGroupId);
  }

  group(id: string): EditorGroup {
    const group = this.groups.find((g) => g.id === id);
    if (!group) throw new Error(`Unknown editor group "${id}"`);
    return group;
  }

  /** Opens `tab` after the group's active tab and activates it; an open tab is just activated. */
  open(tab: Tab, groupId: string = this.activeGroupId): void {
    const group = this.group(groupId);
    if (!group.tabs.some((t) => t.id === tab.id)) {
      const index = group.tabs.findIndex((t) => t.id === group.active) + 1;
      group.tabs = [...group.tabs.slice(0, index), tab, ...group.tabs.slice(index)];
    }
    group.active = tab.id;
    this.activeGroupId = group.id;
  }

  activate(groupId: string, tabId: string): void {
    const group = this.group(groupId);
    if (!group.tabs.some((t) => t.id === tabId)) {
      throw new Error(`Group "${groupId}" has no tab "${tabId}"`);
    }
    group.active = tabId;
    this.activeGroupId = groupId;
  }

  /** Closes a tab; the next tab (or the previous one) becomes active. An emptied group is removed. */
  close(groupId: string, tabId: string): void {
    const group = this.group(groupId);
    const index = group.tabs.findIndex((t) => t.id === tabId);
    if (index < 0) return;
    const tabs = group.tabs.filter((t) => t.id !== tabId);
    group.tabs = tabs;
    if (group.active === tabId) group.active = (tabs[index] ?? tabs[index - 1])?.id;
    if (tabs.length === 0) this.removeGroup(group);
  }

  /** Adds a group beside `groupId`, optionally with a copy of one of its tabs, and activates it. */
  split(groupId: string, direction: Direction, tabId?: string): EditorGroup {
    const group = this.group(groupId);
    const created = this.createGroup();
    if (tabId !== undefined) {
      const tab = group.tabs.find((t) => t.id === tabId);
      if (!tab) throw new Error(`Group "${groupId}" has no tab "${tabId}"`);
      created.tabs = [tab];
      created.active = tab.id;
    }
    const orientation: Orientation =
      direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
    const before = direction === 'left' || direction === 'up';
    const parent = this.parentOf(group);
    if (parent?.orientation === orientation) {
      // Same direction: a new sibling that shares the group's space.
      const index = parent.children.indexOf(group);
      const at = before ? index : index + 1;
      const half = (parent.sizes[index] as number) / 2;
      parent.children = insertAt(parent.children, at, created);
      parent.sizes = insertAt(
        parent.sizes.map((s, i) => (i === index ? half : s)),
        at,
        half,
      );
    } else {
      const children = before ? [created, group] : [group, created];
      const split = new EditorSplit(this.newId('s'), orientation, children, [0.5, 0.5]);
      this.replace(group, split, parent);
    }
    this.activeGroupId = created.id;
    return created;
  }

  /**
   * Moves a tab into a new group split off `toId` in `direction`. Splitting a group's only tab off
   * itself would leave it where it is, so that does nothing.
   */
  moveToSplit(tabId: string, fromId: string, toId: string, direction: Direction): void {
    const from = this.group(fromId);
    if (fromId === toId && from.tabs.length === 1) return;
    const created = this.split(toId, direction);
    this.move(tabId, fromId, created.id);
  }

  /** Moves a tab within a group or to another group, at `index` (default: the end). */
  move(tabId: string, fromId: string, toId: string, index?: number): void {
    const from = this.group(fromId);
    const to = this.group(toId);
    const tab = from.tabs.find((t) => t.id === tabId);
    if (!tab) throw new Error(`Group "${fromId}" has no tab "${tabId}"`);
    if (from === to) {
      const rest = from.tabs.filter((t) => t.id !== tabId);
      from.tabs = insertAt(rest, clamp(index ?? rest.length, 0, rest.length), tab);
      return;
    }
    if (!to.tabs.some((t) => t.id === tabId)) {
      to.tabs = insertAt(to.tabs, clamp(index ?? to.tabs.length, 0, to.tabs.length), tab);
    }
    to.active = tabId;
    this.activeGroupId = to.id;
    this.close(fromId, tabId);
  }

  /** Sets a split's sizes: each at least `MIN_PANE`, then scaled to sum to 1. */
  resize(splitId: string, sizes: readonly number[]): void {
    const split = splitsOf(this.root).find((s) => s.id === splitId);
    if (!split) throw new Error(`Unknown editor split "${splitId}"`);
    if (sizes.length !== split.children.length) {
      throw new Error(
        `Split "${splitId}" has ${String(split.children.length)} children, got ${String(sizes.length)} sizes`,
      );
    }
    split.sizes = normalize(sizes.map((s) => Math.max(MIN_PANE, s)));
  }

  private removeGroup(group: EditorGroup): void {
    const parent = this.parentOf(group);
    if (!parent) return;
    const index = parent.children.indexOf(group);
    const children = parent.children.filter((c) => c !== group);
    const sizes = normalize(parent.sizes.filter((_, i) => i !== index));
    const neighbour = (children[index - 1] ?? children[index]) as EditorNode;
    if (children.length === 1) this.collapse(parent, neighbour);
    else {
      parent.children = children;
      parent.sizes = sizes;
    }
    if (this.activeGroupId === group.id) {
      // The neighbour that took the space; its last group when it came before, else its first.
      const candidates = groupsOf(neighbour);
      this.activeGroupId = (children[index - 1] ? candidates.at(-1) : candidates[0])?.id as string;
    }
  }

  /** Replaces a split that has one child left with that child, merging same-direction splits. */
  private collapse(split: EditorSplit, only: EditorNode): void {
    const grandparent = this.parentOf(split);
    if (only instanceof EditorSplit && grandparent?.orientation === only.orientation) {
      const index = grandparent.children.indexOf(split);
      const share = grandparent.sizes[index] as number;
      grandparent.children = [
        ...grandparent.children.slice(0, index),
        ...only.children,
        ...grandparent.children.slice(index + 1),
      ];
      grandparent.sizes = [
        ...grandparent.sizes.slice(0, index),
        ...only.sizes.map((s) => s * share),
        ...grandparent.sizes.slice(index + 1),
      ];
    } else {
      this.replace(split, only, grandparent);
    }
  }

  private replace(old: EditorNode, next: EditorNode, parent: EditorSplit | undefined): void {
    if (parent) parent.children = parent.children.map((c) => (c === old ? next : c));
    else this.root = next;
  }

  private parentOf(node: EditorNode): EditorSplit | undefined {
    return splitsOf(this.root).find((s) => s.children.includes(node));
  }

  private createGroup(): EditorGroup {
    return new EditorGroup(this.newId('g'));
  }

  private newId(prefix: string): string {
    return `${prefix}${String(this.#nextId++)}`;
  }
}

function groupsOf(node: EditorNode): EditorGroup[] {
  return node instanceof EditorGroup ? [node] : node.children.flatMap(groupsOf);
}

function splitsOf(node: EditorNode): EditorSplit[] {
  return node instanceof EditorSplit ? [node, ...node.children.flatMap(splitsOf)] : [];
}

function insertAt<T>(items: readonly T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalize(sizes: readonly number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((s) => s / total);
}
