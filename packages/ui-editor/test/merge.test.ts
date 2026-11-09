import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { linesText, mergeChanges } from '../src/merge.js';

const doc = (...lines: string[]) => Text.of([...lines, '']);
const changes = (base: Text, yours: Text, theirs: Text) =>
  mergeChanges(base, yours, theirs).map((c) => ({
    kind: c.kind,
    base: [c.base.from, c.base.to],
    yours: [c.yours.from, c.yours.to],
    theirs: [c.theirs.from, c.theirs.to],
  }));

describe('three-way merge', () => {
  const base = doc('a', 'b', 'c', 'd', 'e', 'f');

  it('finds none when neither side changed the base', () => {
    expect(changes(base, base, base)).toEqual([]);
  });

  it('keeps each side’s changes apart where they don’t touch', () => {
    expect(
      changes(base, doc('A', 'b', 'c', 'd', 'e', 'f'), doc('a', 'b', 'c', 'd', 'e', 'F', 'g')),
    ).toEqual([
      { kind: 'yours', base: [0, 1], yours: [0, 1], theirs: [0, 1] },
      { kind: 'theirs', base: [5, 6], yours: [5, 6], theirs: [5, 7] },
    ]);
  });

  it('goes on with one side’s changes once the other’s run out', () => {
    expect(
      changes(base, doc('a', 'b', 'c', 'd', 'e', 'F'), doc('A', 'b', 'c', 'd', 'e', 'f')),
    ).toEqual([
      { kind: 'theirs', base: [0, 1], yours: [0, 1], theirs: [0, 1] },
      { kind: 'yours', base: [5, 6], yours: [5, 6], theirs: [5, 6] },
    ]);
  });

  it('places a change after the other side’s, by the lines it added or removed', () => {
    expect(
      changes(base, doc('x', 'y', 'a', 'b', 'c', 'd', 'e', 'f'), doc('a', 'b', 'c', 'e', 'f')),
    ).toEqual([
      { kind: 'yours', base: [0, 0], yours: [0, 2], theirs: [0, 0] },
      { kind: 'theirs', base: [3, 4], yours: [5, 6], theirs: [3, 3] },
    ]);
  });

  it('makes a conflict of changes that overlap or touch, unless they’re the same', () => {
    expect(
      changes(base, doc('a', 'B', 'C', 'd', 'e', 'f'), doc('a', 'b', 'Z', 'D', 'e', 'f')),
    ).toEqual([{ kind: 'conflict', base: [1, 4], yours: [1, 4], theirs: [1, 4] }]);
    // Next to each other, as git has them.
    expect(
      changes(base, doc('a', 'B', 'c', 'd', 'e', 'f'), doc('a', 'b', 'C', 'd', 'e', 'f')),
    ).toEqual([{ kind: 'conflict', base: [1, 3], yours: [1, 3], theirs: [1, 3] }]);
    expect(
      changes(base, doc('a', 'B', 'c', 'd', 'e', 'f'), doc('a', 'B', 'c', 'd', 'e', 'f')),
    ).toEqual([{ kind: 'both', base: [1, 2], yours: [1, 2], theirs: [1, 2] }]);
  });

  it('spans what a change on one side covers of several on the other', () => {
    const yours = doc('a', 'X', 'Y', 'Z', 'W', 'f');
    const theirs = doc('a', 'B', 'c', 'D', 'e', 'f');
    expect(changes(base, yours, theirs)).toEqual([
      { kind: 'conflict', base: [1, 5], yours: [1, 5], theirs: [1, 5] },
    ]);
  });

  it('gives a range of lines’ text, the last without a newline if it has none', () => {
    const text = Text.of(['one', 'two', 'three']);
    expect(linesText(text, { from: 0, to: 2 })).toBe('one\ntwo\n');
    expect(linesText(text, { from: 2, to: 3 })).toBe('three');
    expect(linesText(text, { from: 1, to: 1 })).toBe('');
  });
});
