// Edit → Duplicate Line or Selection, as IntelliJ's (`DuplicateAction`, read in its source): the
// selection's text put again right after it, and the copy selected; without a selection, the
// caret's line put again below it, the caret moved to the copy, at its column. And Duplicate Entire
// Lines (`DuplicateLinesAction`): the whole lines a selection touches, put again below them.

import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/**
 * The lines from `from`'s to `to`'s put again below them, and the copy's range in what's made, its
 * line break after it too where there's one, as IntelliJ's (`duplicateLinesRange`). The copy goes
 * after the last line's end, so the document's last line needs no line break after it.
 */
function copyLines(state: EditorState, from: number, to: number) {
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const text = state.sliceDoc(first.from, last.to);
  const start = last.to + state.lineBreak.length;
  const after = last.number < state.doc.lines ? state.lineBreak.length : 0;
  return {
    changes: { from: last.to, insert: `${state.lineBreak}${text}` },
    copy: { from: start, to: start + text.length + after },
  };
}

/** The caret's line put again below it, the caret in the copy at its column. */
function copyLine(state: EditorState, head: number) {
  const { changes, copy } = copyLines(state, head, head);
  return { changes, range: EditorSelection.cursor(copy.from + head - state.doc.lineAt(head).from) };
}

/** The change Duplicate Line or Selection makes. */
export function duplicate(state: EditorState): TransactionSpec {
  const changes = state.changeByRange((range) => {
    if (range.empty) return copyLine(state, range.head);
    const text = state.sliceDoc(range.from, range.to);
    return {
      changes: { from: range.to, insert: text },
      range: EditorSelection.range(range.to, range.to + text.length),
    };
  });
  return { ...changes, scrollIntoView: true, userEvent: 'input.duplicate' };
}

/**
 * The change Duplicate Entire Lines makes: the lines a selection touches put again below them, the
 * copy selected, its caret at the same end; a selection ending at a line's start leaves that line
 * out. Without one, the caret's line, as Duplicate Line or Selection.
 */
export function duplicateLines(state: EditorState): TransactionSpec {
  const changes = state.changeByRange((range) => {
    if (range.empty) return copyLine(state, range.head);
    const end = state.doc.lineAt(range.to).from === range.to ? range.to - 1 : range.to;
    const { changes: made, copy } = copyLines(state, range.from, end);
    return {
      changes: made,
      range:
        range.head === range.to
          ? EditorSelection.range(copy.from, copy.to)
          : EditorSelection.range(copy.to, copy.from),
    };
  });
  return { ...changes, scrollIntoView: true, userEvent: 'input.duplicate.lines' };
}

/** The editor `element` is in, if it's one that can be changed. */
function changeableView(element: Element): EditorView | undefined {
  const editor = element.closest('.cm-editor');
  const view = editor && EditorView.findFromDOM(editor as HTMLElement);
  return view && !view.state.readOnly ? view : undefined;
}

/** Whether `element` is in an editor that can be changed: Duplicate's, say, is on there alone. */
export function inChangeableEditor(element: Element): boolean {
  return changeableView(element) !== undefined;
}

/**
 * Duplicates the line or the selection in the editor `element` is in, as Edit → Duplicate Line or
 * Selection does, or the selection's whole lines, as Duplicate Entire Lines does; returns whether
 * it did: not outside an editor, or in a read-only one.
 */
export function editorDuplicate(element: Element, lines = false): boolean {
  const view = changeableView(element);
  if (!view) return false;
  view.dispatch((lines ? duplicateLines : duplicate)(view.state));
  return true;
}
