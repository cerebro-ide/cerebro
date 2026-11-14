// Start New Line, as IntelliJ's `EditorStartNewLine`: an indented line after the caret's, the caret
// on it, wherever the caret is in its line; CodeMirror's `insertBlankLine`, named for Undo. And
// Start New Line Before Current, as IntelliJ's `EditorStartNewLineBefore`
// (`StartNewLineBeforeAction`, read from its source): one before it, the caret at its indent. And
// Split Line, as IntelliJ's `EditorSplitLine` (`SplitLineAction`): Enter, the caret staying.

import { insertBlankLine } from '@codemirror/commands';
import { getIndentation, indentString } from '@codemirror/language';
import {
  EditorSelection,
  type EditorState,
  type Line,
  type TransactionSpec,
} from '@codemirror/state';
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

/** The indent the language gives the line at `pos` in `state`, else `like`'s own white space. */
function indentOf(state: EditorState, pos: number, like: Line): string {
  const column = getIndentation(state, pos);
  return column === null
    ? (/^\s*/.exec(like.text) as RegExpExecArray)[0]
    : indentString(state, column);
}

/**
 * The change Start New Line Before Current makes: IntelliJ's Enter at the line's start, then the
 * caret to the blank line's end, which is its indent (IntelliJ's smart End). The indent is the
 * language's for that line, else the caret's line's own. Undefined in a read-only editor.
 */
export function startNewLineBefore(state: EditorState): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  const line = state.doc.lineAt(state.selection.main.head);
  const blank = state.update({ changes: { from: line.from, insert: state.lineBreak } }).state;
  const insert = indentOf(blank, line.from, line);
  return {
    changes: { from: line.from, insert: insert + state.lineBreak },
    selection: EditorSelection.cursor(line.from + insert.length),
    scrollIntoView: true,
    userEvent: 'input.startNewLineBefore',
  };
}

/** IntelliJ's `EditorStartNewLineBefore`, as a CodeMirror command. */
export const startingNewLineBefore = dispatching(startNewLineBefore);

/**
 * The change Split Line makes, as IntelliJ's: with only white space before the caret, that white
 * space put on a line of its own above, the caret at its end; else Enter (the text after the caret,
 * without its leading white space, on a new line at the language's indent), the caret where it was.
 * Undefined in a read-only editor.
 */
export function splitLine(state: EditorState): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  const { head } = state.selection.main;
  const line = state.doc.lineAt(head);
  const before = line.text.slice(0, head - line.from);
  let changes;
  if (before.trim() === '') {
    changes = { from: line.from, insert: before + state.lineBreak };
  } else {
    const to = head + (/^[ \t]*/.exec(line.text.slice(before.length)) as RegExpExecArray)[0].length;
    const split = state.update({ changes: { from: head, to, insert: state.lineBreak } }).state;
    changes = { from: head, to, insert: state.lineBreak + indentOf(split, head + 1, line) };
  }
  return {
    changes,
    selection: EditorSelection.cursor(head),
    scrollIntoView: true,
    userEvent: 'input.splitLine',
  };
}

/** IntelliJ's `EditorSplitLine`, as a CodeMirror command. */
export const splittingLine = dispatching(splitLine);
