import { EditorSelection, EditorState, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  addCaretsToLineEnds,
  CodeEditor,
  EditorDocument,
  findFrom,
  NOT_FOUND,
  occurrences,
  selectAllOccurrences,
  selectNextOccurrence,
  unselectOccurrence,
  wordAt,
  type CaretMouse,
} from '../src/index.js';

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

/** A view of `doc` with `ranges` selected (anchor, head), the last the main one unless given. */
function viewOf(doc: string, ranges: [number, number][], main = ranges.length - 1) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.create(
        ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
        main,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true), occurrences],
    }),
  });
  views.push(view);
  return view;
}

/** Each range as [anchor, head], and which is the main one. */
const selected = (view: EditorView) => ({
  ranges: view.state.selection.ranges.map((r) => [r.anchor, r.head]),
  main: view.state.selection.mainIndex,
});

describe('the word at the caret and its matches', () => {
  it('takes the word the caret’s in or just after, as IntelliJ’s, and none away from one', () => {
    const doc = Text.of(['a.bc_d$ e']);
    expect(wordAt(doc, 3)).toEqual({ from: 2, to: 7 });
    expect(wordAt(doc, 7)).toEqual({ from: 2, to: 7 });
    expect(wordAt(doc, 9)).toEqual({ from: 8, to: 9 });
    expect(wordAt(Text.of(['a  b']), 2)).toBeUndefined();
    expect(wordAt(Text.of(['']), 0)).toBeUndefined();
  });

  it('finds the text matching case, or only as a whole word', () => {
    const doc = Text.of(['Ab ab abc ab']);
    expect(findFrom(doc, 'ab', 0, false)).toEqual({ from: 3, to: 5 });
    expect(findFrom(doc, 'ab', 5, false)).toEqual({ from: 6, to: 8 });
    expect(findFrom(doc, 'ab', 5, true)).toEqual({ from: 10, to: 12 });
    expect(findFrom(doc, 'ab', 11, true)).toBeUndefined();
  });
});

describe('Add Selection for Next Occurrence', () => {
  it('selects the word at the caret, then adds its next whole matches, each the main one', () => {
    const view = viewOf('foo foobar foo', [[1, 1]]);
    selectNextOccurrence(view);
    expect(selected(view)).toEqual({ ranges: [[0, 3]], main: 0 });
    selectNextOccurrence(view);
    expect(selected(view)).toEqual({
      ranges: [
        [0, 3],
        [11, 14],
      ],
      main: 1,
    });
  });

  it('matches part of a word from a selection made otherwise, its caret at the same end', () => {
    const view = viewOf('foo foobar', [[3, 0]]);
    selectNextOccurrence(view);
    expect(selected(view)).toEqual({
      ranges: [
        [3, 0],
        [7, 4],
      ],
      main: 1,
    });
  });

  it('says none’s found after it, then searches from the top', () => {
    const view = viewOf('ab x ab', [[5, 7]]);
    selectNextOccurrence(view);
    expect(view.dom.querySelector('.cerebro-hint')?.textContent).toBe(NOT_FOUND);
    selectNextOccurrence(view);
    expect(selected(view)).toEqual({
      ranges: [
        [0, 2],
        [5, 7],
      ],
      main: 0,
    });
    // All taken: nothing added, and still from the top.
    selectNextOccurrence(view);
    expect(selected(view).ranges).toHaveLength(2);
  });

  it('forgets the search as anything else changes the selection', () => {
    const view = viewOf('ab x ab', [[5, 7]]);
    selectNextOccurrence(view);
    view.dispatch({ selection: EditorSelection.range(5, 7) });
    // From after it again: none, not the top's.
    selectNextOccurrence(view);
    expect(selected(view).ranges).toEqual([[5, 7]]);
  });

  it('adds nothing where the next match has a caret already', () => {
    const view = viewOf(
      'ab ab',
      [
        [0, 2],
        [3, 5],
      ],
      0,
    );
    selectNextOccurrence(view);
    expect(selected(view)).toEqual({
      ranges: [
        [0, 2],
        [3, 5],
      ],
      main: 0,
    });
  });

  it('does nothing away from a word', () => {
    const view = viewOf('a  b', [[2, 2]]);
    expect(selectNextOccurrence(view)).toBe(true);
    expect(selected(view).ranges).toEqual([[2, 2]]);
  });
});

