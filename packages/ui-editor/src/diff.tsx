// A file's diff, side by side as IntelliJ's (SimpleDiffViewer): the last committed text on the left,
// the current one on the right, each in its own editor with its own scrollbar, and between them a
// divider joining each change on one side to its place on the other. Changes are in IntelliJ's
// colours by kind (TextDiffType): inserted, deleted, or modified, a modified change's lines lighter
// and its changed text in the full colour. As IntelliJ's:
// - Synchronize Scrolling: scrolling one side scrolls the other to the same place
//   (SyncScrollSupport), on unless turned off;
// - Collapse Unchanged Fragments: unchanged lines more than 4 from a change are folded into a band,
//   which shows 4 more of them each side when clicked, then 8 more, then all (FoldingModelSupport);
// - Previous and Next Difference from the caret, and the caret at the first change to start with.
// Read-only, in the code editor's look and in a shadow root for the same reason (editor.tsx). To
// merge, the right side can be edited, with an arrow by each change that takes the left's.
// Jump to Source asks `diffSource` where the caret is in the file as it is now (the right side's).

import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutterLineClass,
  lineNumbers,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal } from '@cerebro-ide/reactive';
import { gutterObstacle, highlight, scroller, selection, theme, variable } from './editor.js';
import {
  compare,
  kindOf,
  type Change,
  type HighlightPolicy,
  type IgnorePolicy,
  type Kind,
  type LineRange,
} from './compare.js';
import { appearance, type Appearance } from './appearance.js';
import { languageFor } from './languages.js';
import { fullWidth } from './width.js';

export interface DiffEditorProps extends Appearance {
  /** The file's path: its language comes from the extension. */
  path: string;
  /** As last committed: empty for a new file. */
  original: string;
  /** As it is now: empty for a deleted file. */
  text: string;
  /** Read reactively. Default: 13. */
  fontSize?: () => number;
  /** Read reactively. Default: 4. */
  tabSize?: () => number;
  /** Scrolling one side scrolls the other, read reactively. Default: true. */
  syncScroll?: () => boolean;
  /** Folds the unchanged lines away from the changes, read reactively. Default: false. */
  collapse?: () => boolean;
  /** What's not a difference, read reactively. Default: nothing, as IntelliJ's. */
  ignore?: () => IgnorePolicy;
  /** How changes are marked, read reactively. Default: by words, as IntelliJ's. */
  highlight?: () => HighlightPolicy;
  /** Makes the right side editable, to merge into it: called with its text as it's edited. */
  onEdit?: (text: string) => void;
  /** Given the diff's controls, once it shows. */
  control?: (diff: DiffControl) => void;
}

/** What a toolbar does with a diff: IntelliJ's Previous and Next Difference. */
export interface DiffControl {
  /** Moves the caret to the change before it, or after it, on the side last focused. */
  previous(): void;
  next(): void;
  /** Whether there's one to go to, read reactively. */
  hasPrevious(): boolean;
  hasNext(): boolean;
}

type Side = 'a' | 'b';

/** Context kept around a change when unchanged lines are folded: IntelliJ's default, 4. */
const CONTEXT = 4;

/**
 * A left line's line on the right, as IntelliJ's diff carries a position across
 * (`BaseSyncScrollable.transferLine`): after a change, shifted by it; in one, as far into the
 * right's lines, at most to their end.
 */
export function transferLine(line: number, ranges: readonly LineRange[]): number {
  const range = ranges.findLast((r) => r.start1 <= line);
  if (!range) return line;
  if (range.start1 === line) return range.start2;
  if (range.end1 <= line) return line - range.end1 + range.end2;
  return Math.min(range.start2 + (line - range.start1), range.end2);
}

/** The ranges seen from the right: to carry a right line to the left. */
const swapped = (ranges: readonly LineRange[]): LineRange[] =>
  ranges.map((r) => ({ start1: r.start2, end1: r.end2, start2: r.start1, end2: r.end1 }));

