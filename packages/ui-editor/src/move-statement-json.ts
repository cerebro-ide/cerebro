// Move Statement in JSON, as IntelliJ's `JsonLineMover` (read from its source, and checked against
// its tests' files): the lines move as Move Line moves them, grown to the whole properties or
// values they start and end in, and the commas put right where they land: one added after what's
// now followed by something, one taken off what's now last in its object or array. Into an object
// or array from its `{` or `}` line, out of one past it; never past the file's own `{` or `}`.
//
// JSON's grammar here has no comments, so IntelliJ's moving a run of line comments together isn't
// ported: lines a comment is on move as lines, their commas left as they are, as IntelliJ moves
// comments.

import {
  ChangeSet,
  type ChangeSpec,
  type EditorState,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { LineMover, type Lines } from './line-mover.js';
import { moveLine } from './move-line.js';

/** What IntelliJ's `JsonProperty` and `JsonValue` are. */
const VALUES = new Set([
  'Property',
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
]);

const same = (a: SyntaxNode | null, b: SyntaxNode | null) =>
  a !== null && b !== null && a.from === b.from && a.to === b.to && a.name === b.name;

/** The object or array `node` is in, itself left out (`PsiTreeUtil.getParentOfType`). */
function containerOf(node: SyntaxNode): SyntaxNode | null {
  let parent = node.parent;
  while (parent && parent.name !== 'Object' && parent.name !== 'Array') parent = parent.parent;
  return parent;
}

/** Where a moved run lands, as `afterMove` puts its commas right. */
type Direction = 'same' | 'inside' | 'outside';

/**
 * A comma after the line's last character, where there's none (`addCommaIfNeeded`). None on a
 * blank line, unlike IntelliJ's as read: past one, it would put a comma there (Claude's choice,
 * open to change; not measured in IntelliJ).
 */
function addComma(doc: Text, line: number): ChangeSpec | undefined {
  const { text, to } = doc.line(line + 1);
  return text.trim() !== '' && !text.endsWith(',') ? { from: to, insert: ',' } : undefined;
}

/**
 * The comma the line ends with taken off, where what follows closes its object or array
 * (`trimCommaIfNeeded`). Spaces after the comma are passed, as IntelliJ passes them by its tree.
 */
function trimComma(doc: Text, line: number): ChangeSpec | undefined {
  const { from, to } = doc.line(line + 1);
  const comma = from + doc.sliceString(from, to).trimEnd().length - 1;
  if (comma < from || doc.sliceString(comma, comma + 1) !== ',') return undefined;
  const next = /\S/.exec(doc.sliceString(to));
  return next && (next[0] === ']' || next[0] === '}') ? { from: comma, to: comma + 1 } : undefined;
}

class JsonMover extends LineMover {
  /**
   * The first and last elements on the lines (`getElementRange`): past the spaces they start
   * with, the element there, whole; before the spaces they end with, the one there, whole. None on
   * blank lines. (IntelliJ's gives none too where neither holds the other and they overlap, which
   * a syntax tree's nodes never do.)
   */
  elements(lines: Lines): [SyntaxNode, SyntaxNode] | undefined {
    const from = this.lineStart(lines.start);
    const start = this.nonSpaceFrom(from);
    const end = this.lineStart(lines.end) - 1;
    if (start === undefined || start > end) return undefined;
    let first = this.tree.resolveInner(start, 1);
    // A line not started by spaces gives its first token, as IntelliJ's leaf there.
    if (start > from) {
      while (first.parent && first.parent.from === first.from && first.parent.name !== 'JsonText')
        first = first.parent;
    }
    const before = this.doc.sliceString(start, end + 1).trimEnd().length + start;
    let last = this.tree.resolveInner(before, -1);
    if (before <= end) {
      while (last.parent && last.parent.to === last.to && last.parent.name !== 'JsonText')
        last = last.parent;
    }
    return [first, last];
  }

  move(up: boolean): TransactionSpec | undefined {
    const found = this.elements(this.selected());
    if (
      !found ||
      found.some((node) => node.type.isError) ||
      !same(found[0].parent, found[1].parent)
    )
      return moveLine(this.state, up);
    const [first, last] = found;
    const moved = { start: this.lineOf(first.from), end: this.lineOf(last.to) + 1 };
    if (up ? moved.start === 0 : moved.end >= this.lineCount) return undefined;
    const dest = up
      ? { start: moved.start - 1, end: moved.start }
      : { start: moved.end, end: moved.end + 1 };
    let direction: Direction = 'same';
    const landing = this.elements(dest);
    if (landing) {
      const [destFirst, destLast] = landing;
      // The file's own `{` or `}`, `[` or `]`: nothing goes past it.
      if (
        same(destFirst, destLast) &&
        !VALUES.has(destFirst.name) &&
        destFirst.parent?.parent?.name === 'JsonText'
      )
        return undefined;
      // Both in the file's value, as the file's own braces aren't passed.
      const firstParent = destFirst.parent as SyntaxNode;
      const lastParent = destLast.parent as SyntaxNode;
      if (same(containerOf(firstParent), lastParent)) direction = up ? 'inside' : 'outside';
      if (same(firstParent, containerOf(lastParent))) direction = up ? 'outside' : 'inside';
    }
    return this.swap(moved, dest, (placed) =>
      commas(placed.doc, this.afterMove(moved, dest, up, direction)),
    );
  }

  /**
   * The commas to add and take off, in IntelliJ's order and by its line numbers (`afterMove`):
   * the moved and passed lines' before the swap, read in the document after it.
   */
  afterMove(moved: Lines, dest: Lines, up: boolean, direction: Direction): [boolean, number][] {
    const down = !up;
    const diff = moved.end - moved.start - (dest.end - dest.start);
    const add = (line: number): [boolean, number] => [true, line];
    const trim = (line: number): [boolean, number] => [false, line];
    switch (direction) {
      case 'same':
        return [
          add(down ? moved.end - 1 - diff : dest.end - 1 + diff),
          trim(down ? moved.end : dest.end + diff),
        ];
      case 'inside':
        return [
          ...(down ? [] : [add(dest.start - 1)]),
          trim(down ? moved.start : dest.start),
          trim(down ? moved.end : dest.end + diff),
        ];
      case 'outside':
        return [
          add(down ? moved.start : dest.start),
          trim(down ? moved.end : dest.end + diff),
          ...(down ? [trim(moved.start - 1), add(moved.end), trim(moved.end)] : []),
        ];
    }
  }
}

/** The commas added (true) and taken off, one after another, as one change. */
function commas(doc: Text, made: [boolean, number][]): ChangeSet {
  let changes = ChangeSet.empty(doc.length);
  let text = doc;
  for (const [adding, line] of made) {
    // Each line's in the document: the braces passed are on either side of the moved lines.
    const change = (adding ? addComma : trimComma)(text, line);
    if (!change) continue;
    const set = ChangeSet.of(change, text.length);
    changes = changes.compose(set);
    text = set.apply(text);
  }
  return changes;
}

/** The change Move Statement Up (or Down) makes in JSON; undefined where nothing moves. */
export function moveJsonStatement(state: EditorState, up: boolean): TransactionSpec | undefined {
  return new JsonMover(state).move(up);
}
