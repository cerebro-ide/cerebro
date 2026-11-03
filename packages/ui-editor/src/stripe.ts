// IntelliJ's error stripe: marks over the scrollbar's band, one for each thing the editor shows in
// the text (the symbol at the caret's usages, a problem), where it is in the whole text. What has
// marks gives them through `stripeMarks`; clicking one puts the caret there.

import { Facet, type EditorState } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

/** A mark on the stripe: a stretch of the text, and the class that colours it. */
export interface StripeMark {
  from: number;
  to: number;
  className: string;
  /** Drawn over marks of a lower rank: an error over a warning over a usage. Default: 0. */
  rank?: number;
}

/** What gives marks: the state's, read whenever it changes (a field's value, kept while equal). */
export const stripeMarks = Facet.define<(state: EditorState) => readonly StripeMark[]>();

/** A stripe mark's least height, in px: IntelliJ's (`ERROR_STRIPE_MARK_MIN_HEIGHT`, 2). */
const MARK_HEIGHT = 2;

/** Where the stripe is in the editor, and its marks in it, in px. */
interface Drawn {
  top: number;
  height: number;
  marks: { top: number; height: number; className: string; from: number }[];
}

/** The marks given, the lowest rank first, so the highest is drawn over it. */
function marksOf(state: EditorState): StripeMark[] {
  return state
    .facet(stripeMarks)
    .flatMap((give) => give(state))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/** Whether what gives marks gives the same as before. */
function same(before: EditorState, after: EditorState): boolean {
  const givers = after.facet(stripeMarks);
  return givers.every((give) => give(before) === give(after));
}

/**
 * The stripe: where each mark is in the whole text, scaled to the scroll area's height when the text
 * is taller, else where it's shown (`EditorMarkupModelImpl.offsetsToYPositions`).
 */
export const errorStripe = ViewPlugin.define((view: EditorView) => {
  const element = document.createElement('div');
  element.className = 'cerebro-stripe';
  element.setAttribute('aria-hidden', 'true');
  view.dom.append(element);
  const measure = {
    read: (): Drawn => {
      const { scrollDOM } = view;
      const height = scrollDOM.clientHeight;
      const whole = view.contentHeight;
      const y = (pos: number) => {
        const top = view.lineBlockAt(pos).top + view.documentPadding.top;
        return whole > height ? (top / whole) * height : top;
      };
      return {
        top: scrollDOM.offsetTop,
        height,
        marks: marksOf(view.state).map((m) => {
          const from = y(m.from);
          const height = Math.max(MARK_HEIGHT, y(m.to) - from);
          return { top: from, height, className: m.className, from: m.from };
        }),
      };
    },
    write: ({ top, height, marks }: Drawn) => {
      element.style.top = `${String(top)}px`;
      element.style.height = `${String(height)}px`;
      element.replaceChildren(
        ...marks.map((m) => {
          const mark = document.createElement('div');
          mark.className = `cerebro-stripeMark ${m.className}`;
          mark.style.top = `${String(m.top)}px`;
          mark.style.height = `${String(m.height)}px`;
          // A click goes to the mark's place, as on IntelliJ's error stripe; not to the scrollbar
          // under it, nor to its track over it (`@cerebro-ide/ui-scrollbar` passes it on).
          mark.dataset['scrollbarThrough'] = '';
          mark.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            view.dispatch({ selection: { anchor: m.from }, scrollIntoView: true });
            view.focus();
          });
          return mark;
        }),
      );
    },
  };
  view.requestMeasure(measure);
  return {
    update(update: ViewUpdate) {
      if (update.docChanged || update.geometryChanged || !same(update.startState, update.state))
        view.requestMeasure(measure);
    },
    destroy() {
      element.remove();
    },
  };
});
