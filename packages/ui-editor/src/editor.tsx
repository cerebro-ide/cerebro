// The code editor: CodeMirror 6, in Cerebro's theme (its colours are the theme's CSS variables, so
// it follows dark and light), with the language for the file and the editor settings applied as
// they change. Given a document, it edits it, with undo; without one, it's read-only.
//
// It lives in a shadow root. CodeMirror adds its styles with style-mod, which uses constructable
// stylesheets inside a shadow root but <style> elements in a document, and the page's
// Content-Security-Policy blocks those (`style-src 'self'`). The theme's variables still reach it:
// custom properties are inherited into shadow roots.

import { defaultKeymap, historyField, indentWithTab, redo, undo } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
import {
  drawSelection,
  highlightActiveLine,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  layer,
  lineNumbers,
  RectangleMarker,
  ViewPlugin,
} from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect } from '@cerebro-ide/reactive';
import { tags } from '@lezer/highlight';
import { EditorDocument, KEPT } from './document.js';
import { findAndReplace } from './find.js';
import { namedHistory } from './history.js';
import { definitionLinks, usageHighlights, type AskDefinition, type AskUsages } from './usages.js';
import { languageFor } from './languages.js';
import { fullWidth } from './width.js';

export interface CodeEditorProps {
  /** The file's path: its language comes from the extension. */
  path: string;
  /** The text to show, read-only, when there's no document. */
  text?: string;
  /** The document to edit: its text, kept with the selection and undo history between editors. */
  document?: EditorDocument;
  /** Read reactively. Default: 13. */
  fontSize?: () => number;
  /** Read reactively. Default: off. */
  softWrap?: () => boolean;
  /** Read reactively. Default: 4. */
  tabSize?: () => number;
  /** A position to show and select: where a definition is. Read reactively; zero-based. */
  reveal?: () =>
    | { line: number; column: number; end?: number | undefined; top?: number | undefined }
    | undefined;
  /** Whether revealing a position also focuses the editor, as after navigating. Default: true. */
  revealFocus?: boolean;
  /**
   * Go to definition of the word at the cursor, given where it is (zero-based): its keys (Mod+B in
   * IntelliJ) or Mod+click.
   */
  onGoToDefinition?: (word: string, at: { line: number; column: number }) => void;
  /** Find usages of the word at the cursor, given where it is: its keys (Alt+F7 in IntelliJ). */
  onFindUsages?: (word: string, at: { line: number; column: number }) => void;
  /** The line at the top of the editor, zero-based: each time it scrolls. */
  onScroll?: (top: number) => void;
  /**
   * Where the symbol at the caret is in the file, highlighted as IntelliJ's: asked once the caret
   * stays. None: no highlights.
   */
  usages?: AskUsages;
  /**
   * Whether the word at a place has a definition: with Ctrl or Cmd held, the word under the pointer
   * shows as a link when it has. None: no links.
   */
  canGoToDefinition?: AskDefinition;
  /** Where the caret is, zero-based: as the editor opens, and each time it moves. */
  onCaret?: (at: { line: number; column: number }) => void;
  /** The keys of the editor's actions, from the keymap. Read reactively. Default: IntelliJ's. */
  keys?: () => EditorKeys;
}

/**
 * The keys of the editor's own actions, as CodeMirror writes them (`Mod-b`, `Ctrl-k Ctrl-t`); an
 * action not given keeps IntelliJ's.
 */
export interface EditorKeys {
  goToDefinition?: readonly string[];
  findUsages?: readonly string[];
  find?: readonly string[];
  replace?: readonly string[];
  /** None when the app's own Edit → Undo and Redo run them, through `editorHistory`. */
  undo?: readonly string[];
  redo?: readonly string[];
}

/** IntelliJ's keys. */
export const DEFAULT_KEYS: Required<EditorKeys> = {
  goToDefinition: ['Mod-b'],
  findUsages: ['Alt-F7'],
  find: ['Mod-f'],
  replace: ['Mod-r'],
  undo: ['Mod-z'],
  redo: ['Mod-Shift-z'],
};

/**
 * Undoes or redoes in the editor `element` is in (the focused one, say), as Edit → Undo and Redo
 * do; returns whether it's in an editor with an undo history, which takes it even with nothing to
 * undo.
 */
export function editorHistory(element: Element, action: 'undo' | 'redo'): boolean {
  const editor = element.closest('.cm-editor');
  const view = editor && EditorView.findFromDOM(editor as HTMLElement);
  if (!view?.state.field(historyField, false)) return false;
  (action === 'undo' ? undo : redo)(view);
  return true;
}

