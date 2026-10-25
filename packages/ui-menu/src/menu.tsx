// Menus: a stack of popups, each showing one menu from the menu registry. The same component is
// the menu bar's dropdowns and every context menu.
//
// Items show their label with the mnemonic underlined, an ellipsis for commands that open a dialog,
// a check mark for toggles, their shortcut, and an arrow for submenus. Commands that aren't
// registered and empty submenus are hidden. Keyboard: Up/Down/Home/End move, Enter/Space activate,
// Right opens a submenu, Left/Escape close one, a mnemonic letter activates its item (or cycles
// between items sharing it). Keys a menu handles don't reach the app's shortcuts.

import {
  displayText,
  formatSequence,
  parseLabel,
  type CommandRegistry,
  type Keymap,
  type MenuEntry,
  type MenuRegistry,
} from '@cerebro-ide/commands';
import { render, type Child } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';

export interface MenuServices {
  commands: CommandRegistry;
  menus: MenuRegistry;
  /** For showing shortcuts; without it, none show. */
  keymap?: Keymap;
}

/** Where a menu opens: at a point, or beside an element. */
export type MenuPosition =
  { x: number; y: number } | { anchor: Element; placement: 'below' | 'right' };

export interface MenuOptions {
  /** Passed to commands: the thing a context menu was opened on. */
  context?: unknown;
  onClose?: () => void;
  /**
   * Left at the top menu, or Right on an item without a submenu: the menu bar uses this to move to
   * the neighbouring menu. Without it, those keys do nothing there.
   */
  onNavigate?: (direction: -1 | 1) => void;
}

export interface MenuHandle {
  close(): void;
  readonly open: boolean;
}

/** An item that can be shown: a registered command, or a submenu with visible items. */
type Item =
  { command: string; label: string; dialog: boolean } | { submenu: string; label: string };

type Entry = Item | { separator: true };

class Level {
  readonly menu: string;
  highlight = -1;
  element: HTMLElement | undefined = undefined;
  dispose: (() => void) | undefined = undefined;

  constructor(menu: string) {
    this.menu = menu;
    makeObservable(this);
  }
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** Opens a menu; it stays open until an item runs, Escape, or a click outside. */
export function openMenu(
  services: MenuServices,
  menu: string,
  position: MenuPosition,
  options: MenuOptions = {},
): MenuHandle {
  return new MenuSession(services, menu, position, options);
}

/** Opens a context menu at the pointer, for `context`; the browser's own menu is suppressed. */
export function openContextMenu(
  services: MenuServices,
  menu: string,
  event: MouseEvent,
  context?: unknown,
): MenuHandle {
  event.preventDefault();
  return openMenu(services, menu, { x: event.clientX, y: event.clientY }, { context });
}

/** A menu's visible entries: hidden items removed, and no leading, trailing or doubled separators. */
export function visibleEntries(services: MenuServices, menu: string): Entry[] {
  const items: Entry[] = services.menus.entries(menu).flatMap((entry: MenuEntry): Entry[] => {
    if ('separator' in entry) return [entry];
    if ('submenu' in entry) {
      return visibleEntries(services, entry.submenu).some((e) => !('separator' in e))
        ? [entry]
        : [];
    }
    const command = services.commands.get(entry.command);
    return command
      ? [{ command: command.id, label: command.label, dialog: command.dialog ?? false }]
      : [];
  });
  return items.filter(
    (entry, i) =>
      !('separator' in entry) ||
      (i > 0 && i < items.length - 1 && !('separator' in (items[i - 1] as Entry))),
  );
}

class MenuSession implements MenuHandle {
  open = true;
  private readonly levels: Level[] = [];
  private readonly layer: HTMLElement;
  private readonly restoreFocus: HTMLElement;

