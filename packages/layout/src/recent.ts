// Recent Files, as IntelliJ's: the tabs an editor area showed, the latest first, closed ones too;
// and the files edited, likewise, which its "Show edited only" lists.

import { effect, makeObservable, untracked, type Disposable } from '@cerebro-ide/reactive';
import type { EditorArea, Tab } from './editor-area.js';

/** How many are kept: IntelliJ's default "Recent files limit" (a claim, not measured). */
export const MAX_RECENT = 50;

export class RecentTabs {
  /** The latest first: the active tab, then the one before it. */
  tabs: readonly Tab[] = [];
  /** The files edited, the latest edited first. */
  edited: readonly Tab[] = [];
  readonly #watching: Disposable;

  /** Follows `area`'s active tab. */
  constructor(area: EditorArea) {
    makeObservable(this);
    this.#watching = effect(() => {
      const tab = area.activeGroup.activeTab;
      if (tab) {
        untracked(() => {
          this.#show(tab);
        });
      }
      return undefined;
    });
  }

  /**
   * Adds the tabs saved from an earlier run, after those shown since (as `tabs` was saved: JSON),
   * skipping what isn't a tab.
   */
  restore(saved: unknown): void {
    this.tabs = after(this.tabs, saved);
  }

  /** Adds the edited files saved from an earlier run, as `restore` the tabs. */
  restoreEdited(saved: unknown): void {
    this.edited = after(this.edited, saved);
  }

  /** A file was edited: it goes first among the edited. */
  edit(tab: Tab): void {
    if (this.edited[0]?.id === tab.id) return;
    this.edited = [tab, ...this.edited.filter((t) => t.id !== tab.id)].slice(0, MAX_RECENT);
  }

  /** Forgets a tab: a file that's gone. */
  forget(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id !== id);
    this.edited = this.edited.filter((t) => t.id !== id);
  }

  dispose(): void {
    this.#watching.dispose();
  }

  #show(tab: Tab): void {
    this.tabs = [tab, ...this.tabs.filter((t) => t.id !== tab.id)].slice(0, MAX_RECENT);
  }
}

/** `tabs`, then the tabs in `saved` (JSON) that aren't among them, skipping what isn't a tab. */
function after(tabs: readonly Tab[], saved: unknown): readonly Tab[] {
  if (!Array.isArray(saved)) return tabs;
  const valid = saved.filter(
    (t): t is Tab =>
      typeof (t as Tab | null)?.id === 'string' && typeof (t as Tab).title === 'string',
  );
  const there = new Set(tabs.map((t) => t.id));
  const added = valid.filter((t) => !there.has(t.id)).map(({ id, title }) => ({ id, title }));
  return [...tabs, ...added].slice(0, MAX_RECENT);
}
