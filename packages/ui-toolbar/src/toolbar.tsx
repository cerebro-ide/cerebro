// The main toolbar, as in IntelliJ's new UI: a row across the top of the window, with things on the
// left (the menu bar, the environment and branch selectors) and on the right (icon buttons).
//
// Its building blocks:
// - ToolbarButton: an icon button that runs a command, its tooltip naming the command and its
//   shortcut;
// - ToolbarDropdown: a label with a chevron that opens a menu from the menu registry below it, so
//   choices get the menus' keyboard navigation, mnemonics and check marks. An optional badge (a
//   name's initials on a colour from it, as IntelliJ's project widget) can lead the label.

import { displayText, type CommandRegistry } from '@cerebro-ide/commands';
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
}

/** An icon button that runs a command; disabled while the command is. */
export function ToolbarButton(props: ToolbarButtonProps): Node {
  const { commands, command } = props;
  const spec = commands.get(command);
  const label = spec ? displayText(spec.label, spec.dialog) : command;
  return (
    <button
      type="button"
      class="cerebro-toolbar-button"
      aria-label={label}
      disabled={() => !commands.isEnabled(command)}
      data-command={command}
      ref={tooltip({ text: () => label, shortcut: () => props.shortcut?.(), placement: 'below' })}
      on:click={() => {
        commands.execute(command);
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

export interface ToolbarDropdownProps {
  services: MenuServices;
  /** The menu it opens. */
  menu: string;
  text: () => string;
  /** For the tooltip and screen readers: what is being chosen. */
  label: string;
  /** Leads the label: an icon, or a badge with a name's initials. */
  icon?: Child;
  badge?: () => string;
  /** Passed to the menu's commands. */
  context?: () => unknown;
}

export function ToolbarDropdown(props: ToolbarDropdownProps): Node {
  const { badge } = props;
  const state = new DropdownState();
  let handle: MenuHandle | undefined;
  let element: HTMLElement | undefined;
  const open = (fromKeyboard: boolean) => {
    state.open = true;
    handle = openMenu(
      props.services,
      props.menu,
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
  return (
    <button
      type="button"
      class={() =>
        state.open
          ? 'cerebro-toolbar-dropdown cerebro-toolbar-dropdown--open'
          : 'cerebro-toolbar-dropdown'
      }
      aria-label={() => `${props.label}: ${props.text()}`}
      aria-haspopup="menu"
      aria-expanded={() => String(state.open)}
      data-menu={props.menu}
      ref={(button) => {
        element = button;
        tooltip({ text: () => props.label })(button);
      }}
      on:pointerdown={(event) => {
        if (event.button === 0) toggle(false);
      }}
      on:keydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
          event.preventDefault();
          toggle(true);
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
      <svg
        class="cerebro-toolbar-dropdown__chevron"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
      >
        <path
          d="M4 6l4 4 4-4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
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
