// What Move Statement's movers share, as IntelliJ's movers share `LineMover` and `MoverWrapper`
// (read from its source): the lines to move, the two runs of lines swapped, a mover's own changes
// after that (`afterMove`), then the moved lines indented again where they land
// (`MoveInfo.indentTarget`).

import { ensureSyntaxTree, indentRange, syntaxTree } from '@codemirror/language';
import {
  ChangeSet,
  EditorSelection,
  type EditorState,
  type Text,
  type TransactionSpec,
} from '@codemirror/state';
import type { Tree } from '@lezer/common';

/** Lines, zero-based, `end` past them: IntelliJ's `LineRange`. */
export interface Lines {
  start: number;
  end: number;
}

/**
 * A mover's own changes once the lines are swapped (IntelliJ's `afterMove`), to the document as
 * it is then.
 */
export type AfterMove = (placed: EditorState) => ChangeSet;

export class LineMover {
  protected readonly doc: Text;
  protected readonly tree: Tree;

  constructor(protected readonly state: EditorState) {
    this.doc = state.doc;
    this.tree = syntaxTree(state);
  }

  lineOf(pos: number) {
    return this.doc.lineAt(pos).number - 1;
  }

  lineStart(line: number) {
    return line >= this.doc.lines ? this.doc.length : this.doc.line(line + 1).from;
  }

  /** The lines there are to move past: a last line left empty by a line break isn't one. */
  get lineCount() {
    const { doc } = this;
    return doc.line(doc.lines).length === 0 ? doc.lines - 1 : doc.lines;
  }

  /** The first non-space character at or after `pos`, across lines; undefined at the end. */
  nonSpaceFrom(pos: number): number | undefined {
    const found = /\S/.exec(this.doc.sliceString(pos));
    return found ? pos + found.index : undefined;
  }

  /** IntelliJ's `getLineRangeFromSelection`: a line a selection ends at the start of is out. */
  selected(): Lines {
    const { from, to, empty } = this.state.selection.main;
    const start = this.lineOf(from);
    const last = this.lineOf(to);
    const end = !empty && last > start && this.lineStart(last) === to ? last : last + 1;
    return { start, end };
  }

  /**
   * The two runs of lines swapped, the mover's own changes made (`after`), and the moved ones
   * indented again where they land.
   */
  swap(moved: Lines, other: Lines, after?: AfterMove): TransactionSpec {
    const { state } = this;
    const chunk = (lines: Lines) => {
      const text = this.doc.sliceString(this.lineStart(lines.start), this.lineStart(lines.end));
      // One character, as the document counts any line break; written in its own as it's saved.
      return text.endsWith('\n') ? text : `${text}\n`;
    };
    const [top, bottom] = moved.start < other.start ? [moved, other] : [other, moved];
    const topFrom = this.lineStart(top.start);
    const topTo = this.lineStart(top.end);
    const bottomFrom = this.lineStart(bottom.start);
    const bottomTo = this.lineStart(bottom.end);
    const swapped = ChangeSet.of(
      [
        { from: topFrom, to: topTo, insert: chunk(bottom) },
        { from: bottomFrom, to: bottomTo, insert: chunk(top) },
      ],
      this.doc.length,
    );
    const text = chunk(moved);
    const movedFrom =
      moved === top ? topFrom + chunk(bottom).length + (bottomFrom - topTo) : topFrom;
    const shift = movedFrom - this.lineStart(moved.start);
    const placed = state.update({ changes: swapped }).state;
    const own = after ? after(placed) : ChangeSet.empty(placed.doc.length);
    const fixed = state.update({ changes: swapped.compose(own) }).state;
    // The moved lines, their line break left out, as the mover's own changes left them.
    const from = own.mapPos(movedFrom, -1);
    const to = own.mapPos(movedFrom + text.length - 1, 1);
    ensureSyntaxTree(fixed, to, 200);
    const indented = indentRange(fixed, from, to);
    const { anchor, head } = state.selection.main;
    const map = (pos: number) => indented.mapPos(own.mapPos(pos + shift, 1), 1);
    return {
      changes: swapped.compose(own).compose(indented),
      // On the characters they were on, past an indent put before them.
      selection: EditorSelection.range(map(anchor), map(head)),
      scrollIntoView: true,
    };
  }

  /** The lines swapped with the line beyond them, as IntelliJ's `LineMover`; there's one. */
  lines(lines: Lines, up: boolean, after?: AfterMove): TransactionSpec {
    return this.swap(
      lines,
      up ? { start: lines.start - 1, end: lines.start } : { start: lines.end, end: lines.end + 1 },
      after,
    );
  }
}
