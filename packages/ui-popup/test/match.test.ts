import { describe, expect, it } from 'vitest';
import { fuzzyFilter, match } from '../src/index.js';

describe('match', () => {
  it('finds the query’s characters in order, ignoring case and spaces', () => {
    expect(match('mts', 'main.ts')?.indices).toEqual([0, 5, 6]);
    expect(match('M T', 'main.ts')?.indices).toEqual([0, 5]);
    expect(match('tsm', 'main.ts')).toBeUndefined();
    expect(match('', 'x')).toEqual({ indices: [], score: -0.01 });
    expect(match('xyz', 'x')).toBeUndefined();
  });

  it('prefers starts of words, after separators or camel humps', () => {
    expect(match('s', 'base/shell.tsx')?.indices).toEqual([5]);
    expect(match('ev', 'searchEverywhere')?.indices).toEqual([6, 7]);
    // A later word start that continues into a run beats the first occurrence.
    expect(match('abc', 'a-ab-c')?.indices).toEqual([2, 3, 5]);
    // Without a later word start, the first occurrence stays.
    expect(match('a', 'banana')?.indices).toEqual([1]);
  });

  it('scores runs and word starts higher, and shorter names on ties', () => {
    const score = (q: string, t: string) => match(q, t)?.score ?? -Infinity;
    expect(score('mai', 'main.ts')).toBeGreaterThan(score('mai', 'm-a-i'));
    expect(score('st', 'src/styles.css')).toBeGreaterThan(score('st', 'pasta'));
    expect(score('main', 'main.ts')).toBeGreaterThan(score('main', 'main.test.ts'));
  });
});

describe('fuzzyFilter', () => {
  const files = [
    { label: 'shell.tsx', detail: 'src' },
    { label: 'main.ts', detail: 'src' },
    { label: 'README.md' },
  ];

  it('keeps everything, in order, for a blank query', () => {
    expect(fuzzyFilter(files, '  ')).toEqual(files);
  });

  it('keeps matches, best first, with the label’s matches to highlight', () => {
    expect(fuzzyFilter(files, 'm')).toEqual([
      { label: 'main.ts', detail: 'src', highlight: [0] },
      { label: 'README.md', highlight: [7] },
    ]);
  });

  it('matches on detail and label together, without highlights', () => {
    expect(fuzzyFilter(files, 'src/sh')).toEqual([{ label: 'shell.tsx', detail: 'src' }]);
  });
});
