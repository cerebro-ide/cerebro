// Move Statement in HTML, as IntelliJ's `XmlMover` (read from its source, and checked against its
// tests): a tag's attribute, on lines of its own, past the next; else the tags, comments and lines of
// text the lines start and end in, whole, past the one beside them, into a tag beside them that
// could hold them (one whose content has lines of its own), or out of their tag past its first or
// last line. Nothing moves past the file's only root tag. Where none of that applies, IntelliJ's
// `LineMover` moves the lines.
//
// IntelliJ's mover reads its XML tree (PSI); Lezer's is read as one (`Element`), each tag's start
// and closing tags' parts its own, text as words and the spaces between them, and the spaces between
// what Lezer has nodes for (in a start tag, between attributes) as PSI's white space. Two departures,
// Claude's choices, open to change:
// - Whether a tag could hold another is IntelliJ's HTML schema's word (`TagNameVariantCollector`);
//   here it's a table of the HTML standard's content models (`couldContain`): a claim, written from
//   the standard, not measured against IntelliJ's schema.
// - In a script's or a style's code, the lines move, where IntelliJ leaves it to the code's language.

import type { EditorState, TransactionSpec } from '@codemirror/state';
import { IterMode, type SyntaxNode } from '@lezer/common';
import { LineMover, type Lines } from './line-mover.js';

/** A node of IntelliJ's tree, as read from Lezer's: the parts Move Statement tells apart. */
interface Node {
  kind: 'document' | 'tag' | 'attribute' | 'text' | 'comment' | 'space' | 'token' | 'other';
  from: number;
  to: number;
  parent: Node | undefined;
  children: Node[];
  /** A tag's name, lower-cased; empty for anything else. */
  name: string;
  /** Where a tag's start tag ends (its `>`), and its closing tag starts (its `</`). */
  open?: number;
  close?: number;
  /** A tag that's `<tag/>` (`XmlTag.isEmpty`). */
  empty?: boolean;
  /** Text in another language: a script's or a style's code. */
  injected?: boolean;
}

interface Range {
  from: number;
  to: number;
}

/** What Lezer splits text into, and what holds another language's code. */
const TEXT = new Set(['Text', 'EntityReference', 'CharacterReference', 'InvalidEntity']);
const INJECTED = new Set(['ScriptText', 'StyleText']);
const TAG_PARTS = new Set(['OpenTag', 'CloseTag', 'SelfClosingTag']);

/** Lezer's children of `node`, not another language's tree in it. */
function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const cursor = node.cursor(IterMode.IgnoreMounts);
  const children: SyntaxNode[] = [];
  for (let more = cursor.firstChild(); more; more = cursor.nextSibling())
    children.push(cursor.node);
  return children;
}

const leaf = (kind: Node['kind'], from: number, to: number, parent: Node): Node => ({
  kind,
  from,
  to,
  parent,
  children: [],
  name: '',
});

/** IntelliJ's tree of the document `text`, from Lezer's (`tree`'s top node). */
function read(text: string, top: SyntaxNode): Node {
  const root: Node = {
    kind: 'document',
    from: 0,
    to: text.length,
    parent: undefined,
    children: [],
    name: '',
  };
  fill(root, top, text);
  return root;
}

/** Text: its words and the spaces between them; spaces alone are white space. */
function textOf(parent: Node, from: number, to: number, value: string): Node {
  if (!/\S/.test(value)) return leaf('space', from, to, parent);
  const node = leaf('text', from, to, parent);
  for (const part of value.matchAll(/\s+|\S+/g)) {
    const start = from + part.index;
    const kind = /\s/.test(part[0]) ? 'space' : 'token';
    node.children.push(leaf(kind, start, start + part[0].length, node));
  }
  return node;
}

