// Popups with a search field over a list, as IntelliJ's Search Everywhere, Go to File and branch
// popup: typing filters the list, Up and Down move through it (wrapping), Page Up and Page Down
// jump, Enter chooses, Escape closes. They aren't modal: a press outside or leaving the window
// closes them. Keys typed into one don't reach the app's shortcuts.
//
// The caller gives the items for each query, so it decides how to search (fuzzyFilter for a list in
// hand, the host for a repo's files). Items may be grouped, with a header over each group.

import { onCleanup, render, type Child } from '@cerebro-ide/jsx';
import { computed, makeObservable, signal, type Signal } from '@cerebro-ide/reactive';
import { SearchHistoryButton, showSearchHistory, showsHistory } from './history.js';

export interface PickerItem {
  label: string;
  /** Shown muted after the label: a file's directory, for example. */
  detail?: string;
  /** Shown at the right, muted: a command's shortcut. */
  shortcut?: string;
  /** How deep in a tree it is, indented as deep: File Structure's members under their types. */
  depth?: number;
  icon?: () => Child;
  /**
   * Clicking the item's icon runs this instead of choosing the item, and the popup stays open:
   * IntelliJ's branches popup marks a favorite so. The list follows what its items read.
   */
  iconClick?: () => void;
  /** Items of one group are listed together, under a header with its name. */
  group?: string;
  /** Indices in the label of the characters that matched the query, shown bold. */
  highlight?: readonly number[];
  /**
   * A close button at the item's end, shown while it's hovered or highlighted: IntelliJ's list of
   * hidden tabs has one per tab. The list follows what its items read, so a closed one goes.
   */
  close?: { label: string; run: () => void };
  /**
   * An item that shows more instead of being chosen: Search Everywhere's "… more" under a kind in
   * All, as IntelliJ's. Choosing it runs this, and the popup stays open. Drawn as the headers are.
   */
  more?: () => void;
  /**
   * A submenu, as IntelliJ's branches popup has for each branch: an arrow at the item's end.
   * Choosing the item, or Right at the end of the search field, opens it beside the row, the popup
   * staying open behind it. It resolves with whether the popup closes too: something was chosen in
   * it, or it was dismissed by a press outside.
   */
  submenu?: (row: HTMLElement) => Promise<boolean>;
  /**
   * An option, checked or not, as IntelliJ's options popups have (the Pull dialog's Add Pull
   * Options): choosing it runs `run`, and the popup stays open. One that can't go with those
   * checked is greyed, and choosing it does nothing. Its check mark is its `icon`.
   */
  option?: { checked: boolean; enabled: boolean; run: () => void };
}

/**
 * Where a popup opens: below an element (a toolbar button) or a place (an editor's caret), or at
 * the top centre of the window.
 */
export type PopupPosition = { below: Pick<Element, 'getBoundingClientRect'> } | 'top';

