// Mouse shortcuts, as IntelliJ's IdeMouseEventDispatcher runs them (read from its source): the
// first three buttons' as they're let go, with the modifiers held as they were pressed; the
// buttons past them (back and forward) as they're pressed. A release that ends a drag runs none:
// AWT gives it no click (`clickCount < 1`, which IntelliJ ignores). Commands run as keys' do: the
// first enabled one bound to the chord. The wheel's run as it turns, only with a modifier held:
// without one, it scrolls.

import type { CommandRegistry } from './commands.js';
import type { Keymap } from './keymap.js';

export interface MouseEventLike {
  /** The button, as the DOM numbers them: 0 the main one, 1 the middle, 2 the other, 3 and 4 back and forward. */
  button: number;
  /** How many clicks in a row this is, as the DOM counts them. */
  detail: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const BUTTONS = ['Click', 'MiddleClick', 'RightClick', 'Button4Click', 'Button5Click'];

/**
 * How far the pointer may move between a press and its release for it to be a click, in pixels:
 * further, it's a drag. Claude's choice, open to change: AWT's own distance wasn't read.
 */
export const DRAG_DISTANCE = 4;

type Modifiers = Pick<MouseEventLike, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

/**
 * The chord a press or release of a button makes, or none: a button the DOM has no shortcut for,
 * or a third click in a row, which no shortcut is. A button past the third clicks once only.
 */
export function chordFromMouse(event: MouseEventLike): string | undefined {
  const button = BUTTONS[event.button];
  if (button === undefined) return undefined;
  const count = event.button > 2 ? 1 : Math.max(event.detail, 1);
  if (count > 2) return undefined;
  return [...modifierNames(event), count === 2 ? `Double${button}` : button].join('+');
}

export type WheelEventLike = Modifiers & {
  /** How far it turned, up below zero, as the DOM's `deltaY`. */
  deltaY: number;
};

/** The chord a turn of the wheel makes, as IntelliJ's (`Ctrl+WheelUp`), or none for no turn. */
export function chordFromWheel(event: WheelEventLike): string | undefined {
  if (event.deltaY === 0) return undefined;
  return [...modifierNames(event), event.deltaY < 0 ? 'WheelUp' : 'WheelDown'].join('+');
}

function modifierNames(event: Modifiers): string[] {
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Meta',
  ].filter((name) => name !== false);
}

/** Runs the keymap's mouse shortcuts, fed the window's presses and releases. */
export class MouseDispatcher {
  /** Each button held: its modifiers and where it was pressed. */
  private readonly held = new Map<number, Modifiers & { x: number; y: number }>();

  constructor(
    private readonly keymap: Keymap,
    private readonly commands: CommandRegistry,
  ) {}

  /** Buttons past the third whose press ran a command: their release is theirs too. */
  private readonly ran = new Set<number>();

  /** A button pressed: past the third, its shortcut runs now. Returns whether a command ran. */
  press(event: MouseEventLike, context?: unknown): boolean {
    if (event.button > 2) {
      const ran = this.run(chordFromMouse(event), context);
      if (ran) this.ran.add(event.button);
      return ran;
    }
    const { ctrlKey, altKey, shiftKey, metaKey } = event;
    this.held.set(event.button, {
      ctrlKey,
      altKey,
      shiftKey,
      metaKey,
      x: event.clientX,
      y: event.clientY,
    });
    return false;
  }

  /**
   * A button let go: one of the first three runs its shortcut, with the modifiers it was pressed
   * with, unless the pointer was dragged, or the press wasn't seen. Returns whether a command ran,
   * or ran as the button was pressed (Chromium goes back or forward as its buttons are let go).
   */
  release(event: MouseEventLike, context?: unknown): boolean {
    if (this.ran.delete(event.button)) return true;
    const pressed = this.held.get(event.button);
    this.held.delete(event.button);
    if (!pressed) return false;
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
    if (moved > DRAG_DISTANCE) return false;
    // Read field by field: a DOM event's are its prototype's getters, which a spread doesn't copy.
    const { button, detail, clientX, clientY } = event;
    return this.run(chordFromMouse({ button, detail, clientX, clientY, ...pressed }), context);
  }

  /** The wheel turned: with a modifier held, its shortcut runs. Returns whether a command ran. */
  wheel(event: WheelEventLike, context?: unknown): boolean {
    if (modifierNames(event).length === 0) return false;
    return this.run(chordFromWheel(event), context);
  }

  private run(chord: string | undefined, context: unknown): boolean {
    return (
      chord !== undefined &&
      this.keymap.commandsFor(chord).some((id) => this.commands.execute(id, context))
    );
  }
}
