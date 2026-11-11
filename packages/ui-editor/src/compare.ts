// Comparing two texts as IntelliJ's diff does (`ComparisonManagerImpl`): by lines first, equal
// lines being equal under the ignore policy, then each changed block's text by the highlighting
// policy. IntelliJ's names and defaults (`IgnorePolicy`, `HighlightPolicy`): ignore nothing,
// highlight words.
//
// CodeMirror's `diff` does the comparing. Lines and words are compared as sequences, each one a
// character standing for its text, so the same algorithm finds the fewest changes of whole lines,
// then of whole words.

import { diff } from '@codemirror/merge';
import type { Text } from '@codemirror/state';

/** What's not a difference, as IntelliJ's Ignore Differences. */
export const IGNORE_POLICIES = ['none', 'trim', 'whitespaces', 'whitespacesAndEmptyLines'] as const;
export type IgnorePolicy = (typeof IGNORE_POLICIES)[number];

/** How a changed block's text is marked, as IntelliJ's Highlighting Differences. */
export const HIGHLIGHT_POLICIES = ['lines', 'words', 'split', 'characters', 'none'] as const;
export type HighlightPolicy = (typeof HIGHLIGHT_POLICIES)[number];

/** A changed block's lines on the left (`start1` to `end1`) and right, zero-based, ends excluded. */
export interface LineRange {
  start1: number;
  end1: number;
  start2: number;
  end2: number;
}

