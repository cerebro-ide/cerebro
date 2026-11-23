// CodeMirror's commands as changes Cerebro names: what a command would do, made into a transaction
// of the app's own, so Undo says IntelliJ's name for it (`history.ts`).

import {
  ChangeSet,
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type { Command, EditorView } from '@codemirror/view';

/** The transaction a CodeMirror command would make in `state`; undefined where it does nothing. */
export function changeOf(command: StateCommand, state: EditorState): Transaction | undefined {
  let made: Transaction | undefined;
  command({
    state,
    dispatch: (tr) => {
      made = tr;
    },
  });
  return made;
}

/** A command dispatching a change, where there's one; false otherwise, so the key goes on. */
export function dispatching(change: (state: EditorState) => TransactionSpec | undefined): Command {
  return (view: EditorView) => {
    const spec = change(view.state);
    if (spec) view.dispatch(spec);
    return spec !== undefined;
  };
}

/**
 * A one-caret change made at every caret, as IntelliJ's editor actions run for each caret
 * (`EditorActionHandler`'s `runForAllCarets`): `one` is asked with a state holding that caret
 * alone, each in the text as the carets before left it, and their changes made one. From the last
 * caret back with `reverse` (a move down, so a caret's lines aren't moved into by the one above).
 * Carets `one` changes nothing for stay. Undefined where it changes nothing for any.
 */
export function atEachCaret(
  state: EditorState,
  one: (alone: EditorState) => TransactionSpec | undefined,
  reverse = false,
): { changes: ChangeSet; selection: EditorSelection } | undefined {
  const { ranges, mainIndex } = state.selection;
  const order = ranges.map((_, i) => i);
  if (reverse) order.reverse();
  let current = state;
  let changes = ChangeSet.empty(state.doc.length);
  const placed = new Map<number, SelectionRange>();
  let changed = false;
  for (const i of order) {
    const range = (ranges[i] as SelectionRange).map(changes);
    const alone = current.update({ selection: EditorSelection.create([range]) }).state;
    const spec = one(alone);
    if (spec) changed = true;
    const tr = alone.update(spec ?? {});
    for (const [j, done] of placed) placed.set(j, done.map(tr.changes));
    placed.set(i, tr.newSelection.main);
    changes = changes.compose(tr.changes);
    current = tr.state;
  }
  if (!changed) return undefined;
  const selection = EditorSelection.create(
    ranges.map((_, i) => placed.get(i) as SelectionRange),
    mainIndex,
  );
  return { changes, selection };
}
