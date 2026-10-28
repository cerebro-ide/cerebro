// What the editor shows of the symbols in it, from what's given (a language server, in the app), as
// IntelliJ's:
//
// - **Usages at the caret:** where the symbol at the caret is in the file, each place behind the
//   text: written apart from read. The symbol's, not the word's: another variable of the same name,
//   in another function, isn't one (the language server tells them apart).
// - **A link under the pointer** with Ctrl or Cmd held: the word under it, when it has a
//   definition, in the link colour and underlined, as Ctrl+click goes there.

import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  layer,
  RectangleMarker,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

/** A place in a file, zero-based. */
export interface Place {
  line: number;
  column: number;
}

/** Where a symbol is in its file: read, or written. */
export interface Usage {
  from: Place;
  to: Place;
  write: boolean;
}

/** Asks where the symbol at a place is in the file; nothing when there's none, or no answer. */
export type AskUsages = (at: Place) => Promise<readonly Usage[] | null | undefined>;

/** Asks whether the word at a place has a definition to go to. */
export type AskDefinition = (word: string, at: Place) => Promise<boolean>;

/** How long the caret stays before its symbol's usages are asked for, in ms (a claim: unnoticed). */
export const USAGES_AFTER = 100;

/** A place as a position in the editor's text, kept within its line and the text. */
function positionOf(state: EditorState, place: Place): number {
  if (place.line >= state.doc.lines) return state.doc.length;
  const line = state.doc.line(place.line + 1);
  return Math.min(line.from + place.column, line.to);
}

/** A position as a place: a line and a column, zero-based. */
export function placeAt(state: EditorState, pos: number): Place {
  const line = state.doc.lineAt(pos);
  return { line: line.number - 1, column: pos - line.from };
}

const setUsages = StateEffect.define<readonly { from: number; to: number; write: boolean }[]>();

/** The usages shown, moved along with edits. */
const usagesField = StateField.define<readonly { from: number; to: number; write: boolean }[]>({
  create: () => [],
  update(usages, tr) {
    for (const effect of tr.effects) if (effect.is(setUsages)) return effect.value;
    if (!tr.docChanged) return usages;
    return usages.map((u) => ({
      from: tr.changes.mapPos(u.from, 1),
      to: tr.changes.mapPos(u.to, -1),
      write: u.write,
    }));
  },
});

/**
 * The usages of the symbol at the caret, asked of `ask` once the caret stays, and drawn as a layer
 * beneath the selection's, so a selection over one shows.
 */
export function usageHighlights(ask: AskUsages, after = USAGES_AFTER): Extension {
  const asker = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { state } = view;
        const head = state.selection.main.head;
        void ask(placeAt(state, head)).then((found) => {
          // Moved or edited since: a later question answers.
          if (view.state.doc !== state.doc || view.state.selection.main.head !== head) return;
          const usages = (found ?? []).map((u) => ({
            from: positionOf(state, u.from),
            to: positionOf(state, u.to),
            write: u.write,
          }));
          view.dispatch({ effects: setUsages.of(usages) });
        });
      }, after);
    };
    schedule();
    return {
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) schedule();
      },
      destroy() {
        clearTimeout(timer);
      },
    };
  });
  return [
    usagesField,
    asker,
    layer({
      above: false,
      class: 'cerebro-usageLayer',
      update: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.startState.field(usagesField) !== update.state.field(usagesField),
      markers: (view) =>
        view.state
          .field(usagesField)
          .flatMap((u) =>
            RectangleMarker.forRange(
              view,
              u.write ? 'cerebro-usage cerebro-usage--write' : 'cerebro-usage',
              EditorSelection.range(u.from, u.to),
            ),
          ),
    }),
  ];
}

const setLink = StateEffect.define<{ from: number; to: number } | undefined>();

/** The word shown as a link, if one is. */
const linkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(link, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLink)) {
        return effect.value
          ? Decoration.set(linkMark.range(effect.value.from, effect.value.to))
          : Decoration.none;
      }
    }
    return tr.docChanged ? Decoration.none : link;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const linkMark = Decoration.mark({ class: 'cerebro-link' });

/** Whether Ctrl or Cmd is held, as Ctrl+click and Cmd+click go to a definition. */
const modified = (event: MouseEvent | KeyboardEvent) => event.ctrlKey || event.metaKey;

/**
 * Shows the word under the pointer as a link while Ctrl or Cmd is held, when `can` says it has a
 * definition.
 */
export function definitionLinks(can: AskDefinition): Extension {
  const linker = ViewPlugin.define((view) => {
    /** Where the pointer was last, over the editor. */
    let pointer: { x: number; y: number } | undefined;
    /** The word asked about last, or shown: a new one is asked about again. */
    let asked: { from: number; to: number } | undefined;
    const clear = () => {
      asked = undefined;
      if (view.state.field(linkField).size) view.dispatch({ effects: setLink.of(undefined) });
    };
    /** The word under the pointer: over it, not beside it at its line's end. */
    const wordUnder = (at: { x: number; y: number }) => {
      // The nearest place: then whether the pointer is over the word there.
      const range = view.state.wordAt(view.posAtCoords(at, false));
      if (!range) return undefined;
      const start = view.coordsAtPos(range.from, 1) as { left: number };
      const end = view.coordsAtPos(range.to, -1) as { right: number };
      return at.x >= start.left && at.x <= end.right ? range : undefined;
    };
    const check = (at: { x: number; y: number }) => {
      const range = wordUnder(at);
      if (!range) {
        clear();
        return;
      }
      if (asked?.from === range.from && asked.to === range.to) return;
      clear();
      const word = { from: range.from, to: range.to };
      asked = word;
      const { doc } = view.state;
      void can(view.state.sliceDoc(word.from, word.to), placeAt(view.state, word.from)).then(
        (yes) => {
          // Moved on, let go or edited since.
          if (asked !== word || view.state.doc !== doc) return;
          if (yes) view.dispatch({ effects: setLink.of(word) });
        },
      );
    };
    const onMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      if (modified(event)) check(pointer);
      else clear();
    };
    const onLeave = () => {
      pointer = undefined;
      clear();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Control' && event.key !== 'Meta') return;
      if (event.type === 'keydown' && pointer) check(pointer);
      if (event.type === 'keyup') clear();
    };
    view.dom.addEventListener('mousemove', onMove);
    view.dom.addEventListener('mouseleave', onLeave);
    // The keys may be pressed with the focus elsewhere, the pointer over the editor.
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onLeave);
    return {
      destroy() {
        view.dom.removeEventListener('mousemove', onMove);
        view.dom.removeEventListener('mouseleave', onLeave);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
        window.removeEventListener('blur', onLeave);
      },
    };
  });
  return [linkField, linker];
}
