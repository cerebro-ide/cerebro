// A file's diff in one editor, as IntelliJ's unified viewer (UnifiedDiffViewer): the current text,
// with each change's removed lines above its added ones, in IntelliJ's colours (removed as deleted,
// added as inserted, their changed text in the full colour), and two columns of line numbers, the
// left's and the right's. As IntelliJ builds it (UnifiedFragmentBuilder): unchanged lines are the
// right's, the master side. Collapse Unchanged Fragments and Previous and Next Difference as the
// side-by-side viewer's; read-only.

import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSet,
  StateEffect,
  Text,
  type Extension,
  type Range,
} from '@codemirror/state';
import { Decoration, EditorView, gutter, GutterMarker, type ViewUpdate } from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal } from '@cerebro-ide/reactive';
import { compare, type Change, type LineRange } from './compare.js';
import {
  diffs,
  diffTheme,
  Fold,
  foldedLines,
  LAYOUT,
  MARKS,
  marks,
  setMarks,
  type DiffEditorProps,
} from './diff.js';
import { gutterObstacle, highlight, scroller, selection, theme } from './editor.js';
import { appearance } from './appearance.js';
import { languageFor } from './languages.js';
import { fullWidth } from './width.js';

/** The two texts as one: IntelliJ's unified diff. */
export interface Unified {
  text: string;
  /** Each line's line on the left and on the right, zero-based: none where it isn't on that side. */
  lines: readonly { a: number | undefined; b: number | undefined }[];
  /** Each change's lines: removed from `start` to `middle`, added from `middle` to `end`. */
  blocks: readonly { start: number; middle: number; end: number; change: Change }[];
}

/**
 * `a` and `b` as one text, with `changes` between them, as IntelliJ's `UnifiedFragmentBuilder`:
 * unchanged lines from the right, each change's left lines, then its right ones. Where unchanged
 * runs differ in length (blank lines ignored), the left's lines are numbered while it has them.
 */
export function unify(a: Text, b: Text, changes: readonly Change[]): Unified {
  const text: string[] = [];
  const lines: Unified['lines'][number][] = [];
  const blocks: Block[] = [];
  let [lineA, lineB] = [0, 0];
  const add = (doc: Text, line: number, numbers: Unified['lines'][number]) => {
    text.push(doc.line(line + 1).text);
    lines.push(numbers);
  };
  const equal = (toA: number, toB: number) => {
    for (let i = 0; lineB + i < toB; i++) {
      add(b, lineB + i, { a: lineA + i < toA ? lineA + i : undefined, b: lineB + i });
    }
  };
  for (const change of changes) {
    equal(change.start1, change.start2);
    const start = text.length;
    for (let n = change.start1; n < change.end1; n++) add(a, n, { a: n, b: undefined });
    const middle = text.length;
    for (let n = change.start2; n < change.end2; n++) add(b, n, { a: undefined, b: n });
    blocks.push({ start, middle, end: text.length, change });
    [lineA, lineB] = [change.end1, change.end2];
  }
  equal(a.lines, b.lines);
  return { text: text.join('\n'), lines, blocks };
}

type Block = Unified['blocks'][number];

/** A line's number in one of the two columns. */
class LineNumber extends GutterMarker {
  constructor(readonly n: number) {
    super();
  }
  override eq(other: LineNumber) {
    return other.n === this.n;
  }
  override toDOM() {
    return document.createTextNode(String(this.n));
  }
}

/** The texts were compared again: the numbers are redrawn. */
const renumber = StateEffect.define();
const renumbered = (update: ViewUpdate) =>
  update.transactions.some((t) => t.effects.some((e) => e.is(renumber)));

/** A text as CodeMirror splits it into lines. */
const textOf = (doc: string) => Text.of(doc.split(/\r\n?|\n/));

