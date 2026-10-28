// IntelliJ's gutter markers, after the line numbers: on a member or a type, what it implements or
// overrides (an arrow up) and what implements or overrides it (an arrow down), from what's given (a
// language server, in the app). A click on one goes there.
//
// The icons are IntelliJ's own (`platform/icons/src/expui/gutter`, Apache 2.0, © JetBrains s.r.o.
// and contributors): their shapes, in its colours through the theme's tokens.

import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import { gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/** What a gutter marker says: up, to what a member implements or overrides; down, to what does. */
export type MarkerKind = 'implements' | 'overrides' | 'implemented' | 'overridden';

/** A gutter marker on a line, zero-based. */
export interface Mark {
  line: number;
  kind: MarkerKind;
  name: string;
}

/** Asks for a file's marks, given its text as the editor has it; nothing when there's no answer. */
export type AskMarks = (text: string) => Promise<readonly Mark[] | null | undefined>;

/** How long after an edit the marks are asked for again, in ms (a claim: typing isn't held up). */
export const MARKS_AFTER = 500;

/** What each says, as IntelliJ's tooltips start. */
const LABELS: Record<MarkerKind, string> = {
  implements: 'Implements',
  overrides: 'Overrides',
  implemented: 'Is implemented',
  overridden: 'Is overridden',
};

const SVG = 'http://www.w3.org/2000/svg';
const DISC =
  'M5.5 11.5C7.98528 11.5 10 9.48528 10 7C10 4.51472 7.98528 2.5 5.5 2.5C3.01472 2.5 1 4.51472 1 7C1 9.48528 3.01472 11.5 5.5 11.5Z';
const I = 'M5 5H4V4H7V5H6V9H7V10H4V9H5V5Z';
const O =
  'M5.4918 10C3.72951 10 2.5 8.64917 2.5 7.01657V7C2.5 5.3674 3.7459 4 5.5082 4C7.27049 4 8.5 5.35083 8.5 6.98343V7C8.5 8.6326 7.2541 10 5.4918 10ZM5.5082 9.05525C6.64754 9.05525 7.44262 8.14365 7.44262 7.01657V7C7.44262 5.87293 6.63115 4.94475 5.4918 4.94475C4.35246 4.94475 3.55738 5.85635 3.55738 6.98343V7C3.55738 8.12707 4.36885 9.05525 5.5082 9.05525Z';
const UP = {
  ring: 'M10 7C10 9.48528 7.98528 11.5 5.5 11.5C3.01472 11.5 1 9.48528 1 7C1 4.51472 3.01472 2.5 5.5 2.5C6.61537 2.5 7.63597 2.90579 8.4222 3.5778L8.43934 3.56066C8.05008 3.1714 7.91948 2.62142 8.04756 2.12432C7.28593 1.72554 6.41931 1.5 5.5 1.5C2.46243 1.5 0 3.96243 0 7C0 10.0376 2.46243 12.5 5.5 12.5C7.91689 12.5 9.96967 10.9411 10.7077 8.7739C10.2828 8.50906 10 8.03755 10 7.5V7Z',
  arrow:
    'M11.5 8C11.2239 8 11 7.77614 11 7.5L11 1.70711L9.85355 2.85355C9.65829 3.04882 9.34171 3.04882 9.14645 2.85355C8.95118 2.65829 8.95118 2.34171 9.14645 2.14645L11.1464 0.146447C11.3417 -0.0488155 11.6583 -0.0488155 11.8536 0.146447L13.8536 2.14645C14.0488 2.34171 14.0488 2.65829 13.8536 2.85355C13.6583 3.04882 13.3417 3.04882 13.1464 2.85355L12 1.70711L12 7.5C12 7.77614 11.7761 8 11.5 8Z',
};
const DOWN = {
  ring: 'M5.5 1.5C7.91689 1.5 9.96967 3.05893 10.7077 5.22611C10.2828 5.49095 10 5.96245 10 6.5V7C10 4.51472 7.98528 2.5 5.5 2.5C3.01472 2.5 1 4.51472 1 7C1 9.48528 3.01472 11.5 5.5 11.5C6.61537 11.5 7.63597 11.0942 8.4222 10.4222L8.43934 10.4393C8.05008 10.8286 7.91949 11.3786 8.04756 11.8757C7.28593 12.2745 6.41931 12.5 5.5 12.5C2.46243 12.5 0 10.0376 0 7C0 3.96243 2.46243 1.5 5.5 1.5Z',
  arrow:
    'M11.5 6C11.7761 6 12 6.22386 12 6.5V12.2929L13.1464 11.1464C13.3417 10.9512 13.6583 10.9512 13.8536 11.1464C14.0488 11.3417 14.0488 11.6583 13.8536 11.8536L11.8536 13.8536C11.6583 14.0488 11.3417 14.0488 11.1464 13.8536L9.14645 11.8536C8.95118 11.6583 8.95118 11.3417 9.14645 11.1464C9.34171 10.9512 9.65829 10.9512 9.85355 11.1464L11 12.2929V6.5C11 6.22386 11.2239 6 11.5 6Z',
};

/** A marker's icon: a disc with I or O in it, ringed, and its arrow. */
function iconOf(kind: MarkerKind): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 14 14');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const up = kind === 'implements' || kind === 'overrides';
  const { ring, arrow } = up ? UP : DOWN;
  const letter = kind === 'implements' || kind === 'implemented' ? I : O;
  for (const [d, part] of [
    [DISC, 'disc'],
    [letter, 'mark'],
    [arrow, 'arrow'],
    [ring, 'mark'],
  ] as const) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('class', `cerebro-marker__${part}`);
    svg.append(path);
  }
  return svg;
}

