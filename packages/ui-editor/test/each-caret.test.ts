import {
  EditorSelection,
  EditorState,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { atEachCaret } from '../src/command-change.js';
import {
  blockComment,
  extendSelection,
  joinLines,
  languageFor,
  moveStatement,
  selectionSteps,
  shrinkSelection,
  splitLine,
  startNewLineBefore,
  toggleCase,
} from '../src/index.js';

/**
 * A state of `marked`, each caret written `|`, or a selection `[` to `]`; the main caret is the
 * last.
 */
function stateOf(marked: string, extensions: Extension = []) {
  const ranges = [];
  let doc = '';
  let from: number | undefined;
  for (const char of marked) {
    if (char === '|') ranges.push(EditorSelection.cursor(doc.length));
    else if (char === '[') from = doc.length;
    else if (char === ']') ranges.push(EditorSelection.range(from as number, doc.length));
    else doc += char;
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges, ranges.length - 1),
    extensions: [EditorState.allowMultipleSelections.of(true), extensions],
  });
}

/** `state` after `spec`, its carets written back as `stateOf` reads them. */
function marked(state: EditorState, spec: TransactionSpec | undefined) {
  if (!spec) return undefined;
  const next = state.update(spec).state;
  let text = next.doc.toString();
  for (const range of [...next.selection.ranges].reverse()) {
    text = range.empty
      ? `${text.slice(0, range.head)}|${text.slice(range.head)}`
      : `${text.slice(0, range.from)}[${text.slice(range.from, range.to)}]${text.slice(range.to)}`;
  }
  return text;
}

describe('a change at each caret', () => {
  it('asks for each caret alone, in the text the ones before left, and keeps the main one', () => {
    const state = stateOf('a|b|c');
    const seen: string[] = [];
    const made = atEachCaret(state, (alone) => {
      seen.push(`${alone.doc.toString()}@${String(alone.selection.main.head)}`);
      return { changes: { from: alone.selection.main.head, insert: 'x' } };
    });
    expect(seen).toEqual(['abc@1', 'axbc@3']);
    // Each caret stays before what's put at it, as CodeMirror maps a caret given no place.
    expect(marked(state, made)).toBe('a|xb|xc');
    expect(made?.selection.mainIndex).toBe(1);
  });

  it('goes from the last caret back when asked; one changed for none stays', () => {
    const state = stateOf('a|b|c');
    const seen: number[] = [];
    const made = atEachCaret(
      state,
      (alone) => {
        seen.push(alone.selection.main.head);
        return seen.length === 1 ? { changes: { from: 0, insert: 'x' } } : undefined;
      },
      true,
    );
    // The first caret, asked second, moved on by the text the last one put before it.
    expect(seen).toEqual([2, 2]);
    expect(marked(state, made)).toBe('xa|b|c');
    expect(atEachCaret(state, () => undefined)).toBeUndefined();
  });
});

describe('the editor’s commands at every caret', () => {
  it('Join Lines joins at each', () => {
    const state = stateOf('a|\nb\nc|\nd');
    expect(marked(state, joinLines(state))).toBe('a| b\nc| d');
  });

  it('Toggle Case changes each word', () => {
    const state = stateOf('ab| cd ef|');
    expect(marked(state, toggleCase(state))).toBe('[AB] cd [EF]');
  });

  it('Comment with Block Comment comments each selection', () => {
    const state = stateOf('[a] + [b];', languageFor('a.ts'));
    expect(marked(state, blockComment(state))).toBe('[/*a*/] + [/*b*/];');
  });

  it('Start New Line Before Current and Split Line act at each', () => {
    const before = stateOf('a|\nb|');
    expect(marked(before, startNewLineBefore(before))).toBe('|\na\n|\nb');
    const split = stateOf('a|b\nc|d');
    expect(marked(split, splitLine(split))).toBe('a|\nb\nc|\nd');
  });

  it('Move Statement moves each caret’s, down from the last so neither takes the other’s', () => {
    const ts = languageFor('a.ts');
    const down = stateOf('a|;\nb|;\nc;\n', ts);
    expect(marked(down, moveStatement(down, false))).toBe('c;\na|;\nb|;\n');
    const up = stateOf('a;\nb|;\nc|;\n', ts);
    expect(marked(up, moveStatement(up, true))).toBe('b|;\nc|;\na;\n');
  });

  it('Extend Selection grows each, and Shrink takes them all back', () => {
    const state = stateOf('ab| cd|', [selectionSteps]);
    const grown = state.update(extendSelection(state) as TransactionSpec).state;
    expect(marked(state, extendSelection(state))).toBe('[ab] [cd]');
    expect(marked(grown, shrinkSelection(grown))).toBe('ab| cd|');
  });
});
