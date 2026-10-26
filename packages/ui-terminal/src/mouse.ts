// Mouse reports to a program that asked for them (CSI ? 1000 h and the like), in the SGR encoding
// when it asked for that too (CSI ? 1006 h), else the original one.

export type MouseTracking = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

export interface MouseReport {
  kind: 'press' | 'release' | 'move' | 'wheel-up' | 'wheel-down';
  /** 0 left, 1 middle, 2 right; ignored for wheels. Moves with no button pressed give -1. */
  button: number;
  /** Zero-based, on the screen. */
  col: number;
  row: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

/** The bytes to send for a mouse event, or undefined when the tracking mode doesn't report it. */
export function encodeMouse(
  report: MouseReport,
  tracking: MouseTracking,
  sgr: boolean,
): string | undefined {
  if (tracking === 'none') return undefined;
  const { kind } = report;
  if (tracking === 'x10' && kind !== 'press') return undefined;
  if (kind === 'move') {
    if (tracking === 'vt200') return undefined;
    if (tracking === 'drag' && report.button < 0) return undefined;
  }
  let code: number;
  if (kind === 'wheel-up') code = 64;
  else if (kind === 'wheel-down') code = 65;
  else if (kind === 'move') code = 32 + (report.button < 0 ? 3 : report.button);
  else code = kind === 'release' && !sgr ? 3 : report.button;
  // X10 mode reports no modifiers.
  if (tracking !== 'x10') {
    code += (report.shift ? 4 : 0) + (report.alt ? 8 : 0) + (report.ctrl ? 16 : 0);
  }
  const col = report.col + 1;
  const row = report.row + 1;
  if (sgr) {
    return `\x1b[<${String(code)};${String(col)};${String(row)}${kind === 'release' ? 'm' : 'M'}`;
  }
  // The original encoding: bytes offset by 32, so positions stop at 223.
  if (col > 223 || row > 223) return undefined;
  return `\x1b[M${String.fromCharCode(32 + code, 32 + col, 32 + row)}`;
}
