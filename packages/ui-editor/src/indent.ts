// How lines are indented, and a file's own indent detected as IntelliJ's "Detect and use existing
// file indents for editing" does (IndentOptionsDetectorImpl, IndentUsageStatisticsImpl,
// IndentOptionsAdjusterImpl): from the first 500 lines that start with code, each line's indent
// counted relative to the line it's nested in. Tabs, when more lines start with one than with
// spaces; else spaces, when more than 80% of the indented lines use them, as many as most of them
// add, when that's at most 8 and more than 80% of them add it. A file under 3 lines, or over 1 MB,
// isn't looked at. IntelliJ takes the lines its formatter starts a block on, leaving out comments
// and continuation lines; Cerebro, without that formatter, takes every line that doesn't start in
// a comment (a claim that it comes out the same for most files).

import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

/** How lines are indented: with a tab, or with `size` spaces. */
export interface Indent {
  tabs: boolean;
  size: number;
}

/** IntelliJ's status bar text for an indent: `4 spaces`, or `Tab`. */
export function indentText(indent: Indent): string {
  if (indent.tabs) return 'Tab';
  return `${String(indent.size)} ${indent.size === 1 ? 'space' : 'spaces'}`;
}

/** What indents a line: the text an indent unit inserts. */
export function indentUnitOf(indent: Indent): string {
  return indent.tabs ? '\t' : ' '.repeat(indent.size);
}

const MAX_LINES = 500;
const MAX_SIZE = 1024 * 1024;
const RATE = 0.8;
const MAX_INDENT = 8;

/** Counts the indents lines add to the lines they're nested in, as IntelliJ's statistics. */
class IndentUsage {
  tabs = 0;
  spaces = 0;
  /** How many lines add each indent. */
  readonly added = new Map<number, number>();
  private previous = 0;
  private previousAdded = 0;
  private readonly parents = [{ indent: 0, added: 0 }];

  line(indent: number): void {
    let added = indent - this.previous;
    if (added < 0) {
      while (
        this.parents.length > 1 &&
        (this.parents.at(-1) as { indent: number }).indent > indent
      ) {
        this.parents.pop();
      }
      const parent = this.parents.at(-1) as { indent: number; added: number };
      this.previous = parent.indent;
      this.previousAdded = parent.added;
      added = indent - this.previous;
    }
    if (added === 0) added = this.previousAdded;
    else this.parents.push({ indent, added });
    this.added.set(added, (this.added.get(added) ?? 0) + 1);
    this.previousAdded = added;
    this.previous = indent;
    if (indent > 0) this.spaces++;
  }

  /**
   * The indent most lines add, if it's clear enough. Asked once a line is indented: then a line
   * adds an indent, so one other than none is used.
   */
  size(): number | undefined {
    // Most used first; of two used as often, the larger.
    const used = [...this.added].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const [size, times] = (used[0]?.[0] === 0 ? used[1] : used[0]) as [number, number];
    return size <= MAX_INDENT && times / this.spaces > RATE ? size : undefined;
  }
}

/**
 * A file's indent, from its lines, as IntelliJ adjusts the settings' (`settings`) to it; undefined
 * when its lines don't tell.
 */
export function detectIndent(
  state: EditorState,
  settings: Indent,
  tabSize: number,
): Indent | undefined {
  const doc = state.doc;
  if (doc.lines < 3 || doc.length > MAX_SIZE) return undefined;
  const tree = syntaxTree(state);
  const usage = new IndentUsage();
  let counted = 0;
  for (let number = 1; number <= doc.lines && counted < MAX_LINES; number++) {
    const line = doc.line(number);
    const leading = line.text.slice(0, line.text.length - line.text.trimStart().length);
    if (leading.length === line.length) continue;
    if (/comment/i.test(tree.resolveInner(line.from + leading.length, 1).type.name)) continue;
    counted++;
    if (leading.includes('\t')) usage.tabs++;
    else usage.line(leading.length);
  }
  if (usage.tabs > usage.spaces) return { tabs: true, size: tabSize };
  if (usage.spaces === 0 || usage.spaces / (usage.spaces + usage.tabs) <= RATE) return undefined;
  return { tabs: false, size: usage.size() ?? settings.size };
}
