// Code → Comment with Line Comment and Comment with Block Comment, as IntelliJ's
// (`CommentByLineCommentHandler`, `CommentByBlockCommentHandler`, read from its source), with the
// comment tokens the file's language gives CodeMirror (`commentTokens`).

import { toggleLineComment } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state';
import { changeOf, dispatching } from './command-change.js';

interface Tokens {
  open: string;
  close: string;
}

/** The block comment's tokens at `pos`, where the language has them. */
function blockTokens(state: EditorState, pos: number): Tokens | undefined {
  return state.languageDataAt<{ block?: Tokens }>('commentTokens', pos, 1)[0]?.block;
}

/**
 * The change Comment with Line Comment makes: CodeMirror's toggle of the lines' comments, then, as
 * IntelliJ's, with no selection, the caret a line down at its column (its advanced setting
 * `editor.comment.line.caret.down`, on to start with); on a blank line it stays after the comment
 * started there. Undefined where the language has no line comment, or the editor's read-only.
 */
export function lineComment(state: EditorState): TransactionSpec | undefined {
  const made = changeOf(toggleLineComment, state);
  if (!made) return undefined;
  const after = made.state;
  const down = state.selection.ranges.every(
    (range) => range.empty && state.doc.lineAt(range.head).text.trim() !== '',
  );
  const selection = down
    ? EditorSelection.create(
        after.selection.ranges.map((range) => {
          const line = after.doc.lineAt(range.head);
          if (line.number === after.doc.lines) return range;
          const next = after.doc.line(line.number + 1);
          return EditorSelection.cursor(Math.min(next.from + range.head - line.from, next.to));
        }),
        after.selection.mainIndex,
      )
    : after.selection;
  return { changes: made.changes, selection, scrollIntoView: true, userEvent: 'comment.line' };
}

/** The block comment the syntax tree has around `pos`, from its side, made of `tokens`. */
function commentAt(state: EditorState, pos: number, side: -1 | 1, tokens: Tokens) {
  for (
    let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
      pos,
      side,
    );
    node;
    node = node.parent
  ) {
    if (!/comment/i.test(node.name)) continue;
    const text = state.sliceDoc(node.from, node.to);
    if (text.startsWith(tokens.open) && text.endsWith(tokens.close)) return node;
  }
  return undefined;
}

/**
 * Takes a block comment's tokens away, as IntelliJ's `uncommentRange`: each with the line break
 * after the opening one, and before the closing one, where they're on lines of their own.
 */
function uncomment(state: EditorState, from: number, to: number, tokens: Tokens) {
  const open = from + tokens.open.length;
  const close = to - tokens.close.length;
  const ownLines =
    state.sliceDoc(open, open + 1) === '\n' && state.sliceDoc(close - 1, close) === '\n';
  return [
    { from, to: open + (ownLines ? 1 : 0) },
    { from: close - (ownLines ? 1 : 0), to },
  ];
}

/** Whether `pos` is at a line's start, or the document's end (IntelliJ's for a selection's end). */
function atLineStart(state: EditorState, pos: number): boolean {
  return pos === state.doc.length || state.doc.lineAt(pos).from === pos;
}

/** One range's change for Comment with Block Comment; undefined for none. */
function blockCommentOf(state: EditorState, range: SelectionRange, tokens: Tokens) {
  const { open, close } = tokens;
  const comment = range.empty
    ? (commentAt(state, range.head, -1, tokens) ?? commentAt(state, range.head, 1, tokens))
    : (commentAt(state, range.from, 1, tokens) ?? commentAt(state, range.to, -1, tokens));
  if (comment) {
    // Inside it, or a selection holding either end of it: it's taken away. A selection inside
    // it, ending in neither, would break it: IntelliJ warns, and changes nothing.
    const holdsAnEnd =
      range.empty ||
      (range.from <= comment.from && comment.from < range.to) ||
      (range.from < comment.to && comment.to <= range.to);
    if (!holdsAnEnd) return undefined;
    const changes = state.changes(uncomment(state, comment.from, comment.to, tokens));
    return { changes, range: range.map(changes) };
  }
  if (range.empty) {
    // `/**/` at the caret, the caret inside (IntelliJ's BLOCK_COMMENT_ADD_SPACE, off).
    return {
      changes: { from: range.head, insert: open + close },
      range: EditorSelection.cursor(range.head + open.length),
    };
  }
  // Whole lines: the tokens on lines of their own, at the first column (BLOCK_COMMENT_AT_FIRST_
  // COLUMN, on), the caret a line down for the one put above it.
  if (atLineStart(state, range.from) && atLineStart(state, range.to)) {
    const before = `${open}\n`;
    // The document's last line, with no line break after it, ends its own.
    const after = state.doc.lineAt(range.to).from === range.to ? `${close}\n` : `\n${close}`;
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: commented(range, range.to - range.from + before.length + after.length),
    };
  }
  return {
    changes: [
      { from: range.from, insert: open },
      { from: range.to, insert: close },
    ],
    range: commented(range, range.to - range.from + open.length + close.length),
  };
}

/**
 * The comment made, `length` long from the selection's start, selected, its caret at the end the
 * selection's was at. IntelliJ's caret stays by its text, inside the selection; CodeMirror's caret
 * is a selection's end.
 */
function commented(range: SelectionRange, length: number) {
  const to = range.from + length;
  return range.head === range.from
    ? EditorSelection.range(to, range.from)
    : EditorSelection.range(range.from, to);
}

/**
 * The change Comment with Block Comment makes, as IntelliJ's: the selection put in a block comment
 * and selected (whole lines with the tokens on lines of their own); without one, an empty one at
 * the caret; inside a comment, or with a selection holding an end of one, that comment taken away.
 * Undefined where the language has no block comment, or the editor's read-only.
 */
export function blockComment(state: EditorState): TransactionSpec | undefined {
  // Cerebro's editor has one caret, so the main selection is all there is.
  const range = state.selection.main;
  const tokens = blockTokens(state, range.from);
  const made = !state.readOnly && tokens ? blockCommentOf(state, range, tokens) : undefined;
  if (!made) return undefined;
  return {
    changes: made.changes,
    selection: made.range,
    scrollIntoView: true,
    userEvent: 'comment.block',
  };
}

/** IntelliJ's `CommentByLineComment`, as a CodeMirror command. */
export const commentByLine = dispatching(lineComment);

/** IntelliJ's `CommentByBlockComment`, as a CodeMirror command. */
export const commentByBlock = dispatching(blockComment);
