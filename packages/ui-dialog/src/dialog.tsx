// Modal dialogs, as IntelliJ's: a title bar with a close button, the content, and OK and Cancel at
// the bottom right (Cancel first on macOS, OK first elsewhere). While one is open, the rest of the
// window takes no pointer input, keys stay inside it (so the app's shortcuts don't run), and Tab
// cycles through its controls. Enter accepts, unless the focus is on a button or in a multi-line
// field; Escape cancels. The title bar drags it. Closing it gives the focus back to where it was.
//
// A dialog may open another; the newest one is on top and has the keyboard.
//
// OK may have options, as IntelliJ's option buttons (the Push dialog's Force Push): an arrow beside
// it lists them, and the button does the first one enabled.

import { type Child, focusedElement, render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';

export interface DialogOk<T> {
  /** Default: OK. */
  label?: string;
  /** Read reactively: the OK button is disabled, and Enter does nothing, while this is false. */
  enabled?: () => boolean;
  /**
   * Checked when OK is pressed, before accepting, as IntelliJ's Define Remote checks its URL: OK is
   * disabled while it runs, and the dialog stays open when it gives false (showing why is the
   * content's). It doesn't reject.
   */
  check?: () => Promise<boolean>;
  /** What accepting the dialog gives. */
  accept: () => T;
  /** Its tooltip, read reactively: why it's disabled, say. */
  description?: () => string | undefined;
  /**
   * More actions, listed on the arrow beside OK. The button does the first enabled one of OK and
   * these (as IntelliJ's Push dialog does its Fetch, when a push can't go without one).
   */
  options?: DialogOption<T>[];
}

/** One of OK's options. */
export interface DialogOption<T> {
  label: string;
  /** Read reactively, as OK's. */
  enabled?: () => boolean;
  /** Read reactively: whether the arrow lists it. Default: it does. */
  visible?: () => boolean;
  description?: () => string | undefined;
  check?: () => Promise<boolean>;
  /** What accepting the dialog with it gives; or, with `run` instead, it runs and stays open. */
  accept?: () => T;
  run?: () => void;
}

export interface DialogOptions<T> {
  title: string;
  /** The body, given the dialog's handle so it can close it. */
  content: (dialog: DialogHandle<T>) => Child;
  /** The OK button. Without it, the dialog has only Cancel's button, named Close. */
  ok?: DialogOk<T>;
  /**
   * An Apply button, as in IntelliJ's Settings: runs without closing. OK runs it too before
   * accepting, while it's enabled.
   */
  apply?: { enabled?: () => boolean; run: () => void };
  /**
   * More buttons that close the dialog with a result, as OK does but without Enter: IntelliJ's
   * Open Project dialog has This Window (OK) and New Window. They go beside OK.
   */
  choices?: { label: string; accept: () => T }[];
  /** Options at the buttons' left, as IntelliJ's Push dialog has Push tags there. */
  footer?: () => Child;
  /** Default: Cancel, or Close without an OK button. */
  cancelLabel?: string;
  /** The dialog's width in pixels; by default it fits its content. */
  width?: number;
  /** Which order the buttons go in. Default: from the browser's platform. */
  platform?: 'mac' | 'other';
}

export interface DialogHandle<T> {
  /** Resolves when the dialog closes: with what OK accepted, or undefined if cancelled. */
  readonly result: Promise<T | undefined>;
  readonly open: boolean;
  close(result?: T): void;
}

/** Elements Tab moves between. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Keeps at least `MARGIN` pixels of the title bar inside the window while dragging. */
const MARGIN = 40;

class Dialog<T> implements DialogHandle<T> {
  open = true;
  readonly result: Promise<T | undefined>;
  private resolve!: (value: T | undefined) => void;
  private readonly layer: HTMLElement;
  private readonly element: HTMLElement;
  private readonly restoreFocus: HTMLElement;
  private readonly dispose: () => void;
  /** OK and its options. */
  private readonly actions: DialogOption<T>[];

  constructor(private readonly options: DialogOptions<T>) {
    const { ok } = options;
    this.actions = ok ? [{ ...ok, label: ok.label ?? 'OK' }, ...(ok.options ?? [])] : [];
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
    // Inside an editor's shadow root too.
    this.restoreFocus = focusedElement();
    this.layer = document.createElement('div');
    this.layer.className = 'cerebro-dialog-layer';
    // Presses outside the dialog don't take the focus from it.
    this.layer.addEventListener('mousedown', (event) => {
      if (event.target === this.layer) event.preventDefault();
    });
    document.body.append(this.layer);
    const handle = render(() => this.view(), this.layer);
    this.dispose = () => {
      handle.dispose();
    };
    this.element = this.layer.querySelector('.cerebro-dialog') as HTMLElement;
    this.center();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onStrayKey, true);
    stack.push(this as Dialog<unknown>);
    this.focusFirst();
  }

  close(result?: T): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onStrayKey, true);
    stack.splice(stack.indexOf(this as Dialog<unknown>), 1);
    this.dispose();
    this.layer.remove();
    this.restoreFocus.focus();
    this.resolve(result);
  }

  /** While an action's check runs. */
  private readonly checking = signal(false);
  /** Whether OK's options are listed. */
  private readonly listing = signal(false);

  /** What the OK button does: the first action enabled, else OK. Read reactively. */
  private current(): DialogOption<T> | undefined {
    return this.actions.find((action) => action.enabled?.() ?? true) ?? this.actions[0];
  }

  private enabled(action: DialogOption<T> | undefined): boolean {
    return !this.checking.get() && action !== undefined && (action.enabled?.() ?? true);
  }

  private accept(): void {
    this.perform(this.current());
  }

  private perform(action: DialogOption<T> | undefined): void {
    if (!action || !this.enabled(action)) return;
    if (action.check) {
      this.checking.set(true);
      void action.check().then((passed) => {
        this.checking.set(false);
        // Not if it was cancelled meanwhile.
        if (passed && this.open) this.finish(action);
      });
    } else this.finish(action);
  }

  private finish(action: DialogOption<T>): void {
    if (!action.accept) {
      action.run?.();
      return;
    }
    const { apply } = this.options;
    if (apply && (apply.enabled?.() ?? true)) apply.run();
    this.close(action.accept());
  }

  private center(): void {
    const rect = this.element.getBoundingClientRect();
    this.moveTo((window.innerWidth - rect.width) / 2, (window.innerHeight - rect.height) / 2);
  }

  /** Moves the dialog, keeping its title bar reachable. */
  private moveTo(left: number, top: number): void {
    const width = this.element.getBoundingClientRect().width;
    const x = Math.min(Math.max(left, MARGIN - width), window.innerWidth - MARGIN);
    const y = Math.min(Math.max(top, 0), window.innerHeight - MARGIN);
    this.element.style.left = `${String(Math.round(x))}px`;
    this.element.style.top = `${String(Math.round(y))}px`;
  }

  private readonly onResize = () => {
    const rect = this.element.getBoundingClientRect();
    this.moveTo(rect.left, rect.top);
  };

  private focusables(): HTMLElement[] {
    return [...this.element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (e) => e.tabIndex >= 0,
    );
  }

  /** The content's first control, else OK, else the dialog itself. */
  private focusFirst(): void {
    const first =
      this.element.querySelector<HTMLElement>(`.cerebro-dialog__content :is(${FOCUSABLE})`) ??
      this.element.querySelector<HTMLElement>('.cerebro-dialog__button--primary:not([disabled])') ??
      this.element;
    first.focus();
  }

  private readonly onKey = (event: KeyboardEvent) => {
    // Keys stay in the dialog: the app's shortcuts don't run behind it.
    event.stopPropagation();
    if (event.isComposing) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (
      event.key === 'Enter' &&
      !(target instanceof HTMLButtonElement) &&
      !(target instanceof HTMLTextAreaElement)
    ) {
      event.preventDefault();
      this.accept();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const all = this.focusables();
      const index = all.indexOf(target);
      const next = event.shiftKey
        ? (all[index - 1] ?? all.at(-1))
        : index < 0
          ? all[0]
          : (all[index + 1] ?? all[0]);
      next?.focus();
    }
  };

  /**
   * Keys while nothing has the focus, as when the browser takes it from a control disabled or
   * removed (a button disabled while its action runs): the newest dialog's still, not the app's.
   */
  private readonly onStrayKey = (event: KeyboardEvent) => {
    if (stack.at(-1) === this && document.activeElement === document.body) this.onKey(event);
  };

  private readonly onDragStart = (down: PointerEvent) => {
    if (down.button !== 0 || (down.target as Element).closest('button')) return;
    down.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const move = (event: PointerEvent) => {
      this.moveTo(
        rect.left + event.clientX - down.clientX,
        rect.top + event.clientY - down.clientY,
      );
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  private view(): Child {
    const { options } = this;
    const { ok } = options;
    const platform =
      options.platform ?? (navigator.platform.includes('Mac') ? 'mac' : ('other' as const));
    const okButton = ok ? (
      <button
        type="button"
        class="cerebro-dialog__button cerebro-dialog__button--primary"
        disabled={() => !this.enabled(this.current())}
        title={() => this.current()?.description?.() ?? ''}
        on:click={() => {
          this.accept();
        }}
      >
        {() => this.current()?.label}
      </button>
    ) : null;
    const { apply } = options;
    const applyButton = apply ? (
      <button
        type="button"
        class="cerebro-dialog__button"
        disabled={() => !(apply.enabled?.() ?? true)}
        on:click={() => {
          apply.run();
        }}
      >
        Apply
      </button>
    ) : null;
    const cancelButton = (
      <button
        type="button"
        class="cerebro-dialog__button"
        on:click={() => {
          this.close();
        }}
      >
        {options.cancelLabel ?? (ok ? 'Cancel' : 'Close')}
      </button>
    );
    const choices = (options.choices ?? []).map((choice) => (
      <button
        type="button"
        class="cerebro-dialog__button"
        on:click={() => {
          this.close(choice.accept());
        }}
      >
        {choice.label}
      </button>
    ));
    const titleId = `cerebro-dialog-title-${String(++dialogs)}`;
    return (
      <div
        class="cerebro-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={options.width === undefined ? {} : { width: `${String(options.width)}px` }}
        on:keydown={this.onKey}
      >
        <div class="cerebro-dialog__title" on:pointerdown={this.onDragStart}>
          <span id={titleId}>{options.title}</span>
          <button
            type="button"
            class="cerebro-dialog__close"
            aria-label="Close"
            tabIndex={-1}
            on:click={() => {
              this.close();
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
        </div>
        <div class="cerebro-dialog__content">{options.content(this)}</div>
        <div class="cerebro-dialog__buttons">
          {options.footer ? <div class="cerebro-dialog__footer">{options.footer()}</div> : null}
          {platform === 'mac'
            ? [cancelButton, applyButton, ...choices.reverse(), this.withOptions(okButton)]
            : [this.withOptions(okButton), ...choices, cancelButton, applyButton]}
        </div>
      </div>
    );
  }

  /** The OK button, and the arrow beside it that lists its options, when it has some. */
  private withOptions(okButton: Child): Child {
    if (!this.options.ok?.options?.length) return okButton;
    let arrow!: HTMLButtonElement;
    /** The options the arrow lists: the visible ones, but not what the button does. */
    const listed = () => {
      const current = this.current();
      return this.actions.filter((a) => a !== current && (a.visible?.() ?? true));
    };
    const highlighted = signal(-1);
    const choose = (action: DialogOption<T>) => {
      if (!this.enabled(action)) return;
      this.listing.set(false);
      arrow.focus();
      this.perform(action);
    };
    return (
      <span class="cerebro-dialog__option-button">
        {okButton}
        <button
          type="button"
          class="cerebro-dialog__button cerebro-dialog__button--primary cerebro-dialog__arrow"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={() => String(this.listing.get())}
          disabled={() => this.checking.get() || listed().length === 0}
          ref={(button) => {
            arrow = button;
          }}
          on:click={() => {
            highlighted.set(-1);
            this.listing.set(!this.listing.peek());
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </button>
        {() =>
          this.listing.get() ? (
            <ul
              class="cerebro-dialog__options"
              role="menu"
              tabIndex={-1}
              ref={(menu) => {
                queueMicrotask(() => {
                  menu.focus();
                });
              }}
              on:focusout={() => {
                this.listing.set(false);
              }}
              on:keydown={(event) => {
                // Its keys: not the dialog's Enter and Escape.
                event.stopPropagation();
                event.preventDefault();
                const list = listed();
                const h = highlighted.peek();
                if (event.key === 'ArrowDown') highlighted.set((h + 1) % list.length);
                else if (event.key === 'ArrowUp') highlighted.set(h <= 0 ? list.length - 1 : h - 1);
                else if (event.key === 'Enter') {
                  const action = list[h];
                  if (action) choose(action);
                } else if (event.key === 'Escape' || event.key === 'Tab') {
                  this.listing.set(false);
                  arrow.focus();
                }
              }}
            >
              {() =>
                listed().map((action, index) => (
                  <li
                    role="menuitem"
                    class={() =>
                      [
                        'cerebro-dialog__option',
                        highlighted.get() === index ? 'cerebro-dialog__option--highlighted' : '',
                        this.enabled(action) ? '' : 'cerebro-dialog__option--disabled',
                      ]
                        .filter(Boolean)
                        .join(' ')
                    }
                    aria-disabled={() => String(!this.enabled(action))}
                    title={() => action.description?.() ?? ''}
                    on:pointerenter={() => {
                      highlighted.set(index);
                    }}
                    on:pointerdown={(event) => {
                      // Chosen without the list losing the focus first.
                      event.preventDefault();
                    }}
                    on:click={() => {
                      choose(action);
                    }}
                  >
                    {action.label}
                  </li>
                ))
              }
            </ul>
          ) : null
        }
      </span>
    );
  }
}

let dialogs = 0;

/** The open dialogs, the newest last. */
const stack: Dialog<unknown>[] = [];

/** Opens a modal dialog. */
export function openDialog<T>(options: DialogOptions<T>): DialogHandle<T> {
  return new Dialog(options);
}
