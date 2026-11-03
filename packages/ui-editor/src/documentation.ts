// The documentation of a symbol, as IntelliJ's Quick Documentation: what it is (its definition,
// highlighted as code) and what its comments say, from what's given (a language server, in the
// app). It shows with the pointer resting on the symbol (IntelliJ's "Show quick documentation on
// hover"), beside a problem's message there, and for the symbol at the caret on its keys (Ctrl+Q).
// It's Markdown, as servers send it, drawn as DOM nodes: HTML in it shows as text.

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
import { highlightCode } from '@lezer/highlight';
import { parser } from '@lezer/markdown';
import { codeLanguage } from './languages.js';
import type { Place } from './usages.js';

/** What a symbol is and what its comments say, as Markdown. */
export interface Documentation {
  text: string;
}

/** Asks for the documentation of the symbol at a place; nothing for none. */
export type AskDocumentation = (at: Place) => Promise<Documentation | null | undefined>;

/** Marks that are Markdown's syntax, not what it says. */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'URL',
  'LinkTitle',
  'LinkLabel',
  'ListMark',
  'HeaderMark',
  'QuoteMark',
]);

/** The element for each kind of node that is one. */
const ELEMENTS: Readonly<Record<string, string>> = {
  Paragraph: 'p',
  Emphasis: 'em',
  StrongEmphasis: 'strong',
  BulletList: 'ul',
  OrderedList: 'ol',
  ListItem: 'li',
  Blockquote: 'blockquote',
};

/** Nodes holding other blocks: the line breaks between them aren't text. */
const BLOCKS = new Set(['Document', 'BulletList', 'OrderedList', 'ListItem', 'Blockquote']);

/** An entity's character (`&nbsp;`), read by the browser's parser, which runs nothing. */
function entity(name: string): string {
  return new DOMParser().parseFromString(name, 'text/html').documentElement.textContent;
}

/** Code, highlighted as its language when it's known, in the editor's colours. */
function code(text: string, name: string, state: EditorState): HTMLElement {
  const pre = document.createElement('pre');
  pre.className = 'cerebro-doc__code';
  const language = codeLanguage(name);
  if (!language) {
    pre.textContent = text;
    return pre;
  }
  highlightCode(
    text,
    language.parser.parse(text),
    { style: (tags) => highlightingFor(state, tags) },
    (part, classes) => {
      const span = document.createElement('span');
      span.textContent = part;
      if (classes) span.className = classes;
      pre.append(classes ? span : part);
    },
    () => {
      pre.append('\n');
    },
  );
  return pre;
}

/** Draws a node of the Markdown's tree into `parent`. */
function draw(node: SyntaxNode, source: string, parent: Node, state: EditorState): void {
  const { name } = node;
  if (MARKS.has(name)) return;
  if (name === 'FencedCode' || name === 'CodeBlock') {
    const info = node.getChild('CodeInfo');
    const text = node.getChild('CodeText');
    parent.appendChild(
      code(
        text ? source.slice(text.from, text.to) : '',
        info ? source.slice(info.from, info.to) : '',
        state,
      ),
    );
    return;
  }
  if (name === 'HorizontalRule') {
    parent.appendChild(document.createElement('hr'));
    return;
  }
  if (name === 'HardBreak') {
    parent.appendChild(document.createElement('br'));
    return;
  }
  if (name === 'Escape') {
    parent.appendChild(document.createTextNode(source.slice(node.from + 1, node.to)));
    return;
  }
  if (name === 'Entity') {
    parent.appendChild(document.createTextNode(entity(source.slice(node.from, node.to))));
    return;
  }
  let element: HTMLElement | undefined;
  if (name === 'InlineCode') {
    element = document.createElement('code');
  } else if (name === 'Link') {
    // Shown as a link, its address on the pointer: opening it is to come.
    element = document.createElement('span');
    element.className = 'cerebro-doc__link';
    const url = node.getChild('URL');
    if (url) element.title = source.slice(url.from, url.to);
  } else if (name.startsWith('ATXHeading') || name.startsWith('SetextHeading')) {
    element = document.createElement('p');
    element.className = 'cerebro-doc__heading';
  } else {
    const tag = ELEMENTS[name];
    if (tag) element = document.createElement(tag);
  }
  const into = element ?? parent;
  // What's between the node's children is its text: in blocks, only the lines between them.
  const block = BLOCKS.has(name);
  // Next to a mark, without the space that sets it apart (`# Heading`).
  const text = (from: number, to: number, after: SyntaxNode | null, before: SyntaxNode | null) => {
    let part = source.slice(from, to);
    if (after && MARKS.has(after.name)) part = part.replace(/^[ \t]+/, '');
    if (before && MARKS.has(before.name)) part = part.replace(/[ \t]+$/, '');
    if (block ? part.trim() !== '' : part !== '') {
      into.appendChild(document.createTextNode(part.replace(/\n[ \t>]*/g, ' ')));
    }
  };
  let at = node.from;
  let previous: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text(at, child.from, previous, child);
    draw(child, source, into, state);
    at = child.to;
    previous = child;
  }
  text(at, node.to, previous, null);
  if (element) parent.appendChild(element);
}

/**
 * Documentation as IntelliJ shows it: a definition it starts with set apart above the rest, as
 * code; the rest as Markdown.
 */
export function documentationView(markdown: string, state: EditorState): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cerebro-doc';
  const tree = parser.parse(markdown);
  const blocks: SyntaxNode[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) blocks.push(child);
  const first = blocks[0];
  if (first?.name === 'FencedCode') {
    const definition = document.createElement('div');
    definition.className = 'cerebro-doc__definition';
    draw(first, markdown, definition, state);
    dom.append(definition);
    blocks.shift();
    // A rule after it (basedpyright's) would set it apart twice.
    if (blocks[0]?.name === 'HorizontalRule') blocks.shift();
  }
  if (blocks.length > 0) {
    const content = document.createElement('div');
    content.className = 'cerebro-doc__content';
    for (const block of blocks) draw(block, markdown, content, state);
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
