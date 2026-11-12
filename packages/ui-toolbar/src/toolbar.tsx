// The main toolbar, as in IntelliJ's new UI: a row across the top of the window, with things on the
// left (the menu bar, the environment and branch selectors) and on the right (icon buttons).
//
// Its building blocks:
// - ToolbarButton: an icon button that runs a command, its tooltip naming the command and its
//   shortcut;
// - ToolbarDropdown: a label with a chevron that opens a menu from the menu registry below it, so
//   choices get the menus' keyboard navigation, mnemonics and check marks; or, for long lists, a
//   popup of the app's (a searchable picker, as IntelliJ's branch popup). An optional badge (a
//   name's initials on a colour from it, as IntelliJ's project widget) can lead the label.

import { displayText, formatChord, type CommandRegistry } from '@cerebro-ide/commands';
import type { Child } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';
import { openMenu, type MenuHandle, type MenuServices } from '@cerebro-ide/ui-menu';
import { tooltip } from '@cerebro-ide/ui-tooltip';

export function MainToolbar(props: { left: () => Child; right?: () => Child }): Node {
  return (
    <div class="cerebro-toolbar" role="toolbar" aria-label="Main toolbar">
      <div class="cerebro-toolbar__side cerebro-toolbar__side--left">{props.left()}</div>
      <div class="cerebro-toolbar__side cerebro-toolbar__side--right">{props.right?.()}</div>
    </div>
  );
}

export interface ToolbarButtonProps {
  commands: CommandRegistry;
  command: string;
  icon: Child;
  /** The command's shortcut, for the tooltip. */
  shortcut?: () => string | undefined;
  /** Passed to the command, as a context menu's: what the toolbar acts on. Read reactively. */
  context?: () => unknown;
}

/**
 * An icon button that runs a command; disabled while the command is. A toggle's (a command that's
 * checked or not) shows pressed while it's on, as IntelliJ's toggle actions in a toolbar.
 */
export function ToolbarButton(props: ToolbarButtonProps): Node {
  const { commands, command } = props;
  const spec = commands.get(command);
  // What the command says now (IntelliJ's "Show Grid", "Hide Grid"), else its name.
  const label = () =>
    spec ? displayText(spec.text?.(props.context?.()) ?? spec.label, spec.dialog) : command;
  const pressed = () => commands.isChecked(command, props.context?.()) === true;
  return (
    <button
      type="button"
      class={() =>
        pressed()
          ? 'cerebro-toolbar-button cerebro-toolbar-button--pressed'
          : 'cerebro-toolbar-button'
      }
      aria-label={label}
      {...(spec?.checked ? { 'aria-pressed': () => String(pressed()) } : {})}
      disabled={() => !commands.isEnabled(command, props.context?.())}
      data-command={command}
      ref={tooltip({ text: label, shortcut: () => props.shortcut?.(), placement: 'below' })}
      on:click={() => {
        commands.execute(command, props.context?.());
      }}
    >
      {props.icon}
    </button>
  );
}

class DropdownState {
  open = false;

  constructor() {
    makeObservable(this);
  }
}

/** A popup a dropdown opens instead of a menu: closed by the dropdown, or closing by itself. */
export interface DropdownPopup {
  close(): void;
  /** Settles when the popup closes. */
  readonly result: Promise<unknown>;
}

export interface ToolbarDropdownProps {
  services: MenuServices;
  /** The menu it opens, unless it opens a popup. */
  menu?: string;
  /** Opens a popup below the button instead of a menu. */
  popup?: (button: HTMLElement) => DropdownPopup;
  text: () => string;
  /** For the tooltip and screen readers (but a filter's text has it): what is being chosen. */
  label: string;
  /**
   * The tooltip in place of the label, none when empty: a filter's value in full while it's on, as
   * IntelliJ's (the Paths filter's paths).
   */
  tooltip?: () => string;
  /** Leads the label: an icon, or a badge with a name's initials. */
  icon?: Child;
  badge?: () => string;
  /** Passed to the menu's commands. */
  context?: () => unknown;
  /**
   * What clears the choice, while there's one to clear: a filter's, as IntelliJ's. An X takes the
   * arrow's place, and Delete or Backspace on the dropdown clears it too. Read reactively.
   */
  clear?: () => (() => void) | undefined;
}