describe('Unselect Occurrence', () => {
  it('removes the main caret, the one before it the main one; with one, drops its selection', () => {
    const view = viewOf(
      'a a a',
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
      2,
    );
    unselectOccurrence(view);
    expect(selected(view)).toEqual({
      ranges: [
        [0, 1],
        [2, 3],
      ],
      main: 1,
    });
    view.dispatch({ selection: EditorSelection.create(view.state.selection.ranges, 0) });
    unselectOccurrence(view);
    expect(selected(view)).toEqual({ ranges: [[2, 3]], main: 0 });
    unselectOccurrence(view);
    expect(selected(view)).toEqual({ ranges: [[3, 3]], main: 0 });
  });

  it('keeps the search’s whole words for the next one', () => {
    const view = viewOf('ab abc ab ab', [[0, 0]]);
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    unselectOccurrence(view);
    selectNextOccurrence(view);
    expect(selected(view).ranges).toEqual([
      [0, 2],
      [7, 9],
      [10, 12],
    ]);
  });
});

describe('Select All Occurrences', () => {
  it('selects every whole match of the word at the caret, its own the main one', () => {
    const view = viewOf('ab abc ab', [[8, 8]]);
    selectAllOccurrences(view);
    expect(selected(view)).toEqual({
      ranges: [
        [0, 2],
        [7, 9],
      ],
      main: 1,
    });
  });

  it('selects every match of a selection, in words too; nothing away from a word', () => {
    const view = viewOf('ab abc', [[0, 2]]);
    selectAllOccurrences(view);
    expect(selected(view).ranges).toEqual([
      [0, 2],
      [3, 5],
    ]);
    const away = viewOf('a  b', [[2, 2]]);
    selectAllOccurrences(away);
    expect(selected(away).ranges).toEqual([[2, 2]]);
  });
});

describe('Add Carets to Ends of Selected Lines', () => {
  it('puts a caret at each selected line’s end, not one the selection ends at the start of', () => {
    const view = viewOf('ab\ncd\nef', [[1, 6]]);
    addCaretsToLineEnds(view);
    expect(selected(view)).toEqual({
      ranges: [
        [2, 2],
        [5, 5],
      ],
      main: 1,
    });
  });

  it('moves a caret with nothing selected to its line’s end; the main one where its caret was', () => {
    const view = viewOf(
      'ab\ncd\nef',
      [
        [7, 3],
        [0, 0],
      ],
      0,
    );
    addCaretsToLineEnds(view);
    expect(selected(view)).toEqual({
      ranges: [
        [2, 2],
        [5, 5],
        [8, 8],
      ],
      main: 1,
    });
  });
});

