// Several carets, as IntelliJ's editor has them: the mouse's Add or Remove Caret and rectangular
// selection, which the editor reads from the keymap's mouse shortcuts (EditorImpl's
// `isToggleCaretEvent` and `isCreateRectangularSelectionEvent`; the actions themselves are
// `EmptyAction`s), and the actions that add carets: Add Selection for Next Occurrence, Unselect
// Occurrence and Select All Occurrences (SelectNextOccurrenceAction and the others, read from their
// source), Add Carets to Ends of Selected Lines (AddCaretPerSelectedLineAction), and Clone Caret
// Above and Below (CloneCaretActionHandler and CaretImpl's `clone`), with the double Ctrl that runs
// them where the keymap gives them no keys (ModifierKeyDoubleClickHandler).

import {
  countColumn,
  EditorSelection,
  findColumn,
  Prec,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type SelectionRange,
  type Text,
  type TransactionSpec,
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

/**
 * A caret's part in a run of Clone Caret: how far from where the run started (negative above), and
 * the columns a clone keeps, as CaretImpl's desired columns: its caret's, and its selection's lead
 * and other end's, so a clone through a short line takes them up again past it.
 */
interface Cloned {
  level: number;
  column?: number;
  lead?: number;
  other?: number;
}

const cloned = StateEffect.define<readonly Cloned[]>();

/**
 * The carets' parts while the last thing done was Clone Caret, or a move with Shift (IntelliJ's
 * `isRepeatedActionInvocation`: its `..._WITH_SELECTION` actions; their columns are then where they
 * are); forgotten as anything else changes the text or the carets.
 */
const cloning = StateField.define<readonly Cloned[] | null>({
  create: () => null,
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(cloned)) return effect.value;
    if (!value || tr.docChanged || !tr.selection) return tr.docChanged ? null : value;
    const moved =
      tr.isUserEvent('select') &&
      !tr.isUserEvent('select.pointer') &&
      tr.selection.ranges.length === value.length;
    return moved ? value.map(({ level }) => ({ level })) : null;
  },
});

/** A position's column, a tab counted to its stop, as IntelliJ's logical columns. */
function columnOf(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return countColumn(line.text.slice(0, pos - line.from), state.tabSize);
}

/**
 * Where a column falls on a line, at its end past it (IntelliJ's without virtual space); before the
 * first line the text's start, past the last its end (CaretImpl's `truncate`).
 */
function placeOf(state: EditorState, number: number, column: number): number {
  if (number < 1) return 0;
  if (number > state.doc.lines) return state.doc.length;
  const line = state.doc.line(number);
  return line.from + findColumn(line.text, column, state.tabSize);
}

/**
 * A caret's clone a line above or below, as CaretImpl's `clone`: at its column, its selection's
 * ends at theirs a line on; none past the first or last line, or onto a caret already there.
 */
function cloneOf(
  state: EditorState,
  range: SelectionRange,
  part: Cloned,
  above: boolean,
  taken: readonly SelectionRange[],
): { range: SelectionRange; part: Cloned } | undefined {
  const shift = above ? -1 : 1;
  const number = state.doc.lineAt(range.head).number + shift;
  if (number < 1 || number > state.doc.lines) return undefined;
  const column = part.column ?? columnOf(state, range.head);
  let made = EditorSelection.cursor(placeOf(state, number, column));
  let ends: Pick<Cloned, 'lead' | 'other'> = {};
  if (!range.empty || part.lead !== undefined) {
    ends = {
      lead: part.lead ?? columnOf(state, range.head),
      other: part.other ?? columnOf(state, range.anchor),
    };
    const head = placeOf(state, number, ends.lead as number);
    const anchor = placeOf(
      state,
      state.doc.lineAt(range.anchor).number + shift,
      ends.other as number,
    );
    if (anchor !== head) made = EditorSelection.range(anchor, head);
  }
  if (taken.some((r) => r.head === made.head)) return undefined;
  return { range: made, part: { level: part.level, column, ...ends } };
}

/**
 * Clone Caret Above (or Below), as IntelliJ's CloneCaretActionHandler: each caret furthest from
 * where the run started gets a clone a line on, and a run turned back takes them away again. A
 * selection's clone goes on past lines too short to hold it. The newest clone is the main caret.
 */
