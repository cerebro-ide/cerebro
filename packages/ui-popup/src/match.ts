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

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const previous = text[i - 1] as string;
  const char = text[i] as string;
  return (
    /[^\p{L}\p{N}]/u.test(previous) ||
    (char !== char.toLowerCase() && previous === previous.toLowerCase())
  );
}

/** Matches `query` against `text`, or undefined when it doesn't match. */
export function match(query: string, text: string): Match | undefined {
  const q = query.toLowerCase().replaceAll(' ', '');
  const t = text.toLowerCase();
  const starts = Array.from({ length: t.length }, (_, i) => isWordStart(text, i));
  /** Best placements of q[from…] after index `previous`, memoized by both. */
  const memo = new Map<number, { score: number; indices: number[] } | null>();
  const best = (from: number, previous: number): { score: number; indices: number[] } | null => {
    if (from === q.length) return { score: 0, indices: [] };
    const key = from * (t.length + 1) + previous + 1;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const char = q[from] as string;
    const first = t.indexOf(char, previous + 1);
    let result: { score: number; indices: number[] } | null = null;
    if (first >= 0) {
      for (let at = first; at < t.length; at++) {
        const adjacent = from > 0 && at === previous + 1;
        if (t[at] !== char || (at !== first && !adjacent && !starts[at])) continue;
        const rest = best(from + 1, at);
        if (!rest) break;
        const score = 1 + (starts[at] ? WORD_START : 0) + (adjacent ? ADJACENT : 0) + rest.score;
        if (!result || score > result.score) result = { score, indices: [at, ...rest.indices] };
      }
    }
    memo.set(key, result);
    return result;
  };
  const found = best(0, -1);
  return found ? { indices: found.indices, score: found.score - text.length / 100 } : undefined;
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
