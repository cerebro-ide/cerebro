import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { compare, kindOf, type Change } from '../src/compare.js';

const text = (lines: readonly string[]) => Text.of([...lines]);
const run = (
  a: string[],
  b: string[],
  ...policies: Parameters<typeof compare> extends [unknown, unknown, ...infer P] ? P : never
) => compare(text(a), text(b), ...policies);
/** A change's marked text on each side. */
const marked = (a: string[], b: string[], change: Change) => {
  const join = (lines: string[], from: number, to: number) => lines.slice(from, to).join('\n');
  const [textA, textB] = [join(a, change.start1, change.end1), join(b, change.start2, change.end2)];
  return change.parts?.map((p) => [textA.slice(p.fromA, p.toA), textB.slice(p.fromB, p.toB)]);
};

describe('comparing two texts', () => {
  it('finds changed lines, and their changed words, as IntelliJ’s defaults', () => {
    const a = ['const a = 1;', 'same', 'gone'];
    const b = ['const b = 1;', 'same', 'added'];
    const changes = run(a, b);
    expect(
      changes.map(({ start1, end1, start2, end2, kind }) => ({ start1, end1, start2, end2, kind })),
    ).toEqual([
      { start1: 0, end1: 1, start2: 0, end2: 1, kind: 'modified' },
      { start1: 2, end1: 3, start2: 2, end2: 3, kind: 'modified' },
    ]);
    expect(marked(a, b, changes[0] as Change)).toEqual([['a', 'b']]);
    // Whole words, not the characters they share.
    expect(marked(a, b, changes[1] as Change)).toEqual([['gone', 'added']]);
  });

  it('marks lines added or removed whole, with no changed text', () => {
    expect(run(['a'], ['a', 'b'])).toEqual([
      { start1: 1, end1: 1, start2: 1, end2: 2, kind: 'inserted', parts: undefined },
    ]);
    expect(run(['a', 'b'], ['b'])).toEqual([
      { start1: 0, end1: 1, start2: 0, end2: 0, kind: 'deleted', parts: undefined },
    ]);
    expect([kindOf(false, true), kindOf(true, false), kindOf(true, true)]).toEqual([
      'inserted',
      'deleted',
      'modified',
    ]);
  });

  it('highlights by lines, characters, split changes, or not at all', () => {
    const a = ['value = 1;', 'other = 2;'];
    const b = ['valve = 10;', 'other = 20;'];
    expect(run(a, b, 'none', 'lines')).toEqual([
      { start1: 0, end1: 2, start2: 0, end2: 2, kind: 'modified', parts: undefined },
    ]);
    const [chars] = run(a, b, 'none', 'characters');
    expect(marked(a, b, chars as Change)).toEqual([
      ['u', 'v'],
      ['', '0'],
      ['', '0'],
    ]);
    // Split where the changed text is a line apart: each line its own change.
    const split = run(a, b, 'none', 'split');
    expect(split.map(({ start1, end1, start2, end2 }) => [start1, end1, start2, end2])).toEqual([
      [0, 1, 0, 1],
      [1, 2, 1, 2],
    ]);
    expect(split.map((c) => marked(a, b, c))).toEqual([
      [
        ['value', 'valve'],
        ['1', '10'],
      ],
      [['2', '20']],
    ]);
    // Changed text on one line alone isn't split.
    expect(run(['a b'], ['c d'], 'none', 'split')).toHaveLength(1);
    expect(run(a, b, 'none', 'none')).toEqual([]);
  });

  it('ignores white space at the lines’ ends when trimming, anywhere when ignoring it', () => {
    expect(run(['  x', 'y '], ['x', 'y'], 'trim')).toEqual([]);
    expect(run(['  x'], ['x'])).toHaveLength(1);
    expect(run(['a b'], ['a  b'], 'trim')).toHaveLength(1);
    expect(run(['a b'], ['ab'], 'whitespaces')).toEqual([]);
    // In a changed line, a change of white space alone isn't marked; trimmed, only at its ends.
    const a = ['x = 1'];
    const b = ['  x  =  2'];
    expect(marked(a, b, run(a, b, 'trim')[0] as Change)).toEqual([
      [' ', '  '],
      [' ', '  '],
      ['1', '2'],
    ]);
    expect(marked(a, b, run(a, b, 'whitespaces')[0] as Change)).toEqual([['1', '2']]);
    // White space after a change, too; an empty line changed.
    const [after] = run(['f(1 )'], ['f(2  )'], 'whitespaces');
    expect(marked(['f(1 )'], ['f(2  )'], after as Change)).toEqual([['1', '2']]);
    expect(marked([''], ['x'], run([''], ['x'])[0] as Change)).toEqual([['', 'x']]);
    expect(marked(a, b, run(a, b)[0] as Change)).toEqual([
      ['', '  '],
      [' ', '  '],
      [' ', '  '],
      ['1', '2'],
    ]);
  });

  it('ignores lines left blank too, with white space and empty lines ignored', () => {
    expect(run(['a', 'b'], ['a', '', '  ', 'b'], 'whitespacesAndEmptyLines')).toEqual([]);
    expect(run(['a', 'b'], ['a', '', 'b'], 'whitespaces')).toHaveLength(1);
    expect(run(['a'], ['a', '', 'c'], 'whitespacesAndEmptyLines')).toHaveLength(1);
  });

  it('tells apart more different lines than characters below the surrogates', () => {
    const a = Array.from({ length: 56_000 }, (_, i) => `line ${String(i)}`);
    const b = [...a.slice(0, -1), 'changed'];
    expect(run(a, b, 'none', 'lines')).toEqual([
      {
        start1: 55_999,
        end1: 56_000,
        start2: 55_999,
        end2: 56_000,
        kind: 'modified',
        parts: undefined,
      },
    ]);
  });
});