const start = (change: LineRange, side: Side) => (side === 'a' ? change.start1 : change.start2);
const end = (change: LineRange, side: Side) => (side === 'a' ? change.end1 : change.end2);

/**
 * The unchanged lines folded between changes `index - 1` and `index` on one side, at a level:
 * 4 lines of context (0), 8 (1), 16 (2), or none folded (3), as IntelliJ's nested folds. Folded
 * only when at least 2 lines would be, as IntelliJ's. The first and last folds reach the text's ends.
 */
export function foldedLines(
  changes: readonly LineRange[],
  index: number,
  side: 'a' | 'b',
  lines: number,
  level: number,
): { from: number; to: number } | undefined {
  if (level >= 3) return undefined;
  const shift = CONTEXT * 2 ** level;
  const before = changes[index - 1];
  const after = changes[index];
  const from = before ? Math.min(end(before, side) + shift, lines) : 0;
  const to = after ? Math.max(start(after, side) - shift, 0) : lines;
  return to - from >= 2 ? { from, to } : undefined;
}

/** The band in place of folded lines: clicked, it shows more of them. */
export class Fold extends WidgetType {
  constructor(
    readonly lines: number,
    readonly expand: () => void,
  ) {
    super();
  }
  override eq(other: Fold) {
    return other.lines === this.lines && other.expand === this.expand;
  }
  toDOM() {
    const band = document.createElement('div');
    band.className = 'cm-diff-fold';
    band.setAttribute('role', 'button');
    band.setAttribute('aria-label', `${String(this.lines)} unchanged lines`);
    // A line's height: a space in the line's font.
    band.textContent = ' ';
    band.addEventListener('click', this.expand);
    return band;
  }
}

/** A change's colour in the gutter beside its lines: one of each, the same by identity. */
class Mark extends GutterMarker {
  constructor(kind: Kind) {
    super();
    this.elementClass = `cm-diff-gutter-${kind}`;
  }
}
export const MARKS = {
  inserted: new Mark('inserted'),
  deleted: new Mark('deleted'),
  modified: new Mark('modified'),
};

/** A side's marks, folds and gutter colours, as the diff sets them. */
export interface Marks {
  decorations: DecorationSet;
  gutter: RangeSet<GutterMarker>;
}
export const setMarks = StateEffect.define<Marks>();
export const marks = StateField.define<Marks>({
  create: (): Marks => ({
    decorations: Decoration.none,
    gutter: RangeSet.empty as RangeSet<GutterMarker>,
  }),
  update: (value, tr) =>
    tr.effects.reduce<Marks>(
      (v, e) => (e.is(setMarks) ? e.value : v),
      tr.docChanged
        ? { decorations: value.decorations.map(tr.changes), gutter: value.gutter.map(tr.changes) }
        : value,
    ),
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.decorations),
    gutterLineClass.from(field, (v) => v.gutter),
  ],
});

/** The ignored colour of a modified change's lines: IntelliJ mixes its colour 40% into the text's. */
const lighter = (kind: Kind) =>
  `color-mix(in srgb, ${variable(`diff-${kind}`)} 40%, ${variable('background')})`;

type StyleSpec = Parameters<typeof EditorView.theme>[0][string];

/** The changes' colours, from the theme's variables. */
export const diffTheme = EditorView.theme({
  ...Object.fromEntries<StyleSpec>(
    (['inserted', 'deleted', 'modified'] as const).flatMap((kind): [string, StyleSpec][] => [
      [`.cm-diff-${kind}`, { backgroundColor: variable(`diff-${kind}`) }],
      [`.cm-diff-${kind}.cm-diff-words`, { backgroundColor: lighter(kind) }],
      [`.cm-diff-word-${kind}`, { backgroundColor: variable(`diff-${kind}`) }],
      [`.cm-gutterElement.cm-diff-gutter-${kind}`, { backgroundColor: variable(`diff-${kind}`) }],
      // Where a change has no lines on this side: a line in its colour where they'd be.
      [`.cm-diff-before-${kind}`, { boxShadow: `inset 0 1px 0 ${variable(`diff-${kind}`)}` }],
      [`.cm-diff-after-${kind}`, { boxShadow: `inset 0 -1px 0 ${variable(`diff-${kind}`)}` }],
    ]),
  ),
  '.cm-diff-fold': { backgroundColor: variable('diff-separator'), cursor: 'pointer' },
});

