// Move Statement in YAML, as IntelliJ's `YAMLStatementMover` (read from its source, and checked
// against its tests): the pairs of a block mapping, or the items of a block sequence, that the
// lines (or the selection) start and end in, whole, swapped with the one beside them; their indent
// left as it is. Where there's none beside them, or nothing to move, IntelliJ's `LineMover` takes
// over: the lines past the next, indented again.
//
// Lezer's tree isn't IntelliJ's: a sequence item's `-` is a node before it, not in it, so the two
// are taken together. A comment at a line's end is a node after its pair, the last on the line, so
// it moves with it. A comment's own line moves past the element beside it, as IntelliJ's counts a
// comment as an element (not among its `SPACE_ELEMENTS`).

import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { LineMover, type Lines } from './line-mover.js';

/** What IntelliJ's moves are within: `YAMLBlockMappingImpl` and `YAMLBlockSequenceImpl`. */
const SCOPES = new Set(['BlockMapping', 'BlockSequence']);

const same = (a: SyntaxNode, b: SyntaxNode) =>
  a.from === b.from && a.to === b.to && a.name === b.name;

/** Whether `node` is `inner`, or holds it (`PsiTreeUtil.isAncestor`). */
function holds(node: SyntaxNode, inner: SyntaxNode): boolean {
  for (let at: SyntaxNode | null = inner; at; at = at.parent) if (same(at, node)) return true;
  return false;
}

/** An element as IntelliJ's tree has it: its first and last node in Lezer's. */
interface Element {
  head: SyntaxNode;
  tail: SyntaxNode;
}

/** A node's element: a sequence item with its `-`; anything else, itself. */
function elementOf(node: SyntaxNode): Element {
  if (node.parent?.name !== 'BlockSequence') return { head: node, tail: node };
  // A `-` and its item go together in a block sequence: Lezer gives one without a value an empty
  // item.
  if (node.name === '-') return { head: node, tail: node.nextSibling as SyntaxNode };
  return { head: node.prevSibling as SyntaxNode, tail: node };
}

class YamlMover extends LineMover {
  protected override readonly indentTarget = false;

  /** The node at the first character that isn't a space at or after `pos` (`findNextAtOffset`). */
  private after(pos: number): SyntaxNode | undefined {
    const at = this.nonSpaceFrom(pos);
    return at === undefined ? undefined : this.tree.resolveInner(at, 1);
  }

  /** The node at the last character that isn't a space at or before `pos` (`findPrevAtOffset`). */
  private before(pos: number): SyntaxNode | undefined {
    const found = /\S\s*$/.exec(this.doc.sliceString(0, pos + 1));
    return found ? this.tree.resolveInner(found.index, 1) : undefined;
  }

  /**
   * The elements to move (`checkAvailable`): those at the two ends, or, where they differ, the
   * children of the mapping or sequence holding both that hold them.
   */
  private elements(first: SyntaxNode, last: SyntaxNode): [Element, Element] | undefined {
    // One token (Lezer's nodes there are the innermost, so neither holds another): a comment moves
    // among its mapping's or sequence's elements; another (a scalar) has none beside it in
    // IntelliJ's tree, which wraps it.
    if (same(first, last)) {
      if (first.name !== 'Comment' || !SCOPES.has((first.parent as SyntaxNode).name)) {
        return undefined;
      }
      return [elementOf(first), elementOf(first)];
    }
    let scope: SyntaxNode | null = first.parent;
    while (scope && !(holds(scope, last) && SCOPES.has(scope.name))) scope = scope.parent;
    if (!scope) return undefined;
    const within = scope;
    const child = (node: SyntaxNode) => {
      let at = node;
      while (!same(at.parent as SyntaxNode, within)) at = at.parent as SyntaxNode;
      return elementOf(at);
    };
    return [child(first), child(last)];
  }

  /** The element beside them, by its lines (`getDestinationScope`); none past the first or last. */
  private destination(moved: Lines, [first, last]: [Element, Element], down: boolean) {
    const line = down ? moved.end : moved.start - 1;
    if (line < 0 || line >= this.lineCount) return undefined;
    const beside = down ? last.tail.nextSibling : first.head.prevSibling;
    if (!beside) return undefined;
    const { head, tail } = elementOf(beside);
    return { start: this.lineOf(head.from), end: this.lineOf(tail.to) + 1 };
  }

  move(up: boolean): TransactionSpec | undefined {
    const { from, to, empty, head } = this.state.selection.main;
    const line = this.doc.lineAt(head);
    const first = this.after(empty ? line.from : from);
    const last = this.before(Math.max(0, (empty ? line.to : to) - 1));
    const found = first && last && this.elements(first, last);
    const lines = () => new LineMover(this.state).selectedLines(up);
    if (!found) return lines();
    const moved = {
      start: this.lineOf(found[0].head.from),
      end: this.lineOf(found[1].tail.to) + 1,
    };
    const dest = this.destination(moved, found, !up);
    return dest ? this.swap(moved, dest) : lines();
  }
}

/** The change Move Statement Up (or Down) makes in YAML; undefined where nothing moves. */
export function moveYamlStatement(state: EditorState, up: boolean): TransactionSpec | undefined {
  return new YamlMover(state).move(up);
}