export interface PickerOptions<T extends PickerItem> {
  /** What is being chosen, for screen readers. */
  label: string;
  /** The items for a query. Read reactively, so the list follows what it reads. */
  items: (query: string) => readonly T[];
  position: PopupPosition;
  placeholder?: string;
  /** Default: 600 at the top, 360 below an element. */
  width?: number;
  /** Shown when nothing matches. Default: Nothing found. */
  empty?: string;
  /**
   * Called as the query changes, to start a search elsewhere (the host's index, say) whose results
   * `items` then reads. (`items` itself mustn't start one: it runs as a computed value.)
   */
  onQueryChange?: (query: string) => void;
  /** The most rows drawn; more matches are counted below them. Default: 200. */
  limit?: number;
  /** Presses inside this element don't close the popup; it handles them (the button it opened from). */
  owner?: Element;
  /** Above the search field: a title, and what was found, as Find in Files'. */
  header?: () => Child;
  /** Beside the search field, at its right: options such as Find in Files' Match Case. */
  options?: () => Child;
  /** Below the search field, above the list: Find in Files' scopes, say. */
  toolbar?: () => Child;
  /** Below the list: the highlighted item shown in full (Find in Files' code). Read reactively. */
  preview?: (item: T | undefined) => Child;
  /** A line below the list, IntelliJ's ad text: a hint, such as the Log filters' "Press Delete…". */
  ad?: string;
  /** Keys pressed in the search field, before the popup's own; returns whether it handled one. */
  onKey?: (event: KeyboardEvent) => boolean;
  /**
   * The item highlighted as it opens, until the query changes (Recent Files': the second); or, as a
   * function, chosen from the items listed as it opens and for each query (File Structure's: the
   * symbol at the caret, then the first that matches).
   */
  initial?: number | ((items: readonly T[]) => number);
  /**
   * Letters the popup handles with Alt (its options': Find in Files' Alt+C), which the menu bar then
   * leaves to it (`data-alt-keys`).
   */
  altKeys?: string;
  /**
   * The search field's history, as IntelliJ's Find in Files' (SearchTextArea): its button at the
   * field's start, and Alt+Down; the text chosen is put in the field, as if typed.
   */
  history?: { label: string; icon: Child; texts: () => readonly string[] };
}

export interface PickerHandle<T> {
  /** Resolves when the popup closes: with the chosen item, or undefined. */
  readonly result: Promise<T | undefined>;
  readonly open: boolean;
  close(): void;
  /** The item highlighted now: Replace in Files' Replace acts on it. */
  highlighted(): T | undefined;
}

/** The most rows drawn by default: thousands of matches would be slow to draw, and of no use. */
const LIMIT = 200;

/** Rows a Page Up or Page Down moves. */
const PAGE = 10;

/** The space between a popup and the window's top edge, or the element it opens below. */
const GAP = 4;

/**
 * Where the pointer was before its latest move, from every move in the window: a list shifting
 * under a still pointer makes the browser send moves at the same place, which mustn't take over
 * from the keyboard. Positions, not movementX and movementY: Chrome gave those as 0 for
 * Playwright's moves (measured in CI), and the guard must not depend on how a move was made.
 */
let previousPointer: { x: number; y: number } | undefined;
let pointer: { x: number; y: number } | undefined;
window.addEventListener(
  'pointermove',
  (event) => {
    previousPointer = pointer;
    pointer = { x: event.clientX, y: event.clientY };
  },
  { capture: true, passive: true },
);

/** Whether a move is the pointer's own, not the page's moving under it. */
function pointerMoved(event: PointerEvent): boolean {
  return previousPointer?.x !== event.clientX || previousPointer.y !== event.clientY;
}

class PickerState {
  query = '';
  /** The highlighted item's index; -1 for none. */
  index = 0;

  constructor() {
    makeObservable(this);
  }
}

/**
 * A drawn row, kept while the list has an item that reads the same: results that come in later
 * (Search Everywhere's, one kind at a time) move it instead of replacing it, so a press on it
 * still lands on it. Its item is the latest that reads so.
 */
interface Row<T> {
  node: Node;
  index: Signal<number>;
  item: T;
  dispose: () => void;
}

