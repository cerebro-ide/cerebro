// The Switcher, as IntelliJ's (Ctrl+Tab): a popup in the window's centre with two lists, the tool
// windows on the left and the open files on the right, and the selected file's folder below them.
//
// Opened with modifiers held (Ctrl of Ctrl+Tab), it goes as they're let go, choosing what's
// selected: Tab, held, moves on, Shift+Tab back, from one list's end into the other. Opened
// without (from a menu), it stays until Enter or Escape. Up and Down move in a list, Left and
// Right between them, Delete or Backspace closes the selected item, and an item's mnemonic (with
// the modifiers held, if any) chooses it.
//
// With `search` (Recent Files'), typing narrows both lists, as IntelliJ's speed search
// (`SwitcherSpeedSearch`): each item by its name, or its name and the folder shown; the best
// match is selected, in the list that has the selection first; a name's matched characters are in
// bold. What's typed shows above the lists; Backspace takes a character back, and Escape forgets
// it before it closes the popup. The popup keeps its size meanwhile.
//
// From IntelliJ's source (Switcher.kt, SwitcherActions.kt, SwitcherSpeedSearch.kt): all of the
// above.

import { type Child, focusedElement, render } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';
import { match } from './match.js';
import { highlighted } from './popup.js';

export interface SwitcherItem {
  label: string;
  /** Shown muted after the label: a file's folder, when another file has its name. */
  detail?: string;
  icon?: () => Child;
  /** A key that chooses it, shown at the row's end: a tool window's number or letter. */
  mnemonic?: string;
  /** Shown below the lists while it's selected: a file's folder. */
  status?: string;
}

export type SwitcherSide = 'left' | 'right';

/** A modifier held as the Switcher opened, as `KeyboardEvent.key` names it. */
export type Modifier = 'Control' | 'Alt' | 'Meta';

export interface SwitcherOptions<T extends SwitcherItem> {
  title: string;
  left: readonly T[];
  right: readonly T[];
  /** The item selected as it opens. */
  initial: { side: SwitcherSide; index: number };
  /** The modifiers held as it opened: letting one go chooses. None: it stays open. */
  held?: readonly Modifier[];
  /** Closes an item, as Delete asks; returns whether it went from the list. */
  close?: (item: T) => boolean;
  /** At the header's end, after the title: Recent Files' "Show edited only". */
  header?: () => Child;
  /** What each list says when it's empty. */
  empty?: { left: string; right: string };
  /** Typing narrows the lists (see above). */
  search?: {
    /** What the files list says when nothing matches. */
    nothing: string;
    /** Enter with nothing matched: given what was typed. */
    none: (query: string) => void;
  };
  /** Sees each key first: true when it took it. */
  onKey?: (event: KeyboardEvent) => boolean;
}

export interface SwitcherHandle<T> {
  /** Resolves when it closes: with the item chosen, or undefined. */
  readonly result: Promise<T | undefined>;
  readonly open: boolean;
  close(): void;
  /** Lists other items on the right, `index` of them selected. */
  replace(right: readonly T[], index: number): void;
}

/** Rows a Page Up or Page Down moves. */
const PAGE = 10;

const FLAG: Record<Modifier, 'ctrlKey' | 'altKey' | 'metaKey'> = {
  Control: 'ctrlKey',
  Alt: 'altKey',
  Meta: 'metaKey',
};

/** The digit or letter a key is, whatever the layout and the modifiers make it type. */
function keyOf(event: KeyboardEvent): string | undefined {
  const match = /^(?:Digit|Key)([0-9A-Z])$/.exec(event.code);
  return match?.[1];
}

class SwitcherState<T> {
  left: readonly T[];
  right: readonly T[];
  side: SwitcherSide;
  index: number;
  /** What's typed, for speed search. */
  query = '';

  constructor(options: SwitcherOptions<SwitcherItem & T>) {
    this.left = options.left;
    this.right = options.right;
    this.side = options.initial.side;
    this.index = options.initial.index;
    makeObservable(this);
  }
}

/** How well an item matches what's typed: by its name, or its name and the folder shown. */
function score(item: SwitcherItem, query: string): number | undefined {
  return (
    match(query, item.label)?.score ??
    (item.detail === undefined ? undefined : match(query, `${item.label} ${item.detail}`)?.score)
  );
}

/** A side's items, those matching what's typed; the selected side's by default. */
const listOf = <T extends SwitcherItem>(
  state: SwitcherState<T>,
  side: SwitcherSide = state.side,
): readonly T[] => {
  const all = side === 'left' ? state.left : state.right;
  return state.query === '' ? all : all.filter((item) => score(item, state.query) !== undefined);
};