/** A diff of one file in one editor, read-only. */
export function UnifiedDiffEditor(props: Omit<DiffEditorProps, 'syncScroll' | 'onEdit'>): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-diff';
  const shadow = container.attachShadow({ mode: 'open' });
  const layout = new CSSStyleSheet();
  layout.replaceSync(LAYOUT);
  shadow.adoptedStyleSheets = [layout];
  const frame = document.createElement('div');
  frame.className = 'cm-diff';
  shadow.append(frame);

  const [a, b] = [textOf(props.original), textOf(props.text)];
  let unified: Unified = { text: '', lines: [], blocks: [] };
  const blocks = signal<Unified['blocks']>([]);
  const caret = signal(0);
  /** Each run of unchanged lines' fold level (`foldedLines`): before change `i`, and after all. */
  let levels: number[] = [];
  let expanders: (() => void)[] = [];

  const column = (side: 'a' | 'b') =>
    gutter({
      class: `cm-lineNumbers cm-diff-numbers-${side}`,
      lineMarker: (view, line) => {
        const n = unified.lines[view.state.doc.lineAt(line.from).number - 1]?.[side];
        return n === undefined ? null : new LineNumber(n + 1);
      },
      lineMarkerChange: renumbered,
      initialSpacer: () => new LineNumber((side === 'a' ? a : b).lines),
    });
  const numbers = [column('a'), column('b')];
  const settings = new Compartment();
  const configure = (): Extension => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
    appearance(props, numbers),
  ];
  const language = languageFor(props.path);
  const view = new EditorView({
    root: shadow,
    parent: frame,
    extensions: [
      gutterObstacle,
      fullWidth,
      selection,
      EditorView.editorAttributes.of({ class: 'cm-diff-unified' }),
      EditorState.readOnly.of(true),
      EditorView.updateListener.of((update) => {
        const { state } = update;
        if (update.selectionSet) caret.set(state.doc.lineAt(state.selection.main.head).number - 1);
      }),
      marks,
      theme,
      diffTheme,
      syntaxHighlighting(highlight),
      ...(language ? [language] : []),
      settings.of(configure()),
    ],
  });

  /** The changes' lines, as the folds take them. */
  const ranges = (): LineRange[] =>
    blocks.peek().map(({ start, end }) => ({ start1: start, end1: end, start2: start, end2: end }));

  /** Marks each change's lines and text, and folds what's to be folded. */
  function mark() {
    const doc = view.state.doc;
    const decorations: Range<Decoration>[] = [];
    const gutterMarks: Range<GutterMarker>[] = [];
    for (const { start, middle, end, change } of blocks.peek()) {
      const words = change.parts !== undefined;
      for (let n = start; n < end; n++) {
        const kind = n < middle ? 'deleted' : 'inserted';
        const from = doc.line(n + 1).from;
        const lines = `cm-diff-line cm-diff-${kind}${words ? ' cm-diff-words' : ''}`;
        decorations.push(Decoration.line({ class: lines }).range(from));
        gutterMarks.push(MARKS[kind].range(from));
      }
      for (const part of change.parts ?? []) {
        // Removed text in the removed lines, added text in the added ones.
        const marked = [
          [start, part.fromA, part.toA, 'deleted'],
          [middle, part.fromB, part.toB, 'inserted'],
        ] as const;
        for (const [line, from, to, kind] of marked) {
          if (from === to) continue;
          const offset = doc.line(line + 1).from;
          const word = Decoration.mark({ class: `cm-diff-word-${kind}` });
          decorations.push(word.range(offset + from, offset + to));
        }
      }
    }
    const all = ranges();
    for (let i = 0; i <= all.length; i++) {
      const folded = foldedLines(all, i, 'a', doc.lines, levels[i] as number);
      if (!folded) continue;
      const widget = new Fold(folded.to - folded.from, expanders[i] as () => void);
      const range = { from: doc.line(folded.from + 1).from, to: doc.line(folded.to).to };
      decorations.push(Decoration.replace({ widget, block: true }).range(range.from, range.to));
    }
    view.dispatch({
      effects: setMarks.of({
        decorations: Decoration.set(decorations, true),
        gutter: RangeSet.of(gutterMarks, true),
      }),
    });
  }

  /** Compares the texts again, as the policies say, and shows them as one. */
  function rediff() {
    const changes = compare(a, b, props.ignore?.() ?? 'none', props.highlight?.() ?? 'words');
    unified = unify(a, b, changes);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: unified.text },
      effects: renumber.of(null),
    });
    blocks.set(unified.blocks);
    levels = changes.map(() => 0).concat(0);
    fold(props.collapse?.() ?? false);
  }
  /** All the unchanged lines folded, or none. */
  function fold(collapse: boolean) {
    levels = levels.map(() => (collapse ? 0 : 3));
    expanders = levels.map((_, i) => () => {
      // Shows more of them, or all: the next level that folds any.
      const lines = view.state.doc.lines;
      let level = (levels[i] as number) + 1;
      while (level < 3 && !foldedLines(ranges(), i, 'a', lines, level)) level++;
      levels[i] = level;
      mark();
    });
    mark();
  }

  /** The caret to a change, scrolled to the middle. */
  const show = (block: Block) => {
    const at = view.state.doc.line(block.start + 1).from;
    view.dispatch({
      selection: EditorSelection.cursor(at),
      effects: EditorView.scrollIntoView(at, { y: 'center' }),
    });
  };
  const goTo = (block: Block | undefined) => {
    if (!block) return;
    show(block);
    view.focus();
  };
  const nextOf = () => blocks.get().find((block) => block.start > caret.get());
  const previousOf = () => blocks.get().findLast((block) => block.end <= caret.get());

  // Jump to Source: a line of the right's, or for a removed one, where its change is on the right.
  diffs.set(container, () => {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const n = line.number - 1;
    // Every line has its numbers; one with none on the right is a change's.
    const right = (unified.lines[n] as Unified['lines'][number]).b;
    if (right !== undefined) return { line: right, column: head - line.from };
    const block = unified.blocks.find(({ start, end }) => start <= n && n < end) as Block;
    return { line: Math.min(block.change.start2, b.lines - 1), column: 0 };
  });

  rediff();
  // The caret at the first change, as IntelliJ opens a diff, scrolled to the middle.
  const first = blocks.peek()[0];
  if (first) show(first);

  const watch = effect(() => {
    view.dispatch({ effects: settings.reconfigure(configure()) });
    return undefined;
  });
  let folding: boolean | undefined;
  const collapsing = effect(() => {
    const collapse = props.collapse?.() ?? false;
    if (folding !== undefined && collapse !== folding) fold(collapse);
    folding = collapse;
    return undefined;
  });
  let policies: string | undefined;
  const comparing = effect(() => {
    const now = `${props.ignore?.() ?? 'none'} ${props.highlight?.() ?? 'words'}`;
    if (policies !== undefined && now !== policies) rediff();
    policies = now;
    return undefined;
  });
  props.control?.({
    previous: () => {
      goTo(previousOf());
    },
    next: () => {
      goTo(nextOf());
    },
    hasPrevious: () => previousOf() !== undefined,
    hasNext: () => nextOf() !== undefined,
  });
  onCleanup(() => {
    watch.dispose();
    collapsing.dispose();
    comparing.dispose();
    view.destroy();
  });
  return container;
}
