// Markdown drawn as DOM nodes from `@lezer/markdown`'s tree, for Quick Documentation (what language
// servers send) and a Markdown file's preview. HTML in it shows as text, so what's drawn can't put
// markup in the page; code blocks are highlighted by the editor's languages, when the block's name
// is one of them.

import type { SyntaxNode } from '@lezer/common';
import { highlightCode, type Highlighter } from '@lezer/highlight';
import { GFM, parser } from '@lezer/markdown';
import { codeLanguage } from './languages.js';

/** How a Markdown text is drawn. */
export interface MarkdownStyle {
  /** The classes of code's highlighted parts: the editor's colours. */
  highlighter: Highlighter;
  /** Headings as h1–h6, as a page's (the preview's); else as a paragraph set apart (a tooltip's). */
  headings: boolean;
  /**
   * An image's source (a `data:` URL: the page's policy allows no other) for its address; without
   * one, or until it comes, its words show.
   */
  image?: (address: string) => Promise<string | undefined>;
}

/** Marks that are Markdown's syntax, not what it says. */
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'LinkTitle',
  'LinkLabel',
  'ListMark',
  'HeaderMark',
  'QuoteMark',
  'StrikethroughMark',
  'TableDelimiter',
]);

/** The element for each kind of node that is one. */
const ELEMENTS: Readonly<Record<string, string>> = {
  Paragraph: 'p',
  Emphasis: 'em',
  StrongEmphasis: 'strong',
  Strikethrough: 's',
  BulletList: 'ul',
  OrderedList: 'ol',
  ListItem: 'li',
  Blockquote: 'blockquote',
  Table: 'table',
  TableHeader: 'tr',
  TableRow: 'tr',
};

/** Nodes holding other blocks: the line breaks between them aren't text. */
const BLOCKS = new Set([
  'Document',
  'BulletList',
  'OrderedList',
  'ListItem',
  'Blockquote',
  'Table',
  'TableHeader',
  'TableRow',
]);

/** GitHub's Markdown: tables, strikethrough, task lists and bare links, as a file's is written. */
export const gfmParser = parser.configure(GFM);

/** An entity's character (`&nbsp;`), read by the browser's parser, which runs nothing. */
function entity(name: string): string {
  return new DOMParser().parseFromString(name, 'text/html').documentElement.textContent;
}

/** Code, highlighted as its language when it's known. */
function code(text: string, name: string, highlighter: Highlighter): HTMLElement {
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
    highlighter,
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

/** A link's text, in the link colour, its address on the pointer: opening it is to come. */
function link(address: string | undefined): HTMLElement {
  const element = document.createElement('span');
  element.className = 'cerebro-doc__link';
  if (address !== undefined) element.title = address;
  return element;
}

/** An image: its words until its source comes, the image once it does. */
function image(
  node: SyntaxNode,
  source: string,
  load: NonNullable<MarkdownStyle['image']>,
): HTMLElement {
  const [open, close] = node.getChildren('LinkMark') as [SyntaxNode, SyntaxNode];
  const url = node.getChild('URL');
  // Its words are between `![` and `]`, which an image always has.
  const words = source.slice(open.to, close.from);
  const element = document.createElement('span');
  element.textContent = words;
  if (!url) return element;
  void load(source.slice(url.from, url.to)).then(
    (src) => {
      if (src === undefined) return;
      const img = document.createElement('img');
      img.src = src;
      img.alt = words;
      element.replaceChildren(img);
    },
    () => undefined,
  );
  return element;
}

/** The element a node is drawn as, if it's drawn as one rather than as its contents. */
function elementFor(
  node: SyntaxNode,
  source: string,
  style: MarkdownStyle,
): HTMLElement | undefined {
  const { name } = node;
  if (name === 'InlineCode') return document.createElement('code');
  if (name === 'Link') {
    const url = node.getChild('URL');
    return link(url ? source.slice(url.from, url.to) : undefined);
  }
  if (name === 'TableCell') {
    return document.createElement(node.parent?.name === 'TableHeader' ? 'th' : 'td');
  }
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
  if (heading) {
    if (style.headings) return document.createElement(`h${heading[1] as string}`);
    const element = document.createElement('p');
    element.className = 'cerebro-doc__heading';
    return element;
  }
  const tag = ELEMENTS[name];
  return tag === undefined ? undefined : document.createElement(tag);
}

/** Draws a node of the Markdown's tree into `parent`. */
export function drawMarkdown(
  node: SyntaxNode,
  source: string,
  parent: Node,
  style: MarkdownStyle,
): void {
  const { name } = node;
  if (MARKS.has(name)) return;
  if (name === 'URL') {
    // A link's or an image's address is its syntax; a bare one (GitHub's) is a link.
    const inside = node.parent?.name === 'Link' || node.parent?.name === 'Image';
    if (!inside) {
      const address = source.slice(node.from, node.to);
      const element = link(address);
      element.textContent = address;
      parent.appendChild(element);
    }
    return;
  }
  if (name === 'Image' && style.image) {
    parent.appendChild(image(node, source, style.image));
    return;
  }
  if (name === 'FencedCode' || name === 'CodeBlock') {
    const info = node.getChild('CodeInfo');
    const text = node.getChild('CodeText');
    parent.appendChild(
      code(
        text ? source.slice(text.from, text.to) : '',
        info ? source.slice(info.from, info.to) : '',
        style.highlighter,
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
  if (name === 'TaskMarker') {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.disabled = true;
    box.checked = /x/i.test(source.slice(node.from, node.to));
    parent.appendChild(box);
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
  const element = elementFor(node, source, style);
  const into = element ?? parent;
  // What's between the node's children is its text: in blocks, only the lines between them.
  const block = BLOCKS.has(name);
  // Next to a mark, without the space that sets it apart (`# Heading`, a line before `---`).
  const text = (from: number, to: number, after: SyntaxNode | null, before: SyntaxNode | null) => {
    let part = source.slice(from, to);
    if (after && MARKS.has(after.name)) part = part.replace(/^\s+/, '');
    if (before && MARKS.has(before.name)) part = part.replace(/\s+$/, '');
    if (block ? part.trim() !== '' : part !== '') {
      into.appendChild(document.createTextNode(part.replace(/\n[ \t>]*/g, ' ')));
    }
  };
  let at = node.from;
  let previous: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    text(at, child.from, previous, child);
    drawMarkdown(child, source, into, style);
    at = child.to;
    previous = child;
  }
  text(at, node.to, previous, null);
  if (element) parent.appendChild(element);
}
