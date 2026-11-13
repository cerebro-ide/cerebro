// The documentation of a symbol, as IntelliJ's Quick Documentation: what it is (its definition,
// highlighted as code) and what its comments say, from what's given (a language server, in the
// app). It shows with the pointer resting on the symbol (IntelliJ's "Show quick documentation on
// hover"), beside a problem's message there, and for the symbol at the caret on its keys (Ctrl+Q).
// It's Markdown, as servers send it, drawn as DOM nodes (markdown.ts): HTML in it shows as text.

import { highlightingFor } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  closeHoverTooltips,
  EditorView,
  hoverTooltip,
  keymap,
  showTooltip,
  type Command,
  type Tooltip,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/markdown';
import { drawMarkdown, type MarkdownStyle } from './markdown.js';
import type { Place } from './usages.js';

/** What a symbol is and what its comments say, as Markdown. */
export interface Documentation {
  text: string;
}

/** Asks for the documentation of the symbol at a place; nothing for none. */
export type AskDocumentation = (at: Place) => Promise<Documentation | null | undefined>;

/**
 * Documentation as IntelliJ shows it: a definition it starts with set apart above the rest, as
 * code; the rest as Markdown.
 */
export function documentationView(markdown: string, state: EditorState): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cerebro-doc';
  const style: MarkdownStyle = {
    highlighter: { style: (tags) => highlightingFor(state, tags) },
    headings: false,
  };
  const tree = parser.parse(markdown);
  const blocks: SyntaxNode[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) blocks.push(child);
  const first = blocks[0];
  if (first?.name === 'FencedCode') {
    const definition = document.createElement('div');
    definition.className = 'cerebro-doc__definition';
    drawMarkdown(first, markdown, definition, style);
    dom.append(definition);
    blocks.shift();
    // A rule after it (basedpyright's) would set it apart twice.
    if (blocks[0]?.name === 'HorizontalRule') blocks.shift();
  }
  if (blocks.length > 0) {
    const content = document.createElement('div');
    content.className = 'cerebro-doc__content';
    for (const block of blocks) drawMarkdown(block, markdown, content, style);
    dom.append(content);
  }
  return dom;
}

/** The place of a position in the editor, zero-based. */
function placeOf(state: EditorState, pos: number): Place {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1, column: pos - line.from };
}

/** The Quick Documentation shown for the caret's symbol, until the text or the caret changes. */
const show = StateEffect.define<Tooltip | null>();
const shown = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(show)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** Shows the documentation of the symbol at the caret, once it's had, if the caret's still there. */
function quickDocumentation(ask: AskDocumentation): Command {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const word = state.wordAt(head);
    void ask(placeOf(state, head)).then((found) => {
      if (!found || view.state.doc !== state.doc || view.state.selection.main.head !== head) {
        return;
      }
      // In place of the pointer's, as IntelliJ shows one.
      view.dispatch({
        effects: [
          closeHoverTooltips,
          show.of({
            pos: word?.from ?? head,
            create: (v) => {
              const dom = documentationView(found.text, v.state);
              dom.classList.add('cerebro-quickDoc');
              return { dom };
            },
          }),
        ],
      });
    });
    return true;
  };
}

/** Documentation from `ask`, on the pointer resting on a word (`documentationKeys` has the keys). */
export function documentation(ask: AskDocumentation): Extension {
  return [
    hoverTooltip(
      async (view, pos) => {
        const word = view.state.wordAt(pos);
        // None beside the Quick Documentation.
        if (!word || view.state.field(shown)) return null;
        const found = await ask(placeOf(view.state, pos));
        if (!found) return null;
        return {
          pos: word.from,
          end: word.to,
          create: (v) => ({ dom: documentationView(found.text, v.state) }),
        };
      },
      { hideOnChange: true },
    ),
    shown,
  ];
}

/** The keys that show the caret's symbol's documentation; Escape hides it. */
export function documentationKeys(ask: AskDocumentation, keys: readonly string[]): Extension {
  return keymap.of([
    ...keys.map((key) => ({ key, run: quickDocumentation(ask) })),
    {
      key: 'Escape',
      run: (view: EditorView) => {
        if (!view.state.field(shown)) return false;
        view.dispatch({ effects: show.of(null) });
        return true;
      },
    },
  ]);
}
