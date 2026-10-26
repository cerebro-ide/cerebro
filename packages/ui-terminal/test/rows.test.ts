import { Terminal, type IBufferLine } from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { drawRuns, keyOf, runsOf } from '../src/rows.js';

/** The first line of what a terminal shows after `text`. */
async function lineOf(text: string, cols = 12) {
  const terminal = new Terminal({ cols, rows: 2, allowProposedApi: true });
  await new Promise<void>((resolve) => {
    terminal.write(text, resolve);
  });
  const buffer = terminal.buffer.active;
  return { line: buffer.getLine(0) as IBufferLine, cell: buffer.getNullCell() };
}

describe('runs of cells', () => {
  it('joins cells that look the same, up to the width', async () => {
    const { line, cell } = await lineOf('ab\x1b[1;31mcd\x1b[0me', 6);
    const runs = runsOf(line, 6, cell);
    expect(runs.map((r) => [r.text, r.width, r.bold, r.fg])).toEqual([
      ['ab', 2, false, undefined],
      ['cd', 2, true, 'var(--cerebro-terminal-ansi-1)'],
      ['e ', 2, false, undefined],
    ]);
  });

  it('reads the palette, true colours and every attribute', async () => {
    const { line, cell } = await lineOf(
      '\x1b[38;5;196;48;2;1;2;3mA\x1b[0;3;2;4;9mB\x1b[0;8mC\x1b[0;44mD\x1b[0;38;2;4;5;6mE',
      5,
    );
    const [a, b, c, d, e] = runsOf(line, 5, cell);
    expect(a).toMatchObject({ fg: '#ff0000', bg: '#010203' });
    expect(b).toMatchObject({ italic: true, dim: true, underline: true, strike: true });
    expect(c?.fg).toBe('transparent');
    expect(d?.bg).toBe('var(--cerebro-terminal-ansi-4)');
    expect(e?.fg).toBe('#040506');
  });

  it('swaps the colours of inverse cells, defaults included', async () => {
    const { line, cell } = await lineOf('\x1b[7mA\x1b[0;7;32;45mB', 2);
    const [a, b] = runsOf(line, 2, cell);
    expect(a).toMatchObject({ fg: 'var(--cerebro-background)', bg: 'var(--cerebro-text)' });
    expect(b).toMatchObject({
      fg: 'var(--cerebro-terminal-ansi-5)',
      bg: 'var(--cerebro-terminal-ansi-2)',
    });
  });

  it('boxes wide characters and symbols, and marks the selection', async () => {
    const { line, cell } = await lineOf('a中─⏺bc', 7);
    const runs = runsOf(line, 7, cell, { start: 5, end: 6 });
    expect(runs.map((r) => [r.text, r.width, r.boxed, r.selected])).toEqual([
      ['a', 1, false, false],
      ['中', 2, true, false],
      ['─', 1, false, false],
      ['⏺', 1, true, false],
      ['b', 1, false, true],
      ['c', 1, false, false],
    ]);
  });
});

describe('drawing runs', () => {
  it('makes a span per run, styled through the style object', async () => {
    const { line, cell } = await lineOf('a\x1b[1;3;2;4;9;31;42mb\x1b[0m中\x1b[44mcd', 6);
    const row = document.createElement('div');
    drawRuns(row, runsOf(line, 6, cell, { start: 4, end: 5 }));
    const spans = [...row.children] as HTMLElement[];
    expect(spans.map((s) => s.textContent)).toEqual(['a', 'b', '中', 'c', 'd']);
    expect(spans[0]?.className).toBe('');
    expect(spans[1]?.className).toBe(
      'cerebro-terminal__bold cerebro-terminal__italic cerebro-terminal__dim',
    );
    expect(spans[1]?.style.color).toBe('var(--cerebro-terminal-ansi-1)');
    expect(spans[1]?.style.backgroundColor).toBe('var(--cerebro-terminal-ansi-2)');
    expect(spans[1]?.style.textDecorationLine).toBe('underline line-through');
    expect(spans[2]?.className).toBe('cerebro-terminal__box');
    expect(spans[2]?.style.width).toBe('2ch');
    // Selected: the selection's colour, not the cell's.
    expect(spans[3]?.className).toBe('cerebro-terminal__selected');
    expect(spans[3]?.style.backgroundColor).toBe('');
    expect(spans[4]?.style.backgroundColor).toBe('var(--cerebro-terminal-ansi-4)');
  });

  it('keys runs by how they look', async () => {
    const { line, cell } = await lineOf('ab');
    expect(keyOf(runsOf(line, 2, cell))).toBe(keyOf(runsOf(line, 2, cell)));
    expect(keyOf(runsOf(line, 2, cell))).not.toBe(
      keyOf(runsOf(line, 2, cell, { start: 0, end: 1 })),
    );
  });
});