function fill(node: Node, lezer: SyntaxNode, text: string): void {
  const parts: SyntaxNode[] = [];
  for (const child of childrenOf(lezer)) {
    if (node.kind !== 'tag' || !TAG_PARTS.has(child.name)) {
      parts.push(child);
      continue;
    }
    const inner = childrenOf(child);
    parts.push(...inner);
    const name = inner.find((part) => part.name === 'TagName');
    if (name && child.name !== 'CloseTag') node.name = text.slice(name.from, name.to).toLowerCase();
    if (child.name === 'OpenTag' && inner.at(-1)?.name === 'EndTag') node.open = child.to;
    if (child.name === 'CloseTag') node.close = child.from;
    if (child.name === 'SelfClosingTag' && text.slice(child.to - 2, child.to) === '/>') {
      node.empty = true;
    }
  }
  let at = node.from;
  const gap = (to: number) => {
    if (to > at) node.children.push(textOf(node, at, to, text.slice(at, to)));
  };
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as SyntaxNode;
    gap(part.from);
    let end = part.to;
    if (TEXT.has(part.name)) {
      // Text and the references in it, side by side, are one text, as IntelliJ's `XmlText`.
      for (let next = parts[i + 1]; next && TEXT.has(next.name); next = parts[++i + 1]) {
        end = next.to;
      }
      node.children.push(textOf(node, part.from, end, text.slice(part.from, end)));
    } else if (part.name === 'Element' || part.name === 'Attribute') {
      const child = leaf(part.name === 'Element' ? 'tag' : 'attribute', part.from, end, node);
      fill(child, part, text);
      node.children.push(child);
    } else if (INJECTED.has(part.name)) {
      const code = leaf('text', part.from, end, node);
      code.injected = true;
      code.children.push(leaf('token', part.from, end, code));
      node.children.push(code);
    } else if (part.name === 'Comment') {
      node.children.push(leaf('comment', part.from, end, node));
    } else {
      // A tag's own parts are its tokens; anything else (a doctype, an error) is none of the above.
      const kind = node.kind === 'tag' || node.kind === 'attribute' ? 'token' : 'other';
      node.children.push(leaf(kind, part.from, end, node));
    }
    at = end;
  }
  gap(node.to);
}

/** The leaf at `pos` (`PsiFile.findElementAt`); none at the end. */
function leafAt(root: Node, pos: number): Node | undefined {
  if (pos < root.from || pos >= root.to) return undefined;
  let node = root;
  for (;;) {
    const child = node.children.find((c) => c.from <= pos && pos < c.to);
    if (!child) return node;
    node = child;
  }
}

/** The leaf after (or before) `node` (`PsiTreeUtil.nextLeaf` and `prevLeaf`). */
function leafBeside(node: Node, forward: boolean): Node | undefined {
  for (let at = node; at.parent; at = at.parent) {
    const siblings = at.parent.children;
    const beside = siblings[siblings.indexOf(at) + (forward ? 1 : -1)];
    if (beside) {
      let found = beside;
      while (found.children.length > 0) {
        found = found.children[forward ? 0 : found.children.length - 1] as Node;
      }
      return found;
    }
  }
  return undefined;
}

/** `PsiTreeUtil.findFirstParent`, `node` itself first. */
function firstParent(node: Node | undefined, test: (node: Node) => boolean): Node | undefined {
  for (let at = node; at; at = at.parent) if (test(at)) return at;
  return undefined;
}

/** Whether `node` is `inner` or holds it (`PsiTreeUtil.isAncestor`, not strict). */
function holds(node: Node, inner: Node): boolean {
  return firstParent(inner, (at) => at === node) !== undefined;
}

/** `PsiTreeUtil.findCommonParent`. */
function commonParent(a: Node, b: Node): Node | undefined {
  return firstParent(a, (at) => holds(at, b));
}

const contains = (range: Range, inner: Range) => range.from <= inner.from && inner.to <= range.to;
const containsPos = (range: Range, pos: number) => range.from <= pos && pos < range.to;

/** A tag's content (`getTagContentRange`): between its start tag and its closing tag. */
function contentOf(tag: Node): Range {
  return { from: tag.open ?? tag.to, to: tag.close ?? tag.to };
}

/** IntelliJ's `XmlTagChild`: what a tag holds, and moves. */
const isMovable = (node: Node) =>
  node.kind === 'tag' || node.kind === 'text' || node.kind === 'comment';
/** What moves only as a whole (`isAtom`): text is split by lines. */
const isAtom = (node: Node) => node.kind !== 'text' && isMovable(node);

/** Text another language is in, holding `node` (`checkInjections`). */
function injected(node: Node): boolean {
  return firstParent(node.parent, (at) => at.kind === 'text')?.injected === true;
}

