// Edit → Duplicate Line or Selection, as IntelliJ's (`DuplicateAction`, read in its source): the
// selection's text put again right after it, and the copy selected; without a selection, the
// caret's line put again below it, the caret moved to the copy, at its column.

import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The change Duplicate Line or Selection makes. */
export function duplicate(state: EditorState): TransactionSpec {
  const changes = state.changeByRange((range) => {
    if (!range.empty) {
      const text = state.sliceDoc(range.from, range.to);
      return {
        changes: { from: range.to, insert: text },
        range: EditorSelection.range(range.to, range.to + text.length),
      };
    }
    // The copy goes after the line's end, so the last line's needs no line break after it.
    const line = state.doc.lineAt(range.head);
    return {
      changes: { from: line.to, insert: `${state.lineBreak}${line.text}` },
      range: EditorSelection.cursor(range.head + line.length + state.lineBreak.length),
    };
  });
  return { ...changes, scrollIntoView: true, userEvent: 'input.duplicate' };
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
 * Selection does; returns whether it did: not outside an editor, or in a read-only one.
 */
export function editorDuplicate(element: Element): boolean {
  const view = changeableView(element);
  if (!view) return false;
  view.dispatch(duplicate(view.state));
  return true;
}
