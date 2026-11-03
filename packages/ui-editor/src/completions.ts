// Code completion, as IntelliJ's: a list of what can go at the caret, from what's given (a
// language server, in the app), shown as a name is typed or after a `.`, and on its keys
// (Ctrl+Space, IntelliJ's Basic Completion). Enter or Tab puts the one chosen in, with the other
// edits it needs (an import). A server that gives those only when asked (TypeScript's) is asked
// once it's chosen; its edits join the completion's in the undo history, as one change.

import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  moveCompletionSelection,
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  ChangeSet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { joinedToLast } from './history.js';
import type { Place } from './usages.js';

/** An edit to the text: from one place to another (zero-based), replaced with `text`. */
export interface CompletionEdit {
  from: Place;
  to: Place;
  text: string;
}

/** Something that can go at the caret. */
export interface CompletionItem {
  label: string;
  /** What it is, as LSP names it (`function`, `field`, `class`...): its icon. */
  kind?: string;
  /** Its type or signature. */
  detail?: string;
  /** Where it's from (a module, for one imported): shown instead of `detail`. */
  description?: string;
  /** Where it goes in the list, compared as text; the label when not given. */
  sortText?: string;
  /** The edit that puts it in; else `insert` (or the label) replaces the word before the caret. */
  edit?: CompletionEdit;
  insert?: string;
  /** Edits elsewhere that it needs (an import). */
  extraEdits?: readonly CompletionEdit[];
  /** Given when its other edits are only had by asking (`ResolveCompletion`). */
  resolve?: unknown;
}

/** What can go at the caret: all of it, or only some (`incomplete`), asked again as one types. */
export interface CompletionList {
  incomplete: boolean;
  items: readonly CompletionItem[];
}

/**
 * Asks what can go at a place, given the text as the editor has it; nothing without an answer.
 */
export type AskCompletions = (
  text: string,
  at: Place,
) => Promise<CompletionList | null | undefined>;

/** Asks for the other edits of a completion given with `resolve`, in the text it was asked for. */
export type ResolveCompletion = (
  item: CompletionItem,
) => Promise<readonly CompletionEdit[] | null | undefined>;

/** A name's letters, as the word a completion replaces. */
const WORD = /[\p{L}\p{N}_$]+/u;
const STILL_WORD = /^[\p{L}\p{N}_$]*$/u;

/** A position in a text, from a place in it. */
const offset = (text: Text, at: Place) => text.line(at.line + 1).from + at.column;

/** A completion waiting for its other edits, by a key of its own: the changes made since. */
const waitFor = StateEffect.define<object>();
const doneWaiting = StateEffect.define<object>();
const waiting = StateField.define<ReadonlyMap<object, ChangeSet>>({
  create: () => new Map(),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && value.size > 0) {
      next = new Map([...value].map(([key, since]) => [key, since.compose(tr.changes)]));
    }
    for (const effect of tr.effects) {
      // From the text before the completion went in: what the server's places are in.
      if (effect.is(waitFor)) next = new Map(next).set(effect.value, tr.changes);
      if (effect.is(doneWaiting)) {
        const left = new Map(next);
        left.delete(effect.value);
        next = left;
      }
    }
    return next;
  },
});

/** Puts a completion in, in place of `from` to `to`, with its other edits, or asks for them. */
function apply(
  view: EditorView,
  item: CompletionItem,
  completion: Completion,
  from: number,
  to: number,
  resolve: ResolveCompletion | undefined,
) {
  const before = view.state.doc;
  const edit = (e: CompletionEdit) => ({
    from: offset(before, e.from),
    to: offset(before, e.to),
    insert: e.text,
  });
  // The server's edit, to the caret at least: typed on since it was asked.
  const main = item.edit
    ? { ...edit(item.edit), to: Math.max(offset(before, item.edit.to), to) }
    : { from, to, insert: item.insert ?? item.label };
  const changes = ChangeSet.of([main, ...(item.extraEdits ?? []).map(edit)], before.length);
  const key = {};
  const asks = item.extraEdits === undefined && item.resolve !== undefined && resolve;
  view.dispatch({
    changes,
    selection: { anchor: changes.mapPos(main.to, 1) },
    userEvent: 'input.complete',
    annotations: pickedCompletion.of(completion),
    ...(asks ? { effects: waitFor.of(key) } : {}),
  });
  if (!asks) return;
  void resolve(item).then(
    (edits) => {
      const since = view.state.field(waiting).get(key) as ChangeSet;
      view.dispatch({
        changes: ChangeSet.of((edits ?? []).map(edit), before.length).map(since),
        effects: doneWaiting.of(key),
        annotations: joinedToLast.of(true),
      });
    },
    () => {
      view.dispatch({ effects: doneWaiting.of(key) });
    },
  );
}

/** The list at the caret, from what `ask` answers. */
function source(ask: AskCompletions, resolve: ResolveCompletion | undefined) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(WORD);
    const from = word?.from ?? context.pos;
    const typed = word?.text ?? '';
    // As one types: a name (not a number), or right after a `.`.
    const shows =
      context.explicit ||
      (typed === '' ? context.state.sliceDoc(from - 1, from) === '.' : !/^\p{N}/u.test(typed));
    if (!shows) return null;
    const line = context.state.doc.lineAt(context.pos);
    const list = await ask(context.state.doc.toString(), {
      line: line.number - 1,
      column: context.pos - line.from,
    });
    if (!list || context.aborted) return null;
    return {
      from,
      options: list.items.map((item) => {
        const detail = item.description ?? item.detail;
        const completion: Completion = {
          label: item.label,
          ...(detail === undefined ? {} : { detail }),
          ...(item.kind === undefined ? {} : { type: item.kind }),
          ...(item.sortText === undefined ? {} : { sortText: item.sortText }),
          apply: (view, _, start, end) => {
            apply(view, item, completion, start, end, resolve);
          },
        };
        return completion;
      }),
      // An incomplete list is asked for again as one types; a complete one is filtered.
      ...(list.incomplete ? {} : { validFor: STILL_WORD }),
    };
  };
}

/** Completion, from `ask`: the list as one types (`completionKeys` has the keys). */
export function completions(
  ask: AskCompletions,
  resolve: ResolveCompletion | undefined,
): Extension {
  return [autocompletion({ override: [source(ask, resolve)], defaultKeymap: false }), waiting];
}

/** The keys that open the list, and those that move in it and choose from it, as IntelliJ's. */
export function completionKeys(keys: readonly string[]): Extension {
  return Prec.highest(
    keymap.of([
      ...keys.map((key) => ({ key, run: startCompletion })),
      { key: 'Escape', run: closeCompletion },
      { key: 'ArrowDown', run: moveCompletionSelection(true) },
      { key: 'ArrowUp', run: moveCompletionSelection(false) },
      { key: 'PageDown', run: moveCompletionSelection(true, 'page') },
      { key: 'PageUp', run: moveCompletionSelection(false, 'page') },
      { key: 'Enter', run: acceptCompletion },
      { key: 'Tab', run: acceptCompletion },
    ]),
  );
}
