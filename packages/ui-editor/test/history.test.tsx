import '@cerebro-ide/theme/themes.css';
import { isolateHistory, redoDepth, undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, editorHistory, EditorDocument, historyNamesIn } from '../src/index.js';
import { historyNames } from '../src/history.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** An editor of a document; its content element, and its view. */
function mount(doc: EditorDocument | undefined) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.body.append(container);
  const handle = render(
    () => (doc ? <CodeEditor path="a.txt" document={doc} /> : <CodeEditor path="a.txt" text="" />),
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

/** A change, as a command makes it: its own step in the history. */
function change(view: EditorView, userEvent: string | undefined, insert = 'x') {
  view.dispatch({
    changes: { from: 0, insert },
    ...(userEvent === undefined ? {} : { userEvent }),
    annotations: isolateHistory.of('full'),
  });
}

describe('the history’s names', () => {
  it('names what Undo and Redo would do, as IntelliJ', async () => {
    const { content, view } = mount(new EditorDocument(''));
    expect(historyNamesIn(content)).toEqual({ undo: undefined, redo: undefined });
    await userEvent.click(content);
    await userEvent.keyboard('ab');
    // Typing goes on as one change.
    expect(undoDepth(view.state)).toBe(1);
    expect(historyNamesIn(content)).toEqual({ undo: 'Typing', redo: undefined });
    for (const [event, name] of [
      ['input.paste', 'Paste'],
      ['input.replace.all', 'Replace'],
      ['input.indent', 'Indent Selection'],
      ['delete.cut', 'Cut'],
      ['delete.backward', 'Backspace'],
      ['delete.forward', 'Delete'],
      ['delete.line', 'Delete Line'],
      ['delete.dedent', 'Unindent Line or Selection'],
      ['input', ''],
      [undefined, ''],
    ] as const) {
      change(view, event);
      expect(historyNamesIn(content)?.undo).toBe(name);
    }
    editorHistory(content, 'undo');
    editorHistory(content, 'undo');
    expect(historyNamesIn(content)).toEqual({ undo: 'Unindent Line or Selection', redo: '' });
    editorHistory(content, 'redo');
    expect(historyNamesIn(content)).toEqual({ undo: '', redo: '' });
    // A new change: nothing to redo.
    change(view, 'input.paste');
    expect(historyNamesIn(content)).toEqual({ undo: 'Paste', redo: undefined });
  });

  it('keeps a name per change the history keeps, which drops its oldest', () => {
    const { content, view } = mount(new EditorDocument(''));
    for (let i = 0; i < 130; i++) change(view, i === 0 ? 'input.paste' : 'delete.cut');
    const names = view.state.field(historyNames);
    expect(names.done).toHaveLength(undoDepth(view.state));
    expect(names.done).not.toContain('Paste');
    while (editorHistory(content, 'undo') && undoDepth(view.state) > 0);
    expect(view.state.field(historyNames).undone).toHaveLength(redoDepth(view.state));
  });

  it('keeps the history and its names with the document between editors', () => {
    const doc = new EditorDocument('');
    change(mount(doc).view, 'input.paste');
    cleanup?.();
    const { content, view } = mount(doc);
    expect(undoDepth(view.state)).toBe(1);
    expect(historyNamesIn(content)?.undo).toBe('Paste');
  });

  it('is read reactively, and is undefined outside an editor with a history', () => {
    const { content, view } = mount(new EditorDocument(''));
    const seen: (string | undefined)[] = [];
    const watch = effect(() => {
      seen.push(historyNamesIn(content)?.undo);
      return undefined;
    });
    change(view, 'delete.cut');
    // Moving the caret changes no names.
    view.dispatch({ selection: { anchor: 1 } });
    watch.dispose();
    expect(seen).toEqual([undefined, 'Cut']);
    expect(historyNamesIn(document.body)).toBeUndefined();
    cleanup?.();
    expect(historyNamesIn(mount(undefined).content)).toBeUndefined();
  });
});