  constructor(
    private readonly services: MenuServices,
    menu: string,
    position: MenuPosition,
    private readonly options: MenuOptions,
  ) {
    // At least the body: a document always has a focused element.
    this.restoreFocus = document.activeElement as HTMLElement;
    this.layer = document.createElement('div');
    this.layer.className = 'cerebro-menu-layer';
    document.body.append(this.layer);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onBlur);
    this.push(menu, position);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.truncate(0);
    this.layer.remove();
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onBlur);
    this.restoreFocus.focus();
    this.options.onClose?.();
  }

  private readonly onBlur = () => {
    this.close();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    if (!this.layer.contains(event.target as Node)) this.close();
  };

  private readonly onKey = (event: KeyboardEvent) => {
    const depth = this.levels.length - 1;
    const level = this.levels[depth] as Level;
    const entries = visibleEntries(this.services, level.menu);
    const handled = this.key(event, depth, level, entries);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private key(event: KeyboardEvent, depth: number, level: Level, entries: Entry[]): boolean {
    const current = entries[level.highlight];
    switch (event.key) {
      case 'ArrowDown':
        level.highlight = step(entries, level.highlight, 1);
        return true;
      case 'ArrowUp':
        level.highlight = step(entries, level.highlight, -1);
        return true;
      case 'Home':
        level.highlight = step(entries, -1, 1);
        return true;
      case 'End':
        level.highlight = step(entries, entries.length, -1);
        return true;
      case 'Enter':
      case ' ':
        if (current && !('separator' in current)) this.activate(depth, level.highlight, true);
        return true;
      case 'ArrowRight':
        if (current && 'submenu' in current) this.activate(depth, level.highlight, true);
        else this.options.onNavigate?.(1);
        return true;
      case 'ArrowLeft':
        if (depth > 0) this.truncate(depth);
        else this.options.onNavigate?.(-1);
        return true;
      case 'Escape':
        if (depth > 0) this.truncate(depth);
        else this.close();
        return true;
      case 'Tab':
        return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const letter = /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^Digit(\d)$/.exec(event.code)?.[1];
    if (!letter) return false;
    const matches = entries.flatMap((entry, i) =>
      !('separator' in entry) && parseLabel(entry.label).mnemonic === letter ? [i] : [],
    );
    if (matches.length === 1) this.activate(depth, matches[0] as number, true);
    else if (matches.length > 1) {
      // Several items share the letter: cycle between them.
      level.highlight = matches.find((i) => i > level.highlight) ?? (matches[0] as number);
    }
    return true;
  }

  /** Runs a command item, or opens a submenu item's menu (focusing its first item from keys). */
  private activate(depth: number, index: number, fromKeyboard: boolean): void {
    const level = this.levels[depth] as Level;
    // Callers only pass items, never separators.
    const entry = visibleEntries(this.services, level.menu)[index] as Item;
    level.highlight = index;
    if ('submenu' in entry) {
      const open = this.levels[depth + 1];
      if (open?.menu === entry.submenu && !fromKeyboard) return;
      this.truncate(depth + 1);
      const item = level.element?.querySelector(`[data-index="${String(index)}"]`) as Element;
      const sub = this.push(entry.submenu, { anchor: item, placement: 'right' });
      if (fromKeyboard) sub.highlight = step(visibleEntries(this.services, sub.menu), -1, 1);
      return;
    }
    if (!this.services.commands.isEnabled(entry.command, this.options.context)) return;
    this.close();
    this.services.commands.execute(entry.command, this.options.context);
  }

  private push(menu: string, position: MenuPosition): Level {
    const level = new Level(menu);
    const depth = this.levels.length;
    this.levels.push(level);
    const element = document.createElement('div');
    element.className = 'cerebro-menu';
    element.setAttribute('role', 'menu');
    element.dataset['menu'] = menu;
    this.layer.append(element);
    const handle = render(() => this.renderMenu(depth, level), element);
    level.element = element;
    level.dispose = () => {
      handle.dispose();
      element.remove();
    };
    place(element, position);
    return level;
  }

  /** Closes the levels from `depth` down. */
  private truncate(depth: number): void {
    for (const level of this.levels.splice(depth)) level.dispose?.();
  }

  private renderMenu(depth: number, level: Level): Child {
    const services = this.services;
    const context = this.options.context;
    const platform = services.keymap?.platform ?? 'other';
    return () =>
      visibleEntries(services, level.menu).map((entry, index) => {
        if ('separator' in entry) return <div class="cerebro-menu-separator" role="separator" />;
        const label = parseLabel(entry.label);
        const isCommand = 'command' in entry;
        const enabled = () => !isCommand || services.commands.isEnabled(entry.command, context);
        const checked = () =>
          isCommand ? services.commands.isChecked(entry.command, context) : undefined;
        const shortcut = () => {
          const key = isCommand ? services.keymap?.shortcutsFor(entry.command)[0] : undefined;
          return key === undefined ? '' : formatSequence(key, platform);
        };
        const text = isCommand ? displayText(entry.label, entry.dialog) : label.text;
        return (
          <div
            class={() =>
              cls(
                'cerebro-menu-item',
                level.highlight === index && 'cerebro-menu-item--highlighted',
                !enabled() && 'cerebro-menu-item--disabled',
              )
            }
            role={() => (checked() === undefined ? 'menuitem' : 'menuitemcheckbox')}
            aria-checked={() => (checked() === undefined ? undefined : String(checked()))}
            aria-disabled={() => String(!enabled())}
            aria-haspopup={isCommand ? undefined : 'menu'}
            data-index={index}
            on:pointerenter={() => {
              level.highlight = index;
              if (isCommand) this.truncate(depth + 1);
              else this.activate(depth, index, false);
            }}
            on:click={() => {
              this.activate(depth, index, false);
            }}
          >
            <span class="cerebro-menu-item__check">
              {() =>
                checked() && (
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                )
              }
            </span>
            <span class="cerebro-menu-item__label">
              {label.index < 0
                ? text
                : [
                    text.slice(0, label.index),
                    <span class="cerebro-mnemonic">
                      {text.slice(label.index, label.index + 1)}
                    </span>,
                    text.slice(label.index + 1),
                  ]}
            </span>
            <span class="cerebro-menu-item__shortcut">{shortcut}</span>
            <span class="cerebro-menu-item__arrow">
              {isCommand ? null : (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    d="M6 3.5l4.5 4.5L6 12.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              )}
            </span>
          </div>
        );
      });
  }
}

/** The next selectable index from `from` in `direction`, wrapping around; -1 if none. */
function step(entries: Entry[], from: number, direction: 1 | -1): number {
  const count = entries.length;
  for (let n = 1; n <= count; n++) {
    const i = (((from + direction * n) % count) + count) % count;
    if (!('separator' in (entries[i] as Entry))) return i;
  }
  return -1;
}

/** Positions a popup, flipping it to stay inside the window. */
function place(element: HTMLElement, position: MenuPosition): void {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  let left: number;
  let top: number;
  if ('anchor' in position) {
    const rect = position.anchor.getBoundingClientRect();
    if (position.placement === 'below') {
      left = rect.left;
      top = rect.bottom + height <= window.innerHeight ? rect.bottom : rect.top - height;
    } else {
      // Beside the item: right of the parent menu, or left of it without room.
      const parent = (
        position.anchor.closest('.cerebro-menu') as HTMLElement
      ).getBoundingClientRect();
      left = parent.right + width <= window.innerWidth ? parent.right : parent.left - width;
      top = rect.top - 4;
    }
  } else {
    left = position.x + width <= window.innerWidth ? position.x : position.x - width;
    top = position.y + height <= window.innerHeight ? position.y : position.y - height;
  }
  left = Math.max(0, Math.min(left, window.innerWidth - width));
  top = Math.max(0, Math.min(top, window.innerHeight - height));
  element.style.left = `${String(left)}px`;
  element.style.top = `${String(top)}px`;
}