/** A position in the editor as a line and column, zero-based. */
function placeOf(state: EditorState, pos: number): { line: number; column: number } {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1, column: pos - line.from };
}

/** The word at a position in the editor, if there is one. */
function wordAt(view: EditorView, pos: number): string | undefined {
  const range = view.state.wordAt(pos);
  return range ? view.state.sliceDoc(range.from, range.to) : undefined;
}

export const variable = (name: string) => `var(--cerebro-${name})`;

/** The editor's look, from the theme's variables. */
export const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: variable('text'),
    backgroundColor: variable('background'),
  },
  // No ligatures, as WebStorm's default.
  // No scrollbar taking room: the page draws its own over the content (@cerebro-ide/ui-scrollbar),
  // and its styles don't reach the shadow root.
  '.cm-scroller': {
    fontFamily: variable('font-mono'),
    fontVariantLigatures: 'none',
    scrollbarWidth: 'none',
  },
  // As WebStorm (measured): the numbers, room for gutter icons after them, then a line.
  '.cm-gutters': {
    backgroundColor: variable('background'),
    color: variable('editor-line-number'),
    border: 'none',
    borderRight: `1px solid ${variable('editor-gutter-line')}`,
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 42px 0 9px' },
  // The caret in the text's colour: CodeMirror's own is black, unseen on the dark theme.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: variable('text') },
  // Find and Replace: the bar over the editor, and the matches it highlights.
  '.cm-panels': { backgroundColor: variable('panel'), color: variable('text') },
  '.cm-panels-top': { borderBottom: `1px solid ${variable('separator')}` },
  '.cerebro-find': {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '4px 8px',
    fontFamily: variable('font'),
    fontSize: variable('font-size'),
  },
  '.cerebro-find__row': { display: 'flex', alignItems: 'center', gap: '4px' },
  '.cerebro-find__field': {
    flex: '0 1 320px',
    minWidth: '80px',
    height: '24px',
    padding: '0 6px',
    border: `1px solid ${variable('input-border')}`,
    borderRadius: '4px',
    background: variable('input'),
    color: variable('text'),
    font: 'inherit',
    outline: 'none',
  },
  '.cerebro-find__field:focus': { borderColor: variable('accent') },
  '.cerebro-find__option, .cerebro-find__button': {
    minWidth: '24px',
    height: '22px',
    padding: '0 4px',
    border: '1px solid transparent',
    borderRadius: '4px',
    background: 'none',
    color: variable('icon'),
    font: 'inherit',
  },
  '.cerebro-find__option': { fontFamily: variable('font-mono'), fontSize: '12px' },
  '.cerebro-find__option:hover, .cerebro-find__button:hover': { background: variable('hover') },
  '.cerebro-find__option[aria-pressed="true"]': {
    borderColor: variable('accent'),
    background: variable('selected'),
    color: variable('text'),
  },
  '.cerebro-find__count': { minWidth: '80px', padding: '0 8px', color: variable('text-muted') },
  '.cerebro-find__close': { marginLeft: 'auto' },
  '.cm-searchMatch': { backgroundColor: variable('search-match') },
  '.cm-searchMatch-selected': { backgroundColor: variable('search-match-selected') },
  '.cm-line': { padding: '0 2px' },
  '.cerebro-activeLine': { backgroundColor: variable('editor-active-line') },
  // The symbol at the caret, where it's read and where it's written, as IntelliJ's.
  '.cerebro-usage': { backgroundColor: variable('editor-usage') },
  '.cerebro-usage--write': { backgroundColor: variable('editor-usage-write') },
  // A word with a definition, under the pointer with Ctrl or Cmd held: the link colour over the
  // syntax's, underlined.
  '.cerebro-link, .cerebro-link *': {
    color: variable('editor-link'),
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': {
    backgroundColor: variable('editor-active-line'),
    color: variable('editor-line-number-active'),
  },
  // As specific as CodeMirror's own rule for a focused editor's selection, a light lavender,
  // which would otherwise win while the editor has the focus.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    { backgroundColor: variable('editor-selection') },
  '&.cm-focused': { outline: 'none' },
});

/**
 * The selection, drawn by CodeMirror as a rectangle per part (the first line's end, the lines
 * between, the last line's start), plus a thin strip over each seam between two parts. Where a
 * seam falls inside a device pixel (a fractional display scale), both parts' edges are
 * anti-aliased and the background showed through as a dark line (measured). The strip lies within
 * both parts, so it never shows outside the selection.
 */
/**
 * Marks the gutters as what scrollbars avoid (`@cerebro-ide/ui-scrollbar`): the horizontal one
 * starts after them, as IntelliJ's. Again after each update, in case they were drawn anew. Goes
 * after `lineNumbers()`.
 */
