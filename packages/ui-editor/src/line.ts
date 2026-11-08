// Go to Line, as IntelliJ's Navigate → Line/Column: "[Line] [:column]", counted from 1. The caret's
// place on the status bar, as IntelliJ's PositionPanel: the same, with what's selected.

/** What's selected: its characters (code points, as IntelliJ counts them) and line breaks. */
export interface Selected {
  chars: number;
  lineBreaks: number;
}

/** A position as Go to Line shows it: line:column, from 1. */
export function formatLineColumn(at: { line: number; column: number }): string {
  return `${String(at.line + 1)}:${String(at.column + 1)}`;
}

/** The caret's place, as IntelliJ's status bar shows it: `12:5 (10 chars, 1 line break)`. */
export function positionText(at: { line: number; column: number }, selected?: Selected): string {
  const place = formatLineColumn(at);
  if (!selected) return place;
  const chars = `${String(selected.chars)} ${selected.chars === 1 ? 'char' : 'chars'}`;
  if (selected.lineBreaks === 0) return `${place} (${chars})`;
  const breaks = `${String(selected.lineBreaks)} line ${selected.lineBreaks === 1 ? 'break' : 'breaks'}`;
  return `${place} (${chars}, ${breaks})`;
}

/**
 * The position typed, zero-based, or undefined if it isn't one. Without a line, the line is the
 * current one; without a column, the line's start.
 */
export function parseLineColumn(
  text: string,
  current: { line: number; column: number },
): { line: number; column: number } | undefined {
  const match = /^\s*(\d*)\s*(?::\s*(\d*)\s*)?$/.exec(text);
  if (!match) return undefined;
  const [, line = '', column = ''] = match;
  if (line === '' && column === '') return undefined;
  return {
    line: line === '' ? current.line : Math.max(Number(line), 1) - 1,
    column: column === '' ? 0 : Math.max(Number(column), 1) - 1,
  };
}
