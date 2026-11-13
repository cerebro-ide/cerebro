// Start New Line, as IntelliJ's `EditorStartNewLine`: an indented line after the caret's, the caret
// on it, wherever the caret is in its line; CodeMirror's `insertBlankLine`, named for Undo.

import { insertBlankLine } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { changeOf, dispatching } from './command-change.js';

/** The change Start New Line makes; undefined in a read-only editor. */
export function startNewLine(state: EditorState): TransactionSpec | undefined {
  const made = changeOf(insertBlankLine, state);
  return (
    made && {
      changes: made.changes,
      selection: made.selection,
      scrollIntoView: true,
      userEvent: 'input.startNewLine',
    }
  );
}

/** IntelliJ's `EditorStartNewLine`, as a CodeMirror command. */
export const startingNewLine = dispatching(startNewLine);
