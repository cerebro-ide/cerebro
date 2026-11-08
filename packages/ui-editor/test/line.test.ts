import { describe, expect, it } from 'vitest';
import { formatLineColumn, parseLineColumn, positionText } from '../src/index.js';

const here = { line: 9, column: 4 };

describe('Go to Line', () => {
  it('shows a position from 1', () => {
    expect(formatLineColumn(here)).toBe('10:5');
  });

  it('shows the caret on the status bar with what’s selected, as IntelliJ', () => {
    expect(positionText(here)).toBe('10:5');
    expect(positionText(here, { chars: 1, lineBreaks: 0 })).toBe('10:5 (1 char)');
    expect(positionText(here, { chars: 10, lineBreaks: 1 })).toBe('10:5 (10 chars, 1 line break)');
    expect(positionText(here, { chars: 30, lineBreaks: 3 })).toBe('10:5 (30 chars, 3 line breaks)');
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
