import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, expandWord, historyNamesIn } from '../src/index.js';
import { expandingWord, expansion } from '../src/expand-word.js';

/**
 * The texts after each of `presses` (true for forward, Alt+/), from `text` with `|` for the caret;
 * the caret marked in each. Undefined where a press offers nothing.
 */
function expansions(text: string, presses: boolean[], readOnly = false) {
  let state = EditorState.create({
    doc: text.replace('|', ''),
    selection: EditorSelection.cursor(text.indexOf('|')),
    extensions: [expansion, EditorState.readOnly.of(readOnly)],
  });
  return presses.map((forward) => {
    const spec = expandWord(state, forward);
    if (!spec) return undefined;
    state = state.update(spec).state;
    const { head } = state.selection.main;
    const doc = state.doc.toString();
    return `${doc.slice(0, head)}|${doc.slice(head)}`;
  });
}

describe('Cyclic Expand Word', () => {
  it('completes the word with the nearest before the caret, then further back, then what was typed', () => {
    expect(expansions('food fork fo|', [true, true, true])).toEqual([
      'food fork fork|',
      'food fork food|',
      'food fork fo|',
    ]);
  });

  it('starts over after what was typed', () => {
    expect(expansions('fork fo|', [true, true, true])).toEqual([
      'fork fork|',
      'fork fo|',
      'fork fork|',
    ]);
  });

  it('backward, completes with the nearest after the caret, then further on', () => {
    expect(expansions('fo| food fork', [false, false, false])).toEqual([
      'food| food fork',
      'fork| food fork',
      'fo| food fork',
    ]);
  });

  it('turns back the other way, through the same words', () => {
    expect(expansions('fan fo| food fork', [true, false, false])).toEqual([
      'fan food| food fork',
      'fan fork| food fork',
      'fan fo| food fork',
    ]);
  });

  it('starts forward after the caret where there’s nothing before it, and backward at the first', () => {
    expect(expansions('fo| food', [true])).toEqual(['food| food']);
    expect(expansions('food fo|', [false])).toEqual(['food food|']);
  });

  it('offers each word once a side, the one nearest the caret, and not the word at the caret', () => {
    expect(expansions('fork food fork fo|ok', [true, true, true])).toEqual([
      'fork food fork fork|ok',
      'fork food fork food|ok',
      'fork food fork fo|ok',
    ]);
    // The same word before the caret and after it: once each.
    expect(expansions('fork fo| fork', [true, true])).toEqual(['fork fork| fork', 'fork fo| fork']);
    expect(expansions('fork fo| fork', [false, false])).toEqual([
      'fork fork| fork',
      'fork fo| fork',
    ]);
  });

  it('with nothing typed, offers every word; none that are only as long as what was', () => {
    expect(expansions('ab cd |', [true])).toEqual(['ab cd cd|']);
    expect(expansions('fo fo|', [true])).toEqual([undefined]);
  });

  it('ends on any other change', () => {
    let state = EditorState.create({
      doc: 'food fo',
      selection: EditorSelection.cursor(7),
      extensions: expansion,
    });
    state = state.update(expandWord(state, true) ?? {}).state;
    expect(state.field(expansion)).not.toBeNull();
    state = state.update({ selection: EditorSelection.cursor(0) }).state;
    expect(state.field(expansion)).toBeNull();
  });

  it('does nothing in a read-only editor, and gives the key on there', () => {
    expect(expansions('food fo|', [true], true)).toEqual([undefined]);
    const view = new EditorView({
      state: EditorState.create({ doc: 'a', extensions: EditorState.readOnly.of(true) }),
    });
    expect(expandingWord(view)).toBe(false);
    view.destroy();
  });

  it('is Alt+/ and Alt+Shift+/ in an editor, as IntelliJ’s, taking the key with nothing to offer; Undo names it', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.txt" document={new EditorDocument('alpha al')} />,
      container,
    );
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const content = root.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(content) as EditorView;
    view.focus();
    view.dispatch({ selection: { anchor: 8 } });
    await userEvent.keyboard('{Alt>}/{/Alt}');
    expect(view.state.doc.toString()).toBe('alpha alpha');
    expect(historyNamesIn(content)?.undo).toBe('Cyclic Expand Word');
    await userEvent.keyboard('{Alt>}{Shift>}?{/Shift}{/Alt}');
    expect(view.state.doc.toString()).toBe('alpha al');
    // Nothing to offer: the key's taken all the same.
    view.dispatch({ selection: { anchor: 0 }, changes: { from: 0, to: 8, insert: 'x' } });
    let passed = false;
    const listener = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.defaultPrevented) passed = true;
    };
    window.addEventListener('keydown', listener);
    await userEvent.keyboard('{End}{Alt>}/{/Alt}');
    window.removeEventListener('keydown', listener);
    expect(passed).toBe(false);
    handle.dispose();
    container.remove();
  });
});
