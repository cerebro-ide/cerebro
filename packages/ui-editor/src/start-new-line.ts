// Start New Line, as IntelliJ's `EditorStartNewLine`: an indented line after the caret's, the caret
// on it, wherever the caret is in its line; CodeMirror's `insertBlankLine`, named for Undo. And
// Start New Line Before Current, as IntelliJ's `EditorStartNewLineBefore`
// (`StartNewLineBeforeAction`, read from its source): one before it, the caret at its indent.

import { insertBlankLine } from '@codemirror/commands';
import { getIndentation, indentString } from '@codemirror/language';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
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

/**
 * The change Start New Line Before Current makes: IntelliJ's Enter at the line's start, then the
 * caret to the blank line's end, which is its indent (IntelliJ's smart End). The indent is the
 * language's for that line, else the caret's line's own. Undefined in a read-only editor.
 */
export function startNewLineBefore(state: EditorState): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  const line = state.doc.lineAt(state.selection.main.head);
  const blank = state.update({ changes: { from: line.from, insert: state.lineBreak } }).state;
  const column = getIndentation(blank, line.from);
  const insert =
    column === null ? (/^\s*/.exec(line.text) as RegExpExecArray)[0] : indentString(state, column);
  return {
    changes: { from: line.from, insert: insert + state.lineBreak },
    selection: EditorSelection.cursor(line.from + insert.length),
    scrollIntoView: true,
    userEvent: 'input.startNewLineBefore',
  };
}

/** IntelliJ's `EditorStartNewLineBefore`, as a CodeMirror command. */
export const startingNewLineBefore = dispatching(startNewLineBefore);
