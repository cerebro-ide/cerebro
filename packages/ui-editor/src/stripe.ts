// IntelliJ's error stripe: marks over the scrollbar's band, one for each thing the editor shows in
// the text (the symbol at the caret's usages, a problem), where it is in the whole text. What has
// marks gives them through `stripeMarks`; clicking one puts the caret there.
//
// With the pointer on the bar over a line that shows, the tooltips of the marks near it, as
// IntelliJ's (`EditorMarkupModelImpl.showToolTipByMouseMove`, read from its source): those within
// twice a mark's least height of the pointer, each text once, the highest rank first, then by text
// (`DaemonTooltipRendererProvider`), left of the bar at the nearest mark's middle. Over a line that
// doesn't show, the preview of the lines there (`scrollbar-preview.ts`).

import { Facet, type EditorState } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';

/** A mark on the stripe: a stretch of the text, and the class that colours it. */
export interface StripeMark {
  from: number;
  to: number;
  className: string;
  /** Drawn over marks of a lower rank: an error over a warning over a usage. Default: 0. */
  rank?: number;
  /** What it says with the pointer near it on the bar: a problem's message, a usage's line. */
  tooltip: string;
}

/** What gives marks: the state's, read whenever it changes (a field's value, kept while equal). */
export const stripeMarks = Facet.define<(state: EditorState) => readonly StripeMark[]>();

/** A stripe mark's least height, in px: IntelliJ's (`ERROR_STRIPE_MARK_MIN_HEIGHT`, 2). */
const MARK_HEIGHT = 2;

/** What `ui-scrollbar` names the event (its `BAR_HOVER`), the pointer's `clientY` or `null`. */
export const BAR_HOVER = 'scrollbar-hover';

/** How far what shows beside the bar stays from the editor's right edge: the bar's 10px, 2px in, and 2px more. */
export const BESIDE_BAR = 14;

/**
 * The line, 1-based, at a height on the scrollbar: as the stripe places marks, the whole text scaled
 * to the scroll area (the bar is drawn only when the text is taller). Undefined when the line shows.
 */
export function hiddenLineAt(view: EditorView, clientY: number): number | undefined {
  const { scrollDOM } = view;
  const height = scrollDOM.clientHeight;
  const whole = view.contentHeight;
  const y = clientY - scrollDOM.getBoundingClientRect().top;
  const at = (y / height) * whole - view.documentPadding.top;
  const block = view.lineBlockAtHeight(Math.max(0, at));
  // Shown when its top is in the area, as IntelliJ asks (`area.contains(x, visualY)`).
  const top = block.top + view.documentPadding.top - scrollDOM.scrollTop;
  if (top >= 0 && top < height) return undefined;
  return view.state.doc.lineAt(block.from).number;
}

/**
 * A mark's tooltip for a usage: its line, trimmed, its first 140 characters and "..." when longer,
 * as IntelliJ's (`HighlightHandlerBase.getLineTextErrorStripeTooltip`).
 */
export function lineTooltip(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos);
  const text = line.text.slice(0, 140);
  return text.length < line.length ? `${text.trim()}...` : text.trim();
}

/** Where the stripe is in the editor, and its marks in it, in px. */
interface Drawn {
  top: number;
  height: number;
  marks: {
    top: number;
    height: number;
    className: string;
    from: number;
    rank: number;
    tooltip: string;
  }[];
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
          return {
            top: from,
            height,
            className: m.className,
            from: m.from,
            rank: m.rank ?? 0,
            tooltip: m.tooltip,
          };
        }),
      };
    },
    write: (measured: Drawn) => {
      drawn = measured;
      const { top, height, marks } = measured;
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
  let drawn: Drawn | undefined;
  let tip: HTMLElement | undefined;
  const hide = () => {
    tip?.remove();
    tip = undefined;
  };
  const hover = (event: Event) => {
    const clientY = (event as CustomEvent<number | null>).detail;
    if (clientY === null || !drawn || hiddenLineAt(view, clientY) !== undefined) {
      hide();
      return;
    }
    const y = clientY - view.scrollDOM.getBoundingClientRect().top;
    const reach = 2 * MARK_HEIGHT;
    const near = drawn.marks.filter((m) => y >= m.top - reach && y <= m.top + m.height + reach);
    const texts = [
      ...new Set(
        near
          .slice()
          .sort((a, b) => b.rank - a.rank || a.tooltip.localeCompare(b.tooltip))
          .map((m) => m.tooltip),
      ),
    ];
    const first = near[0];
    if (!first) {
      hide();
      return;
    }
    const nearest = near.reduce(
      (best, m) => (Math.abs(m.top - y) < Math.abs(best.top - y) ? m : best),
      first,
    );
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'cerebro-stripeTooltip';
      tip.setAttribute('role', 'tooltip');
      tip.style.right = `${String(BESIDE_BAR)}px`;
      view.dom.append(tip);
    }
    tip.replaceChildren(
      ...texts.map((text) => {
        const line = document.createElement('div');
        line.className = 'cerebro-stripeTooltip__text';
        line.textContent = text;
        return line;
      }),
    );
    const box = view.dom.getBoundingClientRect();
    const middle = drawn.top + nearest.top + nearest.height / 2;
    const tall = tip.offsetHeight;
    tip.style.top = `${String(Math.min(Math.max(0, middle - tall / 2), box.height - tall))}px`;
  };
  const { scrollDOM } = view;
  scrollDOM.addEventListener(BAR_HOVER, hover);
  scrollDOM.addEventListener('scroll', hide);
  view.dom.addEventListener('keydown', hide, true);
  view.requestMeasure(measure);
  return {
    update(update: ViewUpdate) {
      if (update.docChanged) hide();
      if (update.docChanged || update.geometryChanged || !same(update.startState, update.state))
        view.requestMeasure(measure);
    },
    destroy() {
      hide();
      element.remove();
      scrollDOM.removeEventListener(BAR_HOVER, hover);
      scrollDOM.removeEventListener('scroll', hide);
      view.dom.removeEventListener('keydown', hide, true);
    },
  };
});