class Switcher<T extends SwitcherItem> implements SwitcherHandle<T> {
  open = true;
  readonly result: Promise<T | undefined>;
  private resolve!: (value: T | undefined) => void;
  private readonly state: SwitcherState<T>;
  private readonly element: HTMLElement;
  private readonly restoreFocus: HTMLElement;
  private readonly dispose: () => void;
  private readonly held: readonly Modifier[];

  constructor(private readonly options: SwitcherOptions<T>) {
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.state = new SwitcherState<T>(options);
    this.held = options.held ?? [];
    // Inside an editor's shadow root too.
    this.restoreFocus = focusedElement();
    this.element = document.createElement('div');
    this.element.className = 'cerebro-popup cerebro-switcher';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', options.title);
    this.element.tabIndex = -1;
    document.body.append(this.element);
    const handle = render(() => this.view(), this.element);
    this.dispose = () => {
      handle.dispose();
    };
    this.place();
    this.element.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onBlur);
    this.element.focus();
  }

  close(): void {
    this.finish(undefined);
  }

  replace(right: readonly T[], index: number): void {
    this.state.right = right;
    this.select('right', index);
  }

  private finish(result: T | undefined): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onBlur);
    this.dispose();
    this.element.remove();
    this.restoreFocus.focus();
    this.resolve(result);
  }

  /** In the window's centre, as IntelliJ's; its size kept as speed search narrows the lists. */
  private place(): void {
    const { width, height } = this.element.getBoundingClientRect();
    this.element.style.minWidth = `${String(width)}px`;
    this.element.style.minHeight = `${String(height)}px`;
    this.element.style.left = `${String(Math.round(Math.max(0, (window.innerWidth - width) / 2)))}px`;
    this.element.style.top = `${String(Math.round(Math.max(0, (window.innerHeight - height) / 2)))}px`;
  }

  private selected(): T | undefined {
    return listOf(this.state)[this.state.index];
  }

  private select(side: SwitcherSide, index: number): void {
    this.state.side = side;
    this.state.index = index;
    this.element
      .querySelector(`[data-side="${side}"] [data-index="${String(index)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  /** The next item, or the one before: from a list's end into the other's start, as IntelliJ's. */
  private go(forward: boolean): void {
    const { state } = this;
    let side = state.side;
    let index = state.index + (forward ? 1 : -1);
    if (index < 0 || index >= listOf(state).length) {
      const other = side === 'left' ? 'right' : 'left';
      if (listOf(state, other).length > 0) side = other;
      index = forward ? 0 : listOf(state, side).length - 1;
    }
    this.select(side, index);
  }

  /** Up or Down, round within the list. */
  private move(by: number): void {
    const count = listOf(this.state).length;
    if (count > 0) this.select(this.state.side, (this.state.index + by + count) % count);
  }

  /** To the other list, at the same row or its last. */
  private cross(side: SwitcherSide): void {
    const count = listOf(this.state, side).length;
    if (side === this.state.side || count === 0) return;
    this.select(side, Math.min(this.state.index, count - 1));
  }

  private closeSelected(): void {
    const item = this.selected();
    if (!item || !this.options.close?.(item)) return;
    const { state } = this;
    const list = listOf(state).filter((other) => other !== item);
    if (state.side === 'left') state.left = state.left.filter((other) => other !== item);
    else state.right = state.right.filter((other) => other !== item);
    if (list.length > 0) this.select(state.side, Math.min(state.index, list.length - 1));
    else this.cross(state.side === 'left' ? 'right' : 'left');
  }

  /** What's typed changed: the best match selected, in the selected list first, as IntelliJ's. */
  private search(query: string): void {
    const { state } = this;
    const item = this.selected();
    state.query = query;
    if (query === '') {
      // The item selected stays so.
      if (item) this.select(state.side, listOf(state).indexOf(item));
      return;
    }
    const other = state.side === 'left' ? 'right' : 'left';
    for (const side of [state.side, other] as const) {
      const list = listOf(state, side);
      if (list.length === 0) continue;
      const scores = list.map((each) => score(each, query) as number);
      this.select(side, scores.indexOf(Math.max(...scores)));
      return;
    }
    state.index = -1;
  }

  /** A key for speed search: true when it took it. */
  private searchKey(event: KeyboardEvent): boolean {
    const { query } = this.state;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key.length === 1) this.search(query + event.key);
    else if (query !== '' && (event.key === 'Backspace' || event.key === 'Escape')) {
      this.search(event.key === 'Escape' ? '' : query.slice(0, -1));
    } else if (query !== '' && event.key === 'Enter' && this.selected() === undefined) {
      this.close();
      this.options.search?.none(query);
    } else return false;
    return true;
  }

  /** Whether exactly the modifiers held as it opened are down (Shift aside). */
  private heldDown(event: KeyboardEvent): boolean {
    return (['Control', 'Alt', 'Meta'] as const).every(
      (modifier) => event[FLAG[modifier]] === this.held.includes(modifier),
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    // Keys stay in the Switcher: the app's shortcuts don't run while it's open.
    event.stopPropagation();
    if (this.options.onKey?.(event) === true || (this.options.search && this.searchKey(event))) {
      event.preventDefault();
      return;
    }
    const keys: Record<string, () => void> = {
      Tab: () => {
        this.go(!event.shiftKey);
      },
      ArrowDown: () => {
        this.move(1);
      },
      ArrowUp: () => {
        this.move(-1);
      },
      ArrowLeft: () => {
        this.cross('left');
      },
      ArrowRight: () => {
        this.cross('right');
      },
      PageDown: () => {
        this.select(
          this.state.side,
          Math.min(this.state.index + PAGE, listOf(this.state).length - 1),
        );
      },
      PageUp: () => {
        this.select(this.state.side, Math.max(this.state.index - PAGE, 0));
      },
      Enter: () => {
        this.finish(this.selected());
      },
      Escape: () => {
        this.close();
      },
      Delete: () => {
        this.closeSelected();
      },
      Backspace: () => {
        this.closeSelected();
      },
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
      return;
    }
    const key = keyOf(event);
    const item = [...this.state.left, ...this.state.right].find(
      (candidate) => candidate.mnemonic !== undefined && candidate.mnemonic === key,
    );
    if (item && this.heldDown(event)) {
      event.preventDefault();
      this.finish(item);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    if (this.held.includes(event.key as Modifier)) this.finish(this.selected());
  };

  private readonly onBlur = () => {
    this.close();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.element.contains(event.target as Node)) this.close();
  };

  private list(side: SwitcherSide): Child {
    const { state, options } = this;
    /** What an empty list says: under a query that matches nothing, the files' search's words. */
    const empty = () => {
      const other = side === 'left' ? 'right' : 'left';
      // Only speed search types a query.
      if (state.query !== '' && listOf(state, other).length === 0) {
        return side === 'right' ? (options.search as { nothing: string }).nothing : '';
      }
      return options.empty?.[side] ?? '';
    };
    return (
      <div
        class={`cerebro-switcher__list cerebro-switcher__list--${side}`}
        role="listbox"
        data-side={side}
      >
        {() => {
          const items = listOf(state, side);
          return items.length > 0 ? (
            items.map((item, index) => this.row(side, item, index))
          ) : (
            <div class="cerebro-switcher__empty">{empty()}</div>
          );
        }}
      </div>
    );
  }

  private row(side: SwitcherSide, item: T, index: number): Child {
    const { state } = this;
    const selected = () => state.side === side && state.index === index;
    return (
      <div
        class={() =>
          selected() ? 'cerebro-popup-item cerebro-popup-item--highlighted' : 'cerebro-popup-item'
        }
        role="option"
        aria-selected={() => String(selected())}
        data-index={index}
        on:mousedown={(event) => {
          // Keeps the focus in the Switcher.
          event.preventDefault();
        }}
        on:click={() => {
          this.finish(item);
        }}
      >
        <span class="cerebro-popup-item__icon">{item.icon?.()}</span>
        <span class="cerebro-popup-item__label">
          {highlighted(
            item.label,
            state.query === '' ? undefined : match(state.query, item.label)?.indices,
          )}
        </span>
        <span class="cerebro-popup-item__detail">{item.detail ?? ''}</span>
        <span class="cerebro-popup-item__shortcut">{item.mnemonic ?? ''}</span>
      </div>
    );
  }

  private view(): Child {
    const { state } = this;
    return [
      <div class="cerebro-switcher__header">
        <div class="cerebro-switcher__title">{this.options.title}</div>
        {this.options.header?.()}
      </div>,
      () =>
        state.query === '' ? null : (
          <div class="cerebro-switcher__search" role="status">
            {state.query}
          </div>
        ),
      <div class="cerebro-switcher__lists">
        {state.left.length > 0 ? this.list('left') : null}
        {this.list('right')}
      </div>,
      <div class="cerebro-switcher__status">{() => this.selected()?.status ?? ''}</div>,
    ];
  }
}

/** Opens the Switcher. */
export function openSwitcher<T extends SwitcherItem>(
  options: SwitcherOptions<T>,
): SwitcherHandle<T> {
  return new Switcher(options);
}
