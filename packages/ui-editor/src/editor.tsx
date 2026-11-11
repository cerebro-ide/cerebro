// The code editor: CodeMirror 6, in Cerebro's theme (its colours are the theme's CSS variables, so
// it follows dark and light), with the language for the file and the editor settings applied as
// they change. Given a document, it edits it, with undo; without one, it's read-only.
//
// It lives in a shadow root. CodeMirror adds its styles with style-mod, which uses constructable
// stylesheets inside a shadow root but <style> elements in a document, and the page's
// Content-Security-Policy blocks those (`style-src 'self'`). The theme's variables still reach it:
// custom properties are inherited into shadow roots.

import {
  defaultKeymap,
  historyField,
  indentWithTab,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
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
import {
  completionKeys,
  completions,
  type AskCompletions,
  type ResolveCompletion,
} from './completions.js';
import { EditorDocument, KEPT } from './document.js';
import { detectIndent, indentUnitOf, type Indent } from './indent.js';
import type { Selected } from './line.js';

/** IntelliJ's: 4 spaces. */
const DEFAULT_INDENT: Indent = { tabs: false, size: 4 };
import { documentation, documentationKeys, type AskDocumentation } from './documentation.js';
import { parameterInfo, parameterKeys, type AskSignatures } from './parameters.js';
import { renameKeys, renaming, type AskRenaming, type Rename } from './rename.js';
import { foldKeys, folding, type AskFolds } from './folding.js';
import { formattable, formatting, type AskFormat } from './format.js';
import { findAndReplace } from './find.js';
import { historyName, namedHistory } from './history.js';
import { textAnnotations, type AskAnnotation } from './annotations.js';
import { gutterMarkers, type AskMarks, type Mark } from './markers.js';
import { goToProblem, problemHighlights, type AskProblems } from './problems.js';
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
  /** How lines are indented, as the settings say. Read reactively. Default: 4 spaces. */
  indent?: () => Indent;
  /**
   * Whether the file's own indent is used instead, when its lines tell one, as IntelliJ's "Detect
   * and use existing file indents for editing". Read reactively. Default: off.
   */
  detectIndent?: () => boolean;
  /** The indent used, and whether it's the file's own: as the editor opens, and as it changes. */
  onIndent?: (indent: Indent, detected: boolean) => void;
  /**
   * A position to show and select: where a definition is. Read reactively; zero-based. Each object
   * is revealed once, as `focus`: a later editor of the file given it again keeps its own place.
   */
  reveal?: () =>
    | { line: number; column: number; end?: number | undefined; top?: number | undefined }
    | undefined;
  /** Whether revealing a position also focuses the editor, as after navigating. Default: true. */
  revealFocus?: boolean;
  /**
   * A request to take the focus, as after opening the file from a list: each object focuses the
   * editor once it's in the page, and only once, whichever editor takes it first. Read reactively.
   */
  focus?: () => object | undefined;
  /**
   * Go to definition of the word at the cursor, given where it is (zero-based): its keys (Mod+B in
   * IntelliJ) or Mod+click.
   */
  onGoToDefinition?: (word: string, at: { line: number; column: number }) => void;
  /** Find usages of the word at the cursor, given where it is: its keys (Alt+F7 in IntelliJ). */
  onFindUsages?: (word: string, at: { line: number; column: number }) => void;
  /**
   * Show what can be done at the caret, given where it is and its place on the screen, for a list
   * there: its keys (Alt+Enter in IntelliJ, its Show Context Actions).
   */
  onContextActions?: (
    at: { line: number; column: number },
    caret: Pick<Element, 'getBoundingClientRect'>,
  ) => void;
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
  /**
   * The file's gutter markers, given its text: what its members implement or override, and what
   * implements or overrides them. Asked as it opens, and once an edit has settled. None: no markers.
   */
  marks?: AskMarks;
  /**
   * The file's problems, given its text: errors and warnings, highlighted as IntelliJ's. Asked as
   * it opens, and once an edit has settled. None: no problems shown.
   */
  problems?: AskProblems;
  /**
   * What can go at the caret, given the text: listed as one types and on its keys (Ctrl+Space),
   * as IntelliJ's code completion, when the document can be edited. None: no completion.
   */
  completions?: AskCompletions;
  /** The other edits of a completion chosen, when it has them only by asking (an import). */
  resolveCompletion?: ResolveCompletion;
  /**
   * The documentation of the symbol at a place: shown with the pointer resting on it, and for the
   * caret's on its keys (Ctrl+Q), as IntelliJ's Quick Documentation. None: no documentation.
   */
  documentation?: AskDocumentation;
  /**
   * What's called at a place: its signatures and the parameter the place is at, shown above the
   * caret on its keys (Ctrl+P) and as a call's arguments are typed, as IntelliJ's Parameter Info.
   * None: no Parameter Info.
   */
  parameterInfo?: AskSignatures;
  /**
   * Where the name at a place is that Rename renames, and what renames it everywhere: in place on
   * its keys (Shift+F6), as IntelliJ's, when the document can be edited. None: no Rename.
   */
  renaming?: AskRenaming;
  /**
   * The edits that format the text, or the selection: Reformat Code on its keys (Ctrl+Alt+L), as
   * IntelliJ's, when the document can be edited. None: no Reformat Code.
   */
  format?: AskFormat;
  /**
   * Where the text folds, given it: asked as it opens, and once an edit has settled. Where it says
   * nothing on a line, or with none, the language's grammar says.
   */
  folds?: AskFolds;
  onRename?: Rename;
  /** The counts of problems in the corner clicked: IntelliJ's shows the Problems tool window. */
  onShowProblems?: () => void;
  /** A gutter marker clicked: go where it says. */
  onMark?: (mark: Mark) => void;
  /**
   * Text annotations in the gutter, before the line numbers, as IntelliJ's Annotate: what asks for
   * them, given the text, as they're shown and once an edit has settled. Read reactively. None:
   * none shown.
   */
  annotate?: () => AskAnnotation | undefined;
  /**
   * Where the caret is, zero-based, and what's selected, if anything: as the editor opens, and each
   * time either changes.
   */
  onCaret?: (at: { line: number; column: number }, selected: Selected | undefined) => void;
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
  /** Basic code completion: what can go at the caret. */
  complete?: readonly string[];
  /** Quick Documentation: what the symbol at the caret is. */
  quickDocumentation?: readonly string[];
  /** Parameter Info: what's called at the caret. */
  parameterInfo?: readonly string[];
  /** Rename: the name at the caret, everywhere it's used. */
  rename?: readonly string[];
  /** Reformat Code: the text, or the selection, formatted. */
  format?: readonly string[];
  /** Collapse and Expand: the part around the caret, folded; the one on its line, unfolded. */
  fold?: readonly string[];
  unfold?: readonly string[];
  /** Collapse All and Expand All. */
  foldAll?: readonly string[];
  unfoldAll?: readonly string[];
  /** Show Context Actions: what can be done at the caret (a problem's fixes). */
  contextActions?: readonly string[];
  /** Next and Previous Highlighted Error: the next problem, or the previous. */
  nextProblem?: readonly string[];
  previousProblem?: readonly string[];
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
  complete: ['Ctrl-Space'],
  quickDocumentation: ['Ctrl-q'],
  parameterInfo: ['Ctrl-p'],
  rename: ['Shift-F6'],
  format: ['Mod-Alt-l'],
  // Shift with a character as CodeMirror finds it: the key's own, Shift held (`-` for `_`).
  fold: ['Mod--'],
  unfold: ['Mod-='],
  foldAll: ['Mod-Shift--'],
  unfoldAll: ['Mod-Shift-='],
  contextActions: ['Alt-Enter'],
  nextProblem: ['F2'],
  previousProblem: ['Shift-F2'],
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

/** Focus requests already taken (`focus`): a later editor given one again leaves the focus. */
const taken = new WeakSet<object>();
/** Positions already revealed (`reveal`), likewise: a later editor shows where the last was. */
const revealed = new WeakSet<object>();

/** A position in the editor as a line and column, zero-based. */
/** What the main selection holds, if it holds anything. */
function selectedIn(state: EditorState): Selected | undefined {
  const { from, to, empty } = state.selection.main;
  if (empty) return undefined;
  return {
    // Code points, as IntelliJ's Character.codePointCount: not graphemes.
    chars: Array.from(state.sliceDoc(from, to)).length,
    lineBreaks: state.doc.lineAt(to).number - state.doc.lineAt(from).number,
  };
}

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
  // Annotate's columns, in the UI's font as IntelliJ's new UI draws them; each line's background
  // fills its height.
  '.cerebro-annotations': { fontFamily: variable('font'), fontSize: variable('font-size') },
  '.cerebro-annotations .cm-gutterElement': { display: 'flex' },
  '.cerebro-annotation': { display: 'flex', alignItems: 'center', color: variable('annotations') },
  '.cerebro-annotation--latest': { color: variable('annotations-latest') },
  '.cerebro-annotation__column': { flex: 'none', overflow: 'hidden', whiteSpace: 'pre' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 42px 0 9px' },
  // With markers, they take the room after the numbers (their place in it is a claim).
  '.cm-lineNumbers:has(+ .cerebro-markers) .cm-gutterElement': { paddingRight: '6px' },
  // The chevrons, last, in the room after the numbers (or the markers: wider then, a claim).
  '.cm-lineNumbers:has(+ .cm-foldGutter) .cm-gutterElement': { paddingRight: '28px' },
  '.cm-foldGutter .cm-gutterElement': {
    width: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cerebro-fold': {
    display: 'flex',
    fill: 'none',
    stroke: variable('editor-fold'),
    cursor: 'pointer',
  },
  // An open one shows with the pointer over the gutter, as IntelliJ's new UI (a claim).
  '.cerebro-fold--open': { opacity: '0' },
  '.cm-gutters:hover .cerebro-fold--open': { opacity: '1' },
  // What's folded, boxed: FOLDED_TEXT_ATTRIBUTES and its border (the box's corners a claim).
  '.cerebro-folded': {
    color: variable('editor-folded'),
    backgroundColor: variable('editor-folded-background'),
    border: `1px solid ${variable('editor-folded-border')}`,
    borderRadius: '3px',
    margin: '0 1px',
    cursor: 'pointer',
  },
  '.cerebro-markers .cm-gutterElement': {
    width: '36px',
    display: 'flex',
    alignItems: 'center',
  },
  '.cerebro-markers__line': { display: 'flex', gap: '2px' },
  '.cerebro-marker': { display: 'flex', cursor: 'pointer' },
  '.cerebro-marker--i': {
    '--marker': variable('editor-marker-i'),
    '--marker-disc': variable('editor-marker-i-disc'),
  },
  '.cerebro-marker--o': {
    '--marker': variable('editor-marker-o'),
    '--marker-disc': variable('editor-marker-o-disc'),
  },
  '.cerebro-marker--up': { '--marker-arrow': variable('editor-marker-up') },
  '.cerebro-marker--down': { '--marker-arrow': variable('editor-marker-down') },
  '.cerebro-marker__disc': { fill: 'var(--marker-disc)' },
  '.cerebro-marker__mark': { fill: 'var(--marker)' },
  '.cerebro-marker__arrow': { fill: 'var(--marker-arrow)' },
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
  '.cerebro-find__option svg': { display: 'block', margin: '0 auto' },
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
  // Their marks over the scrollbar's band: in the thumb's 10px, 2px from the edge (where in the band
  // is a claim; IntelliJ's stripe is 14px beside its thumb), under the thumb, never in the way.
  '.cerebro-stripe': {
    position: 'absolute',
    right: '2px',
    width: '10px',
    pointerEvents: 'none',
  },
  '.cerebro-stripeMark': {
    position: 'absolute',
    left: '0',
    right: '0',
    // The stripe lets the pointer through to the scrollbar; its marks take clicks.
    pointerEvents: 'auto',
  },
  '.cerebro-usageMark': { backgroundColor: variable('editor-usage-stripe') },
  // A mark is 2px high: easier to hit with 2px more on each side.
  '.cerebro-stripeMark::before': {
    content: '""',
    position: 'absolute',
    inset: '-2px 0',
  },
  '.cerebro-usageMark--write': { backgroundColor: variable('editor-usage-stripe-write') },
  // Problems, as IntelliJ's: a wave under an error or a warning, a weak warning's paler; a light
  // theme's warning a background instead; unused code greyed, deprecated code struck out.
  '.cerebro-problem--error, .cerebro-problem--warning, .cerebro-problem--weak': {
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '3px',
  },
  '.cerebro-problem--error': { textDecorationColor: variable('editor-error') },
  '.cerebro-problem--warning': {
    textDecorationColor: variable('editor-warning'),
    backgroundColor: variable('editor-warning-background'),
  },
  '.cerebro-problem--weak': { textDecorationColor: variable('editor-weak') },
  '.cerebro-problem--unused, .cerebro-problem--unused *': { color: variable('editor-unused') },
  '.cerebro-problem--deprecated': {
    textDecorationLine: 'line-through',
    textDecorationColor: variable('editor-deprecated'),
  },
  '.cerebro-problemMark--error': { backgroundColor: variable('editor-error-stripe') },
  '.cerebro-problemMark--warning': { backgroundColor: variable('editor-warning-stripe') },
  '.cerebro-problemMark--weak': { backgroundColor: variable('editor-weak-stripe') },
  // A problem's message under the pointer: as the app's tooltips (`@cerebro-ide/ui-tooltip`). The
  // Quick Documentation, Parameter Info and hints at the caret look the same.
  '.cm-tooltip.cm-tooltip-hover, .cm-tooltip.cerebro-quickDoc, .cm-tooltip.cerebro-parameterInfo, .cm-tooltip.cerebro-hint':
    {
      backgroundColor: variable('tooltip'),
      color: variable('text'),
      border: `1px solid ${variable('tooltip-border')}`,
      borderRadius: '4px',
      boxShadow: variable('shadow'),
    },
  // The completion list, as IntelliJ's: the popups' look, in the editor's font, a type to the right.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: variable('panel'),
    color: variable('text'),
    border: `1px solid ${variable('separator')}`,
    borderRadius: '4px',
    boxShadow: variable('shadow'),
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: variable('font-mono'),
    maxHeight: '300px',
    minWidth: '300px',
    padding: '4px 0',
    // The page's own scrollbars don't reach the shadow root: a thin one, in their colour.
    scrollbarWidth: 'thin',
    scrollbarColor: `${variable('scrollbar')} transparent`,
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '0 8px',
    lineHeight: variable('menu-item-height'),
  },
  // More specific than CodeMirror's own, which is blue.
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: variable('menu-highlight'),
    color: variable('text'),
  },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    color: variable('accent'),
    fontWeight: '600',
  },
  '.cm-completionDetail': {
    marginLeft: 'auto',
    paddingLeft: '24px',
    fontStyle: 'normal',
    color: variable('text-muted'),
  },
  // A problem's message and the documentation, in one tooltip: a line between.
  '.cm-tooltip-section:not(:first-child)': {
    borderTop: `1px solid ${variable('tooltip-border')}`,
  },
  // Documentation, as IntelliJ's: its definition as code, a line, then what its comments say.
  '.cerebro-doc': {
    maxWidth: '600px',
    maxHeight: '400px',
    overflow: 'auto',
    padding: '8px 12px',
    fontFamily: variable('font'),
    fontSize: variable('font-size'),
    lineHeight: '1.5',
    scrollbarWidth: 'thin',
    scrollbarColor: `${variable('scrollbar')} transparent`,
  },
  '.cerebro-doc__definition': {
    paddingBottom: '6px',
    marginBottom: '6px',
    borderBottom: `1px solid ${variable('tooltip-border')}`,
  },
  '.cerebro-doc pre, .cerebro-doc code': { fontFamily: variable('font-mono') },
  '.cerebro-doc pre': { margin: '0', whiteSpace: 'pre-wrap' },
  '.cerebro-doc p, .cerebro-doc ul, .cerebro-doc ol, .cerebro-doc blockquote': {
    margin: '0 0 6px',
  },
  '.cerebro-doc__content > :last-child': { marginBottom: '0' },
  '.cerebro-doc ul, .cerebro-doc ol': { paddingLeft: '20px' },
  '.cerebro-doc hr': {
    border: 'none',
    borderTop: `1px solid ${variable('tooltip-border')}`,
    margin: '6px 0',
  },
  '.cerebro-doc__heading': { fontWeight: '600' },
  '.cerebro-doc__link': { color: variable('editor-link') },
  // The name being renamed, boxed (a claim: IntelliJ's box, in the accent colour, not measured).
  '.cerebro-rename': { outline: `1px solid ${variable('accent')}`, borderRadius: '2px' },
  '.cerebro-rename--empty': { display: 'inline-block', width: '2px', height: '1em' },
  // A hint at the caret: why there's nothing to rename, the lines Reformat Code changed.
  '.cerebro-hint': {
    padding: '6px 10px',
    maxWidth: '500px',
    fontFamily: variable('font'),
    fontSize: variable('font-size'),
  },
  // Parameter Info, as IntelliJ's: a line per signature, in the editor's font.
  '.cerebro-parameterInfo': {
    padding: '4px 8px',
    fontFamily: variable('font-mono'),
    fontSize: variable('font-size'),
    lineHeight: '1.5',
    whiteSpace: 'pre',
  },
  // With more than one, the call's own apart from the others (a claim: IntelliJ's shows the others
  // dimmed when the arguments rule them out).
  '.cerebro-parameterInfo:has(.cerebro-parameterInfo__signature--current) .cerebro-parameterInfo__signature:not(.cerebro-parameterInfo__signature--current)':
    { color: variable('text-muted') },
  '.cerebro-problemTooltip': {
    padding: '8px 12px',
    maxWidth: '600px',
    fontFamily: variable('font'),
    fontSize: variable('font-size'),
    whiteSpace: 'pre-wrap',
  },
  // IntelliJ's inspection widget: the counts, top right, over the text.
  '.cerebro-problems': {
    position: 'absolute',
    top: '4px',
    right: '16px',
    zIndex: '5',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 4px',
    borderRadius: '4px',
    backgroundColor: variable('background'),
    fontFamily: variable('font'),
    fontSize: variable('font-size'),
    color: variable('text'),
  },
  '.cerebro-problems[hidden]': { display: 'none' },
  '.cerebro-problems__count, .cerebro-problems__ok': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  '.cerebro-problems__arrow': {
    display: 'flex',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'none',
    cursor: 'pointer',
  },
  '.cerebro-problems__arrow:hover': { backgroundColor: variable('hover') },
  '.cerebro-problems__count--opens': { cursor: 'pointer' },
  '.cerebro-problemIcon__ok': {
    fill: 'none',
    stroke: variable('icon-ok'),
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  '.cerebro-problemIcon__chevron': {
    fill: 'none',
    stroke: variable('icon'),
    strokeLinecap: 'round',
  },
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
  /** Asks for what can be done at the caret, with where the list goes: below the caret's line. */
  const contextActions = (
    v: EditorView,
    show: NonNullable<CodeEditorProps['onContextActions']>,
  ) => {
    const head = v.state.selection.main.head;
    const caret = {
      // Measured as the list opens. Scrolled out of view, the editor's top left (a claim:
      // IntelliJ's goes in the editor then).
      getBoundingClientRect: () => {
        const box = v.scrollDOM.getBoundingClientRect();
        const at = v.coordsAtPos(head) ?? box;
        return at.top >= box.top && at.bottom <= box.bottom
          ? new DOMRect(at.left, at.top, 0, at.bottom - at.top)
          : box;
      },
    };
    show(placeOf(v.state, head), caret);
  };
  const actions = () => {
    const keys = { ...DEFAULT_KEYS, ...props.keys?.() };
    const { onContextActions } = props;
    return [
      findAndReplace(doc !== undefined, keys),
      doc && props.completions ? completionKeys(keys.complete) : [],
      props.documentation ? documentationKeys(props.documentation, keys.quickDocumentation) : [],
      props.parameterInfo ? parameterKeys(keys.parameterInfo) : [],
      doc && props.renaming && props.onRename ? renameKeys(keys.rename) : [],
      doc && props.format ? formatting(keys.format, props.format) : [],
      foldKeys(keys),
      keymap.of([
        ...keys.goToDefinition.map((key) => ({
          key,
          run: atCursor(() => props.onGoToDefinition),
        })),
        ...keys.findUsages.map((key) => ({ key, run: atCursor(() => props.onFindUsages) })),
        ...(onContextActions
          ? keys.contextActions.map((key) => ({
              key,
              run: (v: EditorView) => {
                contextActions(v, onContextActions);
                return true;
              },
            }))
          : []),
        ...(props.problems
          ? [
              ...keys.nextProblem.map((key) => ({
                key,
                run: (v: EditorView) => goToProblem(v, true),
              })),
              ...keys.previousProblem.map((key) => ({
                key,
                run: (v: EditorView) => goToProblem(v, false),
              })),
            ]
          : []),
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
    props.onCaret?.(placeOf(state, state.selection.main.head), selectedIn(state));
  };
  const annotating = new Compartment();
  let annotated = props.annotate?.();
  const indenting = new Compartment();
  /** The indent last told, as `unit detected`. */
  let told: string | undefined;
  /** Indents as the settings say, or as the file does when it tells and that's asked for. */
  const reindent = () => {
    const set = props.indent?.() ?? DEFAULT_INDENT;
    const found = props.detectIndent?.()
      ? detectIndent(view.state, set, view.state.tabSize)
      : undefined;
    const indent = found ?? set;
    const unit = indentUnitOf(indent);
    if (unit !== view.state.facet(indentUnit)) {
      view.dispatch({ effects: indenting.reconfigure(indentUnit.of(unit)) });
    }
    const now = `${unit} ${String(found !== undefined)}`;
    if (now === told) return;
    told = now;
    props.onIndent?.(indent, found !== undefined);
  };
  const extensions: Extension[] = [
    // Before the line numbers, as IntelliJ's new UI.
    annotating.of(annotated ? textAnnotations(annotated) : []),
    lineNumbers(),
    highlightActiveLineGutter(),
    props.marks ? gutterMarkers(props.marks, (mark) => props.onMark?.(mark)) : [],
    folding(props.folds),
    gutterObstacle,
    fullWidth,
    selection,
    // After the selection: a later layer beneath goes lower.
    props.usages ? usageHighlights(props.usages) : [],
    props.problems ? problemHighlights(props.problems, props.onShowProblems) : [],
    doc && props.completions ? completions(props.completions, props.resolveCompletion) : [],
    // After the problems: below a problem's message, in the same tooltip, as IntelliJ's.
    props.documentation ? documentation(props.documentation) : [],
    props.parameterInfo ? parameterInfo(props.parameterInfo) : [],
    doc && props.renaming && props.onRename ? renaming(props.renaming, props.onRename) : [],
    activeLine,
    // Marks the caret's line (`cm-activeLine`), painted by the layer.
    highlightActiveLine(),
    indenting.of(indentUnit.of(indentUnitOf(props.indent?.() ?? DEFAULT_INDENT))),
    // The file's indent is looked at again after an edit, once the edit's update is over.
    EditorView.updateListener.of((update) => {
      if (update.docChanged && props.detectIndent?.()) queueMicrotask(reindent);
    }),
    doc
      ? [namedHistory(), keymap.of([indentWithTab]), formattable(props.path)]
      : EditorState.readOnly.of(true),
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
    // Scrolled as the last editor of the document was, as IntelliJ keeps a file's place in its tab.
    ...(doc?.scroll === undefined ? {} : { scrollTo: doc.scroll }),
  });
  caret(view.state);
  // The document's text changed elsewhere: an edit (Replace in Files) as one, undoable on its own,
  // not joined with typing next to it; read again from disk, shown, not undoable.
  const following = effect(() => {
    const text = doc?.text.get();
    // The same text, or an equal one: a new editor's, made from the document's kept state.
    if (text === undefined || text === view.state.doc || text.eq(view.state.doc)) return undefined;
    const edit = doc?.lastEdit;
    if (edit?.before.eq(view.state.doc) && edit.changes.apply(edit.before).eq(text)) {
      view.dispatch({
        changes: edit.changes,
        userEvent: 'input.replace',
        annotations: [
          isolateHistory.of('full'),
          ...(edit.name === undefined ? [] : [historyName.of(edit.name)]),
        ],
      });
      return undefined;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: Transaction.addToHistory.of(false),
    });
    return undefined;
  });
  // Annotations shown or closed, or asked of another.
  const annotations = effect(() => {
    const ask = props.annotate?.();
    if (ask === annotated) return undefined;
    annotated = ask;
    view.dispatch({ effects: annotating.reconfigure(ask ? textAnnotations(ask) : []) });
    return undefined;
  });
  // The settings apply as they change, without rebuilding the editor.
  const watch = effect(() => {
    view.dispatch({ effects: [settings.reconfigure(configure()), keyed.reconfigure(actions())] });
    reindent();
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
      if (!container.isConnected || revealed.has(at)) return;
      revealed.add(at);
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
  const focusing = effect(() => {
    const request = props.focus?.();
    if (request === undefined) return undefined;
    // After the current task, as revealing: a new editor isn't in the document yet.
    queueMicrotask(() => {
      if (!container.isConnected || taken.has(request)) return;
      taken.add(request);
      view.focus();
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
    if (doc) {
      doc.state = view.state.toJSON(KEPT);
      doc.scroll = view.scrollSnapshot();
    }
    watch.dispose();
    annotations.dispose();
    revealing.dispose();
    focusing.dispose();
    following.dispose();
    view.destroy();
  });
  return container;
}
