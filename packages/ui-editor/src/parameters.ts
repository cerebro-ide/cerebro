// What's called at the caret, as IntelliJ's Parameter Info: each signature's parameters, the one
// the caret is at in bold, above the caret. It shows on its keys (Ctrl+P), and after a moment when
// a call's `(` or a `,` is typed; while it shows, it follows the caret and the text, and goes when
// the caret leaves the call or on Escape. What's called comes from what's given (a language
// server, in the app).

import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  keymap,
  showTooltip,
  ViewPlugin,
  type EditorView,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view';
import { placeAt, type Place } from './usages.js';

/** One way to call what's called: its text, and where each parameter is in it. */
export interface Signature {
  label: string;
  parameters: { from: number; to: number }[];
  /** The parameter the place is at, if it's at one. */
  active?: number;
}

/** What's called at a place: its signatures, and which one the call is. */
export interface Signatures {
  signatures: Signature[];
  active: number;
}

/** Asks what's called at a place; nothing outside a call. */
export type AskSignatures = (at: Place) => Promise<Signatures | null | undefined>;

/**
 * How long after a `(` or `,` is typed it shows: IntelliJ's "Show parameter info popup in
 * 1000 ms" (a claim, from its settings).
 */
export const PARAMETERS_AFTER = 1000;

/** A signature's parameters, the active one apart, as IntelliJ lists them. */
function signatureView({ label, parameters, active }: Signature, current: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'cerebro-parameterInfo__signature';
  if (current) row.classList.add('cerebro-parameterInfo__signature--current');
  const first = parameters[0];
  const last = parameters.at(-1);
  if (!first || !last) {
    row.textContent = '<no parameters>';
    return row;
  }
  const bold = active === undefined ? undefined : parameters[active];
  if (!bold) {
    row.textContent = label.slice(first.from, last.to);
    return row;
  }
  const strong = document.createElement('strong');
  strong.textContent = label.slice(bold.from, bold.to);
  row.append(label.slice(first.from, bold.from), strong, label.slice(bold.to, last.to));
  return row;
}

/** The Parameter Info's view: a line per signature, the call's own marked when there are more. */
export function parametersView({ signatures, active }: Signatures): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cerebro-parameterInfo';
  signatures.forEach((signature, n) => {
    dom.append(signatureView(signature, signatures.length > 1 && n === active));
  });
  return dom;
}

/** The Parameter Info shown, until it's asked again and there's none. */
const show = StateEffect.define<Tooltip | null>();
/** Asks now, for the keys. */
const request = StateEffect.define();
const shown = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(show)) return effect.value;
    return value && tr.docChanged ? { ...value, pos: tr.changes.mapPos(value.pos) } : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** Whether an edit typed a call's `(` or a `,`. */
function typedOpener(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => {
    if (!tr.isUserEvent('input.type')) return false;
    let typed = false;
    tr.changes.iterChanges((_from, _to, _at, _end, text) => {
      if (/[(,]$/.test(text.toString())) typed = true;
    });
    return typed;
  });
}

/** Parameter Info from `ask` (`parameterKeys` has the keys); `delay` after a `(` or `,`. */
export function parameterInfo(ask: AskSignatures, delay = PARAMETERS_AFTER): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      /** Only the latest answer counts. */
      asked = 0;
      constructor(readonly view: EditorView) {}
      update(update: ViewUpdate) {
        const requested = update.transactions.some((tr) => tr.effects.some((e) => e.is(request)));
        const showing = update.state.field(shown) !== null;
        // Hidden (Escape): one that was to show after a `(` doesn't.
        if (!showing && update.startState.field(shown)) clearTimeout(this.timer);
        if (requested || (showing && (update.docChanged || update.selectionSet))) {
          this.ask();
        } else if (typedOpener(update)) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            this.ask();
          }, delay);
        }
      }
      /** Asks at the caret; shows the answer if the text and the caret are still as asked. */
      ask() {
        const { state } = this.view;
        const head = state.selection.main.head;
        const asked = ++this.asked;
        void ask(placeAt(state, head)).then((found) => {
          const now = this.view.state;
          if (asked !== this.asked || now.doc !== state.doc || now.selection.main.head !== head) {
            return;
          }
          if (!found && !now.field(shown)) return;
          this.view.dispatch({
            effects: show.of(
              found
                ? { pos: head, above: true, create: () => ({ dom: parametersView(found) }) }
                : null,
            ),
          });
        });
      }
      destroy() {
        clearTimeout(this.timer);
        // An answer after this isn't shown.
        this.asked++;
      }
    },
  );
  return [shown, plugin];
}

/** The keys that show what's called at the caret; Escape hides it. */
export function parameterKeys(keys: readonly string[]): Extension {
  return keymap.of([
    ...keys.map((key) => ({
      key,
      run: (view: EditorView) => {
        view.dispatch({ effects: request.of(null) });
        return true;
      },
    })),
    {
      key: 'Escape',
      run: (view: EditorView) => {
        if (!view.state.field(shown, false)) return false;
        view.dispatch({ effects: show.of(null) });
        return true;
      },
    },
  ]);
}
