// Menus by id (`main` for the menu bar, `main/file`, `editor/tab` for a context menu, …), built from
// contributions. Items are ordered by group, then order within the group, with a separator between
// groups. A submenu item refers to another menu.

import { makeObservable, ObservableArray, type Disposable } from '@cerebro-ide/reactive';

export type MenuItemSpec = { command: string } | { submenu: string; label: string };

export interface Contribution {
  menu: string;
  item: MenuItemSpec;
  /** Groups are sorted by name; a separator divides them. Default: `''`. */
  group?: string;
  /** Position within the group; lower first, then contribution order. Default: 0. */
  order?: number;
}

export type MenuEntry = MenuItemSpec | { separator: true };

export class MenuRegistry {
  readonly contributions = new ObservableArray<Contribution>();

  constructor() {
    makeObservable(this);
  }

  contribute(contribution: Contribution): Disposable {
    this.contributions.push(contribution);
    return {
      dispose: () => {
        const index = this.contributions.toArray().indexOf(contribution);
        if (index >= 0) this.contributions.splice(index, 1);
      },
    };
  }

  /** A menu's entries in display order, with separators between groups. */
  entries(menu: string): MenuEntry[] {
    const items = this.contributions
      .toArray()
      .filter((c) => c.menu === menu)
      .map((c, position) => ({ item: c.item, group: c.group ?? '', order: c.order ?? 0, position }))
      .sort((a, b) => compare(a.group, b.group) || a.order - b.order || a.position - b.position);
    const entries: MenuEntry[] = [];
    let group: string | undefined;
    for (const { item, group: name } of items) {
      if (group !== undefined && name !== group) entries.push({ separator: true });
      group = name;
      entries.push(item);
    }
    return entries;
  }
}

function compare(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