/** The panes and the divider, as a constructable sheet: the page allows no style element. */
export const LAYOUT = `
.cm-diff { display: flex; height: 100%; }
.cm-diff > .cm-editor { flex: 1 1 0; min-width: 0; }
.cm-diff-divider { flex: 0 0 30px; position: relative; overflow: hidden; background: var(--cerebro-background); }
.cm-diff-divider > svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.cm-diff-take {
  position: absolute; left: 1px; width: 16px; height: 16px; padding: 0; border: none;
  border-radius: 3px; background: transparent; color: var(--cerebro-text); font: 12px/16px sans-serif;
  cursor: pointer;
}
.cm-diff-take:hover { background: var(--cerebro-diff-edge); }
`;

/** Where a position is in a file: its line and column, zero-based. */
export interface Position {
  line: number;
  column: number;
}

/** The diffs that show, by their element: where each one's caret is in the file, for `diffSource`. */
export const diffs = new WeakMap<Element, () => Position>();

/**
 * Where Jump to Source goes from the diff `element` is in (the focused one, say): the caret's line
 * and column, zero-based, in the file as it is now. From the left side, the last committed text,
 * its line there, as IntelliJ's. Undefined outside a diff.
 */
export function diffSource(element: Element): Position | undefined {
  const container = element.closest('.cerebro-editor-diff');
  return container ? diffs.get(container)?.() : undefined;
}

