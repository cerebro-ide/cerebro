// Cyclic Expand Word, as IntelliJ's `HippieCompletion` and `HippieBackwardCompletion`
// (`HippieWordCompletionHandler`, read from its source): the word before the caret completed with
// another word of the text that starts with it, the nearest before the caret first. Pressed again,
// the next one, further back (forward) or further on (backward); past the last, the word as it was
// typed.

import { StateEffect, StateField, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { Command } from '@codemirror/view';

interface Expansion {
  /** The words offered, in the text's order: those before the caret, then those after it. */
  readonly words: readonly string[];
  /** The one in the text now. */
  readonly index: number;
  /** What was typed, and where it starts. */
  readonly prefix: string;
  readonly from: number;
}

const expanded = StateEffect.define<Expansion | null>();

/** The expansion going on; any other change of the selection or the text ends it. */
export const expansion = StateField.define<Expansion | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(expanded)) return effect.value;
    return tr.selection || tr.docChanged ? null : value;
  },
});

/** A word's characters, as IntelliJ's (a Java identifier's), but `-` and `*`. */
const WORD = /[\p{L}\p{N}_$]+/gu;

/**
 * The words `prefix` starts, before `head` and after it: each once a side, the nearest the caret
 * kept, in the text's order.
 */
function wordsFor(state: EditorState, prefix: string, head: number) {
  const before: string[] = [];
  const after: string[] = [];
  for (const match of state.doc.toString().matchAll(WORD)) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    // The word at the caret is what's being expanded.
    if (start <= head && end >= head) continue;
    if (word.length <= prefix.length || !word.startsWith(prefix)) continue;
    (end > head ? after : before).push(word);
  }
  return { before: [...new Set(before.reverse())].reverse(), after: [...new Set(after)] };
}

/**
 * The change Cyclic Expand Word makes, `forward` (back through the text, IntelliJ's Alt+/) or not;
 * undefined with no word to offer, or in a read-only editor.
 */
export function expandWord(state: EditorState, forward: boolean): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  // Cerebro's editor has one caret, so the main selection is all there is.
  const { head } = state.selection.main;
  const going = state.field(expansion, false);
  let next: Expansion;
  if (going) {
    next = { ...going, index: going.index + (forward ? -1 : 1) };
  } else {
    const line = state.doc.lineAt(head);
    // A word's characters up to the caret: always a match, if an empty one.
    const [typed] = /[\p{L}\p{N}_$]*$/u.exec(
      line.text.slice(0, head - line.from),
    ) as RegExpExecArray;
    const { before, after } = wordsFor(state, typed, head);
    const words = [...before, ...after];
    if (words.length === 0) return undefined;
    // Forward, the nearest before the caret, else the first after it; backward, the first after
    // it, else the first of all.
    const index = forward ? Math.max(before.length - 1, 0) : after.length > 0 ? before.length : 0;
    next = { words, index, prefix: typed, from: head - typed.length };
  }
  const word = next.words[next.index];
  // Past the last word, what was typed, and the expansion over.
  const insert = word ?? next.prefix;
  return {
    changes: { from: next.from, to: head, insert },
    selection: { anchor: next.from + insert.length },
    effects: expanded.of(word === undefined ? null : next),
    scrollIntoView: true,
    userEvent: 'input.expandWord',
  };
}

/**
 * IntelliJ's `HippieCompletion` (`forward`) or `HippieBackwardCompletion`, as a CodeMirror command:
 * it takes the key even with no word to offer, as IntelliJ's, so no other command has it.
 */
function expanding(forward: boolean): Command {
  return (view) => {
    const spec = expandWord(view.state, forward);
    if (spec) view.dispatch(spec);
    return !view.state.readOnly;
  };
}

export const expandingWord = expanding(true);
export const expandingWordBackward = expanding(false);
