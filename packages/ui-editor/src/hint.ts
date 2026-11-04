// A hint at the caret, as IntelliJ's: why there's nothing to rename, how many lines Reformat Code
// changed. It goes when the text or the caret changes.

import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';

const hint = StateEffect.define<Tooltip | null>();

/** The hint shown; an editor that shows hints has it among its extensions. */
export const hinted = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(hint)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** Shows `message` at the caret. */
export function showHint(view: EditorView, message: string): void {
  const pos = view.state.selection.main.head;
  view.dispatch({
    effects: hint.of({
      pos,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cerebro-hint';
        dom.textContent = message;
        return { dom };
      },
    }),
  });
}
