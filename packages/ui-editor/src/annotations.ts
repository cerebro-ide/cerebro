// IntelliJ's text annotations in the gutter (`EditorGutterComponentImpl`, `EditorGutterLayout`, read
// from its source): columns of text by each line, before the line numbers as its new UI has them,
// each as wide as its widest text and 5px more, in the UI's font, over each line's background. What
// they say is given (who last changed each line, in the app): asked as the editor opens, and again
// once an edit has settled, of the text as it is.

import { RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import {
  gutter,
  GutterMarker,
  ViewPlugin,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

/** A line's annotation: its columns' texts, in order. */
export interface LineAnnotation {
  texts: readonly string[];
  /** In the latest's colour: IntelliJ's for a file's last commit. */
  latest?: boolean;
  /** Its background, a CSS colour. */
  background?: string;
}

/** A text's annotations, by line; null for a line they say nothing of. */
export interface TextAnnotation {
  lines: readonly (LineAnnotation | null)[];
  /** What a line's tooltip says. */
  tooltip: (line: number) => string;
  /** A line's annotation right-clicked: its menu, where the pointer is. */
  menu: (line: number, event: MouseEvent) => void;
}

/** Asks for a text's annotations; nothing when there's no answer. */
export type AskAnnotation = (text: string) => Promise<TextAnnotation | undefined>;

/** How long after an edit they're asked for again, in ms (as the gutter markers are). */
export const ANNOTATIONS_AFTER = 500;

/** The gap after each column, in px: IntelliJ's GAP_BETWEEN_ANNOTATIONS. */
const GAP = 5;

/** A line's annotation as drawn: its texts in columns of the widths given. */
class LineMarker extends GutterMarker {
  constructor(
    readonly line: number,
    readonly annotation: LineAnnotation,
    readonly widths: readonly number[],
    readonly tooltip: (line: number) => string,
  ) {
    super();
  }

  override eq(other: LineMarker): boolean {
    return (
      other.line === this.line &&
      other.annotation === this.annotation &&
      other.widths.join() === this.widths.join()
    );
  }

  override toDOM(): Node {
    const element = document.createElement('span');
    element.className = `cerebro-annotation${this.annotation.latest ? ' cerebro-annotation--latest' : ''}`;
    if (this.annotation.background) element.style.background = this.annotation.background;
    this.widths.forEach((width, i) => {
      const column = document.createElement('span');
      column.className = 'cerebro-annotation__column';
      column.style.width = `${String(width + GAP)}px`;
      column.textContent = this.annotation.texts[i] ?? '';
      element.append(column);
    });
    element.title = this.tooltip(this.line);
    return element;
  }
}

interface Shown {
  annotation: TextAnnotation;
  markers: RangeSet<LineMarker>;
  widths: readonly number[];
}

const setAnnotation = StateEffect.define<{ annotation: TextAnnotation; widths: number[] }>();

/** The annotations shown, by line, moved along with edits until the next answer. */
const shownField = StateField.define<Shown | undefined>({
  create: () => undefined,
  update(shown, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setAnnotation)) continue;
      const { annotation, widths } = effect.value;
      const markers = annotation.lines.flatMap((line, i) =>
        line && i < tr.state.doc.lines
          ? [
              new LineMarker(i, line, widths, annotation.tooltip).range(
                tr.state.doc.line(i + 1).from,
              ),
            ]
          : [],
      );
      return { annotation, markers: RangeSet.of(markers), widths };
    }
    if (!shown || !tr.docChanged) return shown;
    // With their lines: text put at a line's start goes before its annotation.
    const moved: Range<LineMarker>[] = [];
    for (const at = shown.markers.iter(); at.value; at.next()) {
      moved.push(at.value.range(tr.changes.mapPos(at.from, 1)));
    }
    return { ...shown, markers: RangeSet.of(moved, true) };
  },
});

/** What keeps the gutter as wide as the columns shown. */
const spacerOf = (shown: Shown | undefined) =>
  new LineMarker(-1, { texts: [] }, shown?.widths ?? [], () => '');

/** Each column's width, in px: its widest text's, in the gutter's font. */
function widthsOf(view: EditorView, annotation: TextAnnotation): number[] {
  const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  const sample = view.dom.querySelector('.cerebro-annotations') ?? view.dom;
  // Chrome's computed `font` is empty (measured): it's put together.
  const { fontWeight, fontSize, fontFamily } = getComputedStyle(sample);
  context.font = `${fontWeight} ${fontSize} ${fontFamily}`;
  const widths: number[] = [];
  for (const line of annotation.lines) {
    line?.texts.forEach((text, i) => {
      widths[i] = Math.max(widths[i] ?? 0, Math.ceil(context.measureText(text).width));
    });
  }
  return widths;
}

/** The annotations asked of `ask`, in a gutter before the line numbers. */
export function textAnnotations(ask: AskAnnotation, after = ANNOTATIONS_AFTER): Extension {
  const asker = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = () => {
      const { doc } = view.state;
      void ask(doc.toString()).then((found) => {
        // Edited since: a later question answers.
        if (view.state.doc !== doc || !found) return;
        view.dispatch({
          effects: setAnnotation.of({ annotation: found, widths: widthsOf(view, found) }),
        });
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
  });
  return [
    shownField,
    asker,
    gutter({
      class: 'cerebro-annotations',
      markers: (view) => view.state.field(shownField)?.markers ?? RangeSet.empty,
      // As wide as its columns with no annotated line in view: lines changed since, scrolled to.
      initialSpacer: (view) => spacerOf(view.state.field(shownField)),
      updateSpacer: (spacer, update) => {
        const shown = update.state.field(shownField);
        return shown?.widths === update.startState.field(shownField)?.widths
          ? spacer
          : spacerOf(shown);
      },
      domEventHandlers: {
        contextmenu(view, block, event) {
          const shown = view.state.field(shownField);
          let line: number | undefined;
          shown?.markers.between(block.from, block.from, (_from, _to, marker) => {
            line = marker.line;
          });
          if (!shown || line === undefined) return false;
          event.preventDefault();
          shown.annotation.menu(line, event as MouseEvent);
          return true;
        },
      },
    }),
  ];
}