describe('in the editor', () => {
  const mounted: (() => void)[] = [];
  afterEach(() => {
    for (const dispose of mounted.splice(0)) dispose();
  });

  /** IntelliJ's mouse: Alt+Shift+click adds a caret, Alt+drag and the middle button a rectangle. */
  const INTELLIJ: CaretMouse = {
    addsCaret: (e) => e.altKey && e.shiftKey && !e.ctrlKey && e.button === 0,
    dragsColumn: (e) => (e.altKey && !e.shiftKey && e.button === 0) || e.button === 1,
  };

  function mount(text: string) {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => (
        <CodeEditor
          path="a.txt"
          document={new EditorDocument(text)}
          mouse={() => ({ ...INTELLIJ, isShortcut: () => false, isLink: () => false })}
        />
      ),
      container,
    );
    mounted.push(() => {
      handle.dispose();
      container.remove();
    });
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    return EditorView.findFromDOM(root.querySelector('.cm-content') as HTMLElement) as EditorView;
  }

  /** The client point at `pos`'s left, half way down its line. */
  const point = (view: EditorView, pos: number) => {
    const at = view.coordsAtPos(pos) as { left: number; top: number; bottom: number };
    return { clientX: at.left + 1, clientY: (at.top + at.bottom) / 2 };
  };

  it('has IntelliJ’s keys for the occurrence actions and the lines’ ends', async () => {
    const view = mount('ab ab\nab');
    view.focus();
    view.dispatch({ selection: EditorSelection.cursor(0) });
    await userEvent.keyboard('{Alt>}j{/Alt}');
    await userEvent.keyboard('{Alt>}j{/Alt}');
    expect(view.state.selection.ranges).toHaveLength(2);
    await userEvent.keyboard('{Alt>}{Shift>}J{/Shift}{/Alt}');
    expect(view.state.selection.ranges).toHaveLength(1);
    await userEvent.keyboard('{Control>}{Alt>}{Shift>}J{/Shift}{/Alt}{/Control}');
    expect(view.state.selection.ranges).toHaveLength(3);
    // Typing goes to every caret.
    await userEvent.keyboard('x');
    expect(view.state.doc.toString()).toBe('x x\nx');
    view.dispatch({ selection: EditorSelection.range(0, 5) });
    await userEvent.keyboard('{Alt>}{Shift>}G{/Shift}{/Alt}');
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([3, 5]);
    // Escape keeps the main caret alone, as IntelliJ’s.
    await userEvent.keyboard('{Escape}');
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([5]);
  });

  it('adds a caret with the mouse’s shortcut, and removes the one clicked', async () => {
    const view = mount('abc\ndef');
    view.dispatch({ selection: EditorSelection.cursor(0) });
    // Real clicks, Alt and Shift held: CodeMirror reads Shift from them.
    const press = async (pos: number, modifiers: ('Alt' | 'Shift')[] = []) => {
      const { clientX, clientY } = point(view, pos);
      const box = view.contentDOM.getBoundingClientRect();
      await userEvent.click(view.contentDOM, {
        position: { x: clientX - box.left, y: clientY - box.top },
        modifiers,
      });
    };
    await press(5, ['Alt', 'Shift']);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([0, 5]);
    await press(5, ['Alt', 'Shift']);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([0]);
    // A plain click: one caret.
    await press(5, ['Alt', 'Shift']);
    await press(2);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([2]);
  });

  it('drags a range more with the shortcut, kept where it was as the text changes', () => {
    const view = mount('abcd\nefgh');
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const init = { bubbles: true, altKey: true, shiftKey: true };
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { ...init, detail: 1, ...point(view, 6) }),
    );
    // Text typed before it as it's held.
    view.dispatch({ changes: { from: 0, insert: 'xy' } });
    const to = point(view, 10);
    document.dispatchEvent(new MouseEvent('mousemove', { ...init, buttons: 1, ...to }));
    document.dispatchEvent(new MouseEvent('mouseup', { ...init, ...to }));
    expect(view.state.selection.ranges.map((r) => [r.anchor, r.head])).toEqual([
      // The first caret stays before what's typed at its place.
      [0, 0],
      [8, 10],
    ]);
  });

  it('selects a rectangle as Alt or the middle button drags', () => {
    const view = mount('abcd\nefgh\nijkl');
    for (const init of [{ altKey: true, button: 0 }, { button: 1 }]) {
      view.dispatch({ selection: EditorSelection.cursor(0) });
      const from = point(view, 1);
      const to = point(view, 13);
      view.contentDOM.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, detail: 1, ...from, ...init }),
      );
      const buttons = init.button === 1 ? 4 : 1;
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, buttons, ...to, ...init }),
      );
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...to, ...init }));
      expect(view.state.selection.ranges.map((r) => view.state.sliceDoc(r.from, r.to))).toEqual([
        'bc',
        'fg',
        'jk',
      ]);
    }
  });
});
