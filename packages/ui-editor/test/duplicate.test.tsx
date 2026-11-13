import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodeEditor,
  editorDuplicate,
  EditorDocument,
  historyNamesIn,
  duplicateLines,
  inChangeableEditor,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** An editor of a document, or read-only with the text alone; its content element, and its view. */
function mount(text: string, editable = true) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(
    () =>
      editable ? (
        <CodeEditor path="a.txt" document={new EditorDocument(text)} />
      ) : (
        <CodeEditor path="a.txt" text={text} />
      ),
    container,
  );
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const content = root.querySelector('.cm-content') as HTMLElement;
  return { content, view: EditorView.findFromDOM(content) as EditorView };
}

/** The text, and each caret's or selection's ends. */
function state(view: EditorView) {
  return {
    text: view.state.doc.toString(),
    ranges: view.state.selection.ranges.map((r) => [r.anchor, r.head]),
  };
}

describe('Duplicate Line or Selection', () => {
  it('puts the caret’s line again below it, the caret in the copy at its column', () => {
    const { content, view } = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 6 } });
    expect(inChangeableEditor(content)).toBe(true);
    expect(editorDuplicate(content)).toBe(true);
    expect(state(view)).toEqual({ text: 'one\ntwo\ntwo\nthree', ranges: [[10, 10]] });
    // The last line, which has no line break after it.
    view.dispatch({ selection: { anchor: 15 } });
    editorDuplicate(content);
    expect(state(view)).toEqual({ text: 'one\ntwo\ntwo\nthree\nthree', ranges: [[21, 21]] });
    expect(historyNamesIn(content)?.undo).toBe('Duplicate Line or Selection');
  });

  it('puts a selection again right after it, the copy selected', () => {
    const { content, view } = mount('a bc d');
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    editorDuplicate(content);
    expect(state(view)).toEqual({ text: 'a bcbc d', ranges: [[4, 6]] });
  });

  it('does nothing in a read-only editor, or outside one', () => {
    const { content, view } = mount('a', false);
    expect(inChangeableEditor(content)).toBe(false);
    expect(editorDuplicate(content)).toBe(false);
    expect(view.state.doc.toString()).toBe('a');
    expect(editorDuplicate(document.body)).toBe(false);
  });
});

describe('Duplicate Entire Lines', () => {
  it('puts the lines a selection touches again below them, the copy selected', () => {
    const { content, view } = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 1, head: 5 } });
    expect(editorDuplicate(content, true)).toBe(true);
    expect(state(view)).toEqual({ text: 'one\ntwo\none\ntwo\nthree', ranges: [[8, 16]] });
    expect(historyNamesIn(content)?.undo).toBe('Duplicate Entire Lines');
  });

  it('keeps the caret at the selection’s start where it was', () => {
    const { content, view } = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 5, head: 1 } });
    editorDuplicate(content, true);
    expect(state(view).ranges).toEqual([[16, 8]]);
  });

  it('leaves out the line a selection ends at the start of', () => {
    const { content, view } = mount('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 0, head: 8 } });
    editorDuplicate(content, true);
    expect(state(view)).toEqual({ text: 'one\ntwo\none\ntwo\nthree', ranges: [[8, 16]] });
  });

  it('selects the copy of the last line without a line break after it', () => {
    const { content, view } = mount('one\ntwo');
    view.dispatch({ selection: { anchor: 5, head: 6 } });
    editorDuplicate(content, true);
    expect(state(view)).toEqual({ text: 'one\ntwo\ntwo', ranges: [[8, 11]] });
  });

  it('puts the caret’s line again below it, as Duplicate Line or Selection', () => {
    const { content, view } = mount('one\ntwo');
    view.dispatch({ selection: { anchor: 1 } });
    editorDuplicate(content, true);
    expect(state(view)).toEqual({ text: 'one\none\ntwo', ranges: [[5, 5]] });
  });

  it('is a change of the editor’s state alone', () => {
    const { view } = mount('a');
    expect(view.state.update(duplicateLines(view.state)).state.doc.toString()).toBe('a\na');
  });
});
