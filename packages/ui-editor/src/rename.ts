// Rename as IntelliJ's in-place rename (Shift+F6): the name at the caret is boxed and selected, and
// the new one is typed over it. Enter, or the caret leaving the box, renames it everywhere it's
// used, through what's given (a language server, in the app); Escape puts the name back. Where
// there's nothing to rename, a hint says why. The typing isn't kept in the undo history: the rename
// is one change, which undo takes back.

import {
  Prec,
  StateEffect,
  StateField,
  Transaction,
  EditorState,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { hinted, showHint } from './hint.js';
import { placeAt, type Place } from './usages.js';

/** The name at a place that Rename renames: where it is, and what it is. */
export interface Renaming {
  from: Place;
  to: Place;
  name: string;
}

/** Asks where the name at a place is that Rename renames; none, or why it can't be renamed. */
export type AskRenaming = (at: Place) => Promise<Renaming | { refused: string } | null | undefined>;

/** Renames the name at a place to `name`, everywhere it's used; why not, if it can't be. */
export type Rename = (at: Place, name: string) => Promise<string | undefined>;

/**
 * IntelliJ's words (RefactoringBundle) for a place with no name to rename.
 */
export const NOTHING_TO_RENAME =
  'Cannot perform refactoring. Caret should be positioned at the name of element to be refactored.';

/** A rename being typed: where the name is now, what it was, and where it was asked. */
interface Session {
  from: number;
  to: number;
  name: string;
  at: Place;
}

const start = StateEffect.define<Session>();
const end = StateEffect.define();
/** Asked for on the keys. */
const requested = StateEffect.define();

/** The box of a name typed away. */
class EmptyName extends WidgetType {
  toDOM(): HTMLElement {
    const box = document.createElement('span');
    box.className = 'cerebro-rename cerebro-rename--empty';
    return box;
  }
}

const session = StateField.define<Session | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(start)) return effect.value;
      if (effect.is(end)) return null;
    }
    // Typed at either end, it's still the name.
    return value && tr.docChanged
      ? { ...value, from: tr.changes.mapPos(value.from, -1), to: tr.changes.mapPos(value.to, 1) }
      : value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => {
      if (!value) return Decoration.none;
      // A name typed away is an empty box: a mark can't be empty.
      return Decoration.set(
        value.from === value.to
          ? Decoration.widget({ widget: new EmptyName() }).range(value.from)
          : Decoration.mark({ class: 'cerebro-rename', inclusive: true }).range(
              value.from,
              value.to,
            ),
      );
    }),
});

/** The offset of a place in the text, if it's in it. */
function offsetOf(state: EditorState, at: Place): number | undefined {
  if (at.line >= state.doc.lines) return undefined;
  const line = state.doc.line(at.line + 1);
  return at.column <= line.length ? line.from + at.column : undefined;
}

/** Rename, through `ask` and `rename` (`renameKeys` has the keys). */
export function renaming(ask: AskRenaming, rename: Rename): Extension {
  /** Ends the rename: the name put back, then renamed everywhere if it's another. */
  const finish = (view: EditorView, renamed: boolean) => {
    const current = view.state.field(session);
    if (!current) return;
    const typed = view.state.sliceDoc(current.from, current.to);
    view.dispatch({
      effects: end.of(null),
      changes: { from: current.from, to: current.to, insert: current.name },
      annotations: Transaction.addToHistory.of(false),
    });
    if (!renamed || typed === current.name || typed === '') return;
    void rename(current.at, typed).then((refused) => {
      if (refused !== undefined) showHint(view, refused);
    });
  };
  /** Starts a rename at the caret, once it's had where the name is, if the text's still the same. */
  const begin = (view: EditorView) => {
    const { state } = view;
    const at = placeAt(state, state.selection.main.head);
    void ask(at).then((found) => {
      if (view.state.doc !== state.doc) return;
      if (!found || 'refused' in found) {
        showHint(view, found?.refused ?? NOTHING_TO_RENAME);
        return;
      }
      const from = offsetOf(state, found.from);
      const to = offsetOf(state, found.to);
      if (from === undefined || to === undefined) return;
      view.dispatch({
        effects: start.of({ from, to, name: found.name, at }),
        selection: { anchor: from, head: to },
      });
    });
  };
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate) {
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(requested)))) {
          begin(this.view);
        }
        const current = update.state.field(session);
        if (!current || !update.selectionSet) return;
        const { from, to } = update.state.selection.main;
        // The caret left the box: renamed, as IntelliJ's ends its template. After this update.
        if (from < current.from || to > current.to) {
          queueMicrotask(() => {
            finish(this.view, true);
          });
        }
      }
    },
  );
  return [
    session,
    hinted,
    plugin,
    // The typing isn't undone on its own: the rename is.
    EditorState.transactionExtender.of((tr) =>
      tr.docChanged && tr.startState.field(session) && !tr.effects.some((e) => e.is(end))
        ? { annotations: Transaction.addToHistory.of(false) }
        : null,
    ),
    Prec.high(
      keymap.of([
        {
          key: 'Enter',
          run: (view) => {
            if (!view.state.field(session)) return false;
            finish(view, true);
            return true;
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(session)) return false;
            finish(view, false);
            return true;
          },
        },
      ]),
    ),
  ];
}

/** The keys that start a rename at the caret. */
export function renameKeys(keys: readonly string[]): Extension {
  return keymap.of(
    keys.map((key) => ({
      key,
      run: (view: EditorView) => {
        if (view.state.field(session, false) !== null) return false;
        view.dispatch({ effects: requested.of(null) });
        return true;
      },
      preventDefault: true,
    })),
  );
}
