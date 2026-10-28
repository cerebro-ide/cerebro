// The menu bar as a native menu: on macOS the app's menu belongs in the system menu bar, so the
// desktop app shows the same menu registry there instead of in the window. The page turns its menus
// into a plain tree (labels, enabled and checked states, shortcuts) and hands it to the app, which
// rebuilds the native menu whenever the tree changes, and reports back the command a click chose.
//
// Shortcuts stay the page's: the native menu shows them, but the app ignores the clicks they
// trigger, since the page's keymap handles them (and its chords and user bindings with them).

import { displayText, parseLabel } from '@cerebro-ide/commands';
import { effect, type Disposable } from '@cerebro-ide/reactive';
import { visibleEntries, type MenuServices } from './menu.js';

/** A native menu item: a command, a submenu or a separator. */
export interface NativeMenuItem {
  label?: string;
  /** The command a click runs. */
  command?: string;
  enabled?: boolean;
  /** For toggles: a check mark, shown when true. */
  checked?: boolean;
  /** The shortcut, as an Electron accelerator. */
  accelerator?: string;
  submenu?: NativeMenuItem[];
  separator?: true;
}

/** How the page talks to the app's native menu. */
export interface NativeMenuBridge {
  set(items: NativeMenuItem[]): void;
  /** Calls `listener` with each command chosen from the menu; returns a function that stops it. */
  onCommand(listener: (command: string) => void): () => void;
}

const MODIFIERS: Readonly<Record<string, string>> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Command',
};

const KEYS: Readonly<Record<string, string>> = {
  '+': 'Plus',
  Enter: 'Return',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** Keys an accelerator can name as they are (Electron's docs list them). */
const NAMED = new Set([
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
]);

/**
 * A normalized key sequence as an Electron accelerator (`Ctrl+Shift+Meta+K` gives
 * `Ctrl+Shift+Command+K`), or undefined when it can't be one: sequences of several chords, and keys
 * accelerators don't name.
 */
export function toAccelerator(sequence: string): string | undefined {
  if (sequence.includes(' ')) return undefined;
  const parts = sequence.endsWith('++')
    ? [...sequence.slice(0, -2).split('+'), '+']
    : sequence.split('+');
  const key = parts.pop() as string;
  const name =
    KEYS[key] ??
    (NAMED.has(key) || /^([A-Z0-9]|F\d{1,2})$/.test(key) || /^[^\w\s]$/.test(key)
      ? key
      : undefined);
  if (name === undefined) return undefined;
  return [...parts.map((m) => MODIFIERS[m] as string), name].join('+');
}

/** A menu's visible entries as a native menu tree, with commands' states for `context`. */
export function nativeMenu(
  services: MenuServices,
  menu: string,
  context?: unknown,
): NativeMenuItem[] {
  const { commands, keymap } = services;
  return visibleEntries(services, menu, context).map((entry): NativeMenuItem => {
    if ('separator' in entry) return { separator: true };
    // A heading: a label that does nothing.
    if ('heading' in entry) return { label: entry.heading, enabled: false };
    if ('submenu' in entry) {
      return {
        label: parseLabel(entry.label).text,
        submenu: nativeMenu(services, entry.submenu, context),
      };
    }
    const item: NativeMenuItem = {
      label: displayText(entry.label, entry.dialog),
      command: entry.command,
      enabled: commands.isEnabled(entry.command, context),
    };
    const checked = commands.isChecked(entry.command, context);
    if (checked !== undefined) item.checked = checked;
    const shortcut = keymap?.shortcutsFor(entry.command)[0];
    const accelerator = shortcut === undefined ? undefined : toAccelerator(shortcut);
    if (accelerator !== undefined) item.accelerator = accelerator;
    return item;
  });
}

export interface NativeMenuOptions {
  /** The menu whose submenus are the menu bar's. Default: `main`. */
  menu?: string;
  /** Passed to commands run from the menu. Read reactively. */
  context?: () => unknown;
}

/**
 * Keeps the app's native menu showing `menu`, rebuilt as commands, menus, shortcuts or their
 * states change, and runs the commands chosen from it.
 */
export function syncNativeMenu(
  services: MenuServices,
  bridge: NativeMenuBridge,
  options: NativeMenuOptions = {},
): Disposable {
  const menu = options.menu ?? 'main';
  const sync = effect(() => {
    bridge.set(nativeMenu(services, menu, options.context?.()));
    return undefined;
  });
  const stop = bridge.onCommand((command) => {
    services.commands.execute(command, options.context?.());
  });
  return {
    dispose() {
      sync.dispose();
      stop();
    },
  };
}