// The HTML standard's content models, as far as Move Statement asks (`couldContain`).
const LISTS = ['li', 'script', 'template'];
const ROWS = ['tr', 'script', 'template'];
/** Elements that go only in some parents. */
const PARENTS: Record<string, readonly string[]> = {
  li: ['ul', 'ol', 'menu'],
  dt: ['dl', 'div'],
  dd: ['dl', 'div'],
  tr: ['table', 'thead', 'tbody', 'tfoot'],
  td: ['tr'],
  th: ['tr'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['colgroup'],
  option: ['select', 'datalist', 'optgroup'],
  optgroup: ['select'],
  summary: ['details'],
  legend: ['fieldset'],
  figcaption: ['figure'],
  head: ['html'],
  body: ['html'],
  title: ['head'],
};
/** Parents that hold only some elements. */
const CHILDREN: Record<string, readonly string[]> = {
  ul: LISTS,
  ol: LISTS,
  menu: LISTS,
  dl: ['dt', 'dd', 'div', 'script', 'template'],
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'script', 'template'],
  thead: ROWS,
  tbody: ROWS,
  tfoot: ROWS,
  tr: ['td', 'th', 'script', 'template'],
  select: ['option', 'optgroup', 'hr', 'script', 'template'],
  optgroup: ['option', 'script', 'template'],
  colgroup: ['col', 'template'],
  html: ['head', 'body'],
  head: ['title', 'base', 'link', 'meta', 'style', 'script', 'noscript', 'template'],
};
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
/** Parents of phrasing content only, and the elements that aren't. */
const PHRASING = new Set([
  'p',
  ...HEADINGS,
  'pre',
  'span',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'small',
  'code',
  'label',
  'button',
  'abbr',
  'cite',
  'q',
  'sub',
  'sup',
  'mark',
  'time',
]);
const FLOW = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  ...HEADINGS,
  'header',
  'hgroup',
  'hr',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** Whether HTML lets `target` hold `moved`; an element it doesn't know, yes. */
function couldContain(target: Node, moved: Node): boolean {
  const parents = PARENTS[moved.name];
  if (parents && !parents.includes(target.name)) return false;
  const children = CHILDREN[target.name];
  if (children && !children.includes(moved.name)) return false;
  return !(PHRASING.has(target.name) && FLOW.has(moved.name));
}

/** What `move` makes of the lines: moved, nothing moved, or left to `LineMover`. */
type Found = { moved: Lines; other: Lines } | 'none' | 'lines';

class HtmlMover extends LineMover {
  private readonly root = read(this.doc.toString(), this.tree.topNode);
  private readonly text = this.doc.toString();

  private lineEnd(line: number) {
    return this.doc.line(line + 1).to;
  }

  /** `getEndLine`: the line after the range's last character. */
  private endLine(range: Range) {
    return this.lineOf(Math.max(range.from, range.to - 1)) + 1;
  }

  /** The range, spaces and line breaks taken off its ends (`getTrimmedRange`). */
  private trimmed(range: Range): Range {
    const all = this.text.slice(range.from, range.to);
    const from = range.to - all.replace(/^[ \t\n\r]*/, '').length;
    return { from, to: from + this.text.slice(from, range.to).replace(/[ \t\n\r]*$/, '').length };
  }

  /** Lines' range, trimmed; none for blank lines. */
  private trimmedLines(lines: Lines): Range | undefined {
    const range = this.trimmed({
      from: this.lineStart(lines.start),
      to: this.lineEnd(lines.end - 1),
    });
    return range.from === range.to ? undefined : range;
  }

  private isBlankLine(line: number) {
    return /^[ \t]*$/.test(this.doc.line(line + 1).text);
  }

  /** `getMeaningfulElementAtOffset`: past white space, then the first node `test` takes. */
  private meaningful(pos: number, forward: boolean, test: (node: Node) => boolean) {
    let node = leafAt(this.root, pos);
    if (node?.kind === 'space') node = leafBeside(node, forward);
    return firstParent(node, test);
  }

