// CodeMirror's commands as changes Cerebro names: what a command would do, made into a transaction
// of the app's own, so Undo says IntelliJ's name for it (`history.ts`).

import type { EditorState, StateCommand, Transaction, TransactionSpec } from '@codemirror/state';
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
