// Extend Selection and Shrink Selection, as IntelliJ's (`EditorSelectWord`, `EditorUnSelectWord`):
// the word at the caret, then each larger piece of the code around the selection, as the
// language's syntax tree has them (a bracketed piece's contents before the piece with its
// brackets); Shrink goes back through the selections Extend grew from.

import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state';
import { dispatching } from './command-change.js';

const grown = StateEffect.define<SelectionRange>();
const shrunk = StateEffect.define();

/**
 * The selections Extend Selection grew from, the last one last; any other change of the selection
 * or the text forgets them.
 */
export const selectionSteps = StateField.define<readonly SelectionRange[]>({
  create: () => [],
  update(steps, tr) {
    for (const effect of tr.effects) {
      if (effect.is(grown)) return [...steps, effect.value];
      if (effect.is(shrunk)) return steps.slice(0, -1);
    }
    return tr.selection || tr.docChanged ? [] : steps;
  },
});

const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);

/** `from` to `to`, without the white space at either end. */
function trimmed(state: EditorState, from: number, to: number) {
  const text = state.sliceDoc(from, to);
  const start = from + text.length - text.trimStart().length;
  return { from: start, to: Math.max(start, to - (text.length - text.trimEnd().length)) };
}

/** Whether `outer` holds the selection and more. */
function larger(outer: { from: number; to: number }, range: SelectionRange): boolean {
  return (
    outer.from <= range.from &&
    outer.to >= range.to &&
    (outer.from < range.from || outer.to > range.to)
  );
}

/** The next larger piece around the selection, if there's one. */
function grow(state: EditorState, range: SelectionRange) {
  if (range.empty) {
    const word = state.wordAt(range.head);
    if (word) return word;
  }
  for (
    let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(
      range.from,
      1,
    );
    node;
    node = node.parent
  ) {
    const first = node.firstChild;
    const last = node.lastChild;
    if (first && last && first !== last && BRACKETS.has(first.name) && BRACKETS.has(last.name)) {
      const inside = trimmed(state, first.to, last.from);
      if (larger(inside, range)) return inside;
    }
    if (larger(node, range)) return node;
  }
  const all = { from: 0, to: state.doc.length };
  return larger(all, range) ? all : undefined;
}

/** The change Extend Selection makes; undefined where the selection is the whole text. */
export function extendSelection(state: EditorState): TransactionSpec | undefined {
  // Cerebro's editor has one caret, so the main selection is all there is.
  const range = state.selection.main;
  const next = grow(state, range);
  return (
    next && {
      selection: EditorSelection.range(next.from, next.to),
      effects: grown.of(range),
      scrollIntoView: true,
    }
  );
}

/** The change Shrink Selection makes: back to what Extend grew from; undefined with nothing to. */
export function shrinkSelection(state: EditorState): TransactionSpec | undefined {
  const steps = state.field(selectionSteps, false) ?? [];
  const last = steps.at(-1);
  return last && { selection: EditorSelection.create([last]), effects: shrunk.of(null) };
}

/** IntelliJ's `EditorSelectWord` and `EditorUnSelectWord`, as CodeMirror commands. */
export const extendingSelection = dispatching(extendSelection);
export const shrinkingSelection = dispatching(shrinkSelection);
