// Bookmarks on lines, as IntelliJ's line bookmarks: an icon in a gutter of their own, before the
// line numbers, on each bookmarked line; a bookmark with a mnemonic shows it instead. They move with the text as it's edited (IntelliJ keeps a
// line bookmark on a range marker), and say where they've moved to, so whoever keeps them can.

import {
  MapMode,
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';

/** IntelliJ's bookmark icon's shape (a claim: drawn after it, not its own drawing). */
const SHAPE = 'M4.5 2.5h7v11L8 10.5l-3.5 3z';

/** A bookmarked line, zero-based, and its mnemonic (a digit or a letter), if it has one. */
export interface BookmarkMark {
  line: number;
  mnemonic?: string | undefined;
}

class Bookmark extends GutterMarker {
  // After what's inserted at its line's start: an Enter there takes the bookmark down with the
  // line's text.
  override startSide = 1;
  // As its start: a point mapped with its start after its end is dropped.
  override endSide = 1;
  // Kept when the line break before it goes, on the line its own joins (a gutter marker's own,
  // `TrackBefore`, drops it then: measured).
  override mapMode = MapMode.Simple;

  constructor(readonly mnemonic?: string) {
    super();
  }

  override eq(other: GutterMarker): boolean {
    return other instanceof Bookmark && other.mnemonic === this.mnemonic;
  }

  override toDOM(): Node {
    if (this.mnemonic !== undefined) {
      // IntelliJ's mnemonic icon: the character on a square (a claim: drawn after it).
      const box = document.createElement('span');
      box.className = 'cerebro-bookmark cerebro-bookmark--mnemonic';
      box.setAttribute('aria-label', `Bookmark ${this.mnemonic}`);
      box.textContent = this.mnemonic;
      return box;
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '1.5 1.5 13 13');
    svg.setAttribute('class', 'cerebro-bookmark');
    svg.setAttribute('aria-label', 'Bookmark');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', SHAPE);
    svg.append(path);
    return svg;
  }
}

const BOOKMARK = new Bookmark();

const setLines = StateEffect.define<readonly BookmarkMark[]>();

/** Where the bookmarks are: one at each bookmarked line's start, moved as the text is. */
const bookmarked = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLines)) return setOf(tr.state, effect.value);
    }
    return value.map(tr.changes);
  },
});

/** The bookmarks on their lines, those past the text's end left out; the first on a line kept. */
function setOf(state: EditorState, marks: readonly BookmarkMark[]): RangeSet<GutterMarker> {
  const byLine = new Map<number, BookmarkMark>();
  for (const mark of marks) {
    if (mark.line < state.doc.lines && !byLine.has(mark.line)) byLine.set(mark.line, mark);
  }
  return RangeSet.of(
    [...byLine.values()]
      .sort((a, b) => a.line - b.line)
      .map((mark) =>
        (mark.mnemonic === undefined ? BOOKMARK : new Bookmark(mark.mnemonic)).range(
          state.doc.line(mark.line + 1).from,
        ),
      ),
  );
}

/** The bookmarked lines, zero-based, in order: two lines joined keep one. */
export function bookmarkedLines(state: EditorState): number[] {
  const lines = new Set<number>();
  const at = state.field(bookmarked).iter();
  while (at.value) {
    lines.add(state.doc.lineAt(at.from).number - 1);
    at.next();
  }
  return [...lines];
}

/** Shows `marks` in `view`, in place of the bookmarks it shows. */
export function showBookmarks(view: EditorView, marks: readonly BookmarkMark[]): void {
  view.dispatch({ effects: setLines.of(marks) });
}

/** The bookmarks' gutter; `moved` is told where they are once an edit has moved them. */
export function bookmarks(moved: (lines: number[]) => void): Extension {
  return [
    bookmarked,
    gutter({ class: 'cerebro-bookmarks', markers: (view) => view.state.field(bookmarked) }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const before = bookmarkedLines(update.startState);
      const after = bookmarkedLines(update.state);
      if (before.join() !== after.join()) moved(after);
    }),
  ];
}
