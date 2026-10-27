// Key chords and sequences. A chord is modifiers plus one key in a fixed order (`Ctrl+Alt+Shift+Meta+K`);
// a sequence is chords separated by spaces (`Ctrl+K Ctrl+S`). Letters and digits come from the
// physical key, so shortcuts work on any keyboard layout. `Mod` is Meta on macOS, Ctrl elsewhere.
// A modifier on its own is a chord too, tapped: `Shift Shift` is IntelliJ's double Shift.

export type Platform = 'mac' | 'other';

export interface KeyEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

const MODIFIER_NAMES: Readonly<Record<string, Modifier | 'Mod'>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  super: 'Meta',
  mod: 'Mod',
};

const KEY_NAMES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  return: 'Enter',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

function keyName(key: string): string {
  if (key.length === 1) return key === ' ' ? 'Space' : key.toUpperCase();
  const known = KEY_NAMES[key.toLowerCase()];
  if (known) return known;
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key;
}

/** Normalizes a chord as written by hand: `shift+ctrl+o` becomes `Ctrl+Shift+O`. */
export function normalizeChord(chord: string, platform: Platform): string {
  // A trailing `+` is the plus key itself: `Ctrl++`.
  const parts = chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
  const modifiers = new Set<Modifier>();
  let key: string | undefined;
  for (const raw of parts) {
    const part = raw.trim();
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (modifier) {
      modifiers.add(modifier === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Ctrl') : modifier);
    } else {
      if (key !== undefined || part === '') throw new Error(`Invalid key chord "${chord}"`);
      key = keyName(part);
    }
  }
  // A modifier on its own: tapped, as in double Shift.
  if (key === undefined && modifiers.size === 1) return [...modifiers][0] as Modifier;
  if (key === undefined) throw new Error(`Key chord "${chord}" has no key`);
  return [...MODIFIERS.filter((m) => modifiers.has(m)), key].join('+');
}

export function normalizeSequence(sequence: string, platform: Platform): string {
  return sequence
    .trim()
    .split(/\s+/)
    .map((chord) => normalizeChord(chord, platform))
    .join(' ');
}

/** The chord a key event makes, or undefined for a modifier pressed on its own. */
export function chordFromEvent(event: KeyEventLike): string | undefined {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return undefined;
  const physical = /^Key([A-Z])$/.exec(event.code) ?? /^Digit(\d)$/.exec(event.code);
  const key = physical ? (physical[1] as string) : keyName(event.key);
  const modifiers: Modifier[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');
  return [...modifiers, key].join('+');
}

const MAC_MODIFIERS: Readonly<Record<Modifier, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};

const MAC_KEYS: Readonly<Record<string, string>> = {
  Enter: '↩',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const OTHER_KEYS: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** A normalized chord for display: `⇧⌘O` on macOS, `Ctrl+Shift+O` elsewhere. */
export function formatChord(chord: string, platform: Platform): string {
  const parts =
    chord === '+' || chord.endsWith('++')
      ? [...chord.slice(0, -2).split('+'), '+']
      : chord.split('+');
  const key = parts.pop() as string;
  const modifiers = parts.filter(Boolean) as Modifier[];
  if (platform === 'mac') {
    // macOS orders modifier glyphs ⌃⌥⇧⌘.
    return modifiers.map((m) => MAC_MODIFIERS[m]).join('') + (MAC_KEYS[key] ?? key);
  }
  return [...modifiers, OTHER_KEYS[key] ?? key].join('+');
}

/** A normalized sequence for display, chords separated by commas, as IntelliJ shows them. */
export function formatSequence(sequence: string, platform: Platform): string {
  // A modifier tapped twice, as IntelliJ names it: "Double Shift", "Double ⇧".
  const [first, second, ...rest] = sequence.split(' ');
  if (rest.length === 0 && first === second && MODIFIERS.includes(first as Modifier)) {
    const modifier = first as Modifier;
    return `Double ${platform === 'mac' ? MAC_MODIFIERS[modifier] : modifier}`;
  }
  return sequence
    .split(' ')
    .map((chord) => formatChord(chord, platform))
    .join(', ');
}

/** The modifiers' names as `KeyboardEvent.key` gives them. */
const MODIFIER_KEYS: Readonly<Record<string, Modifier>> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: 'Meta',
};

/** How quickly a modifier's second tap must follow the first, in milliseconds. */
export const DOUBLE_TAP = 400;

/**
 * Taps of a modifier on its own (pressed and released with nothing else), for IntelliJ's double
 * Shift: fed every key event, it gives `Shift Shift` when a tap follows another of the same
 * modifier within `interval`.
 */
export class ModifierTaps {
  /** The modifier held on its own, if one is. */
  private held: Modifier | undefined;
  private last: { modifier: Modifier; at: number } | undefined;

  constructor(
    private readonly interval = DOUBLE_TAP,
    private readonly now = () => Date.now(),
  ) {}

  keydown(event: KeyEventLike & { repeat?: boolean }): void {
    if (event.repeat) return;
    const modifier = MODIFIER_KEYS[event.key];
    const held: Record<Modifier, boolean> = {
      Ctrl: event.ctrlKey,
      Alt: event.altKey,
      Shift: event.shiftKey,
      Meta: event.metaKey,
    };
    // Only a modifier pressed with no other held (its own flag may be either): anything else
    // breaks taps.
    if (modifier && MODIFIERS.every((m) => m === modifier || !held[m])) this.held = modifier;
    else this.reset();
  }

  /** The sequence a key's release completes, if it's a second quick tap. */
  keyup(event: KeyEventLike): string | undefined {
    const modifier = MODIFIER_KEYS[event.key];
    if (modifier === undefined || modifier !== this.held) {
      this.reset();
      return undefined;
    }
    this.held = undefined;
    const at = this.now();
    if (this.last?.modifier === modifier && at - this.last.at <= this.interval) {
      this.last = undefined;
      return `${modifier} ${modifier}`;
    }
    this.last = { modifier, at };
    return undefined;
  }

  /** Forgets taps, as when the window loses the focus. */
  reset(): void {
    this.held = undefined;
    this.last = undefined;
  }
}
