// Modal dialogs, as IntelliJ's: a title bar with a close button, the content, and OK and Cancel at
// the bottom right (Cancel first on macOS, OK first elsewhere). While one is open, the rest of the
// window takes no pointer input, keys stay inside it (so the app's shortcuts don't run), and Tab
// cycles through its controls. Enter accepts, unless the focus is on a button or in a multi-line
// field; Escape cancels. The title bar drags it. Closing it gives the focus back to where it was.
//
// A dialog may open another; the newest one is on top and has the keyboard.

import { render, type Child } from '@cerebro-ide/jsx';

export interface DialogOk<T> {
  /** Default: OK. */
  label?: string;
  /** Read reactively: the OK button is disabled, and Enter does nothing, while this is false. */
  enabled?: () => boolean;
  /** What accepting the dialog gives. */
  accept: () => T;
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

  constructor(private readonly options: DialogOptions<T>) {
    this.result = new Promise((resolve) => {
      this.resolve = resolve;
    });
    // At least the body: a document always has a focused element.
    this.restoreFocus = document.activeElement as HTMLElement;
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
    this.focusFirst();
  }

  close(result?: T): void {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('resize', this.onResize);
    this.dispose();
    this.layer.remove();
    this.restoreFocus.focus();
    this.resolve(result);
  }

  private accept(): void {
    const { ok } = this.options;
    if (!ok || !(ok.enabled?.() ?? true)) return;
    const { apply } = this.options;
    if (apply && (apply.enabled?.() ?? true)) apply.run();
    this.close(ok.accept());
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
        disabled={() => !(ok.enabled?.() ?? true)}
        on:click={() => {
          this.accept();
        }}
      >
        {ok.label ?? 'OK'}
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
          {platform === 'mac'
            ? [cancelButton, applyButton, ...choices.reverse(), okButton]
            : [okButton, ...choices, cancelButton, applyButton]}
        </div>
      </div>
    );
  }
}

let dialogs = 0;

/** Opens a modal dialog. */
export function openDialog<T>(options: DialogOptions<T>): DialogHandle<T> {
  return new Dialog(options);
}