export const gutterObstacle = ViewPlugin.define((view) => {
  // After the line numbers' plugin, which made the gutters.
  const mark = () => {
    (view.dom.querySelector('.cm-gutters') as Element).setAttribute('data-scrollbar-obstacle', '');
  };
  mark();
  return { update: mark };
});

export const selection: Extension = [
  drawSelection(),
  layer({
    above: false,
    class: 'cm-selectionLayer',
    update: (update) =>
      update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
    markers: (view) =>
      view.state.selection.ranges.flatMap((range) => {
        const parts = RectangleMarker.forRange(view, 'cm-selectionBackground', range);
        return parts.slice(1).flatMap((below, i) => {
          const above = parts[i] as RectangleMarker;
          const left = Math.max(above.left, below.left);
          const right = Math.min(
            above.left + Number(above.width),
            below.left + Number(below.width),
          );
          const seam = above.top + above.height;
          return right > left
            ? [new RectangleMarker('cm-selectionBackground', left, seam - 1, right - left, 2)]
            : [];
        });
      }),
  }),
];

/**
 * The caret's line, highlighted as IntelliJ's: a layer beneath the selection's, so a selection on
 * that line shows. CodeMirror's own (`highlightActiveLine`) paints the line itself, which is above
 * the selection layer, and hid it: a double-clicked word showed nothing (measured in the test).
 */
export const activeLine: Extension = layer({
  above: false,
  class: 'cerebro-activeLineLayer',
  update: (update) =>
    update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
  markers: (view) => {
    // The layer's origin, as CodeMirror places its markers: the scroller's corner, scrolled.
    const scroller = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const top = view.documentTop - scroller.top + view.scrollDOM.scrollTop;
    const left = content.left - scroller.left + view.scrollDOM.scrollLeft;
    const lines = new Set(view.state.selection.ranges.map((range) => view.lineBlockAt(range.head)));
    return [...lines].map(
      (block) =>
        new RectangleMarker(
          'cerebro-activeLine',
          left,
          top + block.top,
          content.width,
          block.height,
        ),
    );
  },
});

/** Lines 22px apart at 13px, as WebStorm (measured), in whole pixels so they don't drift. */
export function scroller(fontSize: number) {
  return {
    fontSize: `${String(fontSize)}px`,
    lineHeight: `${String(Math.round(fontSize * 1.7))}px`,
  };
}

/** Syntax colours, from the theme's variables. */
export const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: variable('syntax-keyword') },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: variable('syntax-string') },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: variable('syntax-number') },
  { tag: [tags.comment, tags.meta], color: variable('syntax-comment'), fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: variable('syntax-function'),
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: variable('syntax-type') },
  { tag: [tags.propertyName, tags.attributeName], color: variable('syntax-property') },
  { tag: [tags.tagName, tags.heading], color: variable('syntax-tag'), fontWeight: 'bold' },
]);

