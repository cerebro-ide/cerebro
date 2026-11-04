// Code folding, as IntelliJ's: a chevron in the gutter by each part that folds, and its keys
// (Collapse, Expand, Collapse All, Expand All). A folded part shows as a box, `{...}` for a block;
// a click on it unfolds it. Where it folds is what's given says (the file's language server, in the
// app), and the language's grammar says where that has nothing on a line.
//
// The chevrons are IntelliJ's own (`platform/icons/src/expui/gutter`, Apache 2.0, © JetBrains s.r.o.
// and contributors): their shapes, in its colours through the theme's tokens.

import {
  codeFolding,
  foldable,
  foldAll,
  foldEffect,
  foldGutter,
  foldService,
  unfoldAll,
  unfoldCode,
} from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { Place } from './usages.js';

/** A part of the text that folds; what it shows folded, if it says. */
export interface Fold {
  from: Place;
  to: Place;
  /** `comment`, `imports`, `region`, or none (LSP's). */
  kind?: string;
  collapsedText?: string;
}

/** Asks where a text folds; nothing when there's no answer, and the grammar says then. */
export type AskFolds = (text: string) => Promise<readonly Fold[] | null | undefined>;

/** How long after an edit the folds are asked for again, in ms (as the markers are). */
export const FOLDS_AFTER = 500;

/** IntelliJ's text for what's folded. */
const ELLIPSIS = '...';

/** The keys of folding's actions, as IntelliJ names them. */
export interface FoldKeys {
  /** Collapse: the part the caret's in. */
  fold: readonly string[];
  /** Expand: the folded part on the caret's line. */
  unfold: readonly string[];
  foldAll: readonly string[];
  unfoldAll: readonly string[];
}

/** A fold as the editor folds it: the text from `from` to `to` hidden, `text` shown. */
interface Folded {
  from: number;
  to: number;
  text: string;
}

/** The pairs a fold of what's between them leaves showing, as IntelliJ's `{...}` and `/**...*\/`. */
const PAIRS = [
  ['/**', '*/'],
  ['/*', '*/'],
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
] as const;

/**
 * A fold as it's shown: its own text in its place, if it has one (a region's name); what's between
 * a pair it's in (a block's braces, a comment's marks), as TypeScript's server folds from the space
 * before a brace (measured); or else the lines after its first.
 */
function foldedOf(state: EditorState, fold: Fold): Folded | null {
  const { doc } = state;
  const offset = (at: Place) =>
    at.line < doc.lines ? Math.min(doc.line(at.line + 1).from + at.column, doc.length) : null;
  const from = offset(fold.from);
  const to = offset(fold.to);
  if (from === null || to === null || to <= from) return null;
  if (fold.collapsedText) return { from, to, text: fold.collapsedText };
  const text = doc.sliceString(from, to);
  const start = from + (text.length - text.trimStart().length);
  const inner = doc.sliceString(start, to);
  for (const [open, close] of PAIRS) {
    if (
      inner.length > open.length + close.length &&
      inner.startsWith(open) &&
      inner.endsWith(close)
    ) {
      return { from: start + open.length, to: to - close.length, text: ELLIPSIS };
    }
  }
  return { from: doc.lineAt(from).to, to, text: ELLIPSIS };
}

const setFolds = StateEffect.define<readonly Fold[] | null>();

/** The folds given, moved along with edits until the next answer; null with none given. */
const foldsField = StateField.define<readonly Folded[] | null>({
  create: () => null,
  update(folds, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setFolds)) continue;
      return effect.value?.flatMap((f) => foldedOf(tr.state, f) ?? []) ?? null;
    }
    if (!folds || !tr.docChanged) return folds;
    return folds.flatMap((f) => {
      const from = tr.changes.mapPos(f.from, 1);
      const to = tr.changes.mapPos(f.to, -1);
      return from < to ? [{ ...f, from, to }] : [];
    });
  },
});

/** The biggest fold given that starts on a line and goes past it. */
const given = foldService.of((state, lineStart, lineEnd) => {
  let found: Folded | null = null;
  for (const f of state.field(foldsField) ?? []) {
    if (f.from < lineStart || f.from > lineEnd || f.to <= lineEnd) continue;
    if (!found || f.to > found.to) found = f;
  }
  return found && { from: found.from, to: found.to };
});

/**
 * Collapse, as IntelliJ's: the innermost part around the caret that folds, from the caret's line
 * up (CodeMirror's own looks at the caret's line only).
 */
function foldAround(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const caretLine = state.doc.lineAt(head);
  for (let n = caretLine.number; n >= 1; n--) {
    const line = state.doc.line(n);
    const range = foldable(state, line.from, line.to);
    if (range && range.to >= head) {
      view.dispatch({ effects: foldEffect.of(range) });
      return true;
    }
  }
  return false;
}

const SVG = 'http://www.w3.org/2000/svg';
/** IntelliJ's `fold.svg` (open: folds when clicked) and `unfold.svg` (folded). */
const OPEN = 'M8 2.75L4.5 6.25L1 2.75';
const CLOSED = 'M3 8L6.5 4.5L3 1';

function chevron(open: boolean): HTMLElement {
  const element = document.createElement('span');
  element.className = `cerebro-fold cerebro-fold--${open ? 'open' : 'closed'}`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 9 9');
  svg.setAttribute('width', '9');
  svg.setAttribute('height', '9');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', open ? OPEN : CLOSED);
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  element.append(svg);
  return element;
}

/**
 * Folding, with its chevrons; where it folds asked of `ask`, if given, when the editor opens and
 * once an edit has settled.
 */
export function folding(ask?: AskFolds, after = FOLDS_AFTER): Extension {
  const asker = ask
    ? ViewPlugin.define((view) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const request = () => {
          const { doc } = view.state;
          void ask(doc.toString()).then((found) => {
            // Edited since: a later question answers.
            if (view.state.doc !== doc) return;
            view.dispatch({ effects: setFolds.of(found ?? null) });
          });
        };
        request();
        return {
          update(update: ViewUpdate) {
            if (!update.docChanged) return;
            clearTimeout(timer);
            timer = setTimeout(request, after);
          },
          destroy() {
            clearTimeout(timer);
          },
        };
      })
    : [];
  return [
    foldsField,
    given,
    asker,
    codeFolding({
      // A given fold's own text (a region's name), or IntelliJ's dots.
      preparePlaceholder: (state, range) =>
        state.field(foldsField)?.find((f) => f.from === range.from && f.to === range.to)?.text ??
        ELLIPSIS,
      placeholderDOM: (_view, onclick, prepared: string) => {
        const element = document.createElement('span');
        element.className = 'cerebro-folded';
        element.textContent = prepared;
        element.setAttribute('aria-label', 'Folded code');
        element.onclick = onclick;
        return element;
      },
    }),
    foldGutter({
      markerDOM: chevron,
      // Drawn again once they're answered: CodeMirror's draws again for edits and folding only.
      foldingChanged: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setFolds))),
    }),
  ];
}

/** Folding's actions on `keys`. */
export function foldKeys(keys: FoldKeys): Extension {
  const run = (command: (view: EditorView) => boolean) => (key: string) => ({
    key,
    run: command,
    preventDefault: true,
  });
  return keymap.of([
    ...keys.fold.map(run(foldAround)),
    ...keys.unfold.map(run(unfoldCode)),
    ...keys.foldAll.map(run(foldAll)),
    ...keys.unfoldAll.map(run(unfoldAll)),
  ]);
}
