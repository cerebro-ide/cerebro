// Several carets, as IntelliJ's editor has them: the mouse's Add or Remove Caret and rectangular
// selection, which the editor reads from the keymap's mouse shortcuts (EditorImpl's
// `isToggleCaretEvent` and `isCreateRectangularSelectionEvent`; the actions themselves are
// `EmptyAction`s), and the actions that add carets: Add Selection for Next Occurrence, Unselect
// Occurrence and Select All Occurrences (SelectNextOccurrenceAction and the others, read from their
// source), and Add Carets to Ends of Selected Lines (AddCaretPerSelectedLineAction).

import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type SelectionRange,
  type Text,
} from '@codemirror/state';
import {
  EditorView,
  rectangularSelection,
  type Command,
  type MouseSelectionStyle,
} from '@codemirror/view';
import { hinted, showHint } from './hint.js';

/** What the mouse does to the carets, read from the keymap's mouse shortcuts. */
export interface CaretMouse {
  /**
   * Whether a press adds a caret, or removes the one there: Add or Remove Caret's, and Add
   * Rectangular Selection on Mouse Drag's (IntelliJ's `isToggleCaretEvent` takes both).
   */
  addsCaret: (event: MouseEvent) => boolean;
  /** Whether a drag selects a rectangle: Create and Add Rectangular Selection on Mouse Drag's. */
  dragsColumn: (event: MouseEvent) => boolean;
}

/**
 * The mouse's carets: a press that adds one adds a range (CodeMirror removes one there, as
 * IntelliJ's toggles it), and a drag that selects a rectangle selects one, a range per line. With
 * none given, no press adds one (not CodeMirror's Ctrl+click, which is Go to Declaration's).
 */
export function caretMouse(mouse: (() => CaretMouse) | undefined): Extension {
  return [
    EditorView.clickAddsSelectionRange.of((event) => mouse?.().addsCaret(event) ?? false),
    // First: Add Rectangular Selection on Mouse Drag is both.
    rectangularSelection({ eventFilter: (event) => mouse?.().dragsColumn(event) ?? false }),
    EditorView.mouseSelectionStyle.of((view, event) =>
      mouse?.().addsCaret(event) ? addingCaret(view, event) : null,
    ),
  ];
}

/**
 * A press that adds a caret, or a range as it's dragged, to those there; one let go where it was
 * pressed, on another caret or range, removes that one instead. Not CodeMirror's own, which takes
 * Shift, held in IntelliJ's Alt+Shift+click, as extending the main selection (measured: the new
 * caret was lost in it).
 */
function addingCaret(view: EditorView, event: MouseEvent): MouseSelectionStyle {
  const at = (e: MouseEvent) => view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
  let start = at(event);
  let before = view.state.selection;
  return {
    update: (update) => {
      if (!update.docChanged) return;
      start = update.changes.mapPos(start);
      before = before.map(update.changes);
    },
    get: (e) => {
      const head = at(e);
      const there = before.ranges.findIndex((r) => r.from <= start && r.to >= start);
      if (head === start && there !== -1 && before.ranges.length > 1) {
        const ranges = before.ranges.filter((_, i) => i !== there);
        return EditorSelection.create(ranges, ranges.length - 1);
      }
      return before.addRange(EditorSelection.range(start, head));
    },
  };
}

/**
 * Whether a character is part of a word, as Java's `Character.isJavaIdentifierPart`, which
 * IntelliJ's occurrence actions take (`SelectWordUtil.JAVA_IDENTIFIER_PART_CONDITION`): letters,
 * digits, `_`, `$` and the other currency signs, combining marks.
 */
const WORD_PART = /[\p{L}\p{Nd}\p{Nl}\p{Mn}\p{Mc}\p{Pc}\p{Sc}]/u;

const isWordPart = (char: string) => char !== '' && WORD_PART.test(char);

/**
 * The word at `pos`, or just before it, as IntelliJ's `SelectWordUtil.getWordSelectionRange`;
 * none away from one.
 */
export function wordAt(doc: Text, pos: number): { from: number; to: number } | undefined {
  const char = (at: number) => doc.sliceString(at, at + 1);
  let at = pos;
  if (at === doc.length || (at > 0 && !isWordPart(char(at)) && isWordPart(char(at - 1)))) at--;
  if (at < 0 || !isWordPart(char(at))) return undefined;
  let from = at;
  let to = at;
  while (from > 0 && isWordPart(char(from - 1))) from--;
  while (to < doc.length && isWordPart(char(to))) to++;
  return { from, to };
}

/**
 * Where `text` is next found from `from`, matching case, as IntelliJ's occurrence actions search
 * (`getFindModel`): with `wholeWords`, only where it isn't part of a longer word.
 */
export function findFrom(
  doc: Text,
  text: string,
  from: number,
  wholeWords: boolean,
): { from: number; to: number } | undefined {
  const all = doc.toString();
  for (let at = all.indexOf(text, from); at !== -1; at = all.indexOf(text, at + 1)) {
    const to = at + text.length;
    const whole = !isWordPart(all.charAt(at - 1)) && !isWordPart(all.charAt(to));
    if (!wholeWords || whole) return { from: at, to };
  }
  return undefined;
}

/**
 * The occurrence search under way, while the last thing done was an occurrence action (IntelliJ's
 * `isRepeatedActionInvocation`): whether it matches whole words (it started from a word at the
 * caret) and whether the last search found nothing, so the next starts from the top.
 */
interface Search {
  wholeWords: boolean;
  notFound: boolean;
}

