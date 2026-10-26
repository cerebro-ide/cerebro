// A terminal line as the page shows it: runs of cells that look the same, each a <span>. Colours
// and widths are set through the style object, never a style attribute, which the page's
// Content-Security-Policy would block.
//
// Cells are 1ch wide (the font is monospace). Characters the font may not have, or draws at
// another width (symbols, emoji, wide CJK), each get a box of exactly their cells, so one odd
// glyph can't shift the rest of the line.

import type { IBufferCell, IBufferLine } from '@xterm/headless';
import { paletteColour, rgbColour } from './colors.js';

export interface Run {
  text: string;
  /** In cells. */
  width: number;
  /** A box of fixed width, for a character whose glyph may not be one cell wide. */
  boxed: boolean;
  fg: string | undefined;
  bg: string | undefined;
  bold: boolean;
  italic: boolean;
  dim: boolean;
  underline: boolean;
  strike: boolean;
  selected: boolean;
}

/** Columns [start, end) of a line that are selected. */
export interface Span {
  start: number;
  end: number;
}

/** Characters drawn in line with the text: Latin, and the box-drawing and block elements. */
function inline(text: string): boolean {
  const code = text.codePointAt(0) as number;
  return text.length === 1 && (code < 0x0250 || (code >= 0x2500 && code <= 0x259f));
}

function colour(mode: 'fg' | 'bg', cell: IBufferCell): string | undefined {
  if (mode === 'fg') {
    if (cell.isFgRGB()) return rgbColour(cell.getFgColor());
    if (cell.isFgPalette()) return paletteColour(cell.getFgColor());
    return undefined;
  }
  if (cell.isBgRGB()) return rgbColour(cell.getBgColor());
  if (cell.isBgPalette()) return paletteColour(cell.getBgColor());
  return undefined;
}

/** The line's cells as runs, up to `cols`; `cell` is reused while reading. */
export function runsOf(
  line: IBufferLine,
  cols: number,
  cell: IBufferCell,
  selection?: Span,
): Run[] {
  const runs: Run[] = [];
  let last: Run | undefined;
  for (let x = 0; x < cols; x++) {
    line.getCell(x, cell);
    const width = cell.getWidth();
    // The second half of a wide character: drawn with the first.
    if (width === 0) continue;
    let fg = colour('fg', cell);
    let bg = colour('bg', cell);
    if (cell.isInverse()) {
      [fg, bg] = [bg ?? 'var(--cerebro-background)', fg ?? 'var(--cerebro-text)'];
    }
    if (cell.isInvisible()) fg = 'transparent';
    const text = cell.getChars() || ' ';
    const boxed = width > 1 || !inline(text);
    const run: Run = {
      text,
      width,
      boxed,
      fg,
      bg,
      bold: cell.isBold() !== 0,
      italic: cell.isItalic() !== 0,
      dim: cell.isDim() !== 0,
      underline: cell.isUnderline() !== 0,
      strike: cell.isStrikethrough() !== 0,
      selected: selection !== undefined && x >= selection.start && x < selection.end,
    };
    if (last && !boxed && !last.boxed && same(last, run)) {
      last.text += run.text;
      last.width += 1;
    } else {
      runs.push(run);
      last = run;
    }
  }
  return runs;
}

function same(a: Run, b: Run): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.dim === b.dim &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.selected === b.selected
  );
}

/** A string that changes whenever the runs would draw differently: to skip unchanged lines. */
export function keyOf(runs: readonly Run[]): string {
  return JSON.stringify(runs);
}

/** Fills `row` with the runs' spans. */
export function drawRuns(row: HTMLElement, runs: readonly Run[]): void {
  const spans = runs.map((run) => {
    const span = document.createElement('span');
    span.textContent = run.text;
    const classes = [
      run.boxed && 'cerebro-terminal__box',
      run.bold && 'cerebro-terminal__bold',
      run.italic && 'cerebro-terminal__italic',
      run.dim && 'cerebro-terminal__dim',
      run.selected && 'cerebro-terminal__selected',
    ].filter((c) => c !== false);
    if (classes.length > 0) span.className = classes.join(' ');
    if (run.boxed) span.style.width = `${String(run.width)}ch`;
    if (run.fg !== undefined) span.style.color = run.fg;
    if (run.bg !== undefined && !run.selected) span.style.backgroundColor = run.bg;
    const lines = [run.underline && 'underline', run.strike && 'line-through'].filter(
      (l) => l !== false,
    );
    if (lines.length > 0) span.style.textDecorationLine = lines.join(' ');
    return span;
  });
  row.replaceChildren(...spans);
}
