// Move Caret to Code Block Start and End, and each with Selection, as IntelliJ's
// (`CodeBlockStartAction`, `CodeBlockUtil`, read from its source). With the caret on an indent
// guide (its column the guide's, IntelliJ's `getCaretIndentGuide`), to where the guide starts or
// ends: the line it comes down from, or the line it stops at, at the guide's column; Start from
// the guide's own first line goes by the braces instead. Elsewhere, by the structural braces: back
// to the `{` the caret is inside, after it, or from just after a `}` to the `{` it closes, before
// it; on to the `}` the caret is inside, before it, or from just before a `{` to the `}` that
// closes it, after it. A brace in a string or a comment isn't one: the syntax tree's tokens are.
// The guides are IntelliJ's (`IndentGuides`, `IndentGuideCalculator`), computed as its editor
// does with them shown, its default, whether or not this editor draws them. The move is a place
// for Back (`includeCurrentCommandAsNavigation`), as the other jumps (`JUMP`).
//
// Which braces are structural is each language's brace matcher's in IntelliJ: JSON's are its
// braces and brackets (`JsonBraceMatcher`, read); the others' are taken to be their braces (a
// claim: JavaScript's and CSS's matchers aren't in IntelliJ's open source). A language's own
// `CodeBlockProvider` or `CodeBlockSupportHandler` (none read for these) isn't followed.

import { language, syntaxTree } from '@codemirror/language';
import {
  countColumn,
  EditorSelection,
  findColumn,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import type { Command } from '@codemirror/view';
import { JUMP } from './leaves.js';

/** IntelliJ's `IndentGuideDescriptor`, its lines zero-based, `endLine` past the guide. */
export interface IndentGuide {
  level: number;
  startLine: number;
  endLine: number;
}

/** A line's leading spaces and tabs. */
const leadingOf = (text: string) => (/^[ \t]*/.exec(text) as RegExpExecArray)[0];

/** The node type of the token at `pos`, the one starting there. */
const tokenAt = (state: EditorState, pos: number) =>
  syntaxTree(state).resolveInner(pos, 1).type.name;

/**
 * Each line's indent, as `IndentGuideCalculator`'s: a blank or commented line's negative, taken
 * from the lines around it (the one above's when the one below starts with a closing bracket).
 */
function lineIndents(state: EditorState): number[] {
  const { doc, tabSize } = state;
  const indents: number[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const leading = leadingOf(line.text);
    const blank = leading.length === line.text.length;
    const comment = !blank && /comment/i.test(tokenAt(state, line.from + leading.length));
    indents.push(blank || comment ? -1 : countColumn(leading, tabSize));
  }
  let top = 0;
  for (let line = 0; line < indents.length; line++) {
    if ((indents[line] as number) >= 0) {
      top = indents[line] as number;
      continue;
    }
    const start = line;
    while (line < indents.length && (indents[line] as number) < 0) line++;
    const bottom = line < indents.length ? (indents[line] as number) : top;
    let indent = Math.min(top, bottom);
    if (bottom < top) {
      const below = doc.line(line + 1);
      const first = below.from + leadingOf(below.text).length;
      if ([')', ']', '}'].includes(tokenAt(state, first))) indent = top;
    }
    for (let blank = start; blank < line; blank++) indents[blank] = -Math.min(top, indent);
    line--;
  }
  return indents;
}

/** The text's indent guides, as IntelliJ's `IndentGuides.buildDescriptors`. */
export function indentGuides(state: EditorState): IndentGuide[] {
  if (state.doc.length === 0) return [];
  const indents = lineIndents(state);
  const level = (line: number) => Math.abs(indents[line] as number);
  const guides: IndentGuide[] = [];
  const add = (indent: number, from: number, endLine: number) => {
    let startLine = from;
    while (startLine > 0 && (indents[startLine] as number) < 0) startLine--;
    guides.push({ level: indent, startLine, endLine });
  };
  const stack: { line: number; indent: number }[] = [{ line: 0, indent: 0 }];
  for (let line = 1; line < indents.length; line++) {
    const current = level(line);
    while (stack.length > 0 && current <= (stack.at(-1) as { indent: number }).indent) {
      const { line: start, indent } = stack.pop() as { line: number; indent: number };
      if (indent === 0) continue;
      for (let i = start; i < line; i++) {
        if (level(i) !== indent) {
          add(indent, start, line);
          break;
        }
      }
    }
    if (current - level(line - 1) > 1) stack.push({ line: line - 1, indent: level(line - 1) });
  }
  for (const { line, indent } of stack.reverse()) {
    if (indent > 0) add(indent, line, indents.length);
  }
  return guides;
}

/** The guide the caret is on: its column the guide's, on a line the guide runs down. */
function caretGuide(state: EditorState, head: number): IndentGuide | undefined {
  const line = state.doc.lineAt(head);
  const column = countColumn(line.text.slice(0, head - line.from), state.tabSize);
  const number = line.number - 1;
  if (column === 0) return undefined;
  return indentGuides(state).find(
    (g) => g.level === column && number >= g.startLine && number < g.endLine,
  );
}

/**
 * Where the guide's `line` is at its column, or the line's end if it's shorter; past the last line,
 * the text's end.
 */
function atColumn(state: EditorState, line: number, column: number): number {
  if (line >= state.doc.lines) return state.doc.length;
  const { from, text } = state.doc.line(line + 1);
  return from + findColumn(text, column, state.tabSize);
}

/** The structural braces, as tokens of the syntax tree, from the start or to the end. */
function braces(state: EditorState, from: number, to: number) {
  const pairs = state.facet(language)?.name === 'json' ? '{}[]' : '{}';
  const found: { from: number; to: number; open: boolean }[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      const at = pairs.indexOf(node.name);
      if (node.name.length === 1 && at >= 0 && node.to - node.from === 1) {
        found.push({ from: node.from, to: node.to, open: at % 2 === 0 });
      }
    },
  });
  return found.filter((b) => b.from >= from && b.to <= to);
}

