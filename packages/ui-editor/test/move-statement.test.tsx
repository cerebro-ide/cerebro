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
  moveStatement,
} from '../src/index.js';

/**
 * The text after Move Statement Up or Down, the caret (or a selection's ends) written `|`;
 * undefined where nothing moves.
 */
function moved(marked: string, up: boolean, path = 'a.ts', readOnly = false) {
  const at = [...marked.matchAll(/\|/g)].map((m, i) => m.index - i);
  const doc = marked.replaceAll('|', '');
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(at[0] as number, at[1] ?? (at[0] as number)),
    extensions: [languageFor(path) ?? [], EditorState.readOnly.of(readOnly)],
  });
  const spec = moveStatement(state, up);
  if (!spec) return undefined;
  const next = state.update(spec).state;
  const { from, to } = next.selection.main;
  const text = next.doc.toString();
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}|${text.slice(from, to)}|${text.slice(to)}`;
}

describe('Move Statement Up and Down', () => {
  it('swap the caret’s statement with the one beyond it, the caret with it', () => {
    expect(moved('a();\nb(|);\nc();\n', true)).toBe('b(|);\na();\nc();\n');
    expect(moved('a();\nb(|);\nc();\n', false)).toBe('a();\nc();\nb(|);\n');
  });

  it('move a statement over several lines whole, from any line of it but an inner one', () => {
    expect(moved('|foo(\n  1,\n);\nb();\n', false)).toBe('b();\n|foo(\n  1,\n);\n');
    expect(moved('a();\nfoo(\n  1,\n)|;\n', true)).toBe('foo(\n  1,\n)|;\na();\n');
    // Inside it, an argument's line moves as a line; a parameter's too.
    expect(moved('foo(\n  |1,\n  2,\n);\n', false)).toBe('foo(\n  2,\n  |1,\n);\n');
    expect(moved('foo(\n  1,\n  |2,\n);\n', true)).toBe('foo(\n  |2,\n  1,\n);\n');
    expect(moved('function f(\n  |a,\n  b,\n) {}\n', false)).toBe(
      'function f(\n  b,\n  |a,\n) {}\n',
    );
    // Past one, to the next statement's line.
    expect(moved('|a();\nfoo(\n  1,\n);\nb();\n', false)).toBe('foo(\n  1,\n);\n|a();\nb();\n');
    expect(moved('foo(\n  1,\n);\n|a();\n', true)).toBe('|a();\nfoo(\n  1,\n);\n');
    // From its last line, at the top: nowhere to go.
    expect(moved('foo(\n  1,\n)|;\n', true)).toBeUndefined();
  });

  it('go into a block and out of it, indented where they land', () => {
    expect(moved('|a();\nif (x) {\n  b();\n}\n', false)).toBe('if (x) {\n  |a();\n  b();\n}\n');
    expect(moved('if (x) {\n  b();\n}\n|a();\n', true)).toBe('if (x) {\n  b();\n  |a();\n}\n');
    expect(moved('if (x) {\n  |a();\n}\nb();\n', false)).toBe('if (x) {\n}\n|a();\nb();\n');
    expect(moved('if (x) {\n  |a();\n}\n', true)).toBe('|a();\nif (x) {\n}\n');
    // Into the other branch.
    expect(moved('if (x) {\n  |a();\n} else {\n  b();\n}\n', false)).toBe(
      'if (x) {\n} else {\n  |a();\n  b();\n}\n',
    );
  });

  it('stay in their function and their class', () => {
    expect(moved('function f() {\n  |a();\n}\nb();\n', true)).toBeUndefined();
    expect(moved('function f() {\n  |a();\n}\nb();\n', false)).toBeUndefined();
    // Nor past its end, with nothing after it.
    expect(moved('function f() {\n  |a();\n}\n', false)).toBeUndefined();
    expect(moved('class C {\n  |m() {}\n}\n', false)).toBeUndefined();
    expect(moved('class C {\n  |m() {}\n}\n', true)).toBeUndefined();
  });

  it('pass a function, a class, or a statement holding one, whole', () => {
    expect(moved('|a();\nfunction f() {\n  b();\n}\nc();\n', false)).toBe(
      'function f() {\n  b();\n}\n|a();\nc();\n',
    );
    expect(moved('foo(() => {\n  b();\n});\n|a();\n', true)).toBe(
      '|a();\nfoo(() => {\n  b();\n});\n',
    );
    // A block whose statement holds one isn't passed: only what's outside its blocks counts.
    expect(moved('|a();\nif (x) {\n  foo(() => 1);\n}\n', false)).toBe(
      'if (x) {\n  |a();\n  foo(() => 1);\n}\n',
    );
  });

  it('move a function, a class or a member whole, from its first or last line', () => {
    const two = 'function f() {\n  a();\n}\n\nfunction g() {\n  b();\n}\n';
    // The blank line between stays between.
    expect(moved(`|${two}`, false)).toBe(
      'function g() {\n  b();\n}\n\n|function f() {\n  a();\n}\n',
    );
    expect(moved(two.replace('}\n\n', '|}\n\n'), false)).toBe(
      'function g() {\n  b();\n}\n\nfunction f() {\n  a();\n|}\n',
    );
    // Past one blank line of more, one at a time.
    expect(moved('|function f() {}\n\n\nfunction g() {}\n', false)).toBe(
      '\n|function f() {}\n\nfunction g() {}\n',
    );
    expect(moved('function f() {}\n\n\n|x();\n', true)).toBe('function f() {}\n\n|x();\n\n');
    expect(moved('class C {\n  |m() {}\n  n() {}\n}\n', false)).toBe(
      'class C {\n  n() {}\n  |m() {}\n}\n',
    );
    expect(moved('export function f() {}\n|x();\n', true)).toBe('|x();\nexport function f() {}\n');
  });

  it('take a doc comment with what it’s above, a plain one apart', () => {
    expect(moved('/** F. */\nfunction f() {}\n|function g() {}\n', true)).toBe(
      '|function g() {}\n/** F. */\nfunction f() {}\n',
    );
    expect(moved('/** |F. */\nfunction f() {}\nfunction g() {}\n', false)).toBe(
      'function g() {}\n/** |F. */\nfunction f() {}\n',
    );
    expect(moved('// c\n|a();\n', true)).toBe('|a();\n// c\n');
    expect(moved('/* c */\nfunction f() {}\n|g();\n', true)).toBe(
      '/* c */\n|g();\nfunction f() {}\n',
    );
    // Not one a blank line sets apart.
    expect(moved('/** F. */\n\nfunction f() {}\n|g();\n', true)).toBe(
      '/** F. */\n\n|g();\nfunction f() {}\n',
    );
    // The moved one's own goes with it, past what's above it.
    expect(moved('b();\n/** A. */\n|a();\n', true)).toBe('/** A. */\n|a();\nb();\n');
  });

  it('pass blank lines one at a time, and move a selection’s statements', () => {
    expect(moved('|a();\n\nb();\n', false)).toBe('\n|a();\nb();\n');
    expect(moved('a();\n\n|b();\n', true)).toBe('a();\n|b();\n\n');
    expect(moved('|a();\nb()|;\nc();\n', false)).toBe('c();\n|a();\nb()|;\n');
    // Not the line a selection ends at the start of.
    expect(moved('|a();\n|b();\nc();\n', false)).toBe('b();\n|a();\n|c();\n');
  });

  it('do nothing at the text’s ends, or read-only', () => {
    expect(moved('|a();\nb();\n', true)).toBeUndefined();
    expect(moved('a();\n|b();\n', false)).toBeUndefined();
    expect(moved('a();\n|b();', false)).toBeUndefined();
    expect(moved('a();\n|b();\n', true, 'a.ts', true)).toBeUndefined();
  });

  it('move the last statement’s lines past what’s after it at the top, comments or blank lines', () => {
    expect(moved('|a();\n\n', false)).toBe('\n|a();\n');
    expect(moved('\n\n|a();\n', true)).toBe('\n|a();\n\n');
    // Spaces to the end.
    expect(moved('|a();\n \n ', false)).toBe(' \n|a();\n ');
    // A blank line's, as a line.
    expect(moved('|\na();\n', false)).toBe('a();\n|\n');
    // The last line, with no line break after it.
    expect(moved('a();\n|b();', true)).toBe('|b();\na();\n');
  });

  it('move lines in another language, as Move Line', () => {
    expect(moved('a\n|b\nc', true, 'a.txt')).toBe('|b\na\nc');
    expect(moved('|a\nb', false, 'a.txt')).toBe('b\n|a');
    expect(moved('|a', true, 'a.txt')).toBeUndefined();
  });
});

describe('Move Statement’s keys in an editor', () => {
  it('run on IntelliJ’s, named for Undo', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
    document.body.append(container);
    const doc = new EditorDocument('a();\nb();\n');
    const handle = render(() => <CodeEditor path="a.ts" document={doc} />, container);
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-editor') as HTMLElement,
    ) as EditorView;
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
    await userEvent.keyboard('{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}');
    expect(view.state.doc.toString()).toBe('b();\na();\n');
    expect(historyNamesIn(view.contentDOM)?.undo).toBe('Move Statement Down');
    await userEvent.keyboard('{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}');
    expect(view.state.doc.toString()).toBe('a();\nb();\n');
    handle.dispose();
    container.remove();
  });
});
