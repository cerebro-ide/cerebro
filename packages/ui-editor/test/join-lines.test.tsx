import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, historyNamesIn, joinLines } from '../src/index.js';

/** The text after Join Lines from `anchor` to `head`, its selection's ends; undefined for none. */
function joined(doc: string, anchor: number, head = anchor, readOnly = false) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: EditorState.readOnly.of(readOnly),
  });
  const spec = joinLines(state);
  if (!spec) return undefined;
  const next = state.update(spec).state;
  return { text: next.doc.toString(), at: [next.selection.main.anchor, next.selection.main.head] };
}

describe('Join Lines', () => {
  it('joins the caret’s line and the next with a space for the white space between', () => {
    expect(joined('a(  \n    b);\nc', 0)).toEqual({ text: 'a( b);\nc', at: [2, 2] });
  });

  it('puts no space where the next line is blank', () => {
    expect(joined('a\n   \nb', 0)).toEqual({ text: 'a\nb', at: [1, 1] });
  });

  it('joins a selection’s lines, not one it ends at the start of; the selection stays', () => {
    expect(joined('a\nb\nc\nd', 0, 4)).toEqual({ text: 'a b\nc\nd', at: [0, 4] });
    expect(joined('a\nb\nc\nd', 0, 5)).toEqual({ text: 'a b c\nd', at: [0, 5] });
  });

  it('does nothing at the last line, in one line’s selection, or a read-only editor', () => {
    expect(joined('a\nb', 2)).toBeUndefined();
    expect(joined('ab\nc', 0, 1)).toBeUndefined();
    expect(joined('a\nb', 0, 0, true)).toBeUndefined();
  });

  it('is Ctrl+Shift+J in an editor, as IntelliJ’s, and Undo names it', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.txt" document={new EditorDocument('a\nb')} />,
      container,
    );
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const content = root.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(content) as EditorView;
    view.focus();
    await userEvent.keyboard('{Control>}{Shift>}J{/Shift}{/Control}');
    expect(view.state.doc.toString()).toBe('a b');
    expect(historyNamesIn(content)?.undo).toBe('Join Lines');
    handle.dispose();
    container.remove();
  });
});