/** What a row shows of its item: items that read the same share a row. */
function rowKey(item: PickerItem): string {
  return JSON.stringify([
    item.group,
    item.label,
    item.detail,
    item.shortcut,
    item.depth,
    item.highlight,
    item.more !== undefined,
    item.close?.label,
    item.submenu !== undefined,
    item.option?.checked,
    item.option?.enabled,
  ]);
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** A label with its matched characters in bold. */
function highlighted(label: string, highlight: readonly number[] | undefined): Child {
  if (!highlight?.length) return label;
  const marked = new Set(highlight);
  const parts: Child[] = [];
  let run = '';
  let bold = false;
  const flush = () => {
    if (run) parts.push(bold ? <b class="cerebro-popup-item__match">{run}</b> : run);
    run = '';
  };
  // Indices are UTF-16 ones, as match() gives them.
  for (let i = 0; i < label.length; i++) {
    if (marked.has(i) !== bold) {
      flush();
      bold = !bold;
    }
    run += label[i] as string;
  }
  flush();
  return parts;
}

class Picker<T extends PickerItem> implements PickerHandle<T> {
  open = true;
  readonly result: Promise<T | undefined>;
  private resolve!: (value: T | undefined) => void;
  private readonly state = new PickerState();
  private readonly items;
  private readonly element: HTMLElement;
  private readonly restoreFocus: HTMLElement;
  private readonly dispose: () => void;
  private rows = new Map<string, Row<T>>();
  /** A submenu open beside a row: presses outside are its to handle. */
  private submenuOpen = false;

  constructor(private readonly options: PickerOptions<T>) {
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.items = computed(() => options.items(this.state.query));
    this.state.index = this.initial(
      typeof options.initial === 'function' ? undefined : options.initial,
    );
    // At least the body: a document always has a focused element.
    this.restoreFocus = document.activeElement as HTMLElement;
    this.element = document.createElement('div');
    this.element.className = 'cerebro-popup';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', options.label);
    if (options.altKeys) this.element.dataset['altKeys'] = options.altKeys;
    const top = options.position === 'top';
    this.element.style.width = `${String(options.width ?? (top ? 600 : 360))}px`;
    document.body.append(this.element);
    const handle = render(() => this.view(), this.element);
    this.dispose = () => {
      handle.dispose();
    };
    this.place();
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onBlur);
    (this.element.querySelector('.cerebro-popup__search') as HTMLElement).focus();
  }

  close(): void {
    this.finish(undefined);
  }

  /** The item to highlight in the list as it is: `at`, or the one `initial` chooses, if it's there. */
  private initial(at = 0): number {
    const items = this.items.get();
    const { initial } = this.options;
    const index = typeof initial === 'function' ? initial(items) : at;
    return Math.max(0, Math.min(index, items.length - 1));
  }

  highlighted(): T | undefined {
    return this.items.peek()[this.state.index];
  }

  private finish(result: T | undefined): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onBlur);
    this.dispose();
    this.element.remove();
    this.restoreFocus.focus();
    this.resolve(result);
  }

  private place(): void {
    const { position } = this.options;
    const width = this.element.getBoundingClientRect().width;
    let left: number;
    let top: number;
    if (position === 'top') {
      left = (window.innerWidth - width) / 2;
      top = window.innerHeight * 0.15;
    } else {
      const anchor = position.below.getBoundingClientRect();
      left = anchor.left;
      top = anchor.bottom + GAP;
    }
    left = Math.max(GAP, Math.min(left, window.innerWidth - width - GAP));
    this.element.style.left = `${String(Math.round(left))}px`;
    this.element.style.top = `${String(Math.round(top))}px`;
    this.element.style.maxHeight = `${String(Math.round(window.innerHeight - top - GAP))}px`;
  }

  private readonly onBlur = () => {
    this.close();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.submenuOpen) return;
    const target = event.target as Node;
    // A popup opened over this one (its search history) is part of it while it's open.
    const over = (target as Element).closest('.cerebro-popup');
    const later =
      over != null &&
      (this.element.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (!this.element.contains(target) && !this.options.owner?.contains(target) && !later) {
      this.close();
    }
  };

  /** Highlights the item at `index`, scrolling it into view. */
  private highlight(index: number): void {
    this.state.index = index;
    this.element
      .querySelector(`[data-index="${String(index)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  private readonly onKey = (event: KeyboardEvent) => {
    // Keys stay in the popup: the app's shortcuts don't run while typing in it.
    event.stopPropagation();
    if (event.isComposing) return;
    if (this.options.onKey?.(event)) {
      event.preventDefault();
      return;
    }
    const count = Math.min(this.items.get().length, this.options.limit ?? LIMIT);
    const { index } = this.state;
    const field = event.currentTarget as HTMLInputElement;
    if (
      event.key === 'ArrowRight' &&
      this.items.get()[index]?.submenu &&
      field.selectionStart === field.value.length
    ) {
      event.preventDefault();
      this.choose(index);
      return;
    }
    /** Highlights another item; there's none to move to in an empty list. */
    const go = (to: number) => {
      if (count) this.highlight(to);
    };
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        go((index + 1) % count);
      },
      ArrowUp: () => {
        go((index - 1 + count) % count);
      },
      PageDown: () => {
        go(Math.min(index + PAGE, count - 1));
      },
      PageUp: () => {
        go(Math.max(index - PAGE, 0));
      },
      Enter: () => {
        this.choose(index);
      },
      Escape: () => {
        this.close();
      },
      Tab: () => undefined,
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  private choose(index: number): void {
    const item = this.items.get()[index];
    if (item?.more) item.more();
    else if (item?.option) {
      if (item.option.enabled) item.option.run();
    } else if (item?.submenu) void this.openSubmenu(item.submenu, index);
    else if (item) this.finish(item);
  }

  /** Opens an item's submenu beside its row; the popup closes after it if it says so. */
  private async openSubmenu(submenu: (row: HTMLElement) => Promise<boolean>, index: number) {
    if (this.submenuOpen) return;
    this.highlight(index);
    const row = this.element.querySelector(`[data-index="${String(index)}"]`) as HTMLElement;
    this.submenuOpen = true;
    const close = await submenu(row);
    this.submenuOpen = false;
    if (close) this.finish(undefined);
  }

  /** Draws a row for an item, at an index that changes as items come in before it. */
  private row(item: T, at: number): Row<T> {
    const { state } = this;
    const index = signal(at);
    const fragment = new DocumentFragment();
    const rendered = render(
      () => (
        <div
          class={() =>
            cls(
              'cerebro-popup-item',
              item.more && 'cerebro-popup-item--more',
              item.option?.enabled === false && 'cerebro-popup-item--disabled',
              state.index === index.get() && 'cerebro-popup-item--highlighted',
            )
          }
          role="option"
          aria-selected={() => String(state.index === index.get())}
          data-index={() => index.get()}
          on:pointermove={(event) => {
            // Only a pointer that really moves takes over from the keyboard.
            if (pointerMoved(event)) state.index = index.peek();
          }}
          on:mousedown={(event) => {
            // Keeps the focus in the search field.
            event.preventDefault();
          }}
          on:click={() => {
            this.choose(index.peek());
          }}
        >
          <span
            class="cerebro-popup-item__icon"
            on:click={(event) => {
              const click = row.item.iconClick;
              if (!click) return;
              event.stopPropagation();
              click();
            }}
          >
            {item.icon?.()}
          </span>
          <span class="cerebro-popup-item__label">{highlighted(item.label, item.highlight)}</span>
          <span class="cerebro-popup-item__detail">{item.detail ?? ''}</span>
          <span class="cerebro-popup-item__shortcut">{item.shortcut ?? ''}</span>
          {item.submenu ? (
            <span class="cerebro-popup-item__arrow">
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path
                  d="M6 3.5l4.5 4.5L6 12.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
          ) : null}
          {item.close ? (
            <button
              type="button"
              class="cerebro-popup-item__close"
              aria-label={item.close.label}
              tabIndex={-1}
              on:click={(event) => {
                // Closes the item, not the popup.
                event.stopPropagation();
                row.item.close?.run();
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M4.5 4.5l7 7M11.5 4.5l-7 7"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
      ),
      fragment,
    );
    if (item.depth) {
      (fragment.querySelector('.cerebro-popup-item') as HTMLElement).style.setProperty(
        '--cerebro-popup-depth',
        String(item.depth),
      );
    }
    const row: Row<T> = {
      // The fragment keeps render's markers; the row itself goes in the list.
      node: fragment.querySelector('.cerebro-popup-item') as Node,
      index,
      item,
      dispose: () => {
        rendered.dispose();
      },
    };
    return row;
  }

  private view(): Child {
    const { options, state } = this;
    onCleanup(() => {
      for (const row of this.rows.values()) row.dispose();
    });
    const { history } = options;
    let row: HTMLElement | undefined;
    const showHistory = (
      shown: NonNullable<PickerOptions<T>['history']>,
      field: HTMLInputElement,
    ) => {
      void showSearchHistory({
        label: shown.label,
        texts: shown.texts(),
        below: row as HTMLElement,
      }).then((text) => {
        if (text === undefined) return;
        field.value = text;
        state.query = text;
        state.index = this.initial();
        options.onQueryChange?.(text);
      });
    };
    const input = (
      <input
        class="cerebro-popup__search"
        type="text"
        spellcheck={false}
        placeholder={options.placeholder ?? ''}
        aria-label={options.label}
        aria-controls="cerebro-popup-list"
        on:input={(event) => {
          state.query = (event.currentTarget as HTMLInputElement).value;
          state.index = this.initial();
          options.onQueryChange?.(state.query);
        }}
        on:keydown={(event) => {
          if (history && showsHistory(event)) {
            event.preventDefault();
            event.stopPropagation();
            showHistory(history, event.currentTarget as HTMLInputElement);
            return;
          }
          this.onKey(event);
        }}
      />
    ) as HTMLInputElement;
    return [
      options.header ? <div class="cerebro-popup__header">{options.header()}</div> : null,
      options.options || history ? (
        <div
          class="cerebro-popup__search-row"
          ref={(element: HTMLElement) => {
            row = element;
          }}
        >
          {history ? (
            <SearchHistoryButton
              label={history.label}
              icon={history.icon}
              show={() => {
                showHistory(history, input);
              }}
            />
          ) : null}
          {input}
          {options.options ? <div class="cerebro-popup__options">{options.options()}</div> : null}
        </div>
      ) : (
        input
      ),
      options.toolbar ? <div class="cerebro-popup__toolbar">{options.toolbar()}</div> : null,
      <div class="cerebro-popup__list" id="cerebro-popup-list" role="listbox">
        {() => {
          const items = this.items.get();
          if (items.length === 0) {
            return <div class="cerebro-popup__empty">{options.empty ?? 'Nothing found'}</div>;
          }
          const limit = options.limit ?? LIMIT;
          const more = items.length - limit;
          const kept = new Map<string, Row<T>>();
          const rows = items.slice(0, limit).map((item, index) => {
            const key = rowKey(item);
            // Items that read the same as an earlier one get rows of their own.
            let unique = key;
            for (let n = 1; kept.has(unique); n++) unique = `${key}#${String(n)}`;
            let row = this.rows.get(unique);
            if (row) {
              row.item = item;
              row.index.set(index);
            } else row = this.row(item, index);
            kept.set(unique, row);
            return [
              item.group !== undefined && item.group !== items[index - 1]?.group ? (
                <div class="cerebro-popup__group" role="presentation">
                  {item.group}
                </div>
              ) : null,
              row.node,
            ];
          });
          for (const [key, row] of this.rows) if (!kept.has(key)) row.dispose();
          this.rows = kept;
          return [
            ...rows,
            more > 0 ? (
              <div class="cerebro-popup__more">
                {String(more)} more; type more to narrow them down
              </div>
            ) : null,
          ];
        }}
      </div>,
      options.preview ? (
        <div class="cerebro-popup__preview">
          {() =>
            (options.preview as NonNullable<typeof options.preview>)(this.items.get()[state.index])
          }
        </div>
      ) : null,
      options.ad === undefined ? null : <div class="cerebro-popup__ad">{options.ad}</div>,
    ];
  }
}

/** Opens a popup to pick an item from a searchable list. */
export function openPicker<T extends PickerItem>(options: PickerOptions<T>): PickerHandle<T> {
  return new Picker(options);
}
