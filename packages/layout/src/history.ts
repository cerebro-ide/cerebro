// Back and Forward, as IntelliJ's Navigate → Back and Forward: the places the user was, in an editor
// area. A place is left when another tab becomes active, or when the caret jumps within a file (the
// caller says so, as it navigates); going back returns to the place left, and forward undoes that.
// Going somewhere new forgets the places ahead.

import { effect, makeObservable, untracked, type Disposable } from '@cerebro-ide/reactive';
import type { EditorArea, Tab } from './editor-area.js';

/** A position in a file, zero-based. */
export interface Position {
  line: number;
  column: number;
}

/**
 * A tab, where its caret was, if it has one (a diff has none), and the line at the top of its view,
 * so going back shows it as it was.
 */
export interface Place {
  tab: Tab;
  at?: Position | undefined;
  top?: number | undefined;
}

/** How many places are kept behind (a claim, not measured: IntelliJ keeps a few dozen). */
export const MAX_PLACES = 50;

export class NavigationHistory {
  /** The places behind, the latest last. */
  back: readonly Place[] = [];
  /** The places ahead, the nearest last. */
  forward: readonly Place[] = [];
  readonly #area: EditorArea;
  readonly #caret: (tab: string) => Position | undefined;
  readonly #reveal: (place: Place) => void;
  readonly #top: (tab: string) => number | undefined;
  readonly #watching: Disposable;
  /** The tab going back or forward is making active: reaching it isn't leaving a place. */
  #arriving: string | undefined;

  /**
   * Follows `area`'s active tab. `caret` says where a tab's caret is, and `top` which line is at
   * the top of its view; `reveal` puts them back as a place has them, once its tab is active.
   */
  constructor(
    area: EditorArea,
    caret: (tab: string) => Position | undefined,
    reveal: (place: Place) => void,
    top: (tab: string) => number | undefined = () => undefined,
  ) {
    this.#area = area;
    this.#caret = caret;
    this.#reveal = reveal;
    this.#top = top;
    makeObservable(this);
    let current: Tab | undefined;
    this.#watching = effect(() => {
      const tab = area.activeGroup.activeTab;
      const left = current;
      current = tab;
      const arriving = this.#arriving;
      this.#arriving = undefined;
      if (left && tab && left.id !== tab.id && tab.id !== arriving) {
        untracked(() => {
          this.#push(this.#placeOf(left));
        });
      }
      return undefined;
    });
  }

  /** The place the active tab's caret is. */
  current(): Place | undefined {
    const tab = this.#area.activeGroup.activeTab;
    return tab && this.#placeOf(tab);
  }

  /** Leaves the current place: before the caret jumps within its file. */
  record(): void {
    const place = this.current();
    if (place) this.#push(place);
  }

  get canGoBack(): boolean {
    return this.back.length > 0;
  }

  get canGoForward(): boolean {
    return this.forward.length > 0;
  }

  /** Returns to the last place left; the current one goes ahead. */
  goBack(): void {
    const place = this.back.at(-1);
    if (!place) return;
    this.back = this.back.slice(0, -1);
    const here = this.current();
    if (here) this.forward = [...this.forward, here];
    this.#go(place);
  }

  /** Undoes going back. */
  goForward(): void {
    const place = this.forward.at(-1);
    if (!place) return;
    this.forward = this.forward.slice(0, -1);
    const here = this.current();
    if (here) this.back = [...this.back, here];
    this.#go(place);
  }

  dispose(): void {
    this.#watching.dispose();
  }

  #placeOf(tab: Tab): Place {
    return { tab, at: this.#caret(tab.id), top: this.#top(tab.id) };
  }

  /** Remembers a place left, unless it's where the last one was; what was ahead is forgotten. */
  #push(place: Place): void {
    const last = this.back.at(-1);
    this.forward = [];
    if (last?.tab.id === place.tab.id && last.at?.line === place.at?.line) return;
    this.back = [...this.back, place].slice(-MAX_PLACES);
  }

  #go(place: Place): void {
    // Methods are batched: the area's active tab is followed once this one returns.
    if (this.#area.activeGroup.active !== place.tab.id) this.#arriving = place.tab.id;
    this.#area.open(place.tab);
    this.#reveal(place);
  }
}
