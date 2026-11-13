// Code → Move Line Up and Move Line Down, as IntelliJ's (`MoveLineUp`, `MoveLineDown`): the
// caret's line, or the lines a selection touches, swapped with the line above or below; CodeMirror's
// `moveLineUp` and `moveLineDown`, which leave out a line a selection ends at the start of, as
// IntelliJ does, and do nothing at the document's first or last line.

import { moveLineDown, moveLineUp } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { changeOf, dispatching } from './command-change.js';

/** The change Move Line Up (or Down) makes; undefined where there's no line to move past. */
export function moveLine(state: EditorState, up: boolean): TransactionSpec | undefined {
  const made = changeOf(up ? moveLineUp : moveLineDown, state);
  return (
    made && {
      changes: made.changes,
      selection: made.selection,
      scrollIntoView: true,
      userEvent: up ? 'move.line.up' : 'move.line.down',
    }
  );
}

/** IntelliJ's `MoveLineUp` and `MoveLineDown`, as CodeMirror commands. */
export const moveLinesUp = dispatching((state) => moveLine(state, true));
export const moveLinesDown = dispatching((state) => moveLine(state, false));
