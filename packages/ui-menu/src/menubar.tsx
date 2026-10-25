// The menu bar: the submenus of one menu (`main`), as a bar or, hidden as IntelliJ's new UI does it,
// collapsed into a button. Using the hidden bar expands it in place, as IntelliJ does: clicking the
// button shows the bar with its first menu open, and it collapses again when the menu closes.
//
// Keyboard, as in desktop OSes:
// - Alt plus a mnemonic letter opens that menu, expanding a hidden bar.
// - Alt pressed alone highlights the bar's first menu, expanding a hidden bar (arrows, Enter and
//   letters then work, Escape or Alt leaves).
// - While a menu is open, Left and Right move to the neighbouring menu.
// Mnemonics in the bar are underlined while Alt is held, the bar has the keyboard or a menu is open,
// as in IntelliJ.

import { parseLabel } from '@cerebro-ide/commands';
import { onCleanup } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { openMenu, visibleEntries, type MenuHandle, type MenuServices } from './menu.js';

export interface MenuBarProps {
  services: MenuServices;
  /** The menu whose submenus are the bar's menus. Default: `main`. */
  menu?: string;
  /** Shown as a bar; otherwise collapsed into a button. Read reactively. */
  visible: () => boolean;
  /** Passed to commands run from these menus. */
  context?: () => unknown;
}

class BarState {
  /** The menu that is open or highlighted, as an index among the bar's menus; -1 for none. */
  active = -1;
  /** The bar has the keyboard (after Alt alone), without a menu open. */
  keyboard = false;
  /** Alt is held. */
  alt = false;
  /** A menu is open. */
  open = false;
  /** A hidden bar shows while it's in use. */
  expanded = false;

  constructor() {
    makeObservable(this);
  }
}

interface Root {
  submenu: string;
  label: string;
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** The letter or digit a key event's physical key makes. */
function letterOf(event: KeyboardEvent): string | undefined {
  return /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^Digit(\d)$/.exec(event.code)?.[1];
}

export function MenuBar(props: MenuBarProps): Node {
  const { services } = props;
  const menu = props.menu ?? 'main';
  const state = new BarState();
  const roots = (): Root[] =>
    visibleEntries(services, menu).flatMap((e) => ('submenu' in e ? [e] : []));
  let handle: MenuHandle | undefined;
  let bar: HTMLElement | undefined;
  /** Set when Alt goes down alone; cleared by any other key or a press. */
  let altAlone = false;

  const close = () => {
    const current = handle;
    handle = undefined;
    current?.close();
    state.open = false;
    state.active = -1;
    state.keyboard = false;
    state.expanded = false;
  };

  /** Opens one of the bar's menus below its name, expanding a hidden bar first. */
  const openRoot = (index: number, fromKeyboard: boolean) => {
    const list = roots();
    const root = list[index] as Root;
    const previous = handle;
    handle = undefined;
    previous?.close();
    // Showing the bar renders it right away, so its names are there to anchor to.
    state.expanded = !props.visible();
    state.keyboard = false;
    state.active = index;
    state.open = true;
    const opened = openMenu(
      services,
      root.submenu,
      {
        anchor: bar?.querySelector(`[data-index="${String(index)}"]`) as Element,
        placement: 'below',
      },
      {
        context: props.context?.(),
        owner: bar as Element,
        focusFirst: fromKeyboard,
        onNavigate: (direction) => {
          openRoot((index + direction + list.length) % list.length, true);
        },
        onClose: () => {
          // Only the menu that is current ends the bar's state; a replaced one doesn't.
          if (handle === opened) {
            handle = undefined;
            state.open = false;
            state.active = -1;
            state.expanded = false;
          }
        },
      },
    );
    handle = opened;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Alt') {
      state.alt = true;
      altAlone = !event.ctrlKey && !event.metaKey && !event.shiftKey;
      return;
    }
    altAlone = false;
    const letter = letterOf(event);
    if (event.altKey && !event.ctrlKey && !event.metaKey && letter) {
      const index = roots().findIndex((r) => parseLabel(r.label).mnemonic === letter);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      openRoot(index, true);
      return;
    }
    if (!state.keyboard) return;
    // The bar has the keyboard: it handles every key.
    event.preventDefault();
    event.stopPropagation();
    const count = roots().length;
    switch (event.key) {
      case 'ArrowLeft':
        state.active = (state.active - 1 + count) % count;
        return;
      case 'ArrowRight':
        state.active = (state.active + 1) % count;
        return;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        openRoot(state.active, true);
        return;
      case 'Escape':
        close();
        return;
    }
    const index = roots().findIndex((r) => parseLabel(r.label).mnemonic === letter);
    if (index >= 0) openRoot(index, true);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key !== 'Alt') return;
    state.alt = false;
    if (!altAlone) return;
    altAlone = false;
    event.preventDefault();
    if (state.open || state.keyboard) close();
    else {
      state.expanded = !props.visible();
      state.keyboard = true;
      state.active = 0;
    }
  };

  const onPointerDown = () => {
    altAlone = false;
    if (state.keyboard) close();
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    close();
  });

  return (
    <div
      class={() =>
        cls(
          'cerebro-menubar',
          (state.alt || state.keyboard || state.open) && 'cerebro-menubar--mnemonics',
        )
      }
      role="menubar"
    >
      {() =>
        props.visible() || state.expanded ? (
          <div
            class="cerebro-menubar__items"
            ref={(element) => {
              bar = element;
            }}
          >
            {() =>
              roots().map((root, index) => {
                const label = parseLabel(root.label);
                return (
                  <div
                    class={() =>
                      cls(
                        'cerebro-menubar__item',
                        state.active === index && 'cerebro-menubar__item--active',
                      )
                    }
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={() => String(state.open && state.active === index)}
                    data-index={index}
                    on:pointerdown={() => {
                      if (state.open && state.active === index) close();
                      else openRoot(index, false);
                    }}
                    on:pointermove={(event) => {
                      // Only a pointer that really moves switches menus, not one that a menu
                      // appeared under.
                      if (event.movementX === 0 && event.movementY === 0) return;
                      if (state.open && state.active !== index) openRoot(index, false);
                    }}
                  >
                    {label.index < 0
                      ? label.text
                      : [
                          label.text.slice(0, label.index),
                          <span class="cerebro-mnemonic">{label.text.charAt(label.index)}</span>,
                          label.text.slice(label.index + 1),
                        ]}
                  </div>
                );
              })
            }
          </div>
        ) : (
          <button
            type="button"
            class="cerebro-menubar__button"
            aria-label="Main Menu"
            aria-haspopup="menu"
            aria-expanded="false"
            ref={tooltip({ text: () => 'Main Menu' })}
            on:pointerdown={() => {
              openRoot(0, false);
            }}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2.5 4h11M2.5 8h11M2.5 12h11"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        )
      }
    </div>
  );
}