/** `CodeBlockUtil.calcBlockStartOffsetFromBraceMatcher`: where Start goes by the braces. */
function braceStart(state: EditorState, head: number): number | undefined {
  const before = braces(state, 0, head).reverse();
  const first = before[0];
  const afterClose = first?.to === head && !first.open;
  let depth = afterClose ? -1 : 0;
  for (const brace of before) {
    if (brace.open) {
      // The brace just before the caret is where the walk starts, not one it reaches.
      if (brace.to === head) continue;
      if (depth === 0) return afterClose ? brace.from : brace.to;
      depth--;
    } else depth++;
  }
  return undefined;
}

/** `CodeBlockUtil.calcBlockEndOffsetFromBraceMatcher`: where End goes by the braces. */
function braceEnd(state: EditorState, head: number): number | undefined {
  const after = braces(state, head, state.doc.length);
  const first = after[0];
  const beforeOpen = first?.from === head && first.open;
  let depth = beforeOpen ? -1 : 0;
  for (const brace of after) {
    if (!brace.open) {
      if (brace.from === head) continue;
      if (depth === 0) return beforeOpen ? brace.to : brace.from;
      depth--;
    } else depth++;
  }
  return undefined;
}

/** Where a caret at `head` goes: the block's start, or its end; none when there's no block. */
function target(state: EditorState, head: number, end: boolean): number | undefined {
  const guide = caretGuide(state, head);
  if (end) return guide ? atColumn(state, guide.endLine, guide.level) : braceEnd(state, head);
  const line = state.doc.lineAt(head).number - 1;
  return guide && guide.startLine !== line
    ? atColumn(state, guide.startLine, guide.level)
    : braceStart(state, head);
}

/**
 * The move for each caret, to its block's start or end, selecting from where its selection started
 * when `select`. A caret with no block stays, as IntelliJ's: Start keeps its selection, End drops
 * it unless selecting.
 */
export function codeBlockMove(state: EditorState, end: boolean, select: boolean): TransactionSpec {
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => {
      const found = target(state, range.head, end);
      if (found === undefined && !end) return range;
      const head = found ?? range.head;
      return select ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
    }),
    state.selection.mainIndex,
  );
  return { selection, scrollIntoView: true, userEvent: JUMP };
}

/** The command: its keys are taken even when there's no block to go to. */
export function movingToCodeBlock(end: boolean, select: boolean): Command {
  return (view) => {
    view.dispatch(codeBlockMove(view.state, end, select));
    return true;
  };
}
