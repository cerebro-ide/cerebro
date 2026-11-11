// What the Pull and Merge dialogs share, as IntelliJ's (`GitOptionsPopupBuilder`, `GitOptionsPanel`,
// `ComboBoxWithAutoCompletion`, read from its source): a branch field whose branches are suggested
// as it's typed, and options chosen in a popup from Modify options, shown under the command, each
// removable, and kept per repository.

import type { Child } from '@cerebro-ide/jsx';
import { signal, type Signal } from '@cerebro-ide/reactive';
import { openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { icon } from './icons.js';

/** An option: its flag, what it does, and those it can't go with, as IntelliJ's option enums. */
export interface GitOption {
  flag: string;
  description: string;
  excludes: string[];
}

/** Whether `flag` goes with those chosen, as IntelliJ's `isOptionSuitable`. */
const suitable = (all: readonly GitOption[], flag: string, chosen: readonly string[]) =>
  chosen.every((c) => !all.find((o) => o.flag === c)?.excludes.includes(flag));

/** A dialog's options: those chosen, the Modify options link, and the chosen ones shown. */
export interface GitOptions {
  chosen: Signal<string[]>;
  /** Modify options, at the buttons' left: the popup to add or remove them. */
  link: () => Child;
  /** The options chosen, under the command, each removable. */
  shown: () => Child;
  /** Keeps those chosen for the repository's next time. */
  keep: () => void;
}

/**
 * A dialog's options, from `all`, with those kept for the repository under `key` to start with (in
 * the page's storage). `title` is the popup's, as IntelliJ's "Add Pull Options"; `width`, one wide
 * enough for its longest description and flag on one line, as IntelliJ's popup fits them.
 */
export function gitOptions(
  all: readonly GitOption[],
  title: string,
  key: string,
  width: number,
): GitOptions {
  const chosen = signal(read(all, key));
  const toggle = (flag: string) => {
    const now = chosen.peek();
    chosen.set(now.includes(flag) ? now.filter((o) => o !== flag) : [...now, flag]);
  };
  const modify = (button: HTMLElement) => {
    openPicker<PickerItem>({
      label: title,
      placeholder: title,
      width,
      position: { below: button },
      owner: button,
      items: () =>
        all.map((o) => {
          const checked = chosen.get().includes(o.flag);
          return {
            label: o.description,
            shortcut: o.flag,
            ...(checked ? { icon: () => icon('check') } : {}),
            option: {
              checked,
              enabled: suitable(all, o.flag, chosen.get()),
              run: () => {
                toggle(o.flag);
              },
            },
          };
        }),
    });
  };
  return {
    chosen,
    link: () => (
      <button
        type="button"
        class="playground-link"
        on:click={(event) => {
          modify(event.currentTarget as HTMLElement);
        }}
      >
        Modify options
      </button>
    ),
    shown: () =>
      chosen.get().length === 0 ? null : (
        <div class="playground-git-options">
          {chosen.get().map((flag) => (
            <span class="playground-git-options__option">
              {flag}
              <button
                type="button"
                class="playground-git-options__remove"
                aria-label={`Remove ${flag}`}
                on:click={() => {
                  toggle(flag);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ),
    keep: () => {
      try {
        localStorage.setItem(key, JSON.stringify(chosen.peek()));
      } catch {
        // Not kept: the next time starts without them.
      }
    },
  };
}

/** The options kept under `key`, those still among `all`. */
function read(all: readonly GitOption[], key: string): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(kept)
      ? kept.filter((o): o is string => all.some((known) => known.flag === o))
      : [];
  } catch {
    return [];
  }
}

/**
 * A branch field, focused with its text selected, its `branches` that hold what's typed suggested
 * under it as it's typed, and chosen with a click. Read reactively: the list follows them.
 */
export function branchField(branch: Signal<string>, branches: () => readonly string[]): Child {
  const suggesting = signal(false);
  /** The field, which the suggestions show under. */
  let field!: HTMLInputElement;
  return (
    <span class="playground-git-branch">
      <input
        class="playground-git-branch__field"
        aria-label="Branch"
        placeholder="Specify branch"
        spellcheck={false}
        value={() => branch.get()}
        ref={(element) => {
          field = element;
          requestAnimationFrame(() => {
            element.focus();
            element.select();
          });
        }}
        on:input={(event) => {
          branch.set((event.currentTarget as HTMLInputElement).value.trim());
          suggesting.set(true);
        }}
        on:blur={() => {
          suggesting.set(false);
        }}
      />
      {() => {
        const typed = branch.get();
        const list = suggesting.get()
          ? branches().filter((b) => b !== typed && b.includes(typed))
          : [];
        return list.length === 0 ? null : (
          <ul
            class="playground-git-branch__suggestions"
            role="listbox"
            ref={(element) => {
              // Under the field, over the dialog's edge: its content would clip it.
              const at = field.getBoundingClientRect();
              element.style.left = `${String(at.left)}px`;
              element.style.top = `${String(at.bottom + 2)}px`;
              element.style.width = `${String(at.width)}px`;
            }}
          >
            {list.map((b) => (
              <li
                role="option"
                class="playground-git-branch__suggestion"
                on:pointerdown={(event) => {
                  // Chosen, not a press that leaves the field first.
                  event.preventDefault();
                  branch.set(b);
                  suggesting.set(false);
                }}
              >
                {b}
              </li>
            ))}
          </ul>
        );
      }}
    </span>
  );
}
