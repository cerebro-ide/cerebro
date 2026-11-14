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
  splitLine,
  startNewLine,
  startNewLineBefore,
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

/** The text after Start New Line Before Current at `caret` in a file at `path`, the caret as `|`. */
function before(doc: string, caret: number, path = 'a.ts') {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [languageFor(path) ?? []],
  });
  const next = state.update(startNewLineBefore(state) ?? {}).state;
  const { head } = next.selection.main;
  return `${next.doc.toString().slice(0, head)}|${next.doc.toString().slice(head)}`;
}

describe('Start New Line Before Current', () => {
  it('puts a line before the caret’s, the caret at the indent the language gives it', () => {
    expect(before('if (a) {\n  b();\n}', 13)).toBe('if (a) {\n  |\n  b();\n}');
    // Before a block's closing brace: inside the block.
    expect(before('if (a) {\n  b();\n}', 17)).toBe('if (a) {\n  b();\n  |\n}');
    expect(before('a;\nb;', 0)).toBe('|\na;\nb;');
  });

  it('takes the caret line’s indent where the language gives none', () => {
    expect(before('a\n\t  b', 6, 'a.txt')).toBe('a\n\t  |\n\t  b');
  });

  it('does nothing in a read-only editor', () => {
    const state = EditorState.create({ doc: 'a', extensions: EditorState.readOnly.of(true) });
    expect(startNewLineBefore(state)).toBeUndefined();
  });
});

/** The text after Split Line at `caret` in a file at `path`, the caret as `|`. */
function split(doc: string, caret: number, path = 'a.ts') {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [languageFor(path) ?? []],
  });
  const next = state.update(splitLine(state) ?? {}).state;
  const { head } = next.selection.main;
  return `${next.doc.toString().slice(0, head)}|${next.doc.toString().slice(head)}`;
}

describe('Split Line', () => {
  it('moves what’s after the caret to a new line, at the language’s indent, the caret staying', () => {
    expect(split('if (a) {\n  b(c,   d);\n}', 15)).toBe('if (a) {\n  b(c,|\n    d);\n}');
    expect(split('ab', 1, 'a.txt')).toBe('a|\nb');
  });

  it('puts the white space before the caret on a line above where there’s only that', () => {
    expect(split('a\n  bc', 4, 'a.txt')).toBe('a\n  |\n  bc');
  });

  it('does nothing in a read-only editor', () => {
    const state = EditorState.create({ doc: 'a', extensions: EditorState.readOnly.of(true) });
    expect(splitLine(state)).toBeUndefined();
  });
});

describe('the keys in an editor', () => {
  it('Ctrl+Enter splits the line, as IntelliJ’s, and Undo names it', async () => {
    const { view, content, close } = mount('ab', true);
    view.dispatch({ selection: { anchor: 1 } });
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(view.state.doc.toString()).toBe('a\nb');
    expect(view.state.selection.main.head).toBe(1);
    expect(historyNamesIn(content)?.undo).toBe('Split Line');
    close();
  });

  it('Ctrl+Alt+Enter starts a new line before the caret’s, as IntelliJ’s, and Undo names it', async () => {
    const { view, content, close } = mount('ab\ncd', true);
    view.dispatch({ selection: { anchor: 4 } });
    await userEvent.keyboard('{Control>}{Alt>}{Enter}{/Alt}{/Control}');
    expect(view.state.doc.toString()).toBe('ab\n\ncd');
    expect(view.state.selection.main.head).toBe(3);
    expect(historyNamesIn(content)?.undo).toBe('Start New Line Before Current');
    close();
  });

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
