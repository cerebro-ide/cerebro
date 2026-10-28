// The content's width, from the longest line in the whole file, as IntelliJ's: the horizontal
// scrollbar is the same wherever the editor is scrolled. CodeMirror draws only the lines on screen,
// and widens the content as it meets longer ones, so the bar changed while scrolling down.
//
// A floor: the content is never narrower than the longest line in columns, at the font's character
// width. A line wider than its columns (wide characters) still widens it, as CodeMirror does.

import { countColumn, type EditorState, type Text } from '@codemirror/state';
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** The longest line: its width in columns, and where it is. */
interface Longest {
  columns: number;
  from: number;
  to: number;
}

/** The longest of the lines from `first` to `last` (one-based), or `longest` if none is longer. */
function scan(doc: Text, tabSize: number, first: number, last: number, longest?: Longest): Longest {
  let best = longest ?? { columns: -1, from: 0, to: 0 };
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    // A line no longer in characters can't be longer in columns, but for tabs: skip it cheaply.
    if (line.length <= best.columns && !line.text.includes('\t')) continue;
    const columns = countColumn(line.text, tabSize);
    if (columns > best.columns) best = { columns, from: line.from, to: line.to };
  }
  return best;
}

/** The whole document's longest line. */
export const longestLine = (state: EditorState): Longest =>
  scan(state.doc, state.tabSize, 1, state.doc.lines);

/** The longest line after an update: found again only where the text changed, or all over. */
function updated(longest: Longest, update: ViewUpdate): Longest {
  const { state } = update;
  if (state.tabSize !== update.startState.tabSize) return longestLine(state);
  // The longest line itself changed: it may be shorter now.
  if (update.changes.touchesRange(longest.from, longest.to)) return longestLine(state);
  let best: Longest = {
    columns: longest.columns,
    from: update.changes.mapPos(longest.from),
    to: update.changes.mapPos(longest.to),
  };
  update.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    best = scan(
      state.doc,
      state.tabSize,
      state.doc.lineAt(fromB).number,
      state.doc.lineAt(toB).number,
      best,
    );
  });
  return best;
}

/** Sizes the content for the longest line, unless lines wrap. */
export const fullWidth = ViewPlugin.define((view) => {
  let longest = longestLine(view.state);
  const size = () => {
    view.requestMeasure({
      key: fullWidth,
      read: (v) => {
        if (v.lineWrapping) return '';
        // A line's own padding, as the theme sets it. There's always a line, if an empty one.
        const style = getComputedStyle(v.contentDOM.querySelector('.cm-line') as Element);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        return `${String(longest.columns * v.defaultCharacterWidth + padding)}px`;
      },
      write: (width, v) => {
        v.contentDOM.style.minWidth = width;
      },
    });
  };
  size();
  return {
    update(update: ViewUpdate) {
      if (update.docChanged || update.startState.tabSize !== update.state.tabSize) {
        longest = updated(longest, update);
      }
      // Also as settings change: the font's size, wrapping.
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.transactions.some((tr) => tr.reconfigured)
      ) {
        size();
      }
    },
  };
});
