// What a key press sends to a terminal's program, as xterm sends it: control characters, escape
// sequences for the special keys (with their modifiers), and Alt as an Escape prefix. Printable
// text isn't encoded here: it arrives through the view's text field, so input methods work.

export interface KeyModes {
  /** DECCKM: the arrow keys send SS3 sequences (ESC O A) instead of CSI ones (ESC [ A). */
  applicationCursorKeys: boolean;
  /** On macOS Option types characters, so it isn't Meta unless asked. */
  mac?: boolean;
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const CURSOR: Record<string, string> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

const TILDE: Record<string, string> = {
  Insert: '2',
  Delete: '3',
  PageUp: '5',
  PageDown: '6',
  F5: '15',
  F6: '17',
  F7: '18',
  F8: '19',
  F9: '20',
  F10: '21',
  F11: '23',
  F12: '24',
};

const SS3_FUNCTION: Record<string, string> = { F1: 'P', F2: 'Q', F3: 'R', F4: 'S' };

/** Control characters for Ctrl with a punctuation key. */
const CTRL_PUNCTUATION: Record<string, string> = {
  ' ': '\x00',
  '@': '\x00',
  '2': '\x00',
  '[': '\x1b',
  '3': '\x1b',
  '\\': '\x1c',
  '4': '\x1c',
  ']': '\x1d',
  '5': '\x1d',
  '^': '\x1e',
  '6': '\x1e',
  _: '\x1f',
  '-': '\x1f',
  '/': '\x1f',
  '7': '\x1f',
  '8': '\x7f',
};

/** The xterm modifier parameter: 1 + Shift 1 + Alt 2 + Ctrl 4. */
function modifier(event: KeyLike, alt: boolean): number {
  return 1 + (event.shiftKey ? 1 : 0) + (alt ? 2 : 0) + (event.ctrlKey ? 4 : 0);
}

/** The sequence a key sends, or undefined for keys that type text or send nothing. */
export function encodeKey(event: KeyLike, modes: KeyModes): string | undefined {
  // Cmd combinations are the app's, never the terminal's.
  if (event.metaKey) return undefined;
  const alt = event.altKey && !modes.mac;
  const mod = modifier(event, alt);
  const { key } = event;

  const cursor = CURSOR[key];
  if (cursor !== undefined) {
    if (mod > 1) return `\x1b[1;${String(mod)}${cursor}`;
    return `${modes.applicationCursorKeys ? '\x1bO' : '\x1b['}${cursor}`;
  }
  const tilde = TILDE[key];
  if (tilde !== undefined) {
    return mod > 1 ? `\x1b[${tilde};${String(mod)}~` : `\x1b[${tilde}~`;
  }
  const ss3 = SS3_FUNCTION[key];
  if (ss3 !== undefined) return mod > 1 ? `\x1b[1;${String(mod)}${ss3}` : `\x1bO${ss3}`;

  const prefix = alt ? '\x1b' : '';
  switch (key) {
    case 'Enter':
      return `${prefix}\r`;
    case 'Backspace':
      return prefix + (event.ctrlKey ? '\x08' : '\x7f');
    case 'Tab':
      return event.shiftKey ? '\x1b[Z' : `${prefix}\t`;
    case 'Escape':
      return `${prefix}\x1b`;
  }
  if (key.length !== 1) return undefined;
  if (event.ctrlKey) {
    const lower = key.toLowerCase();
    if (lower >= 'a' && lower <= 'z') {
      return prefix + String.fromCharCode(lower.charCodeAt(0) - 96);
    }
    const control = CTRL_PUNCTUATION[key];
    return control === undefined ? undefined : prefix + control;
  }
  // Alt with a character: Escape, then the character. (Without Alt, the text field types it.)
  return alt ? `\x1b${key}` : undefined;
}
