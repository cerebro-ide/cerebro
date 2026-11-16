// The lines under the pointer on the scrollbar, as IntelliJ's ("Show code lens on scrollbar hover",
// on by default; `EditorMarkupModelImpl.showToolTipByMouseMove` and `EditorFragmentRenderer`, read
// from its source): over a line the editor doesn't show, a preview of the lines around it, left of
// the scrollbar at the pointer's height. The lines are the editor's, highlighted, with their numbers:
// from 5 above the line to 5 below it (`PREVIEW_LINES`), 10 at most, so near the text's start or end
// fewer. It shows 300 ms after the pointer gets there, then follows it at once; gone as the pointer
// leaves the bar or comes to a line that shows, at a key, an edit or a scroll.
//
// The scrollbar (`@cerebro-ide/ui-scrollbar`) is drawn over the page, and tells the scroll area where
// the pointer is on it with a `scrollbar-hover` event (its `BAR_HOVER`). Over a line that shows, the
// stripe's marks there give their tooltips instead (`stripe.ts`).

import { language } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, ViewPlugin } from '@codemirror/view';
import { BAR_HOVER, BESIDE_BAR, hiddenLineAt } from './stripe.js';

/** How long the pointer rests on the bar before the preview shows, in ms (IntelliJ's). */
export const PREVIEW_AFTER = 300;

/** Lines shown above and below the one under the pointer (IntelliJ's `PREVIEW_LINES`). */
const AROUND = 5;

/** The preview of the lines around the one under the pointer on the scrollbar, drawn with `look`. */
export function scrollbarPreview(look: Extension): Extension {
  return ViewPlugin.define((view) => {
    let shown: { dom: HTMLElement; preview: EditorView } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Where the pointer is while the preview waits to show: where it shows. */
    let waiting = { line: 0, clientY: 0 };

    const hide = () => {
      clearTimeout(timer);
      timer = undefined;
      shown?.preview.destroy();
      shown?.dom.remove();
      shown = undefined;
    };

    /** Draws the lines around `line`, at the pointer's height. */
    const draw = (line: number, clientY: number) => {
      const { doc } = view.state;
      const first = Math.max(1, line - AROUND);
      const last = Math.min(doc.lines, line + AROUND);
      // As IntelliJ's: 10 lines' height at most, from the first.
      const count = Math.min(2 * AROUND, last - first);
      const end = doc.line(first + count - 1);
      const lang = view.state.facet(language);
      const state = EditorState.create({
        doc: doc.sliceString(doc.line(first).from, end.to),
        extensions: [
          look,
          lang ? lang.extension : [],
          lineNumbers({ formatNumber: (n) => String(n + first - 1) }),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      });
      if (shown) shown.preview.setState(state);
      else {
        const dom = document.createElement('div');
        dom.className = 'cerebro-scrollbarPreview';
        dom.setAttribute('aria-hidden', 'true');
        dom.style.right = `${String(BESIDE_BAR)}px`;
        view.dom.append(dom);
        const root = view.root as ShadowRoot | Document;
        shown = { dom, preview: new EditorView({ parent: dom, root, state }) };
      }
      shown.dom.style.height = `${String(count * view.defaultLineHeight)}px`;
      // Kept in the editor, frame and all.
      const height = shown.dom.offsetHeight;
      const box = view.dom.getBoundingClientRect();
      const top = Math.min(Math.max(0, clientY - box.top - height / 2), box.height - height);
      shown.dom.style.top = `${String(top)}px`;
    };

    const hover = (event: Event) => {
      const clientY = (event as CustomEvent<number | null>).detail;
      const line = clientY === null ? undefined : hiddenLineAt(view, clientY);
      if (clientY === null || line === undefined) {
        hide();
        return;
      }
      if (shown) {
        draw(line, clientY);
        return;
      }
      // Shown where the pointer is once the wait is over, as IntelliJ's (its moves don't restart it).
      waiting = { line, clientY };
      timer ??= setTimeout(() => {
        timer = undefined;
        draw(waiting.line, waiting.clientY);
      }, PREVIEW_AFTER);
    };

    const { scrollDOM } = view;
    scrollDOM.addEventListener(BAR_HOVER, hover);
    scrollDOM.addEventListener('scroll', hide);
    view.dom.addEventListener('keydown', hide, true);
    return {
      update(update) {
        if (update.docChanged) hide();
      },
      destroy() {
        hide();
        scrollDOM.removeEventListener(BAR_HOVER, hover);
        scrollDOM.removeEventListener('scroll', hide);
        view.dom.removeEventListener('keydown', hide, true);
      },
    };
  });
}