/** A diff of one file: read-only, or editable on the right to merge. */
export function DiffEditor(props: DiffEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-diff';
  const shadow = container.attachShadow({ mode: 'open' });
  const layout = new CSSStyleSheet();
  layout.replaceSync(LAYOUT);
  shadow.adoptedStyleSheets = [layout];
  const frame = document.createElement('div');
  frame.className = 'cm-diff';
  shadow.append(frame);

  const language = languageFor(props.path);
  const settings = [new Compartment(), new Compartment()] as const;
  const numbers = lineNumbers();
  const configure = (): Extension => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
    appearance(props, numbers),
  ];
  /** The side last focused, as IntelliJ's current one: the right one to start with. */
  const current = signal<Side>('b');
  /** Each side's caret line, for Previous and Next Difference. */
  const carets = { a: signal(0), b: signal(0) };
  const changes = signal<readonly Change[]>([]);
  /** Each run of unchanged lines' fold level (`foldedLines`): before change `i`, and after all. */
  let levels: number[] = [];

  const pane = (side: Side, doc: string, compartment: Compartment, onEdit?: (t: string) => void) =>
    new EditorView({
      doc,
      root: shadow,
      parent: frame,
      extensions: [
        gutterObstacle,
        fullWidth,
        selection,
        EditorView.editorAttributes.of({ class: `cm-diff-${side}` }),
        onEdit
          ? EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              onEdit(update.state.doc.toString());
              queueMicrotask(rediff);
            })
          : EditorState.readOnly.of(true),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) {
            const { state } = update;
            carets[side].set(state.doc.lineAt(state.selection.main.head).number - 1);
          }
          if (update.focusChanged && update.view.hasFocus) current.set(side);
          if (update.geometryChanged || update.viewportChanged || update.heightChanged) draw();
        }),
        marks,
        theme,
        diffTheme,
        syntaxHighlighting(highlight),
        ...(language ? [language] : []),
        compartment.of(configure()),
      ],
    });
  const views = {
    a: pane('a', props.original, settings[0]),
    b: pane('b', props.text, settings[1], props.onEdit),
  };
  const divider = document.createElement('div');
  divider.className = 'cm-diff-divider';
  frame.insertBefore(divider, views.b.dom);
  diffs.set(container, () => {
    const side = current.peek();
    const { state } = views[side];
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const at = { line: line.number - 1, column: head - line.from };
    if (side === 'b') return at;
    return {
      line: Math.min(transferLine(at.line, changes.peek()), views.b.state.doc.lines - 1),
      column: at.column,
    };
  });

  /** A side's lines from `from` to `to`, as positions: from the first's start to the last's end. */
  const span = (doc: Text, from: number, to: number) => ({
    from: doc.line(from + 1).from,
    to: doc.line(to).to,
  });

  /** Marks each change on each side, and folds what's to be folded. */
  function mark() {
    const all = changes.peek();
    for (const side of ['a', 'b'] as const) {
      const view = views[side];
      const doc = view.state.doc;
      const decorations: Range<Decoration>[] = [];
      const gutter: Range<GutterMarker>[] = [];
      for (const change of all) {
        const { kind, parts } = change;
        const [first, last] = [start(change, side), end(change, side)];
        if (first === last) {
          // None of its lines here: a line where they'd be, over the line after, or under the last.
          const below = first < doc.lines;
          const line = doc.line(below ? first + 1 : doc.lines);
          const where = below ? 'before' : 'after';
          decorations.push(Decoration.line({ class: `cm-diff-${where}-${kind}` }).range(line.from));
          continue;
        }
        // Its changed text, if it's marked, in the full colour: on lines in the lighter one.
        const words = parts !== undefined;
        for (let n = first; n < last; n++) {
          const from = doc.line(n + 1).from;
          const lines = `cm-diff-line cm-diff-${kind}${words ? ' cm-diff-words' : ''}`;
          decorations.push(Decoration.line({ class: lines }).range(from));
          gutter.push(MARKS[kind].range(from));
        }
        if (!words) continue;
        const offset = doc.line(first + 1).from;
        for (const part of parts) {
          const [from, to] = side === 'a' ? [part.fromA, part.toA] : [part.fromB, part.toB];
          if (from === to) continue;
          const word = kindOf(part.toA > part.fromA, part.toB > part.fromB);
          decorations.push(
            Decoration.mark({ class: `cm-diff-word-${word}` }).range(offset + from, offset + to),
          );
        }
      }
      for (let i = 0; i <= all.length; i++) {
        const folded = foldedLines(all, i, side, doc.lines, levels[i] as number);
        if (!folded) continue;
        const widget = new Fold(folded.to - folded.from, expanders[i] as () => void);
        const { from, to } = span(doc, folded.from, folded.to);
        decorations.push(Decoration.replace({ widget, block: true }).range(from, to));
      }
      view.dispatch({
        effects: setMarks.of({
          decorations: Decoration.set(decorations, true),
          gutter: RangeSet.of(gutter, true),
        }),
      });
    }
    draw();
  }

  /** Each fold's expander: kept, so its band is the same widget as long as it shows. */
  let expanders: (() => void)[] = [];
  /** Diffs the two sides again: to start with, and after an edit. */
  function rediff() {
    const found = compare(
      views.a.state.doc,
      views.b.state.doc,
      props.ignore?.() ?? 'none',
      props.highlight?.() ?? 'words',
    );
    changes.set(found);
    levels = found.map(() => 0).concat(0);
    fold(props.collapse?.() ?? false);
  }
  /** All the unchanged lines folded, or none, as IntelliJ's toggle refolds them. */
  function fold(collapse: boolean) {
    levels = levels.map(() => (collapse ? 0 : 3));
    expanders = levels.map((_, i) => () => {
      // Shows more of them, or all, as IntelliJ's nested folds: the next level that folds any.
      const all = changes.peek();
      const lines = (side: Side) => views[side].state.doc.lines;
      let level = (levels[i] as number) + 1;
      while (
        level < 3 &&
        !foldedLines(all, i, 'a', lines('a'), level) &&
        !foldedLines(all, i, 'b', lines('b'), level)
      ) {
        level++;
      }
      levels[i] = level;
      mark();
    });
    mark();
  }

  // The divider: each change and fold joined across it, as IntelliJ's, redrawn as the sides scroll.
  let frameRequest = 0;
  function draw() {
    cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(paint);
  }
  const SVG = 'http://www.w3.org/2000/svg';
  function paint() {
    const width = divider.clientWidth;
    const top = divider.getBoundingClientRect().top;
    /** A side's lines' top and bottom in the divider: a change's, or a fold's. */
    const edges = (side: Side, from: number, to: number) => {
      const view = views[side];
      const doc = view.state.doc;
      const offset = view.documentTop - top;
      // A change or fold starts at a line, or after the last.
      const upper =
        offset +
        (from < doc.lines
          ? view.lineBlockAt(doc.line(from + 1).from).top
          : view.lineBlockAt(doc.length).bottom);
      return [upper, from === to ? upper : offset + view.lineBlockAt(doc.line(to).from).bottom];
    };
    const shape = (a: number[], b: number[], fill: string) => {
      const [a1, a2] = a as [number, number];
      const [b1, b2] = b as [number, number];
      const h = width / 2;
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute(
        'd',
        `M0 ${String(a1)}C${String(h)} ${String(a1)} ${String(h)} ${String(b1)} ${String(width)} ${String(b1)}` +
          `L${String(width)} ${String(b2)}C${String(h)} ${String(b2)} ${String(h)} ${String(a2)} 0 ${String(a2)}Z`,
      );
      path.setAttribute('fill', fill);
      path.setAttribute('class', 'cm-diff-joint');
      return path;
    };
    const svg = document.createElementNS(SVG, 'svg');
    const all = changes.peek();
    const buttons: HTMLElement[] = [];
    for (const change of all) {
      const a = edges('a', change.start1, change.end1);
      const b = edges('b', change.start2, change.end2);
      svg.append(shape(a, b, `var(--cerebro-diff-${change.kind})`));
      if (!props.onEdit) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-diff-take';
      button.title = 'Accept';
      button.setAttribute('aria-label', 'Accept');
      button.textContent = '»';
      button.style.top = `${String((a[0] as number) + 3)}px`;
      button.addEventListener('click', () => {
        take(change);
      });
      buttons.push(button);
    }
    for (let i = 0; i <= all.length; i++) {
      const folds = (['a', 'b'] as const).map((side) =>
        foldedLines(all, i, side, views[side].state.doc.lines, levels[i] as number),
      );
      const [a, b] = folds;
      if (!a || !b) continue;
      // A fold is one line high: its band's.
      const band = (side: Side, from: number) => {
        const [upper] = edges(side, from, from);
        return [upper as number, (upper as number) + views[side].defaultLineHeight];
      };
      svg.append(shape(band('a', a.from), band('b', b.from), 'var(--cerebro-diff-separator)'));
    }
    divider.replaceChildren(svg, ...buttons);
  }

  /** Takes the left's lines in place of the right's, as IntelliJ's arrow does. */
  function take(change: Change) {
    const a = views.a.state.doc;
    const b = views.b.state.doc;
    // Where a line starts, or the text's end.
    const at = (doc: Text, line: number) =>
      line < doc.lines ? doc.line(line + 1).from : doc.length;
    let insert = a.sliceString(at(a, change.start1), at(a, change.end1));
    let from = at(b, change.start2);
    const to = at(b, change.end2);
    if (insert === '' && to === b.length && from > 0) {
      // The right's last lines go, and the newline before them.
      from--;
    } else if (from === b.length && b.length > 0 && !insert.endsWith('\n')) {
      // After the right's last line, which has no newline: one before the lines taken. (Lines
      // taken without a newline end the left's text, so the right's change ends its text too.)
      insert = `\n${insert}`;
    }
    views.b.dispatch({ changes: { from, to, insert } });
  }

  // Synchronize Scrolling, as IntelliJ's: the line a third of the way down one side is carried to
  // the other, at the same height there, and in the same phase within its line.
  /** Where a side was scrolled to keep up with the other: its scroll event isn't the user's. */
  const following: Record<Side, number | undefined> = { a: undefined, b: undefined };
  function follow(master: Side) {
    const slave: Side = master === 'a' ? 'b' : 'a';
    const [m, s] = [views[master], views[slave]];
    const set = (left: number, top: number) => {
      const before = [s.scrollDOM.scrollLeft, s.scrollDOM.scrollTop];
      s.scrollDOM.scrollLeft = left;
      s.scrollDOM.scrollTop = top;
      if (s.scrollDOM.scrollLeft !== before[0] || s.scrollDOM.scrollTop !== before[1]) {
        following[slave] = s.scrollDOM.scrollTop;
      }
    };
    const third = Math.floor(m.scrollDOM.clientHeight / 3);
    // From the scroller's top to the text's.
    const padding = (view: EditorView) =>
      view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop;
    const y = m.scrollDOM.scrollTop + third - padding(m);
    const block = m.lineBlockAtHeight(y);
    const line = m.state.doc.lineAt(block.from).number - 1;
    const ranges = master === 'a' ? changes.peek() : swapped(changes.peek());
    const target = Math.min(transferLine(line, ranges), s.state.doc.lines - 1);
    const there = s.lineBlockAt(s.state.doc.line(target + 1).from);
    const phase = Math.min(y - block.top, m.defaultLineHeight);
    set(m.scrollDOM.scrollLeft, there.top + padding(s) - third + phase);
  }
  for (const side of ['a', 'b'] as const) {
    views[side].scrollDOM.addEventListener('scroll', () => {
      const followed = following[side];
      following[side] = undefined;
      const own =
        followed === undefined || Math.abs(views[side].scrollDOM.scrollTop - followed) > 1;
      if (own && (props.syncScroll?.() ?? true)) follow(side);
      draw();
    });
  }

  const goTo = (change: Change | undefined) => {
    if (!change) return;
    const side = current.peek();
    const view = views[side];
    const doc = view.state.doc;
    const line = doc.line(Math.min(start(change, side), doc.lines - 1) + 1);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  };
  const nextOf = () => {
    const side = current.get();
    const line = carets[side].get();
    return changes.get().find((c) => start(c, side) > line);
  };
  const previousOf = () => {
    const side = current.get();
    const line = carets[side].get();
    return changes.get().findLast((c) => start(c, side) < line && end(c, side) <= line);
  };

  rediff();
  // The caret at the first change, as IntelliJ opens a diff, scrolled to the middle.
  const first = changes.peek()[0];
  if (first) {
    for (const side of ['a', 'b'] as const) {
      const doc = views[side].state.doc;
      const at = doc.line(Math.min(start(first, side), doc.lines - 1) + 1).from;
      views[side].dispatch({
        selection: EditorSelection.cursor(at),
        ...(side === 'b' ? { effects: EditorView.scrollIntoView(at, { y: 'center' }) } : {}),
      });
    }
  }

  const watch = effect(() => {
    const configured = configure();
    views.a.dispatch({ effects: settings[0].reconfigure(configured) });
    views.b.dispatch({ effects: settings[1].reconfigure(configured) });
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
  let syncing: boolean | undefined;
  const sync = effect(() => {
    const on = props.syncScroll?.() ?? true;
    // Turned on: the other side catches up at once.
    if (syncing === false && on) follow(current.peek());
    syncing = on;
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
    cancelAnimationFrame(frameRequest);
    watch.dispose();
    collapsing.dispose();
    comparing.dispose();
    sync.dispose();
    views.a.destroy();
    views.b.destroy();
  });
  return container;
}