/** A code editor for one file: editing its document, or showing a text read-only. */
export function CodeEditor(props: CodeEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-code';
  const shadow = container.attachShadow({ mode: 'open' });
  const settings = new Compartment();
  const keyed = new Compartment();
  /** At the word at the cursor, if there is one and a handler: runs it. */
  const atCursor =
    (handler: () => CodeEditorProps['onFindUsages']) =>
    (v: EditorView): boolean => {
      const head = v.state.selection.main.head;
      const word = wordAt(v, head);
      const run = handler();
      if (word === undefined || !run) return false;
      run(word, placeOf(v.state, head));
      return true;
    };
  const actions = () => {
    const keys = { ...DEFAULT_KEYS, ...props.keys?.() };
    return [
      findAndReplace(doc !== undefined, keys),
      keymap.of([
        ...keys.goToDefinition.map((key) => ({
          key,
          run: atCursor(() => props.onGoToDefinition),
        })),
        ...keys.findUsages.map((key) => ({ key, run: atCursor(() => props.onFindUsages) })),
        ...(doc
          ? [
              ...keys.undo.map((key) => ({ key, run: undo, preventDefault: true })),
              ...keys.redo.map((key) => ({ key, run: redo, preventDefault: true })),
            ]
          : []),
      ]),
    ];
  };
  const configure = () => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    props.softWrap?.() ? EditorView.lineWrapping : [],
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
  ];
  const language = languageFor(props.path);
  const doc = props.document;
  const caret = (state: EditorState) => {
    props.onCaret?.(placeOf(state, state.selection.main.head));
  };
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    gutterObstacle,
    fullWidth,
    selection,
    // After the selection: a later layer beneath goes lower.
    props.usages ? usageHighlights(props.usages) : [],
    activeLine,
    // Marks the caret's line (`cm-activeLine`), painted by the layer.
    highlightActiveLine(),
    doc ? [namedHistory(), keymap.of([indentWithTab])] : EditorState.readOnly.of(true),
    // The document follows the edits.
    doc
      ? EditorView.updateListener.of((update) => {
          if (update.docChanged) doc.text.set(update.state.doc);
        })
      : [],
    props.onCaret
      ? EditorView.updateListener.of((update) => {
          if (update.selectionSet) caret(update.state);
        })
      : [],
    keyed.of(actions()),
    keymap.of([
      // Not CodeMirror's Mod-[ and Mod-] (indent less and more): they're Back and Forward on
      // macOS, as IntelliJ's; Tab and Shift+Tab indent.
      ...defaultKeymap.filter((binding) => binding.key !== 'Mod-[' && binding.key !== 'Mod-]'),
    ]),
    EditorView.domEventHandlers({
      mousedown: (event, v) => {
        if (!(event.ctrlKey || event.metaKey) || !props.onGoToDefinition) return false;
        // Not precise: the nearest position, never none.
        const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }, false);
        const word = wordAt(v, pos);
        if (word === undefined) return false;
        event.preventDefault();
        props.onGoToDefinition(word, placeOf(v.state, pos));
        return true;
      },
    }),
    props.canGoToDefinition ? definitionLinks(props.canGoToDefinition) : [],
    theme,
    syntaxHighlighting(highlight),
    ...(language ? [language] : []),
    settings.of(configure()),
  ];
  const view = new EditorView({
    parent: shadow,
    root: shadow,
    state:
      doc?.state === undefined
        ? EditorState.create({ doc: doc ? doc.text.peek() : (props.text ?? ''), extensions })
        : EditorState.fromJSON(doc.state, { extensions }, KEPT),
  });
  caret(view.state);
  // The document's text changed elsewhere: an edit (Replace in Files) as one, undoable; read again
  // from disk, shown, not undoable.
  const following = effect(() => {
    const text = doc?.text.get();
    // The same text, or an equal one: a new editor's, made from the document's kept state.
    if (text === undefined || text === view.state.doc || text.eq(view.state.doc)) return undefined;
    const edit = doc?.lastEdit;
    if (edit?.before.eq(view.state.doc) && edit.changes.apply(edit.before).eq(text)) {
      view.dispatch({ changes: edit.changes, userEvent: 'input.replace' });
      return undefined;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: Transaction.addToHistory.of(false),
    });
    return undefined;
  });
  // The settings apply as they change, without rebuilding the editor.
  const watch = effect(() => {
    view.dispatch({ effects: [settings.reconfigure(configure()), keyed.reconfigure(actions())] });
    return undefined;
  });
  // A position to reveal: selected, scrolled to the middle of the editor (or with the line `top`
  // at the top, as it was: going back), and focused, as IntelliJ does after navigating. After the current task, since an editor opened to reveal a position isn't
  // in the document yet, and a detached element can't take the focus.
  /** A line by its zero-based number, kept within the document. */
  const lineOf = (n: number) =>
    view.state.doc.line(Math.min(Math.max(n + 1, 1), view.state.doc.lines));
  const revealing = effect(() => {
    const at = props.reveal?.();
    if (!at) return undefined;
    queueMicrotask(() => {
      if (!container.isConnected) return;
      const line = lineOf(at.line);
      const pos = Math.min(line.from + at.column, line.to);
      view.dispatch({
        // To `end`, on the same line: a match, say.
        selection: { anchor: pos, head: Math.min(line.from + (at.end ?? at.column), line.to) },
        effects:
          at.top === undefined
            ? EditorView.scrollIntoView(pos, { y: 'center' })
            : EditorView.scrollIntoView(lineOf(at.top).from, { y: 'start', yMargin: 0 }),
      });
      if (props.revealFocus !== false) view.focus();
    });
    return undefined;
  });
  // Read once CodeMirror has measured the lines scrolled into view: before, their heights are
  // estimates. Heights are from the document's top, below the content's padding.
  const scrolled = () => {
    view.requestMeasure({
      key: scrolled,
      read: () => view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentPadding.top).from,
      write: (from) => props.onScroll?.(view.state.doc.lineAt(from).number - 1),
    });
  };
  view.scrollDOM.addEventListener('scroll', scrolled);
  onCleanup(() => {
    view.scrollDOM.removeEventListener('scroll', scrolled);
    if (doc) doc.state = view.state.toJSON(KEPT);
    watch.dispose();
    revealing.dispose();
    following.dispose();
    view.destroy();
  });
  return container;
}
