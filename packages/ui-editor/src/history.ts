// The editor's undo history with names for what Undo and Redo would take back or do again, as
// IntelliJ's Edit menu shows them ("Undo Typing"). CodeMirror's history keeps no names: a field
// beside it keeps one per undoable change, from the transaction's user event, in step with
// `undoDepth` and `redoDepth`. A change joined to the one before (typing on) keeps that one's name.

import { history, redoDepth, undoDepth } from '@codemirror/commands';
import { StateField, type Extension, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { signal } from '@cerebro-ide/reactive';

/**
 * The names of the user events, as IntelliJ names the same commands: Typing from its
 * EditorBundle, Replace from its FindBundle, the rest its actions' (ActionsBundle). An event that
 * isn't here has no name, and Undo is only "Undo", as IntelliJ's for a command without one.
 */
const NAMES: readonly (readonly [event: string, name: string])[] = [
  ['input.type', 'Typing'],
  ['input.paste', 'Paste'],
  ['input.replace', 'Replace'],
  ['input.indent', 'Indent Selection'],
  ['delete.cut', 'Cut'],
  ['delete.backward', 'Backspace'],
  ['delete.forward', 'Delete'],
  ['delete.line', 'Delete Line'],
  ['delete.dedent', 'Unindent Line or Selection'],
];

function nameOf(tr: Transaction): string {
  return NAMES.find(([event]) => tr.isUserEvent(event))?.[1] ?? '';
}

export interface Names {
  /** A name per change Undo takes back, the next last. */
  done: readonly string[];
  /** A name per change Redo does again, the next last. */
  undone: readonly string[];
}

/**
 * The names as many as the history's changes, which it keeps as many of as there are changes: the
 * oldest dropped when it dropped them.
 */
function fit(names: readonly string[], depth: number): readonly string[] {
  return names.length > depth ? names.slice(names.length - depth) : names;
}

export const historyNames = StateField.define<Names>({
  create: () => ({ done: [], undone: [] }),
  update(names, tr) {
    let { done, undone } = names;
    const depth = undoDepth(tr.state);
    if (tr.isUserEvent('undo')) {
      // There's a name for each change, so for the one undone.
      undone = [...undone, done.at(-1) as string];
      done = done.slice(0, -1);
    } else if (tr.isUserEvent('redo')) {
      done = [...done, undone.at(-1) as string];
      undone = undone.slice(0, -1);
    } else if (depth !== undoDepth(tr.startState)) {
      // A new change: one more, or fewer when the history dropped its oldest to make room.
      done = [...done, nameOf(tr)];
    }
    done = fit(done, depth);
    undone = fit(undone, redoDepth(tr.state));
    return done === names.done && undone === names.undone ? names : { done, undone };
  },
  toJSON: (names: Names) => names,
  fromJSON: (json: unknown) => json as Names,
});

/** Changes as editors' histories change, for what reads them to be read again. */
const changed = signal(0);

/** CodeMirror's history, with names. */
export function namedHistory(): Extension {
  return [
    history(),
    historyNames,
    EditorView.updateListener.of((update) => {
      if (update.startState.field(historyNames) !== update.state.field(historyNames)) {
        changed.set(changed.peek() + 1);
      }
    }),
  ];
}

/**
 * What Undo and Redo would do in the editor an element is in, by name ('' for a change without
 * one), or undefined where there's nothing to do; undefined for an element in no editor with a
 * history. Read reactively.
 */
export function historyNamesIn(
  element: Element,
): { undo: string | undefined; redo: string | undefined } | undefined {
  changed.get();
  const editor = element.closest('.cm-editor');
  const view = editor && EditorView.findFromDOM(editor as HTMLElement);
  const names = view?.state.field(historyNames, false);
  return names && { undo: names.done.at(-1), redo: names.undone.at(-1) };
}
