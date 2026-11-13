// The Switcher, as IntelliJ's (Ctrl+Tab): a popup in the window's centre with two lists, the tool
// windows on the left and the open files on the right, and the selected file's folder below them.
//
// Opened with modifiers held (Ctrl of Ctrl+Tab), it goes as they're let go, choosing what's
// selected: Tab, held, moves on, Shift+Tab back, from one list's end into the other. Opened
// without (from a menu), it stays until Enter or Escape. Up and Down move in a list, Left and
// Right between them, Delete or Backspace closes the selected item, and an item's mnemonic (with
// the modifiers held, if any) chooses it.
//
// From IntelliJ's source (Switcher.kt, SwitcherActions.kt): all of the above.

import { type Child, focusedElement, render } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';

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
}

export interface SwitcherHandle<T> {
  /** Resolves when it closes: with the item chosen, or undefined. */
  readonly result: Promise<T | undefined>;
  readonly open: boolean;
  close(): void;
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

  constructor(options: SwitcherOptions<SwitcherItem & T>) {
    this.left = options.left;
    this.right = options.right;
    this.side = options.initial.side;
    this.index = options.initial.index;
    makeObservable(this);
  }
}

/** A side's items; the selected side's by default. */
const listOf = <T,>(state: SwitcherState<T>, side: SwitcherSide = state.side): readonly T[] =>
  side === 'left' ? state.left : state.right;

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

  /** In the window's centre, as IntelliJ's. */
  private place(): void {
    const { width, height } = this.element.getBoundingClientRect();
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
    if (state.side === 'left') state.left = list;
    else state.right = list;
    if (list.length > 0) this.select(state.side, Math.min(state.index, list.length - 1));
    else this.cross(state.side === 'left' ? 'right' : 'left');
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
    const { state } = this;
    return (
      <div
        class={`cerebro-switcher__list cerebro-switcher__list--${side}`}
        role="listbox"
        data-side={side}
      >
        {() =>
          listOf(state, side).map((item, index) => (
            <div
              class={() =>
                state.side === side && state.index === index
                  ? 'cerebro-popup-item cerebro-popup-item--highlighted'
                  : 'cerebro-popup-item'
              }
              role="option"
              aria-selected={() => String(state.side === side && state.index === index)}
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
              <span class="cerebro-popup-item__label">{item.label}</span>
              <span class="cerebro-popup-item__detail">{item.detail ?? ''}</span>
              <span class="cerebro-popup-item__shortcut">{item.mnemonic ?? ''}</span>
            </div>
          ))
        }
      </div>
    );
  }

  private view(): Child {
    return [
      <div class="cerebro-switcher__title">{this.options.title}</div>,
      <div class="cerebro-switcher__lists">
        {this.state.left.length > 0 ? this.list('left') : null}
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