  /** The nodes `range` cuts into parts (`getCutElements`): not a tag whose content holds it. */
  private cut(range: Range): Node[] {
    const first = leafAt(this.root, range.from) as Node;
    const last = leafAt(this.root, range.to - 1) as Node;
    // The document holds them both.
    const common = commonParent(first, last) as Node;
    const found: Node[] = [];
    for (let at = first; at !== common; at = at.parent as Node) {
      if (isAtom(at) && at.from < range.from) found.push(at);
    }
    for (let at = last; at !== common; at = at.parent as Node) {
      if (isAtom(at) && this.trimmed(at).to > range.to) found.push(at);
    }
    for (let at: Node | undefined = common; at; at = at.parent) {
      if (at.kind === 'tag' && contains(contentOf(at), range)) break;
      if (isAtom(at) && !contains(range, this.trimmed(at))) found.push(at);
    }
    return found;
  }

  /** The lines grown until they hold each node they cut whole (`expandToWholeElements`). */
  private whole(lines: Lines): Lines | undefined {
    let result = lines;
    for (;;) {
      const range = this.trimmedLines(result);
      if (!range) return undefined;
      let { start, end } = result;
      for (const node of this.cut(range)) {
        const trimmed = this.trimmed(node);
        start = Math.min(start, this.lineOf(trimmed.from));
        end = Math.max(end, this.endLine(trimmed));
      }
      if (start === result.start && end === result.end) return result;
      result = { start, end };
    }
  }

  /**
   * The ancestor of `leaf` that's a child of the moved nodes' parent (`getMovedChild`): of the lowest
   * tag whose content holds them, else of the document. So the first and the last leaf's have one
   * parent, which IntelliJ's checks.
   */
  private movedChild(leaf: Node, moved: Range): Node {
    for (let node = leaf; ; node = node.parent as Node) {
      const parent = node.parent as Node;
      if (parent.kind === 'tag' ? contains(contentOf(parent), moved) : parent.kind === 'document') {
        return node;
      }
    }
  }

  /** Whether the moved nodes go into `target` (`canMoveInto`). */
  private canMoveInto(target: Node, moved: Node[]): boolean {
    if (target.empty) return false;
    const content = contentOf(target);
    if (content.from <= target.from || content.to >= target.to) return false;
    if (this.lineOf(content.from - 1) >= this.lineOf(content.to)) return false;
    return moved.every((node) => node.kind !== 'tag' || couldContain(target, node));
  }

  /** `moveAttribute`: an attribute's lines past the line beyond, or the attribute there. */
  private attribute(attribute: Node, toMove: Lines, toMove2: Lines, down: boolean): Found {
    let moved = toMove;
    let other = toMove2;
    // `updateMovedRegionEnd` and `updateMovedRegionStart`: the attribute's lines whole.
    if (attribute.to + 1 < this.doc.length) {
      const line = this.lineOf(attribute.to + 1);
      const delta = line - moved.end;
      moved = { start: moved.start, end: Math.max(line, moved.end) };
      if (delta > 0 && down) {
        other = {
          start: other.start + delta,
          end: Math.min(other.end + delta, this.doc.lines - 1),
        };
      }
    }
    const first = this.lineOf(attribute.from);
    const delta = moved.start - first;
    moved = { start: Math.min(first, moved.start), end: moved.end };
    if (delta > 0 && !down) other = { start: other.start - delta, end: other.end - delta };
    const destination = { from: this.lineStart(other.start), to: this.lineEnd(other.end - 1) };
    const tag = attribute.parent as Node;
    // Not into the tag's content, nor before its name.
    if (
      (down && destination.to >= contentOf(tag).from) ||
      (!down && destination.from <= tag.from)
    ) {
      return 'none';
    }
    const target = this.meaningful(
      down ? destination.to : destination.from,
      !down,
      (node) => node.kind === 'attribute',
    );
    if (target) {
      if (down) {
        // `updatedMovedIntoEnd`.
        if (target.to + 1 < this.doc.length) {
          const line = this.lineOf(target.to + 1);
          other = {
            start: other.start,
            end: Math.min(Math.max(line, other.end), this.doc.lines - 1),
          };
        }
      } else {
        other = { start: Math.min(this.lineOf(target.from), other.start), end: other.end };
      }
    }
    return { moved, other };
  }

