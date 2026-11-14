// Scrolling and the visible page, as IntelliJ's (read from its source), each in a read-only editor
// too:
// - Scroll Up and Scroll Down (`EditorScrollUp`, `EditorScrollDown`; `ScrollUpAction`,
//   `EditorActionUtil.scrollRelatively`): the text scrolled a line, the caret left where it is.
// - Scroll to Center (`EditorScrollToCenter`, `ScrollToCenterAction`): the caret's line to the
//   middle.
// - Move Caret to Page Top and Bottom (`EditorMoveToPageTop`, `EditorMoveToPageBottom` and their
//   `WithSelection`; `EditorActionUtil.moveCaretPageTop`, `moveCaretPageBottom`): the caret to the
//   first or last line wholly in view, at its column; the With Selection ones select to there.

import { EditorSelection } from '@codemirror/state';
import { EditorView, type Command } from '@codemirror/view';

/** A command scrolling the editor `lines` lines down (up, for less than none). */
export function scrollingBy(lines: number): Command {
  return (view) => {
    view.scrollDOM.scrollTop += lines * view.defaultLineHeight;
    return true;
  };
}

/** IntelliJ's `EditorScrollToCenter`, as a CodeMirror command. */
export const scrollingToCenter: Command = (view) => {
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
  });
  return true;
};

/** The first (`top`) or last line wholly in view: its start. */
function pageLine(view: EditorView, top: boolean): number {
  // Where the view starts and ends, from the text's top.
  const from = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
  const to = from + view.scrollDOM.clientHeight;
  if (top) {
    const block = view.lineBlockAtHeight(from);
    // Cut off at the top: the next line, where it starts in view (IntelliJ's condition).
    if (from > block.top && block.to < view.state.doc.length) {
      const next = view.lineBlockAt(block.to + 1);
      if (next.top < to) return next.from;
    }
    return block.from;
  }
  return view.lineBlockAtHeight(Math.max(from, to - view.defaultLineHeight)).from;
}

/**
 * A command moving the caret to the first (`top`) or last line wholly in view, at its column, and
 * selecting from where the selection started to there when `select`.
 */
export function movingToPage(top: boolean, select: boolean): Command {
  return (view) => {
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const target = state.doc.lineAt(pageLine(view, top));
    const head = Math.min(target.from + range.head - line.from, target.to);
    view.dispatch({
      selection: select ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head),
      scrollIntoView: true,
    });
    return true;
  };
}
