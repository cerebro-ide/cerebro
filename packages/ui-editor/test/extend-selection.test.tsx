import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  extendSelection,
  languageFor,
  selectionSteps,
  shrinkSelection,
} from '../src/index.js';

const CODE = 'function f() {\n  return g(alpha, beta);\n}';

/** What Extend Selection selects, from the caret at `at`, step by step until it can't. */
function extended(doc: string, at: number, path = 'a.ts'): string[] {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(at),
    extensions: [languageFor(path) ?? [], selectionSteps],
  });
  const seen: string[] = [];
  for (let spec = extendSelection(state); spec; spec = extendSelection(state)) {
    state = state.update(spec).state;
    seen.push(state.sliceDoc(state.selection.main.from, state.selection.main.to));
  }
  return seen;
}

describe('Extend Selection', () => {
  it('selects the word, then each larger piece of code, a bracketed one’s inside first', () => {
    expect(extended(CODE, CODE.indexOf('alpha') + 1)).toEqual([
      'alpha',
      'alpha, beta',
      '(alpha, beta)',
      'g(alpha, beta)',
      'return g(alpha, beta);',
      '{\n  return g(alpha, beta);\n}',
      CODE,
    ]);
  });

  it('starts from the syntax away from a word, and ends at the whole text', () => {
    expect(extended('a  b', 2, 'a.txt')).toEqual(['a  b']);
    expect(extended('', 0, 'a.txt')).toEqual([]);
  });
});

describe('Shrink Selection', () => {
  it('goes back through what Extend grew from; another selection forgets them', () => {
    let state = EditorState.create({
      doc: CODE,
      selection: EditorSelection.cursor(CODE.indexOf('alpha')),
      extensions: [languageFor('a.ts') ?? [], selectionSteps],
    });
    const selected = () => state.sliceDoc(state.selection.main.from, state.selection.main.to);
    for (let i = 0; i < 3; i++) state = state.update(extendSelection(state) ?? {}).state;
    expect(selected()).toBe('(alpha, beta)');
    state = state.update(shrinkSelection(state) ?? {}).state;
    expect(selected()).toBe('alpha, beta');
    state = state.update(shrinkSelection(state) ?? {}).state;
    state = state.update(shrinkSelection(state) ?? {}).state;
    expect(state.selection.main.empty).toBe(true);
    expect(shrinkSelection(state)).toBeUndefined();
    state = state.update(extendSelection(state) ?? {}).state;
    state = state.update({ selection: { anchor: 0 } }).state;
    expect(shrinkSelection(state)).toBeUndefined();
  });

  it('does nothing without the steps kept', () => {
    expect(shrinkSelection(EditorState.create({ doc: 'a' }))).toBeUndefined();
  });
});

describe('the keys in an editor', () => {
  it('are Ctrl+W and Ctrl+Shift+W, as IntelliJ’s, in a read-only editor too', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(() => <CodeEditor path="a.ts" text={CODE} />, container);
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-content') as HTMLElement,
    ) as EditorView;
    view.focus();
    view.dispatch({ selection: { anchor: CODE.indexOf('beta') } });
    const selected = () =>
      view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
    await userEvent.keyboard('{Control>}ww{/Control}');
    expect(selected()).toBe('alpha, beta');
    await userEvent.keyboard('{Control>}{Shift>}W{/Shift}{/Control}');
    expect(selected()).toBe('beta');
    handle.dispose();
    container.remove();
  });
});
