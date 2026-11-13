import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  historyNamesIn,
  languageFor,
  toggleCase,
} from '../src/index.js';

/** The text after Toggle Case from `anchor` to `head`, its selection's ends; undefined for none. */
function toggled(doc: string, anchor: number, head = anchor, path = 'a.txt', readOnly = false) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [languageFor(path) ?? [], EditorState.readOnly.of(readOnly)],
  });
  const spec = toggleCase(state);
  if (!spec) return undefined;
  const next = state.update(spec).state;
  return { text: next.doc.toString(), at: [next.selection.main.anchor, next.selection.main.head] };
}

describe('Toggle Case', () => {
  it('makes the word at the caret upper case where it has no upper-case letter, and selects it', () => {
    expect(toggled('a foo b', 4)).toEqual({ text: 'a FOO b', at: [2, 5] });
  });

  it('makes it lower case where it has one', () => {
    expect(toggled('a FOO b', 4)).toEqual({ text: 'a foo b', at: [2, 5] });
    expect(toggled('a fooBar b', 4)).toEqual({ text: 'a foobar b', at: [2, 8] });
  });

  it('changes a selection, which stays, its caret on its side', () => {
    expect(toggled('ab cd ef', 1, 4)).toEqual({ text: 'aB Cd ef', at: [1, 4] });
    expect(toggled('ab cd ef', 4, 1)).toEqual({ text: 'aB Cd ef', at: [4, 1] });
  });

  it('keeps a string’s escapes as they are', () => {
    expect(toggled('"a\\nb"', 0, 6, 'a.ts')).toEqual({ text: '"A\\nB"', at: [0, 6] });
    // From inside an escape: its part in the selection stays too.
    expect(toggled('"a\\nb"', 3, 5, 'a.ts')).toEqual({ text: '"a\\nB"', at: [3, 5] });
  });

  it('selects the text as it came out, where its length changed', () => {
    expect(toggled('ß', 0)).toEqual({ text: 'SS', at: [0, 2] });
  });

  it('does nothing with no word at the caret, or in a read-only editor', () => {
    expect(toggled('a  b', 2)).toBeUndefined();
    expect(toggled('ab', 1, 1, 'a.txt', true)).toBeUndefined();
  });

  it('is Ctrl+Shift+U in an editor, as IntelliJ’s, and Undo names it', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.txt" document={new EditorDocument('ab')} />,
      container,
    );
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const content = root.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(content) as EditorView;
    view.focus();
    await userEvent.keyboard('{Control>}{Shift>}U{/Shift}{/Control}');
    expect(view.state.doc.toString()).toBe('AB');
    expect(historyNamesIn(content)?.undo).toBe('Toggle Case');
    handle.dispose();
    container.remove();
  });
});
