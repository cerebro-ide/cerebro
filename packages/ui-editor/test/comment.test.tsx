import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  blockComment,
  CodeEditor,
  EditorDocument,
  historyNamesIn,
  languageFor,
  lineComment,
} from '../src/index.js';
import { commentByLine } from '../src/comment.js';

/**
 * A TypeScript file's state, `|` for the caret, or `[` and `]` for a selection whose caret is at
 * its end (`]`), or `>` and `<` for one whose caret is at its start (`<`).
 */
function stateOf(text: string, path = 'a.ts', readOnly = false) {
  const marks = /[|[\]<>]/g;
  const at = (mark: string) =>
    text.replace(marks, (m) => (m === mark ? '\u0000' : '')).indexOf('\u0000');
  const doc = text.replace(marks, '');
  const selection = text.includes('|')
    ? EditorSelection.cursor(at('|'))
    : text.includes('[')
      ? EditorSelection.range(at('['), at(']'))
      : EditorSelection.range(at('<'), at('>'));
  return EditorState.create({
    doc,
    selection,
    extensions: [languageFor(path) ?? [], EditorState.readOnly.of(readOnly)],
  });
}

/** The text after a change, with its caret or selection marked as `stateOf` reads them. */
function after(state: EditorState, change: (s: EditorState) => unknown): string | undefined {
  const spec = change(state);
  if (spec === undefined) return undefined;
  const next = state.update(spec as Parameters<EditorState['update']>[0]).state;
  const { anchor, head } = next.selection.main;
  const doc = next.doc.toString();
  if (anchor === head) return `${doc.slice(0, head)}|${doc.slice(head)}`;
  const [from, to] = [Math.min(anchor, head), Math.max(anchor, head)];
  const [open, close] = head === to ? ['[', ']'] : ['<', '>'];
  return head === to
    ? `${doc.slice(0, from)}${open}${doc.slice(from, to)}${close}${doc.slice(to)}`
    : `${doc.slice(0, from)}${close}${doc.slice(from, to)}${open}${doc.slice(to)}`;
}

describe('Comment with Line Comment', () => {
  it('comments the caret’s line and moves the caret a line down, at its column after the comment', () => {
    expect(after(stateOf('a|bc;\nd;'), lineComment)).toBe('// abc;\nd;|');
    expect(after(stateOf('a|bc;\ndefgh;'), lineComment)).toBe('// abc;\ndefg|h;');
    // Back again: uncommented, the caret down.
    expect(after(stateOf('// a|bc;\nd;'), lineComment)).toBe('abc;\nd|;');
  });

  it('keeps the caret on the last line, and after the comment started on a blank one', () => {
    expect(after(stateOf('a;\nb|c;'), lineComment)).toBe('a;\n// b|c;');
    expect(after(stateOf('a;\n|\nb;'), lineComment)).toBe('a;\n// |\nb;');
  });

  it('comments a selection’s lines, the caret staying', () => {
    expect(after(stateOf('[a;\nb]c;'), lineComment)).toBe('// [a;\n// b]c;');
  });

  it('does nothing without line comments, or in a read-only editor', () => {
    expect(after(stateOf('{|}', 'a.json'), lineComment)).toBeUndefined();
    expect(after(stateOf('a|;', 'a.ts', true), lineComment)).toBeUndefined();
  });
});

describe('Comment with Block Comment', () => {
  it('puts an empty comment at the caret, the caret inside', () => {
    expect(after(stateOf('a|b;'), blockComment)).toBe('a/*|*/b;');
  });

  it('puts one in a line comment, which isn’t a block comment', () => {
    expect(after(stateOf('// a|b'), blockComment)).toBe('// a/*|*/b');
  });

  it('takes away the comment the caret is in', () => {
    expect(after(stateOf('a/* x| */b;'), blockComment)).toBe('a x| b;');
    expect(after(stateOf('a/*|*/b;'), blockComment)).toBe('a|b;');
  });

  it('puts a selection in a comment and selects it, the caret on its side', () => {
    expect(after(stateOf('a [bc] d;'), blockComment)).toBe('a [/*bc*/] d;');
    expect(after(stateOf('a >bc< d;'), blockComment)).toBe('a >/*bc*/< d;');
  });

  it('puts whole lines’ comment on lines of its own', () => {
    expect(after(stateOf('[a;\nb;\n]c;'), blockComment)).toBe('[/*\na;\nb;\n*/\n]c;');
    // To the end of the document's last line.
    expect(after(stateOf('a;\n[b;]'), blockComment)).toBe('a;\n[/*\nb;\n*/]');
  });

  it('takes away a comment a selection holds an end of, on its own lines too', () => {
    expect(after(stateOf('a [/*bc*/] d;'), blockComment)).toBe('a [bc] d;');
    expect(after(stateOf('a /*b[c*/ d];'), blockComment)).toBe('a b[c d];');
    expect(after(stateOf('[/*\na;\n*/\n]b;'), blockComment)).toBe('[a;\n]b;');
  });

  it('changes nothing for a selection inside a comment, which it would break', () => {
    expect(after(stateOf('/* a [b] c */'), blockComment)).toBeUndefined();
  });

  it('does nothing without block comments, or in a read-only editor', () => {
    expect(after(stateOf('{|}', 'a.json'), blockComment)).toBeUndefined();
    expect(after(stateOf('a|;', 'a.ts', true), blockComment)).toBeUndefined();
  });
});

describe('the comments’ commands', () => {
  it('say they did nothing where there’s nothing to do, so the key goes on', () => {
    const view = new EditorView({ state: stateOf('{|}', 'a.json') });
    expect(commentByLine(view)).toBe(false);
    view.destroy();
  });
});

describe('the comments’ keys in an editor', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it('comment on Ctrl+/ and Ctrl+Shift+/, as IntelliJ’s, and Undo names them', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const handle = render(
      () => <CodeEditor path="a.ts" document={new EditorDocument('a;\nb;')} />,
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
    await userEvent.keyboard('{Control>}/{/Control}');
    expect(view.state.doc.toString()).toBe('// a;\nb;');
    expect(historyNamesIn(content)?.undo).toBe('Comment with Line Comment');
    await userEvent.keyboard('{Control>}{Shift>}?{/Shift}{/Control}');
    expect(view.state.doc.toString()).toBe('// a;\nb;/**/');
    expect(historyNamesIn(content)?.undo).toBe('Comment with Block Comment');
  });
});
