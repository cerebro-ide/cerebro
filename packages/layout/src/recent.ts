// Recent Files, as IntelliJ's: the tabs an editor area showed, the latest first, closed ones too.

import { effect, makeObservable, untracked, type Disposable } from '@cerebro-ide/reactive';
import type { EditorArea, Tab } from './editor-area.js';

/** How many are kept: IntelliJ's default "Recent files limit" (a claim, not measured). */
export const MAX_RECENT = 50;

export class RecentTabs {
  /** The latest first: the active tab, then the one before it. */
  tabs: readonly Tab[] = [];
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

  /** Forgets a tab: a file that's gone. */
  forget(id: string): void {
    this.tabs = this.tabs.filter((t) => t.id !== id);
  }

  dispose(): void {
    this.#watching.dispose();
  }

  #show(tab: Tab): void {
    this.tabs = [tab, ...this.tabs.filter((t) => t.id !== tab.id)].slice(0, MAX_RECENT);
  }
}
