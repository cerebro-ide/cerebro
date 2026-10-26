// Matching a query against a name, as popups filter their lists: the query's characters in order,
// not necessarily adjacent, ignoring case (`mts` matches `main.ts`). Matches score higher for runs
// of adjacent characters and for starting words (after a separator, or a capital in camelCase), and
// shorter names win ties. The best-scoring placement is found among the likely ones for each
// character: right after the previous match, at a word start, or its first occurrence.
//
// IntelliJ's matching is richer (camel humps, typo tolerance); this is the simple start.

/** Where a query matched a text, and how well. */
export interface Match {
  /** The matched characters' indices in the text, in UTF-16 code units. */
  indices: number[];
  score: number;
}

const WORD_START = 2;
const ADJACENT = 3;

/** Whether a character code is an ASCII letter or digit; undefined beyond ASCII. */
function asciiWordChar(code: number): boolean | undefined {
  if (code >= 128) return undefined;
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const previous = text[i - 1] as string;
  const char = text[i] as string;
  // ASCII by character code (most paths are), anything else by Unicode class: much faster over
  // thousands of paths.
  const word = asciiWordChar(previous.charCodeAt(0)) ?? /[\p{L}\p{N}]/u.test(previous);
  return !word || (char !== char.toLowerCase() && previous === previous.toLowerCase());
}

const scratch = { starts: new Uint8Array(256), memo: new Float64Array(1024) };

/** Matches `query` against `text`, or undefined when it doesn't match. */
export function match(query: string, text: string): Match | undefined {
  const q = query.toLowerCase().replaceAll(' ', '');
  const t = text.toLowerCase();
  // Most texts don't match at all: a plain in-order check rules them out before the search.
  let at = -1;
  for (const char of q) {
    at = t.indexOf(char, at + 1);
    if (at < 0) return undefined;
  }
  const n = t.length;
  // Scratch space shared by all calls, grown as needed: filtering thousands of paths would
  // otherwise allocate two arrays for each.
  if (scratch.starts.length < n) scratch.starts = new Uint8Array(n * 2);
  const starts = scratch.starts;
  for (let i = 0; i < n; i++) starts[i] = isWordStart(text, i) ? 1 : 0;
  // The best score for placing q[from…] after index `previous`, memoized in a flat array (NaN:
  // not yet known; -Infinity: no placement). Only scores are kept while searching; the indices are
  // read back from the memo afterwards.
  const size = q.length * (n + 1);
  if (scratch.memo.length < size) scratch.memo = new Float64Array(size * 2);
  const memo = scratch.memo;
  memo.fill(Number.NaN, 0, size);
  /**
   * Calls `visit` with each likely spot for q[from] after `previous` and its score, until `visit`
   * returns true.
   */
  const each = (from: number, previous: number, visit: (at: number, score: number) => boolean) => {
    const char = q[from] as string;
    const first = t.indexOf(char, previous + 1);
    if (first < 0) return;
    for (let at = first; at < n; at++) {
      const adjacent = from > 0 && at === previous + 1;
      if (t[at] !== char || (at !== first && !adjacent && !starts[at])) continue;
      const rest = best(from + 1, at);
      if (rest === -Infinity) return;
      const score = 1 + (starts[at] ? WORD_START : 0) + (adjacent ? ADJACENT : 0) + rest;
      if (visit(at, score)) return;
    }
  };
  const best = (from: number, previous: number): number => {
    if (from === q.length) return 0;
    const key = from * (n + 1) + previous + 1;
    const known = memo[key] as number;
    if (!Number.isNaN(known)) return known;
    let result = -Infinity;
    each(from, previous, (_at, score) => {
      if (score > result) result = score;
      return false;
    });
    memo[key] = result;
    return result;
  };
  const total = best(0, -1);
  // The placements that gave the best score: the first spot reaching it at each step.
  const indices: number[] = [];
  let previous = -1;
  for (let from = 0; from < q.length; from++) {
    const target = best(from, previous);
    each(from, previous, (spot, score) => {
      if (score !== target) return false;
      indices.push(spot);
      previous = spot;
      return true;
    });
  }
  return { indices, score: total - text.length / 100 };
}

export interface Filterable {
  label: string;
  detail?: string;
  highlight?: readonly number[];
}

/**
 * The items matching `query`, best first, each with its label's matched characters to highlight.
 * An item whose label doesn't match may match on its detail and label together (`src/sh` finds
 * `shell.tsx` in `src`), shown without highlights. A blank query keeps them all, in order.
 */
export function fuzzyFilter<T extends Filterable>(items: readonly T[], query: string): T[] {
  if (query.trim() === '') return [...items];
  const matched: { item: T; score: number }[] = [];
  for (const item of items) {
    const label = match(query, item.label);
    if (label) {
      matched.push({ item: { ...item, highlight: label.indices }, score: label.score });
      continue;
    }
    const full =
      item.detail === undefined ? undefined : match(query, `${item.detail}/${item.label}`);
    if (full) matched.push({ item, score: full.score - 10 });
  }
  return matched.sort((a, b) => b.score - a.score).map((m) => m.item);
}
