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
  startNewLine,
} from '../src/index.js';

describe('Start New Line', () => {
  it('puts an indented line after the caret’s, wherever it is in it, the caret on it', () => {
    const state = EditorState.create({
      doc: 'if (a) {\n  b();\n}',
      selection: EditorSelection.cursor(11),
      extensions: [languageFor('a.ts') ?? []],
    });
    const next = state.update(startNewLine(state) ?? {}).state;
    expect(next.doc.toString()).toBe('if (a) {\n  b();\n  \n}');
    expect(next.selection.main.head).toBe(18);
  });

  it('does nothing in a read-only editor', () => {
    const state = EditorState.create({ doc: 'a', extensions: EditorState.readOnly.of(true) });
    expect(startNewLine(state)).toBeUndefined();
  });
});

/** An editor of `text`, changeable or not, focused; its view and content, and how to close it. */
function mount(text: string, editable: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(
    () =>
      editable ? (
        <CodeEditor path="a.ts" document={new EditorDocument(text)} />
      ) : (
        <CodeEditor path="a.ts" text={text} />
      ),
    container,
  );
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const content = root.querySelector('.cm-content') as HTMLElement;
  const view = EditorView.findFromDOM(content) as EditorView;
  view.focus();
  return {
    view,
    content,
    close: () => {
      handle.dispose();
      container.remove();
    },
  };
}

describe('the keys in an editor', () => {
  it('Shift+Enter starts a new line, as IntelliJ’s, and Undo names it', async () => {
    const { view, content, close } = mount('ab\ncd', true);
    view.dispatch({ selection: { anchor: 1 } });
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(view.state.doc.toString()).toBe('ab\n\ncd');
    expect(view.state.selection.main.head).toBe(3);
    expect(historyNamesIn(content)?.undo).toBe('Start New Line');
    close();
  });

  it('Ctrl+Shift+M moves the caret to the matching brace, in a read-only editor too', async () => {
    const { view, close } = mount('f(a, b);', false);
    view.dispatch({ selection: { anchor: 1 } });
    await userEvent.keyboard('{Control>}{Shift>}M{/Shift}{/Control}');
    expect(view.state.selection.main.head).toBe(7);
    close();
  });
});
