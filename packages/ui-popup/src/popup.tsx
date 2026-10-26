// Popups with a search field over a list, as IntelliJ's Search Everywhere, Go to File and branch
// popup: typing filters the list, Up and Down move through it (wrapping), Page Up and Page Down
// jump, Enter chooses, Escape closes. They aren't modal: a press outside or leaving the window
// closes them. Keys typed into one don't reach the app's shortcuts.
//
// The caller gives the items for each query, so it decides how to search (fuzzyFilter for a list in
// hand, the host for a repo's files). Items may be grouped, with a header over each group.

import { render, type Child } from '@cerebro-ide/jsx';
import { computed, makeObservable } from '@cerebro-ide/reactive';

export interface PickerItem {
  label: string;
  /** Shown muted after the label: a file's directory, for example. */
  detail?: string;
  /** Shown at the right, muted: a command's shortcut. */
  shortcut?: string;
  icon?: () => Child;
  /** Items of one group are listed together, under a header with its name. */
  group?: string;
  /** Indices in the label of the characters that matched the query, shown bold. */
  highlight?: readonly number[];
}

/** Where a popup opens: below an element (a toolbar button), or at the top centre of the window. */
export type PopupPosition = { below: Element } | 'top';

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
}

export interface PickerHandle<T> {
  /** Resolves when the popup closes: with the chosen item, or undefined. */
  readonly result: Promise<T | undefined>;
  readonly open: boolean;
  close(): void;
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

  constructor(private readonly options: PickerOptions<T>) {
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.items = computed(() => options.items(this.state.query));
    // At least the body: a document always has a focused element.
    this.restoreFocus = document.activeElement as HTMLElement;
    this.element = document.createElement('div');
    this.element.className = 'cerebro-popup';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', options.label);
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
    const target = event.target as Node;
    if (!this.element.contains(target) && !this.options.owner?.contains(target)) this.close();
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
    const count = Math.min(this.items.get().length, this.options.limit ?? LIMIT);
    const { index } = this.state;
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
    if (item) this.finish(item);
  }

  private view(): Child {
    const { options, state } = this;
    return [
      <input
        class="cerebro-popup__search"
        type="text"
        spellcheck={false}
        placeholder={options.placeholder ?? ''}
        aria-label={options.label}
        aria-controls="cerebro-popup-list"
        on:input={(event) => {
          state.query = (event.currentTarget as HTMLInputElement).value;
          state.index = 0;
          options.onQueryChange?.(state.query);
        }}
        on:keydown={this.onKey}
      />,
      <div class="cerebro-popup__list" id="cerebro-popup-list" role="listbox">
        {() => {
          const items = this.items.get();
          if (items.length === 0) {
            return <div class="cerebro-popup__empty">{options.empty ?? 'Nothing found'}</div>;
          }
          const limit = options.limit ?? LIMIT;
          const more = items.length - limit;
          return [
            ...items.slice(0, limit).map((item, index) => [
              item.group !== undefined && item.group !== items[index - 1]?.group ? (
                <div class="cerebro-popup__group" role="presentation">
                  {item.group}
                </div>
              ) : null,
              <div
                class={() =>
                  cls(
                    'cerebro-popup-item',
                    state.index === index && 'cerebro-popup-item--highlighted',
                  )
                }
                role="option"
                aria-selected={() => String(state.index === index)}
                data-index={index}
                on:pointermove={(event) => {
                  // Only a pointer that really moves takes over from the keyboard.
                  if (pointerMoved(event)) state.index = index;
                }}
                on:mousedown={(event) => {
                  // Keeps the focus in the search field.
                  event.preventDefault();
                }}
                on:click={() => {
                  this.choose(index);
                }}
              >
                <span class="cerebro-popup-item__icon">{item.icon?.()}</span>
                <span class="cerebro-popup-item__label">
                  {highlighted(item.label, item.highlight)}
                </span>
                <span class="cerebro-popup-item__detail">{item.detail ?? ''}</span>
                <span class="cerebro-popup-item__shortcut">{item.shortcut ?? ''}</span>
              </div>,
            ]),
            more > 0 ? (
              <div class="cerebro-popup__more">
                {String(more)} more; type more to narrow them down
              </div>
            ) : null,
          ];
        }}
      </div>,
    ];
  }
}

/** Opens a popup to pick an item from a searchable list. */
export function openPicker<T extends PickerItem>(options: PickerOptions<T>): PickerHandle<T> {
  return new Picker(options);
}
