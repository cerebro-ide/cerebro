// Toggle Case, as IntelliJ's `EditorToggleCase` (`ToggleCaseAction`, read from its source): the
// selection, or the word at the caret, made lower case where it has an upper-case letter, and upper
// case where it hasn't; a string's escapes (`\n`) kept as they are. The text changed is selected.

import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { dispatching } from './command-change.js';

/** `from` to `to` in `lower` or upper case, but for the escapes in it. */
function cased(state: EditorState, from: number, to: number, lower: boolean): string {
  const escapes: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'Escape') escapes.push({ from: node.from, to: node.to });
    },
  });
  const change = (text: string) => (lower ? text.toLowerCase() : text.toUpperCase());
  let text = '';
  let at = from;
  for (const escape of escapes) {
    const start = Math.max(escape.from, from);
    const end = Math.min(escape.to, to);
    text += change(state.sliceDoc(at, start)) + state.sliceDoc(start, end);
    at = end;
  }
  return text + change(state.sliceDoc(at, to));
}

/**
 * The change Toggle Case makes; undefined with no selection and no word at the caret, or in a
 * read-only editor.
 */
export function toggleCase(state: EditorState): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  // Cerebro's editor has one caret, so the main selection is all there is.
  const range = state.selection.main;
  const { from, to } = range.empty ? (state.wordAt(range.head) ?? range) : range;
  if (from === to) return undefined;
  const text = state.sliceDoc(from, to);
  const insert = cased(state, from, to, text !== cased(state, from, to, true));
  const end = from + insert.length;
  // IntelliJ's caret stays where it was, the word it changed selected; CodeMirror's caret is a
  // selection's end: the word's end, or the selection's start where it was there.
  const selection =
    range.head === range.from && !range.empty
      ? EditorSelection.range(end, from)
      : EditorSelection.range(from, end);
  return { changes: { from, to, insert }, selection, userEvent: 'input.toggleCase' };
}

/** IntelliJ's `EditorToggleCase`, as a CodeMirror command. */
export const togglingCase = dispatching(toggleCase);
