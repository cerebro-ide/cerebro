import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  codeBlockMove,
  CodeEditor,
  EditorDocument,
  indentGuides,
  languageFor,
} from '../src/index.js';

const CODE = ['function f() {', '  if (x) {', '    a("{");', '  }', '  b();', '}', ''].join('\n');

const stateOf = (doc: string, anchor: number, head = anchor, path = 'a.ts') =>
  EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: [languageFor(path) ?? []],
  });

/** Where the caret goes from `at`, as text up to it: to the block's end with `end`. */
function moved(doc: string, at: number, end: boolean, path?: string) {
  const state = stateOf(doc, at, at, path);
  const next = state.update(codeBlockMove(state, end, false)).state;
  return next.selection.main.head;
}

/** Where `text` is in CODE, or just after it with `after`. */
const at = (text: string, after = false) => CODE.indexOf(text) + (after ? text.length : 0);

describe('Move Caret to Code Block Start and End', () => {
  it('go by the braces: after the `{` the caret’s inside, before its `}`; a string’s isn’t one', () => {
    const inA = at('a("') + 2;
    expect(moved(CODE, inA, false)).toBe(at('if (x) {', true));
    expect(moved(CODE, inA, true)).toBe(at('\n  }\n') + 3);
    // Out of the `if`: the function's.
    expect(moved(CODE, at('b()'), false)).toBe(at('f() {', true));
    expect(moved(CODE, at('b()'), true)).toBe(CODE.lastIndexOf('}'));
    // Past a block on the way.
    expect(moved(CODE, at('  if'), true)).toBe(CODE.lastIndexOf('}'));
  });

  it('go from a brace to the one it pairs with: after a `}` to before its `{`, and back', () => {
    const close = at('\n  }\n') + 3;
    expect(moved(CODE, close + 1, false)).toBe(at('{\n    a'));
    expect(moved(CODE, at('{\n    a'), true)).toBe(close + 1);
    // Just after a `{`, or just before a `}`: the block around it.
    expect(moved(CODE, at('if (x) {', true), false)).toBe(at('f() {', true));
    expect(moved(CODE, close, true)).toBe(CODE.lastIndexOf('}'));
  });

  it('go by the indent guide the caret is on, to the line it comes down from or stops at', () => {
    // Line 2's column 2, on the `if`'s guide: its line and its `}` line, at that column.
    const onGuide = at('    a') + 2;
    expect(moved(CODE, onGuide, false)).toBe(at('if'));
    expect(moved(CODE, onGuide, true)).toBe(at('\n  }\n') + 3);
    // On the guide's first line, Start goes by the braces.
    expect(moved(CODE, at('if'), false)).toBe(at('f() {', true));
    expect(moved(CODE, at('if'), true)).toBe(at('\n  }\n') + 3);
  });

  it('stay where there’s no block: Start keeping the selection, End dropping it', () => {
    const doc = 'const x = 1;';
    let state = stateOf(doc, 0, 5);
    state = state.update(codeBlockMove(state, false, false)).state;
    expect(state.selection.main).toMatchObject({ anchor: 0, head: 5 });
    state = state.update(codeBlockMove(state, true, false)).state;
    expect(state.selection.main).toMatchObject({ anchor: 5, head: 5 });
    // Plain text has no braces.
    expect(moved('{ a }', 2, false, 'a.txt')).toBe(2);
  });

  it('select from where the selection started, with Selection, every caret', () => {
    const inA = at('a("') + 2;
    let state = EditorState.create({
      doc: CODE,
      selection: EditorSelection.create([
        EditorSelection.range(inA - 1, inA),
        EditorSelection.cursor(at('b()')),
      ]),
      extensions: [languageFor('a.ts') ?? [], EditorState.allowMultipleSelections.of(true)],
    });
    state = state.update(codeBlockMove(state, true, true)).state;
    expect(state.selection.ranges.map((r) => [r.anchor, r.head])).toEqual([
      [inA - 1, at('\n  }\n') + 3],
      [at('b()'), CODE.lastIndexOf('}')],
    ]);
  });

  it('take JSON’s brackets as blocks too, as its brace matcher', () => {
    const json = '{"a": [1, 2]}';
    expect(moved(json, json.indexOf('2'), false, 'a.json')).toBe(json.indexOf('[') + 1);
    expect(moved(json, json.indexOf('2'), true, 'a.json')).toBe(json.indexOf(']'));
  });

  it('go to the text’s end by a guide that runs to it', () => {
    const doc = 'x\n  a\n    b\n    c';
    const onGuide = doc.indexOf('    c') + 2;
    expect(moved(doc, onGuide, true)).toBe(doc.length);
    expect(moved(doc, onGuide, false)).toBe(doc.indexOf('a'));
  });
});

describe('indentGuides', () => {
  const guides = (doc: string) => indentGuides(stateOf(doc, 0));

  it('are IntelliJ’s: one at each level a block is indented from, from its line to its end', () => {
    expect(guides(CODE)).toEqual([{ level: 2, startLine: 1, endLine: 3 }]);
    expect(guides('')).toEqual([]);
  });

  it('take a blank or commented line’s indent from the lines around it', () => {
    // Before a closing brace, the line above's: the guide runs on to the `}`.
    expect(guides('g {\n  f {\n    a\n\n  }\n}')).toEqual([{ level: 2, startLine: 1, endLine: 4 }]);
    // Else the smaller one's; a comment is as blank (as code, it would run the guide on).
    expect(guides('g {\n  f {\n    a\n    // c\n  b\n}')).toEqual([
      { level: 2, startLine: 1, endLine: 3 },
    ]);
    // A guide doesn't start on a blank line, but at the one above it.
    expect(guides('  a\n\n      b\n  c')).toEqual([{ level: 2, startLine: 0, endLine: 3 }]);
  });
});

describe('in the editor', () => {
  it('runs on its keys, a place for Back', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
    document.body.append(container);
    const onLeave = vi.fn();
    const handle = render(
      () => <CodeEditor path="a.ts" document={new EditorDocument(CODE)} onLeave={onLeave} />,
      container,
    );
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-editor') as HTMLElement,
    ) as EditorView;
    view.focus();
    view.dispatch({ selection: { anchor: at('b()') } });
    await userEvent.keyboard('{Control>}]{/Control}');
    expect(view.state.selection.main.head).toBe(CODE.lastIndexOf('}'));
    expect(onLeave).toHaveBeenCalledWith({ line: 4, column: 2 });
    // `{`, as a keyboard sends Shift+[ (Ctrl+[ would be Start's).
    await userEvent.keyboard('{Control>}{Shift>}{{{/Shift}{/Control}');
    expect(view.state.selection.main).toMatchObject({
      anchor: CODE.lastIndexOf('}'),
      head: at('f() {', true),
    });
    handle.dispose();
    container.remove();
  });
});
