// Code → Move Statement Up and Move Statement Down, as IntelliJ's (`MoveStatementUp`,
// `MoveStatementDown`; `MoveStatementHandler`, `MoverWrapper`, read from its source). The whole
// statements the caret's line or a selection's lines touch swap with what's above or below, and
// are indented again where they land (`MoveInfo.indentTarget`).
//
// IntelliJ asks each language's mover, then moves lines (`LineMover`, registered last).
// JavaScript's and TypeScript's mover isn't in its open source, so theirs here is a port of Java's
// (`JavaStatementMover`, `JavaDeclarationMover`, read), over CodeMirror's syntax tree (a claim that
// WebStorm's does the same):
// - A statement goes past the next line a statement, or a block's `}`, starts on (as
//   `calcInsertOffset`): into a block from its `{` line, out of it past its `}`, past blank lines
//   one at a time. Never out of its function or class, or into another (`checkMovingInsideOutside`):
//   then nothing moves.
// - A neighbour that holds a function or a class (not inside a nested block) is passed whole, as
//   Java's passes a statement holding an anonymous class (`getDestLineForAnonymous`). A function,
//   class or method moves whole from its first or last line, as Java's members.
// - A `/** … */` comment just above a statement moves with it, as Java's doc comment is part of
//   its member.
// - Lines that aren't whole statements (an argument's in a call over several lines) move as lines.
// JSON's is `JsonLineMover`'s port (`move-statement-json.ts`), YAML's `YAMLStatementMover`'s
// (`move-statement-yaml.ts`), HTML's `XmlMover`'s (`move-statement-html.ts`). Other languages'
// movers aren't ported: their lines move, as Move Line moves them.

import { language } from '@codemirror/language';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { atEachCaret, dispatching } from './command-change.js';
import { LineMover, type Lines } from './line-mover.js';
import { moveLine } from './move-line.js';
import { moveHtmlStatement } from './move-statement-html.js';
import { moveJsonStatement } from './move-statement-json.js';
import { moveYamlStatement } from './move-statement-yaml.js';

const SCRIPTS = new Set(['javascript', 'typescript', 'jsx', 'tsx']);
/** What holds statements (or a class's members), each child but its braces one. */
const CONTAINERS = new Set(['Script', 'Block', 'ClassBody']);
const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunction',
  'MethodDeclaration',
]);
/** What a statement can't move into or out of, as Java's methods and classes. */
const GUARDS = new Set([...FUNCTIONS, 'ClassDeclaration', 'ClassExpression']);
/** What moves whole from its first or last line, as Java's members. */
const DECLARATIONS = new Set([
  ...GUARDS,
  'ExportDeclaration',
  'PropertyDeclaration',
  'InterfaceDeclaration',
  'TypeAliasDeclaration',
  'EnumDeclaration',
]);

const same = (a: SyntaxNode, b: SyntaxNode) =>
  a.from === b.from && a.to === b.to && a.type === b.type;

const isBrace = (node: SyntaxNode) => node.name === '{' || node.name === '}';

/** A statement (or a member, or a comment among them): a child of a container, but a brace. */
const isUnit = (node: SyntaxNode) =>
  !isBrace(node) && node.parent !== null && CONTAINERS.has(node.parent.name);

/** A container's statements, in order. */
function unitsOf(container: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  for (let child = container.firstChild; child; child = child.nextSibling) {
    if (!isBrace(child)) found.push(child);
  }
  return found;
}

/** The statements' container `node` is in: the top one (`Script`) at the latest. */
function containerOf(node: SyntaxNode): SyntaxNode {
  let up = node.parent as SyntaxNode;
  while (!CONTAINERS.has(up.name)) up = up.parent as SyntaxNode;
  return up;
}

/** Whether a function or a class is in `node`, not counting one in a block inside it. */
function holdsGuard(node: SyntaxNode): boolean {
  if (GUARDS.has(node.name)) return true;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!CONTAINERS.has(child.name) && holdsGuard(child)) return true;
  }
  return false;
}

