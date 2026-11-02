// A file's diff, side by side as IntelliJ shows it: the last committed text on the left, the
// current one on the right, changed lines marked and unchanged ones aligned. CodeMirror's merge
// view, read-only, in the code editor's look and in a shadow root for the same reason (editor.tsx).
// To merge, the right side can be edited, with an arrow by each change that takes the left's.
// Jump to Source asks `diffSource` where the caret is in the file as it is now (the right side's).

import { type Chunk, MergeView } from '@codemirror/merge';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { gutterObstacle, highlight, scroller, selection, theme, variable } from './editor.js';
import { languageFor } from './languages.js';
import { fullWidth } from './width.js';

export interface DiffEditorProps {
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
  /** Makes the right side editable, to merge into it: called with its text as it's edited. */
  onEdit?: (text: string) => void;
}

/** The changes' colours, from the theme's variables: removed on the left, added on the right. */
const diffTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: variable('diff-removed') },
  '&.cm-merge-b .cm-changedLine': { backgroundColor: variable('diff-added') },
  '&.cm-merge-a .cm-changedText': { background: variable('diff-removed-text') },
  '&.cm-merge-b .cm-changedText': { background: variable('diff-added-text') },
  '&.cm-merge-a .cm-changedLineGutter': { background: variable('diff-removed-text') },
  '&.cm-merge-b .cm-changedLineGutter': { background: variable('diff-added-text') },
});

/** A changed block's lines on the left (`start1` to `end1`) and right, zero-based, ends excluded. */
export interface LineRange {
  start1: number;
  end1: number;
  start2: number;
  end2: number;
}

/** The merge view's changes as lines: each covers whole lines, ending where the next line starts. */
function lineRanges(chunks: readonly Chunk[], a: Text, b: Text): LineRange[] {
  const lines = (doc: Text, from: number, to: number) => {
    const start = doc.lineAt(from).number - 1;
    if (to === from) return [start, start] as const;
    return [start, to > doc.length ? doc.lines : doc.lineAt(to).number - 1] as const;
  };
  return chunks.map((chunk) => {
    const [start1, end1] = lines(a, chunk.fromA, chunk.toA);
    const [start2, end2] = lines(b, chunk.fromB, chunk.toB);
    return { start1, end1, start2, end2 };
  });
}

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

/** The diffs that show, by their element: for `diffSource`. */
const diffs = new WeakMap<Element, { view: MergeView; side: () => 'a' | 'b' }>();

/**
 * Where Jump to Source goes from the diff `element` is in (the focused one, say): the caret's line
 * and column, zero-based, in the file as it is now. From the left side, the last committed text,
 * its line there, as IntelliJ's. Undefined outside a diff.
 */
export function diffSource(element: Element): { line: number; column: number } | undefined {
  const container = element.closest('.cerebro-editor-diff');
  const diff = container ? diffs.get(container) : undefined;
  if (!diff) return undefined;
  const { view } = diff;
  const side = diff.side() === 'a' ? view.a : view.b;
  const head = side.state.selection.main.head;
  const line = side.state.doc.lineAt(head);
  const at = { line: line.number - 1, column: head - line.from };
  if (side === view.b) return at;
  const ranges = lineRanges(view.chunks, view.a.state.doc, view.b.state.doc);
  return {
    line: Math.min(transferLine(at.line, ranges), view.b.state.doc.lines - 1),
    column: at.column,
  };
}

/** A diff of one file: read-only, or editable on the right to merge. */
export function DiffEditor(props: DiffEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-diff';
  const shadow = container.attachShadow({ mode: 'open' });
  const language = languageFor(props.path);
  const sides = [new Compartment(), new Compartment()] as const;
  const configure = (): Extension => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
  ];
  const side = (doc: string, settings: Compartment, onEdit?: (text: string) => void) => ({
    doc,
    extensions: [
      lineNumbers(),
      gutterObstacle,
      fullWidth,
      selection,
      onEdit
        ? EditorView.updateListener.of((update) => {
            if (update.docChanged) onEdit(update.state.doc.toString());
          })
        : EditorState.readOnly.of(true),
      theme,
      diffTheme,
      syntaxHighlighting(highlight),
      ...(language ? [language] : []),
      settings.of(configure()),
    ],
  });
  const view = new MergeView({
    a: side(props.original, sides[0]),
    b: side(props.text, sides[1], props.onEdit),
    parent: shadow,
    root: shadow,
    gutter: true,
    highlightChanges: true,
    ...(props.onEdit ? { revertControls: 'a-to-b' as const } : {}),
  });
  // The merge view grows with its text; its frame scrolls. Set through the style object, which
  // the page's Content-Security-Policy allows.
  view.dom.style.height = '100%';
  view.dom.style.overflow = 'auto';
  // The side last focused is the current one, as IntelliJ's: the right one to start with.
  let current: 'a' | 'b' = 'b';
  view.a.contentDOM.addEventListener('focus', () => {
    current = 'a';
  });
  view.b.contentDOM.addEventListener('focus', () => {
    current = 'b';
  });
  diffs.set(container, { view, side: () => current });
  const watch = effect(() => {
    const settings = configure();
    view.a.dispatch({ effects: sides[0].reconfigure(settings) });
    view.b.dispatch({ effects: sides[1].reconfigure(settings) });
    return undefined;
  });
  onCleanup(() => {
    watch.dispose();
    view.destroy();
  });
  return container;
}