const searching = StateEffect.define<Search>();

/** Forgotten as anything else changes the text or the selection. */
const search = StateField.define<Search | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(searching)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** IntelliJ's words, FindBundle's `select.next.occurence.not.found.message`. */
export const NOT_FOUND = 'Not found, try again to search from top';

/** The main selection made the word at its caret: Select Next's and Select All's first step. */
function selectWord(state: EditorState): SelectionRange | undefined {
  const word = wordAt(state.doc, state.selection.main.head);
  return word && EditorSelection.range(word.from, word.to);
}

/** A range over `found`, its caret at the same end as `like`'s. */
function rangeLike(like: SelectionRange, found: { from: number; to: number }): SelectionRange {
  return like.head === like.from && !like.empty
    ? EditorSelection.range(found.to, found.from)
    : EditorSelection.range(found.from, found.to);
}

/**
 * Add Selection for Next Occurrence: with nothing selected, the word at the caret, and later ones
 * then match whole words; else a caret more, on the next match of the main selection after it,
 * made the main one. None after it: IntelliJ's hint, and the next search starts from the top.
 */
export const selectNextOccurrence: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  const was = state.field(search);
  if (main.empty) {
    const word = selectWord(state);
    if (word) {
      view.dispatch({
        selection: state.selection.replaceRange(word),
        effects: [
          searching.of({ wholeWords: true, notFound: false }),
          EditorView.scrollIntoView(word),
        ],
        userEvent: 'select',
      });
    }
    return true;
  }
  const wholeWords = was?.wholeWords ?? false;
  const found = findFrom(
    state.doc,
    state.sliceDoc(main.from, main.to),
    was?.notFound ? 0 : main.to,
    wholeWords,
  );
  if (!found) {
    view.dispatch({ effects: searching.of({ wholeWords, notFound: true }) });
    showHint(view, NOT_FOUND);
    return true;
  }
  const taken = state.selection.ranges.some(
    (range) => range.from === found.from && range.to === found.to,
  );
  if (taken) {
    // Already selected (the top's, after a search found none): nothing added.
    view.dispatch({ effects: searching.of({ wholeWords, notFound: was?.notFound ?? false }) });
    return true;
  }
  const ranges = [...state.selection.ranges, rangeLike(main, found)];
  view.dispatch({
    selection: EditorSelection.create(ranges, ranges.length - 1),
    effects: [searching.of({ wholeWords, notFound: false }), EditorView.scrollIntoView(found.from)],
    userEvent: 'select',
  });
  return true;
};

/**
 * Unselect Occurrence: the main caret removed, where there are others (the one before it made the
 * main one, as the one added before it: Claude's choice, open to change, IntelliJ's being the one
 * added last); else the selection dropped.
 */
export const unselectOccurrence: Command = (view) => {
  const { state } = view;
  const { ranges, mainIndex, main } = state.selection;
  const was = state.field(search);
  const effects = searching.of({ wholeWords: was?.wholeWords ?? false, notFound: false });
  const selection =
    ranges.length > 1
      ? EditorSelection.create(
          ranges.filter((_, i) => i !== mainIndex),
          mainIndex === 0 ? ranges.length - 2 : mainIndex - 1,
        )
      : EditorSelection.single(main.head);
  view.dispatch({ selection, effects, scrollIntoView: true, userEvent: 'select' });
  return true;
};

/**
 * Select All Occurrences: every match of the main selection (with nothing selected, the word at
 * the caret, matching whole words), a caret at each; the one where it was stays the main one.
 */
export const selectAllOccurrences: Command = (view) => {
  const { state } = view;
  let main: SelectionRange | undefined = state.selection.main;
  const wholeWords = main.empty;
  if (main.empty) main = selectWord(state);
  if (!main) return true;
  const text = state.sliceDoc(main.from, main.to);
  const ranges: SelectionRange[] = [];
  let mainIndex = 0;
  for (
    let found = findFrom(state.doc, text, 0, wholeWords);
    found;
    found = findFrom(state.doc, text, found.to, wholeWords)
  ) {
    if (found.from === main.from) mainIndex = ranges.length;
    ranges.push(rangeLike(main, found));
  }
  view.dispatch({
    selection: EditorSelection.create(ranges, mainIndex),
    scrollIntoView: true,
    userEvent: 'select',
  });
  return true;
};

/**
 * Add Carets to Ends of Selected Lines: each selection's lines given a caret at their end (one
 * ending at a line's start leaves that line out), the selection gone; the main one at the end of
 * the main caret's line (Claude's choice, open to change).
 */
export const addCaretsToLineEnds: Command = (view) => {
  const { state } = view;
  const ranges: SelectionRange[] = [];
  let mainIndex = 0;
  state.selection.ranges.forEach((range, index) => {
    const first = state.doc.lineAt(range.from).number;
    let last = state.doc.lineAt(range.to).number;
    if (last > first && state.doc.line(last).from === range.to) last--;
    const head = state.doc.lineAt(range.head).number;
    for (let line = first; line <= last; line++) {
      if (index === state.selection.mainIndex && line === Math.min(head, last)) {
        mainIndex = ranges.length;
      }
      ranges.push(EditorSelection.cursor(state.doc.line(line).to));
    }
  });
  view.dispatch({
    selection: EditorSelection.create(ranges, mainIndex),
    scrollIntoView: true,
    userEvent: 'select',
  });
  return true;
};

/** What the occurrence actions need in an editor: their search, and the hint for none found. */
export const occurrences: Extension = [search, hinted];
