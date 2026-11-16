// The caret leaving its line by a move IntelliJ counts as navigation, a place for Back
// (`includeCurrentCommandAsNavigation`, read from its source): a click (EditorImpl's mouse press),
// and going to the text's start or end (`EditorActionUtil.moveCaretToTextStart`, `…TextEnd`). A
// move within the line isn't one (`caretPositionChanged`), nor typing, nor a drag after the press.

import { Prec, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';

/** Where the caret is: its line and column, zero-based. */
function caretOf(state: EditorState): { line: number; column: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number - 1, column: head - line.from };
}

/** The user event of a jump to the text's start or end. */
const JUMP = 'select.jump';

/** To the text's start or end, as CodeMirror's `cursorDocStart` and `…End`, marked a jump. */
const jump =
  (end: boolean): Command =>
  (view) => {
    view.dispatch({
      selection: { anchor: end ? view.state.doc.length : 0 },
      scrollIntoView: true,
      userEvent: JUMP,
    });
    return true;
  };

/** Calls `onLeave` with where the caret was when such a move takes it to another line. */
export function leaves(onLeave: (from: { line: number; column: number }) => void): Extension {
  // Where the caret was as the pointer was pressed, until the press's selection.
  let pressed: { line: number; column: number } | undefined;
  return [
    EditorView.domEventHandlers({
      mousedown: (_event, view) => {
        pressed = caretOf(view.state);
        return false;
      },
    }),
    // Before CodeMirror's own keys for them (its standard keymap's).
    Prec.high(
      keymap.of([
        { key: 'Mod-Home', run: jump(false) },
        { key: 'Mod-End', run: jump(true) },
        { mac: 'Cmd-ArrowUp', run: jump(false) },
        { mac: 'Cmd-ArrowDown', run: jump(true) },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        const press = pressed !== undefined && tr.isUserEvent('select.pointer');
        if (!press && !tr.isUserEvent(JUMP)) continue;
        const from = press ? (pressed as { line: number; column: number }) : caretOf(tr.startState);
        if (press) pressed = undefined;
        if (caretOf(tr.state).line !== from.line) onLeave(from);
      }
    }),
  ];
}