/** A doc comment (`/** … *\/`) just above `unit`, on the line before it. */
function docOf(state: EditorState, unit: SyntaxNode): SyntaxNode | undefined {
  const before = unit.prevSibling;
  if (before?.name !== 'BlockComment') return undefined;
  if (!state.sliceDoc(before.from, before.from + 3).startsWith('/**')) return undefined;
  const { doc } = state;
  return doc.lineAt(before.to).number + 1 === doc.lineAt(unit.from).number ? before : undefined;
}

class Mover extends LineMover {
  /** The lines a statement takes, with its doc comment. */
  linesOf(unit: SyntaxNode): Lines {
    const from = docOf(this.state, unit)?.from ?? unit.from;
    return { start: this.lineOf(from), end: this.lineOf(unit.to) + 1 };
  }

  /**
   * The statements the lines hold whole, the lines grown to cover what they start or end in
   * (`expandLineRangeToCoverPsiElements`, `findStatementsInRange`); none for parts of one.
   */
  statements(lines: Lines): { lines: Lines; units: SyntaxNode[] } | undefined {
    const text = this.doc.sliceString(this.lineStart(lines.start), this.lineStart(lines.end));
    const lead = /\S/.exec(text);
    if (!lead) return undefined;
    const from = this.lineStart(lines.start) + lead.index;
    const to = this.lineStart(lines.start) + text.trimEnd().length;
    const first = this.tree.resolveInner(from, 1);
    const last = this.tree.resolveInner(to, -1);
    const common = this.commonOf(first, last);
    const [one, two] = [first, last].map((node) => this.childOf(common, node)) as [
      SyntaxNode,
      SyntaxNode,
    ];
    const grown: Lines = {
      start: Math.min(lines.start, this.lineOf(one.from)),
      end: Math.max(lines.end, this.lineOf(two.to) + 1),
    };
    const container = CONTAINERS.has(common.name) ? common : containerOf(common);
    const start = this.lineStart(grown.start);
    const end = this.lineStart(grown.end);
    const touched = unitsOf(container).filter((u) => u.to > start && u.from < end);
    if (touched.length > 0 && touched.every((u) => u.from >= start && u.to <= end)) {
      return this.withDocs(touched, grown);
    }
    return this.declaration(first, lines);
  }

  /** The units with the doc comment above the first, and the statement below a last one. */
  private withDocs(units: SyntaxNode[], lines: Lines) {
    const last = units.at(-1) as SyntaxNode;
    const next = last.nextSibling;
    const all = next && isUnit(next) && docOf(this.state, next) ? [...units, next] : units;
    const first = this.linesOf(all[0] as SyntaxNode);
    const end = this.lineOf((all.at(-1) as SyntaxNode).to) + 1;
    return {
      lines: { start: Math.min(lines.start, first.start), end: Math.max(lines.end, end) },
      units: all,
    };
  }

  /** A function, class or member the lines start or end, moved whole (`isInsideDeclaration`). */
  private declaration(from: SyntaxNode, lines: Lines) {
    let unit: SyntaxNode | null = from;
    while (unit && !isUnit(unit)) unit = unit.parent;
    if (!unit || !DECLARATIONS.has(unit.name)) return undefined;
    const own = this.linesOf(unit);
    if (own.start !== lines.start && own.end !== lines.end) return undefined;
    return { lines: own, units: [unit] };
  }

  private commonOf(a: SyntaxNode, b: SyntaxNode): SyntaxNode {
    const above: SyntaxNode[] = [];
    for (let node: SyntaxNode | null = a; node; node = node.parent) above.push(node);
    // Both are in the tree's top node, at the latest.
    for (let node = b; ; node = node.parent as SyntaxNode) {
      const found = above.find((other) => same(other, node));
      if (found) return found;
    }
  }

  /** `node`'s ancestor that's a child of `parent`; `parent` itself if `node` is it. */
  private childOf(parent: SyntaxNode, node: SyntaxNode): SyntaxNode {
    let child = node;
    while (child.parent && !same(child.parent, parent) && !same(child, parent)) {
      child = child.parent;
    }
    return child;
  }

