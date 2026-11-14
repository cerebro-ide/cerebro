// Bookmarks on lines, as IntelliJ's line bookmarks: an icon in a gutter of their own, before the
// line numbers, on each bookmarked line. They move with the text as it's edited (IntelliJ keeps a
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

class Bookmark extends GutterMarker {
  // After what's inserted at its line's start: an Enter there takes the bookmark down with the
  // line's text.
  override startSide = 1;
  // As its start: a point mapped with its start after its end is dropped.
  override endSide = 1;
  // Kept when the line break before it goes, on the line its own joins (a gutter marker's own,
  // `TrackBefore`, drops it then: measured).
  override mapMode = MapMode.Simple;

  override toDOM(): Node {
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

const setLines = StateEffect.define<readonly number[]>();

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

/** The bookmarks on `lines` (zero-based), those past the text's end left out. */
function setOf(state: EditorState, lines: readonly number[]): RangeSet<GutterMarker> {
  const inside = [...new Set(lines)].filter((line) => line < state.doc.lines);
  return RangeSet.of(
    inside.sort((a, b) => a - b).map((line) => BOOKMARK.range(state.doc.line(line + 1).from)),
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

/** Shows the bookmarks on `lines` in `view`, in place of those it shows. */
export function showBookmarks(view: EditorView, lines: readonly number[]): void {
  view.dispatch({ effects: setLines.of(lines) });
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
