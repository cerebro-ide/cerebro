// Three-way merge, as IntelliJ's merge window computes it (`ComparisonMergeUtil`): the changes
// yours and theirs made to the base, by whole lines, as IntelliJ compares lines first. CodeMirror's
// diff, on characters, could join two changes across an unchanged line between them, so it's given
// the lines, each distinct one as a character of its own. Changes that touch or overlap combine
// into one: a conflict, unless both made the same change. The rest are one side's, and merge on
// their own.

import { diff } from '@codemirror/merge';
import type { Text } from '@codemirror/state';
import type { LineRange } from './compare.js';

/** Lines of a text, zero-based, the end excluded. */
export interface Lines {
  from: number;
  to: number;
}

/** Whose change it is: one side's, the same on both, or theirs and yours different. */
export type MergeKind = 'yours' | 'theirs' | 'both' | 'conflict';

/** A change to the base, and its lines in each text. */
export interface MergeChange {
  kind: MergeKind;
  base: Lines;
  yours: Lines;
  theirs: Lines;
}

/** A range of lines' text, newlines included. */
export function linesText(doc: Text, lines: Lines): string {
  const at = (line: number) => (line < doc.lines ? doc.line(line + 1).from : doc.length);
  return doc.sliceString(at(lines.from), at(lines.to));
}

/**
 * A span of the base's lines in one side's text: shifted by the side's changes before it
 * (`changes` up to `first`), and by those in it (from `first` to `last`).
 */
function span(
  changes: readonly LineRange[],
  first: number,
  last: number,
  from: number,
  to: number,
): Lines {
  const shift = (list: readonly LineRange[]) =>
    list.reduce((sum, c) => sum + c.end2 - c.start2 - (c.end1 - c.start1), 0);
  const prior = shift(changes.slice(0, first));
  return { from: from + prior, to: to + prior + shift(changes.slice(first, last)) };
}

/** A character for each distinct line, past the ASCII ones and short of the surrogates. */
const FIRST = 0x100;
const LAST = 0xd7ff;

/** The lines a side changed in the base, by a diff of the lines as characters. */
export function lineChanges(base: Text, side: Text): LineRange[] {
  return changesOf(base.toJSON(), side.toJSON());
}

/** What a side changed in the base's pieces (lines, or words), by a diff of each as a character. */
function changesOf(base: readonly string[], side: readonly string[]): LineRange[] {
  const codes = new Map<string, string>();
  const encode = (pieces: readonly string[]) =>
    pieces
      .map((line) => {
        let code = codes.get(line);
        if (code === undefined) {
          // Past the characters there are, lines alike share one: the diff is coarser, not wrong.
          code = String.fromCharCode(Math.min(FIRST + codes.size, LAST));
          codes.set(line, code);
        }
        return code;
      })
      .join('');
  return diff(encode(base), encode(side)).map((c) => ({
    start1: c.fromA,
    end1: c.toA,
    start2: c.fromB,
    end2: c.toB,
  }));
}

/** A stretch of the base that one side changed, or both: what of it each has, and who changed it. */
interface Combined {
  base: Lines;
  yours: Lines;
  theirs: Lines;
  changed: { yours: boolean; theirs: boolean };
}

/**
 * Yours' and theirs' changes to the base's pieces, combined where they touch or overlap, as
 * IntelliJ's `ComparisonMergeUtil` does.
 */
function combine(sides: readonly [LineRange[], LineRange[]]): Combined[] {
  const next = [0, 0];
  const combined: Combined[] = [];
  const at = (side: 0 | 1) => sides[side][next[side] as number];
  for (;;) {
    const [y, t] = [at(0), at(1)];
    if (!y && !t) return combined;
    const before = [...next];
    const start = Math.min(y?.start1 ?? Infinity, t?.start1 ?? Infinity);
    let end = start;
    const taken = [false, false];
    // A side's own changes never touch (the diff would have made them one), so whichever's next
    // touching or overlapping what's taken is the other's, or a change it spans.
    for (let side = nextTouching(); side !== undefined; side = nextTouching()) {
      end = Math.max(end, (at(side) as LineRange).end1);
      taken[side] = true;
      next[side] = (next[side] as number) + 1;
    }
    function nextTouching(): 0 | 1 | undefined {
      return ([0, 1] as const).find((side) => (at(side)?.start1 ?? Infinity) <= end);
    }
    combined.push({
      base: { from: start, to: end },
      yours: span(sides[0], before[0] as number, next[0] as number, start, end),
      theirs: span(sides[1], before[1] as number, next[1] as number, start, end),
      changed: { yours: taken[0] as boolean, theirs: taken[1] as boolean },
    });
  }
}

/** The changes yours and theirs made to the base, in order. */
export function mergeChanges(base: Text, yours: Text, theirs: Text): MergeChange[] {
  return combine([lineChanges(base, yours), lineChanges(base, theirs)]).map((c) => ({
    kind: !c.changed.theirs
      ? 'yours'
      : !c.changed.yours
        ? 'theirs'
        : linesText(yours, c.yours) === linesText(theirs, c.theirs)
          ? 'both'
          : 'conflict',
    base: c.base,
    yours: c.yours,
    theirs: c.theirs,
  }));
}

/** A text's words, runs of white space, and each other character, as IntelliJ's word diff splits it. */
const WORDS = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

/**
 * A conflict's lines resolved, as IntelliJ's Resolve Simple Conflicts (`MergeResolveUtil.tryResolve`,
 * read from its source): compared word by word, each side's changes are taken where the other
 * didn't change those words, or made the same change; undefined where both changed the same words
 * differently, or inserted different words in the same place, whose order can't be known.
 */
export function resolveConflict(base: string, yours: string, theirs: string): string | undefined {
  const words = (text: string): string[] => text.match(WORDS) ?? [];
  const [b, y, t] = [words(base), words(yours), words(theirs)];
  const piece = (words: readonly string[], lines: Lines) =>
    words.slice(lines.from, lines.to).join('');
  let resolved = '';
  let done = 0;
  for (const c of combine([changesOf(b, y), changesOf(b, t)])) {
    const [mine, others] = [piece(y, c.yours), piece(t, c.theirs)];
    if (c.changed.yours && c.changed.theirs && mine !== others) return undefined;
    resolved += piece(b, { from: done, to: c.base.from }) + (c.changed.yours ? mine : others);
    done = c.base.to;
  }
  return resolved + piece(b, { from: done, to: b.length });
}
