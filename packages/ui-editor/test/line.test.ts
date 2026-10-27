import { describe, expect, it } from 'vitest';
import { formatLineColumn, parseLineColumn } from '../src/index.js';

const here = { line: 9, column: 4 };

describe('Go to Line', () => {
  it('shows a position from 1', () => {
    expect(formatLineColumn(here)).toBe('10:5');
  });

  it('reads a line, a line and column, or a column on the current line', () => {
    expect(parseLineColumn('42', here)).toEqual({ line: 41, column: 0 });
    expect(parseLineColumn(' 42 : 7 ', here)).toEqual({ line: 41, column: 6 });
    expect(parseLineColumn(':7', here)).toEqual({ line: 9, column: 6 });
    expect(parseLineColumn('42:', here)).toEqual({ line: 41, column: 0 });
    // 0 is taken as the first.
    expect(parseLineColumn('0:0', here)).toEqual({ line: 0, column: 0 });
  });

  it('refuses what isn’t a position', () => {
    for (const text of ['', ' ', ':', 'abc', '1:2:3', '-1', '1.5']) {
      expect(parseLineColumn(text, here)).toBeUndefined();
    }
  });
});