/** Changed text in a block: offsets from the start of its first line, on each side. */
export interface Part {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

export type Kind = 'inserted' | 'deleted' | 'modified';

/** A changed block: its lines, its kind, and its changed text, unless it's marked by lines. */
export interface Change extends LineRange {
  kind: Kind;
  parts: readonly Part[] | undefined;
}

/** A change's kind, as IntelliJ's (`DiffUtil.getDiffType`): what's on either side. */
export const kindOf = (left: boolean, right: boolean): Kind =>
  !left ? 'inserted' : !right ? 'deleted' : 'modified';

/** Each item as one character, the same for items with the same key: for `diff`. */
function encode(a: readonly string[], b: readonly string[]): [string, string] {
  const codes = new Map<string, string>();
  const code = (key: string) => {
    let found = codes.get(key);
    if (found === undefined) {
      // Past the surrogates, so each stays one unit of the string: 63,000 different items.
      const n = codes.size + 0x100;
      found = String.fromCharCode(n < 0xd800 ? n : n + 0x800);
      codes.set(key, found);
    }
    return found;
  };
  return [a.map(code).join(''), b.map(code).join('')];
}

/** A line's text as the policy compares it. */
function lineKey(line: string, ignore: IgnorePolicy): string {
  if (ignore === 'none') return line;
  if (ignore === 'trim') return line.trim();
  return line.replace(/\s+/g, '');
}

const blank = (line: string) => line.trim() === '';

/** Words, runs of white space, and each other character, as IntelliJ's `ByWord` splits text. */
const TOKENS = /[\p{L}\p{N}_]+|\s+|[^]/gu;

/** The changed text of a block, by tokens or characters. */
function parts(a: string, b: string, highlight: HighlightPolicy, ignore: IgnorePolicy): Part[] {
  let found: Part[];
  if (highlight === 'characters') {
    found = diff(a, b).map(({ fromA, toA, fromB, toB }) => ({ fromA, toA, fromB, toB }));
  } else {
    const tokensA = a.match(TOKENS) ?? [];
    const tokensB = b.match(TOKENS) ?? [];
    const starts = (tokens: readonly string[]) =>
      tokens.reduce<number[]>((at, token, i) => [...at, (at[i] as number) + token.length], [0]);
    const [atA, atB] = [starts(tokensA), starts(tokensB)];
    found = diff(...encode(tokensA, tokensB)).map((c) => ({
      fromA: atA[c.fromA] as number,
      toA: atA[c.toA] as number,
      fromB: atB[c.fromB] as number,
      toB: atB[c.toB] as number,
    }));
  }
  found = found.flatMap((p) => spaced(p, a, b));
  if (ignore === 'none') return found;
  // White space ignored: a change of white space alone isn't one; trimmed, only at a line's ends.
  const space = (text: string) => /^\s*$/.test(text);
  const edge = (text: string, from: number, to: number) =>
    from === 0 || text[from - 1] === '\n' || to === text.length || text[to] === '\n';
  return found.filter((p) => {
    if (!space(a.slice(p.fromA, p.toA)) || !space(b.slice(p.fromB, p.toB))) return true;
    return ignore === 'trim' && !(edge(a, p.fromA, p.toA) && edge(b, p.fromB, p.toB));
  });
}

/**
 * A change's white space at its start and end apart from the rest, so a policy can leave it out.
 */
function spaced(part: Part, a: string, b: string): Part[] {
  const [textA, textB] = [a.slice(part.fromA, part.toA), b.slice(part.fromB, part.toB)];
  if (/^\s*$/.test(textA) && /^\s*$/.test(textB)) return [part];
  const lead = (t: string) => (/^\s*/.exec(t) as RegExpExecArray)[0].length;
  const trail = (t: string) => (/\s*$/.exec(t) as RegExpExecArray)[0].length;
  const [leadA, leadB, trailA, trailB] = [lead(textA), lead(textB), trail(textA), trail(textB)];
  const middle = {
    fromA: part.fromA + leadA,
    toA: part.toA - trailA,
    fromB: part.fromB + leadB,
    toB: part.toB - trailB,
  };
  return [
    ...(leadA + leadB > 0 ? [{ ...part, toA: middle.fromA, toB: middle.fromB }] : []),
    middle,
    ...(trailA + trailB > 0 ? [{ ...part, fromA: middle.toA, fromB: middle.toB }] : []),
  ];
}

/**
 * Splits a block where its changed text is a line or more apart, as IntelliJ's Split changes
 * (`LineFragmentSplitter`): the lines between, the same on both sides, are left out.
 */
function split(change: Change, a: string, b: string): Change[] {
  const found = change.parts as readonly Part[];
  const lineOf = (text: string, at: number) => text.slice(0, at).split('\n').length - 1;
  const pieces: Part[][] = [];
  for (const [i, part] of found.entries()) {
    const before = found[i - 1];
    const apart = before !== undefined && a.slice(before.toA, part.fromA).includes('\n');
    if (apart || pieces.length === 0) pieces.push([]);
    (pieces.at(-1) as Part[]).push(part);
  }
  if (pieces.length < 2) return [change];
  return pieces.map((piece) => {
    const first = piece[0] as Part;
    const last = piece.at(-1) as Part;
    const [lineA, lineB] = [lineOf(a, first.fromA), lineOf(b, first.fromB)];
    // The piece's lines: from its first changed text's to its last's, whole.
    const endA = lineOf(a, Math.max(last.toA - 1, last.fromA)) + 1;
    const endB = lineOf(b, Math.max(last.toB - 1, last.fromB)) + 1;
    const offset = (text: string, line: number) =>
      line === 0 ? 0 : text.split('\n', line).join('\n').length + 1;
    const [baseA, baseB] = [offset(a, lineA), offset(b, lineB)];
    const start1 = change.start1 + lineA;
    const start2 = change.start2 + lineB;
    return {
      start1,
      end1: change.start1 + endA,
      start2,
      end2: change.start2 + endB,
      kind: 'modified' as const,
      parts: piece.map((p) => ({
        fromA: p.fromA - baseA,
        toA: p.toA - baseA,
        fromB: p.fromB - baseB,
        toB: p.toB - baseB,
      })),
    };
  });
}

/** The lines from `from` to `to`, joined: one at least. */
const slice = (doc: Text, from: number, to: number) =>
  doc.sliceString(doc.line(from + 1).from, doc.line(to).to);

/** The changes from `a` to `b`, as IntelliJ's diff finds them under its policies. */
export function compare(
  a: Text,
  b: Text,
  ignore: IgnorePolicy = 'none',
  highlight: HighlightPolicy = 'words',
): Change[] {
  if (highlight === 'none') return [];
  const linesA = Array.from({ length: a.lines }, (_, i) => a.line(i + 1).text);
  const linesB = Array.from({ length: b.lines }, (_, i) => b.line(i + 1).text);
  const [keysA, keysB] = encode(
    linesA.map((l) => lineKey(l, ignore)),
    linesB.map((l) => lineKey(l, ignore)),
  );
  const changes: Change[] = [];
  for (const c of diff(keysA, keysB)) {
    const block = { start1: c.fromA, end1: c.toA, start2: c.fromB, end2: c.toB };
    // Blank lines alone aren't a change when they're ignored too.
    const lines = [...linesA.slice(c.fromA, c.toA), ...linesB.slice(c.fromB, c.toB)];
    if (ignore === 'whitespacesAndEmptyLines' && lines.every(blank)) continue;
    const kind = kindOf(c.toA > c.fromA, c.toB > c.fromB);
    if (kind !== 'modified' || highlight === 'lines') {
      changes.push({ ...block, kind, parts: undefined });
      continue;
    }
    const [textA, textB] = [slice(a, c.fromA, c.toA), slice(b, c.fromB, c.toB)];
    const change = { ...block, kind, parts: parts(textA, textB, highlight, ignore) };
    changes.push(...(highlight === 'split' ? split(change, textA, textB) : [change]));
  }
  return changes;
}