export function ToolbarDropdown(props: ToolbarDropdownProps): Node {
  const { badge } = props;
  const state = new DropdownState();
  let handle: MenuHandle | DropdownPopup | undefined;
  let element: HTMLElement | undefined;
  const open = (fromKeyboard: boolean) => {
    state.open = true;
    if (props.popup) {
      const popup = props.popup(element as HTMLElement);
      handle = popup;
      // A press while it's open only closes it, so it's still the handle when it settles.
      void popup.result.then(() => {
        handle = undefined;
        state.open = false;
      });
      return;
    }
    handle = openMenu(
      props.services,
      props.menu as string,
      { anchor: element as Element, placement: 'below' },
      {
        context: props.context?.(),
        owner: element as Element,
        focusFirst: fromKeyboard,
        // One menu at a time: a new one only opens once this one is gone.
        onClose: () => {
          handle = undefined;
          state.open = false;
        },
      },
    );
  };
  const toggle = (fromKeyboard: boolean) => {
    if (handle) handle.close();
    else open(fromKeyboard);
  };
  const button = (
    <button
      type="button"
      class={() =>
        state.open
          ? 'cerebro-toolbar-dropdown cerebro-toolbar-dropdown--open'
          : 'cerebro-toolbar-dropdown'
      }
      // A filter's text names it already ("Branch: side"), as IntelliJ's does.
      aria-label={() => (props.clear ? props.text() : `${props.label}: ${props.text()}`)}
      aria-haspopup={props.popup ? 'dialog' : 'menu'}
      aria-expanded={() => String(state.open)}
      data-menu={props.menu}
      ref={(button) => {
        element = button;
        tooltip({ text: () => props.tooltip?.() ?? props.label })(button);
      }}
      on:pointerdown={(event) => {
        if (event.button === 0) toggle(false);
      }}
      on:mousedown={(event) => {
        // A popup takes the focus as it opens (its search field): the button doesn't take it back.
        if (props.popup) event.preventDefault();
      }}
      on:keydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          toggle(true);
        }
        const clear = props.clear?.();
        if ((event.key === 'Delete' || event.key === 'Backspace') && clear) {
          event.preventDefault();
          clear();
        }
      }}
    >
      {badge ? (
        <span
          class="cerebro-toolbar-dropdown__badge"
          style={{ background: () => badgeColour(badge()) }}
        >
          {() => initials(badge())}
        </span>
      ) : null}
      {props.icon ? <span class="cerebro-toolbar-dropdown__icon">{props.icon}</span> : null}
      <span class="cerebro-toolbar-dropdown__text">{props.text}</span>
      {() => (props.clear?.() ? null : glyph('cerebro-toolbar-dropdown__chevron', 'M4 6l4 4 4-4'))}
    </button>
  ) as HTMLElement;
  if (!props.clear) return button;
  const { clear } = props;
  return (
    <span class="cerebro-toolbar-filter">
      {button}
      {() => {
        const run = clear();
        return run ? (
          <button
            type="button"
            class="cerebro-toolbar-dropdown__clear"
            aria-label={`Clear ${props.label}`}
            ref={tooltip({
              text: () => 'Clear',
              // IntelliJ's: the Delete action's first shortcut, which clears it too.
              shortcut: () => formatChord('Delete', props.services.keymap?.platform ?? 'other'),
              placement: 'below',
            })}
            on:click={run}
          >
            {glyph('', 'M5 5l6 6M11 5l-6 6')}
          </button>
        ) : null;
      }}
    </span>
  );
}

/** A small line drawing: the dropdown's arrow, or its X. */
function glyph(className: string, path: string) {
  return (
    <svg class={className} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Up to two initials, IntelliJ-style: `data-viz` gives DV, `cerebro` gives CE. */
export function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters =
    words.length >= 2
      ? (words[0] as string).charAt(0) + (words[1] as string).charAt(0)
      : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase();
}

const BADGE_COLOURS = ['#c75450', '#d9a343', '#5d9b47', '#3574f0', '#955ae0', '#e66d17', '#21a8a8'];

/** A stable colour for a name, so each environment keeps its badge colour. */
export function badgeColour(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) as number)) | 0;
  return BADGE_COLOURS[Math.abs(hash) % BADGE_COLOURS.length] as string;
}