  /**
   * `moveTagChildren`: tags, comments and lines of text, whole, into a tag beside them that could
   * hold them, else past it; out of their tag from its first or last child.
   */
  private children(lines: Lines, down: boolean): Found {
    const toMove = this.whole(lines);
    if (!toMove) return 'lines';
    const range = this.trimmedLines(toMove) as Range;
    const firstLeaf = leafAt(this.root, range.from) as Node;
    const lastLeaf = leafAt(this.root, range.to - 1) as Node;
    if (injected(firstLeaf) || injected(lastLeaf)) return 'lines';
    const first = this.movedChild(firstLeaf, range);
    const last = this.movedChild(lastLeaf, range);
    const parent = first.parent as Node;
    const siblings = parent.children;
    const moved: Node[] = [];
    for (const child of siblings.slice(siblings.indexOf(first), siblings.indexOf(last) + 1)) {
      if (child.kind === 'space') continue;
      if (!isMovable(child)) return 'lines';
      moved.push(child);
    }
    // Not the file's only root tag.
    if (
      parent.kind !== 'tag' &&
      moved.some((node) => node.kind === 'tag') &&
      parent.children.filter((child) => child.kind === 'tag').length < 2
    ) {
      return 'none';
    }
    const line = down ? toMove.end : toMove.start - 1;
    if (line < 0 || (down && line >= this.lineCount)) return 'none';
    if (this.isBlankLine(line)) return { moved: toMove, other: { start: line, end: line + 1 } };

    const { text } = this.doc.line(line + 1);
    const lineFrom = this.lineStart(line);
    const target = leafAt(
      this.root,
      down
        ? lineFrom + text.length - text.replace(/^[ \t]*/, '').length
        : lineFrom + text.replace(/[ \t]*$/, '').length - 1,
    ) as Node;
    let other: Lines;
    let entered: Node | undefined;
    if (
      parent.kind === 'tag' &&
      holds(parent, target) &&
      !containsPos(contentOf(parent), target.from)
    ) {
      // Out of the parent, past its start or closing tag.
      const parentRange = this.trimmed(parent);
      other = down
        ? { start: line, end: this.endLine(parentRange) }
        : { start: this.lineOf(parentRange.from), end: line + 1 };
    } else {
      const container = commonParent(parent, target) as Node;
      let sibling = target;
      while (sibling.parent !== container) sibling = sibling.parent as Node;
      if (sibling.kind === 'tag' && this.canMoveInto(sibling, moved)) {
        entered = sibling;
        const content = contentOf(sibling);
        other = down
          ? { start: line, end: this.lineOf(content.from - 1) + 1 }
          : { start: this.lineOf(content.to), end: line + 1 };
      } else if (isAtom(sibling)) {
        const siblingRange = this.trimmed(sibling);
        other = down
          ? { start: line, end: this.endLine(siblingRange) }
          : { start: this.lineOf(siblingRange.from), end: line + 1 };
      } else {
        other = { start: line, end: line + 1 };
      }
    }
    const destination = this.trimmedLines(other) as Range;
    for (const node of this.cut(destination)) {
      if (node !== parent && node !== entered) return 'none';
    }
    return { moved: toMove, other };
  }

  /** IntelliJ's `checkAvailable`: what the selected lines make. */
  private found(lines: Lines, down: boolean): Found {
    const toMove2 = down
      ? { start: lines.end, end: lines.end + 1 }
      : { start: lines.start - 1, end: lines.start };
    const start = this.lineStart(lines.start);
    const end = this.lineEnd(lines.end - 1);
    const sources = (node: Node) => node.kind === 'tag' || node.kind === 'attribute';
    const atStart = this.meaningful(start, true, sources);
    const atEnd = this.meaningful(Math.max(start, end - 1), false, sources);
    if (!atStart || !atEnd) return 'lines';
    if (atStart.kind === 'attribute' && atEnd === atStart) {
      return this.attribute(atStart, lines, toMove2, down);
    }
    return this.children(lines, down);
  }

  move(up: boolean): TransactionSpec | undefined {
    const lines = this.selected();
    // `LineMover`'s own check first: nothing past the first or last line.
    if (up ? lines.start === 0 : lines.end >= this.lineCount) return undefined;
    const found = this.found(lines, !up);
    if (found === 'lines') return this.lines(lines, up);
    return found === 'none' ? undefined : this.swap(found.moved, found.other);
  }
}

/** The change Move Statement Up (or Down) makes in HTML; undefined where nothing moves. */
export function moveHtmlStatement(state: EditorState, up: boolean): TransactionSpec | undefined {
  return new HtmlMover(state).move(up);
}