/** A line's markers, as one gutter element. */
class LineMarks extends GutterMarker {
  constructor(readonly marks: readonly Mark[]) {
    super();
  }

  override eq(other: LineMarks): boolean {
    return (
      other.marks.length === this.marks.length &&
      other.marks.every((m, i) => {
        const mine = this.marks[i] as Mark;
        return m.kind === mine.kind && m.name === mine.name;
      })
    );
  }

  override toDOM(): Node {
    const element = document.createElement('span');
    element.className = 'cerebro-markers__line';
    this.marks.forEach((mark, i) => {
      const button = document.createElement('span');
      const up = mark.kind === 'implements' || mark.kind === 'overrides';
      const family = mark.kind === 'implements' || mark.kind === 'implemented' ? 'i' : 'o';
      button.className = `cerebro-marker cerebro-marker--${family} cerebro-marker--${up ? 'up' : 'down'}`;
      button.dataset['marker'] = String(i);
      button.title = `${LABELS[mark.kind]} ${mark.name}`;
      button.setAttribute('aria-label', button.title);
      button.append(iconOf(mark.kind));
      element.append(button);
    });
    return element;
  }
}

const setMarks = StateEffect.define<readonly Mark[]>();

/** The marks shown, by line, moved along with edits until the next answer. */
const marksField = StateField.define<RangeSet<LineMarks>>({
  create: () => RangeSet.empty,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue;
      const byLine = new Map<number, Mark[]>();
      for (const mark of effect.value) {
        if (mark.line >= tr.state.doc.lines) continue;
        byLine.set(mark.line, [...(byLine.get(mark.line) ?? []), mark]);
      }
      return RangeSet.of(
        [...byLine].map(([line, on]) => new LineMarks(on).range(tr.state.doc.line(line + 1).from)),
        true,
      );
    }
    return marks.map(tr.changes);
  },
});

/**
 * The gutter markers asked of `ask` when the editor opens and once an edit has settled, and `open`
 * called with the one clicked.
 */
export function gutterMarkers(
  ask: AskMarks,
  open: (mark: Mark) => void,
  after = MARKS_AFTER,
): Extension {
  const asker = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = () => {
      const { doc } = view.state;
      void ask(doc.toString()).then((found) => {
        // Edited since: a later question answers.
        if (view.state.doc !== doc) return;
        view.dispatch({ effects: setMarks.of(found ?? []) });
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
    marksField,
    asker,
    gutter({
      class: 'cerebro-markers',
      markers: (view) => view.state.field(marksField),
      domEventHandlers: {
        mousedown(view, line, event) {
          const target = (event.target as Element).closest<HTMLElement>('[data-marker]');
          if (!target) return false;
          let marks: readonly Mark[] = [];
          view.state.field(marksField).between(line.from, line.from, (_from, _to, value) => {
            marks = value.marks;
          });
          // The line's element is drawn from these marks, so its index is one of theirs.
          event.preventDefault();
          open(marks[Number(target.dataset['marker'])] as Mark);
          return true;
        },
      },
    }),
  ];
}