  /** Whether a statement, or a block's `}`, starts the line (`calcInsertOffset`'s test). */
  landsOn(line: number): boolean {
    const start = this.lineStart(line);
    const at = this.nonSpaceFrom(start);
    if (at === undefined) return false;
    for (let node: SyntaxNode | null = this.tree.resolveInner(at, 1); node; node = node.parent) {
      if (node.from < start) continue;
      if (isUnit(node)) return true;
      if (node.name === '}' && node.parent?.name === 'Block') return true;
    }
    return false;
  }

  /** The function body or class body `pos` is inside; null outside all. */
  scopeAt(pos: number): string | null {
    for (let node: SyntaxNode | null = this.tree.resolveInner(pos, 1); node; node = node.parent) {
      const body =
        node.name === 'ClassBody' ||
        (node.name === 'Block' && node.parent !== null && FUNCTIONS.has(node.parent.name));
      if (body && node.from < pos && pos < node.to) return `${String(node.from)}:${node.name}`;
    }
    return null;
  }

  /**
   * What the statements swap with: a neighbour holding a function or class whole, a blank line
   * before it one at a time when there are more; else the lines to the next statement's line.
   */
  target(lines: Lines, units: SyntaxNode[], up: boolean): Lines | undefined {
    const near = up
      ? (units[0] as SyntaxNode).prevSibling
      : (units.at(-1) as SyntaxNode).nextSibling;
    // A doc comment goes with what it's above.
    const neighbour =
      near && up && docOf(this.state, units[0] as SyntaxNode) ? near.prevSibling : near;
    if (neighbour && isUnit(neighbour) && holdsGuard(neighbour)) {
      const whole = this.linesOf(neighbour);
      const gap = up ? lines.start - whole.end : whole.start - lines.end;
      if (gap > 1)
        return up
          ? { start: lines.start - 1, end: lines.start }
          : { start: lines.end, end: lines.end + 1 };
      return whole;
    }
    if (up) {
      for (let line = lines.start - 1; line >= 0; line--) {
        if (this.landsOn(line)) return { start: line, end: lines.start };
      }
    } else {
      for (let line = lines.end + 1; line < this.lineCount; line++) {
        if (this.landsOn(line)) return { start: lines.end, end: line };
      }
    }
    return undefined;
  }

  move(up: boolean): TransactionSpec | undefined {
    const chosen = this.selected();
    if (up ? chosen.start === 0 : chosen.end >= this.lineCount) return undefined;
    const found = this.statements(chosen);
    if (!found) return this.lines(chosen, up);
    const { lines, units } = found;
    if (up ? lines.start === 0 : lines.end >= this.lineCount) return undefined;
    const other = this.target(lines, units, up);
    // Only blank lines or comments beyond: at the top, they're passed as lines; in a block or a
    // class, they'd take the statement past its `}`, which IntelliJ's won't (Java's movers).
    if (!other)
      return (units[0] as SyntaxNode).parent?.name === 'Script' ? this.lines(lines, up) : undefined;
    const insert = this.lineStart(up ? other.start : other.end);
    if (this.scopeAt(insert) !== this.scopeAt((units[0] as SyntaxNode).from)) return undefined;
    return this.swap(lines, other);
  }
}

/** The change Move Statement Up (or Down) makes; undefined where nothing moves. */
export function moveStatement(state: EditorState, up: boolean): TransactionSpec | undefined {
  if (state.readOnly) return undefined;
  const name = state.facet(language)?.name ?? '';
  // At each caret, as IntelliJ's; down from the last, so one caret's lines don't take another's.
  const one = (alone: EditorState) =>
    name === 'json'
      ? moveJsonStatement(alone, up)
      : name === 'yaml'
        ? moveYamlStatement(alone, up)
        : name === 'html'
          ? moveHtmlStatement(alone, up)
          : SCRIPTS.has(name)
            ? new Mover(alone).move(up)
            : moveLine(alone, up);
  const made = atEachCaret(state, one, !up);
  return (
    made && {
      ...made,
      scrollIntoView: true,
      userEvent: up ? 'move.statement.up' : 'move.statement.down',
    }
  );
}

/** IntelliJ's `MoveStatementUp` and `MoveStatementDown`, as CodeMirror commands. */
export const moveStatementsUp = dispatching((state) => moveStatement(state, true));
export const moveStatementsDown = dispatching((state) => moveStatement(state, false));
