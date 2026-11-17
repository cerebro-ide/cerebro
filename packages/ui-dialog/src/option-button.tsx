// An option button, as IntelliJ's `JBOptionButton`: a button, and an arrow beside it that lists
// more actions. The dialog's OK has one (the Push dialog's Force Push), and so may anything else
// (the Interactive Rebase dialog's Squash, with Fixup).

import type { Child } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';

/** An action the arrow lists. */
export interface OptionItem {
  label: string;
  /** Read reactively. */
  enabled: () => boolean;
  /** Its tooltip, read reactively. */
  description?: () => string | undefined;
  run: () => void;
}

/**
 * `button` with the arrow: `items` read reactively, the arrow off while `disabled` or there are
 * none. `primary` styles the arrow as a dialog's default button.
 */
export function optionButton(
  button: Child,
  items: () => readonly OptionItem[],
  disabled: () => boolean,
  primary = false,
): Child {
  let arrow!: HTMLButtonElement;
  const listing = signal(false);
  const highlighted = signal(-1);
  const choose = (item: OptionItem) => {
    if (!item.enabled()) return;
    listing.set(false);
    arrow.focus();
    item.run();
  };
  return (
    <span class="cerebro-dialog__option-button">
      {button}
      <button
        type="button"
        class={[
          'cerebro-dialog__button',
          primary && 'cerebro-dialog__button--primary',
          'cerebro-dialog__arrow',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={() => String(listing.get())}
        disabled={() => disabled() || items().length === 0}
        ref={(element) => {
          arrow = element;
        }}
        on:click={() => {
          highlighted.set(-1);
          listing.set(!listing.peek());
        }}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
      {() =>
        listing.get() ? (
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
              listing.set(false);
            }}
            on:keydown={(event) => {
              // Its keys: not the dialog's Enter and Escape.
              event.stopPropagation();
              event.preventDefault();
              const list = items();
              const h = highlighted.peek();
              if (event.key === 'ArrowDown') highlighted.set((h + 1) % list.length);
              else if (event.key === 'ArrowUp') highlighted.set(h <= 0 ? list.length - 1 : h - 1);
              else if (event.key === 'Enter') {
                const item = list[h];
                if (item) choose(item);
              } else if (event.key === 'Escape' || event.key === 'Tab') {
                listing.set(false);
                arrow.focus();
              }
            }}
          >
            {() =>
              items().map((item, index) => (
                <li
                  role="menuitem"
                  class={() =>
                    [
                      'cerebro-dialog__option',
                      highlighted.get() === index ? 'cerebro-dialog__option--highlighted' : '',
                      item.enabled() ? '' : 'cerebro-dialog__option--disabled',
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }
                  aria-disabled={() => String(!item.enabled())}
                  title={() => item.description?.() ?? ''}
                  on:pointerenter={() => {
                    highlighted.set(index);
                  }}
                  on:pointerdown={(event) => {
                    // Chosen without the list losing the focus first.
                    event.preventDefault();
                  }}
                  on:click={() => {
                    choose(item);
                  }}
                >
                  {item.label}
                </li>
              ))
            }
          </ul>
        ) : null
      }
    </span>
  );
}