export function cloneCaret(state: EditorState, above: boolean): TransactionSpec {
  const { ranges, mainIndex } = state.selection;
  const was = state.field(cloning, false) ?? null;
  const parts = ranges.map((_, i) => was?.[i] ?? { level: 0 });
  const furthest = Math.max(...parts.map((part) => Math.abs(part.level)));
  const current = parts.flatMap((part, i) => (Math.abs(part.level) === furthest ? [i] : []));
  const level = (parts[current[0] as number] as Cloned).level;
  let made = ranges.map((range, i) => ({ range, part: parts[i] as Cloned }));
  let main = ranges[mainIndex] as SelectionRange;
  if ((level > 0 && above) || (level < 0 && !above)) {
    made = made.filter((_, i) => !current.includes(i));
  } else {
    for (const i of current) {
      const original = made[i] as (typeof made)[number];
      let clone: (typeof made)[number] | undefined = original;
      do {
        clone = cloneOf(
          state,
          clone.range,
          clone.part,
          above,
          made.map((m) => m.range),
        );
      } while (clone && !original.range.empty && clone.range.empty);
      if (clone) {
        made.push({
          range: clone.range,
          part: { ...clone.part, level: above ? level - 1 : level + 1 },
        });
        main = clone.range;
      }
    }
  }
  made.sort((a, b) => a.range.from - b.range.from);
  const index = made.findIndex((m) => m.range === main);
  const selection = EditorSelection.create(
    made.map((m) => m.range),
    index < 0 ? made.length - 1 : index,
  );
  // Ranges merged where clones met: the run starts again.
  const kept = selection.ranges.length === made.length ? made.map((m) => m.part) : [];
  return {
    selection,
    effects: cloned.of(kept.length > 0 ? kept : made.map(() => ({ level: 0 }))),
    scrollIntoView: true,
    userEvent: 'select.clone',
  };
}

export const cloneCaretAbove: Command = (view) => {
  view.dispatch(cloneCaret(view.state, true));
  return true;
};

export const cloneCaretBelow: Command = (view) => {
  view.dispatch(cloneCaret(view.state, false));
  return true;
};

/** How long each step of a double Ctrl may take, as ModifierKeyDoubleClickHandler's. */
export const DOUBLE_MODIFIER = 300;

/**
 * IntelliJ's double Ctrl (Alt on macOS) held with Up or Down, which clones a caret where the keymap
 * gives Clone Caret no keys (ModifierKeyDoubleClickHandler, `addCaretsOnDoubleCtrl`): the modifier
 * pressed, let go and pressed again, each within `DOUBLE_MODIFIER` of the last, then held. `which`
 * says the modifier, and whether each action has the gesture; anything else pressed between starts
 * over. Its moves with Shift (Left, Right, Home, End) aren't taken: those actions have keys in every
 * keymap, which leaves them the keymap's.
 */
export function cloneGesture(
  which:
    (() => { modifier: 'Control' | 'Alt'; above: boolean; below: boolean } | undefined) | undefined,
  now: () => number = () => performance.now(),
): Extension {
  let first = false;
  let released = false;
  let second = false;
  let at = 0;
  const reset = () => {
    first = released = second = false;
  };
  const modifier = (down: boolean) => {
    const time = now();
    if (first && time - at > DOUBLE_MODIFIER) {
      reset();
      return;
    }
    if (down && !first) {
      first = true;
      at = time;
    } else if (down && released) {
      second = true;
      at = time;
    } else if (!down && first && !released) {
      released = true;
      at = time;
    } else reset();
  };
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        const gesture = which?.();
        if (!gesture) return false;
        if (event.key === gesture.modifier) {
          if (!event.repeat) modifier(true);
          return false;
        }
        const others =
          event.shiftKey ||
          event.metaKey ||
          (gesture.modifier === 'Control' ? event.altKey : event.ctrlKey);
        const up = event.key === 'ArrowUp';
        if (first && released && second && (up || event.key === 'ArrowDown') && !others) {
          if (!(up ? gesture.above : gesture.below)) return false;
          event.preventDefault();
          view.dispatch(cloneCaret(view.state, up));
          return true;
        }
        reset();
        return false;
      },
      keyup: (event) => {
        const gesture = which?.();
        if (gesture && event.key === gesture.modifier) modifier(false);
        return false;
      },
      blur: () => {
        reset();
        return false;
      },
    }),
  );
}

/** What the occurrence actions need in an editor: their search, and the hint for none found. */
export const occurrences: Extension = [search, hinted, cloning];
