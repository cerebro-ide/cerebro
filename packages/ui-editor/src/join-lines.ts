// Join Lines, as IntelliJ's `EditorJoinLines` (`JoinLinesHandler`, read from its source): the
// caret's line and the next, or the lines a selection touches (not one it ends at the start of),
// made one, each line break with the white space around it made one space; none where the next
// line is blank. The caret goes where the first join was; a selection stays, its caret at its end.

import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { dispatching } from './command-change.js';

/** The change Join Lines makes; undefined with no line after, or in a read-only editor. */
export function joinLines(state: EditorState): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  // Cerebro's editor has one caret, so the main selection is all there is.
  const range = state.selection.main;
  const { doc } = state;
  const first = doc.lineAt(range.from).number;
  let last = first + 1;
  if (!range.empty) {
    last = doc.lineAt(range.to).number;
    if (doc.line(last).from === range.to) last--;
  }
  // A selection in one line joins nothing, as IntelliJ's (no lines to count).
  if (last > doc.lines || last <= first) return undefined;
  const joins = [];
  for (let number = first; number < last; number++) {
    const line = doc.line(number);
    const next = doc.line(number + 1);
    const to = next.from + next.text.length - next.text.trimStart().length;
    joins.push({
      from: line.from + line.text.trimEnd().length,
      to,
      insert: to === next.to ? '' : ' ',
    });
  }
  const changes = state.changes(joins);
  const selection = range.empty
    ? EditorSelection.cursor((joins[0] as { from: number }).from)
    : EditorSelection.range(changes.mapPos(range.from), changes.mapPos(range.to));
  return { changes, selection, scrollIntoView: true, userEvent: 'input.joinLines' };
}

/** IntelliJ's `EditorJoinLines`, as a CodeMirror command. */
export const joiningLines = dispatching(joinLines);
