// Code folding, as IntelliJ's: a chevron in the gutter by each part that folds, and its keys
// (Collapse, Expand, Collapse All, Expand All). A folded part shows as a box, `{...}` for a block;
// a click on it unfolds it. Where it folds is what's given says (the file's language server, in the
// app), and the language's grammar says where that has nothing on a line. The imports fold as the
// editor opens, as IntelliJ's (`COLLAPSE_IMPORTS`, on by default; `LspFoldingBuilder` takes a
// server's `imports` folds for them), but where the caret is: the first answer's only
// (`UpdateFoldRegionsOperation`'s default state, "only on initial fold regions construction on
// editor opening"), so imports that appear later stay open.
//
// A folded part's lines show while the pointer rests on its box, as IntelliJ's
// (`FoldingPopupManager` and `DocumentFragmentTooltipRenderer`, read from its source): after 300
// ms, its whole lines from the editor, highlighted, under its first line, as many as fit below;
// gone as the pointer leaves, at a key, or as the editor scrolls. Without a gutter: a claim.
//
// The chevrons are IntelliJ's own (`platform/icons/src/expui/gutter`, Apache 2.0, © JetBrains s.r.o.
// and contributors): their shapes, in its colours through the theme's tokens.

import {
  codeFolding,
  foldable,
  foldAll,
  foldedRanges,
  foldEffect,
  foldGutter,
  foldService,
  language,
  unfoldAll,
  unfoldCode,
  unfoldEffect,
} from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  showTooltip,
  ViewPlugin,
  type Rect,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import type { Place } from './usages.js';
import { actionKeys } from './actions.js';

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

/** How long the pointer rests on a folded part before its lines show, in ms (IntelliJ's). */
export const PEEK_AFTER = 300;

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
 * once an edit has settled. A folded part's lines, shown as the pointer rests on it, are drawn
 * with `look` (the editor's theme and highlighting).
 */
export function folding(ask?: AskFolds, look: Extension = [], after = FOLDS_AFTER): Extension {
  const asker = ask
    ? ViewPlugin.define((view) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let first = true;
        const request = () => {
          const { doc } = view.state;
          void ask(doc.toString()).then((found) => {
            // Edited since: a later question answers.
            if (view.state.doc !== doc) return;
            const head = view.state.selection.main.head;
            const imports = first
              ? (found ?? []).flatMap((f) => {
                  const folded = f.kind === 'imports' ? foldedOf(view.state, f) : null;
                  // Not one that would hide nothing (a fold within a line), nor where the caret is.
                  return folded &&
                    folded.from < folded.to &&
                    !(folded.from < head && head < folded.to)
                    ? [foldEffect.of({ from: folded.from, to: folded.to })]
                    : [];
                })
              : [];
            first = false;
            view.dispatch({ effects: [setFolds.of(found ?? null), ...imports] });
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
    peeking,
    peekClosing,
    codeFolding({
      // A given fold's own text (a region's name), or IntelliJ's dots.
      preparePlaceholder: (state, range) =>
        state.field(foldsField)?.find((f) => f.from === range.from && f.to === range.to)?.text ??
        ELLIPSIS,
      placeholderDOM: (view, onclick, prepared: string) => {
        const element = document.createElement('span');
        element.className = 'cerebro-folded';
        element.textContent = prepared;
        element.setAttribute('aria-label', 'Folded code');
        element.onclick = onclick;
        let timer: ReturnType<typeof setTimeout> | undefined;
        element.addEventListener('mouseenter', () => {
          timer = setTimeout(() => {
            // The fold it's the box of, if it's still folded (not unfolded meanwhile).
            const at = view.posAtDOM(element);
            const touching: { from: number; to: number }[] = [];
            foldedRanges(view.state).between(at, at, (from, to) => {
              touching.push({ from, to });
            });
            const fold = touching.find((range) => range.from === at);
            if (fold) view.dispatch({ effects: peek.of(peekAt(view, fold.from, fold.to, look)) });
          }, PEEK_AFTER);
        });
        element.addEventListener('mouseleave', () => {
          clearTimeout(timer);
          if (view.state.field(peeking)) view.dispatch({ effects: peek.of(null) });
        });
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

const peek = StateEffect.define<Tooltip | null>();

/** The lines of the folded part the pointer rests on; gone with an edit, a move, or a fold. */
const peeking = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(peek)) return effect.value;
      if (effect.is(foldEffect) || effect.is(unfoldEffect)) return null;
    }
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/**
 * The tooltip of a folded part's lines: from its first line's to its last's, in a read-only editor
 * drawn with `look` and the editor's language, as many as fit between its first line and the
 * window's bottom.
 */
function peekAt(view: EditorView, from: number, to: number, look: Extension): Tooltip {
  const { doc } = view.state;
  const first = doc.lineAt(from);
  // Drawn: the pointer's on its box.
  const below = (view.coordsAtPos(first.from) as Rect).bottom;
  const fit = Math.max(1, Math.floor((window.innerHeight - below) / view.defaultLineHeight));
  const last = doc.line(Math.min(doc.lineAt(to).number, first.number + fit - 1));
  const lang = view.state.facet(language);
  return {
    pos: first.from,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cerebro-foldPeek';
      const preview = new EditorView({
        parent: dom,
        root: view.root as ShadowRoot | Document,
        state: EditorState.create({
          doc: doc.sliceString(first.from, last.to),
          extensions: [
            look,
            lang ? lang.extension : [],
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
          ],
        }),
      });
      return {
        dom,
        destroy: () => {
          preview.destroy();
        },
      };
    },
  };
}

/** Hides the lines shown at a key, or as the editor scrolls. */
const peekClosing = EditorView.domEventHandlers({
  keydown: (_event, view) => {
    if (view.state.field(peeking)) view.dispatch({ effects: peek.of(null) });
  },
  scroll: (_event, view) => {
    if (view.state.field(peeking)) view.dispatch({ effects: peek.of(null) });
  },
});

/** Folding's actions on `keys`. */
export function foldKeys(keys: FoldKeys): Extension {
  const actions = [
    actionKeys('fold', keys.fold, foldAround, { preventDefault: true }),
    actionKeys('unfold', keys.unfold, unfoldCode, { preventDefault: true }),
    actionKeys('foldAll', keys.foldAll, foldAll, { preventDefault: true }),
    actionKeys('unfoldAll', keys.unfoldAll, unfoldAll, { preventDefault: true }),
  ];
  return [actions.map((each) => each.action), keymap.of(actions.flatMap((each) => each.bindings))];
}
