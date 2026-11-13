import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, historyNamesIn, moveLine } from '../src/index.js';

/** The text after Move Line Up or Down from a selection, `undefined` for no change. */
function moved(doc: string, anchor: number, head: number, up: boolean) {
  const state = EditorState.create({ doc, selection: EditorSelection.range(anchor, head) });
  const spec = moveLine(state, up);
  if (!spec) return undefined;
  const next = state.update(spec).state;
  return {
    text: next.doc.toString(),
    ranges: [next.selection.main.anchor, next.selection.main.head],
  };
}

describe('Move Line Up and Down', () => {
  it('swap the caret’s line with the one above or below, the caret with it', () => {
    expect(moved('a\nb\nc', 2, 2, true)).toEqual({ text: 'b\na\nc', ranges: [0, 0] });
    expect(moved('a\nb\nc', 2, 2, false)).toEqual({ text: 'a\nc\nb', ranges: [4, 4] });
  });

  it('move a selection’s lines, not one it ends at the start of', () => {
    expect(moved('a\nb\nc', 0, 2, false)).toEqual({ text: 'b\na\nc', ranges: [2, 4] });
  });

  it('do nothing at the document’s first or last line', () => {
    expect(moved('a\nb', 0, 0, true)).toBeUndefined();
    expect(moved('a\nb', 2, 2, false)).toBeUndefined();
  });
});

describe('Move Line’s keys in an editor', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('are Alt+Shift+Up and Down, as IntelliJ’s, and Undo names them', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.txt" document={new EditorDocument('a\nb')} />,
      container,
    );
    cleanup = () => {
      handle.dispose();
      container.remove();
    };
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const content = root.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(content) as EditorView;
    view.focus();
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
    expect(view.state.doc.toString()).toBe('b\na');
    expect(historyNamesIn(content)?.undo).toBe('Move Line Down');
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}');
    expect(view.state.doc.toString()).toBe('a\nb');
    expect(historyNamesIn(content)?.undo).toBe('Move Line Up');
    // Nowhere to go: the key goes on.
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowUp}{/Shift}{/Alt}');
    expect(view.state.doc.toString()).toBe('a\nb');
  });
});
