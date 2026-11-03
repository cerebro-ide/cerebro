// A file's problems, as IntelliJ shows its highlights, from what's given (a language server, in
// the app):
//
// - **In the text:** an error or a warning underlined with a wave, in its colour (a warning in the
//   light theme has a background instead, as IntelliJ's); unused code greyed, deprecated code
//   struck out. Its message shows with the pointer over it.
// - **On the error stripe** (`stripe.ts`): a mark for each error and warning, errors on top.
// - **In the editor's corner:** how many errors and warnings there are, or a tick for none, with
//   arrows to the previous and next; F2 and Shift+F2 go there too.

import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { errorStripe, stripeMarks, type StripeMark } from './stripe.js';
import type { Place } from './usages.js';

/** How bad a problem is: an error, a warning, a weak warning, or a hint (shown by its tags alone). */
export type Severity = 'error' | 'warning' | 'weak' | 'hint';

/** A problem in the file: where it is (zero-based), how bad, and what it says. */
export interface Problem {
  from: Place;
  to: Place;
  severity: Severity;
  message: string;
  /** Code that does nothing (an unused variable): greyed. */
  unused?: boolean;
  /** Deprecated code: struck out. */
  deprecated?: boolean;
}

/** Asks for the file's problems, given its text as the editor has it; nothing without an answer. */
export type AskProblems = (text: string) => Promise<readonly Problem[] | null | undefined>;

/** How long after an edit the problems are asked for (a claim: IntelliJ's autoreparse delay). */
export const PROBLEMS_AFTER = 300;

/** A problem placed in the text: positions, moved along with edits. */
interface Placed {
  from: number;
  to: number;
  severity: Severity;
  message: string;
  unused: boolean;
  deprecated: boolean;
}

const RANK: Record<Severity, number> = { hint: 0, weak: 1, warning: 2, error: 3 };

/** A place as a position in the text, kept within its line and the text. */
function positionOf(state: EditorState, place: Place): number {
  if (place.line >= state.doc.lines) return state.doc.length;
  const line = state.doc.line(place.line + 1);
  return Math.min(line.from + place.column, line.to);
}

/**
 * Where a problem is drawn: an empty one (a missing `;` at a line's end) takes the character after
 * it, or the one before at its line's end, so it shows.
 */
function drawnAt(state: EditorState, from: number, to: number): { from: number; to: number } {
  if (from < to) return { from, to };
  const line = state.doc.lineAt(from);
  if (from < line.to) return { from, to: from + 1 };
  if (from > line.from) return { from: from - 1, to: from };
  return { from, to };
}

const setProblems = StateEffect.define<readonly Placed[]>();

/** The problems shown, the worst first, moved along with edits. */
const problemsField = StateField.define<readonly Placed[]>({
  create: () => [],
  update(problems, tr) {
    for (const effect of tr.effects) if (effect.is(setProblems)) return effect.value;
    if (!tr.docChanged) return problems;
    return problems.map((p) => ({
      ...p,
      from: tr.changes.mapPos(p.from, 1),
      to: Math.max(tr.changes.mapPos(p.from, 1), tr.changes.mapPos(p.to, -1)),
    }));
  },
});

/** A problem's classes in the text, by how bad it is and its tags; none for a bare hint. */
function classesOf(problem: Placed): string {
  const classes = problem.severity === 'hint' ? [] : [`cerebro-problem--${problem.severity}`];
  if (problem.unused) classes.push('cerebro-problem--unused');
  if (problem.deprecated) classes.push('cerebro-problem--deprecated');
  return classes.join(' ');
}

/**
 * The problems as marks in the text. Of two on the same text, the worse goes inside the other,
 * drawn over it: CodeMirror puts the later one outside (seen in the test), so it's added first.
 */
const decorations = EditorView.decorations.compute([problemsField], (state): DecorationSet => {
  const shown = state
    .field(problemsField)
    .map((p) => ({
      ...drawnAt(state, p.from, p.to),
      className: classesOf(p),
      rank: RANK[p.severity],
    }))
    .filter((p) => p.className !== '' && p.from < p.to)
    .sort((a, b) => a.from - b.from || b.rank - a.rank);
  const builder = new RangeSetBuilder<Decoration>();
  for (const p of shown) {
    builder.add(p.from, p.to, Decoration.mark({ class: `cerebro-problem ${p.className}` }));
  }
  return builder.finish();
});

/** The problems' marks on the error stripe: errors and warnings, not hints. Made once per set. */
const madeMarks = new WeakMap<readonly Placed[], StripeMark[]>();
const stripe = stripeMarks.of((state) => {
  const problems = state.field(problemsField);
  let marks = madeMarks.get(problems);
  if (!marks) {
    marks = problems
      .filter((p) => p.severity !== 'hint')
      .map((p) => ({
        from: p.from,
        to: p.to,
        className: `cerebro-problemMark cerebro-problemMark--${p.severity}`,
        rank: RANK[p.severity],
      }));
    madeMarks.set(problems, marks);
  }
  return marks;
});

/** The messages of the problems at a position, the worst first. */
const tooltip = hoverTooltip((view, pos, side) => {
  // The character under the pointer: before the position, or after it.
  const char = side < 0 ? pos - 1 : pos;
  const here = view.state
    .field(problemsField)
    .filter((p) => {
      const drawn = drawnAt(view.state, p.from, p.to);
      return p.severity !== 'hint' && drawn.from <= char && char < drawn.to;
    })
    .sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const first = here[0];
  if (!first) return null;
  return {
    pos: first.from,
    end: first.to,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cerebro-problemTooltip';
      for (const p of here) {
        const line = document.createElement('div');
        line.className = 'cerebro-problemTooltip__message';
        line.textContent = p.message;
        dom.append(line);
      }
      return { dom };
    },
  };
});

/**
 * The problem to go to from the caret, forward or back, wrapping around: errors only when there
 * are some, as IntelliJ goes to the worst first (a claim); none when there are none.
 */
function nextProblem(state: EditorState, forward: boolean): number | undefined {
  const problems = state.field(problemsField).filter((p) => p.severity !== 'hint');
  const errors = problems.filter((p) => p.severity === 'error');
  const starts = [...new Set((errors.length > 0 ? errors : problems).map((p) => p.from))].sort(
    (a, b) => a - b,
  );
  if (starts.length === 0) return undefined;
  const head = state.selection.main.head;
  return forward
    ? (starts.find((at) => at > head) ?? starts[0])
    : (starts.findLast((at) => at < head) ?? starts.at(-1));
}

/** Moves the caret to the next problem, or the previous; false when there are none. */
export function goToProblem(view: EditorView, forward: boolean): boolean {
  const at = nextProblem(view.state, forward);
  if (at === undefined) return false;
  view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
  return true;
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * IntelliJ's icons (`expui/status/error`, `warning`, `general/inspections/inspectionsOK`, and
 * `general/chevronUp`, `chevronDown`; Apache 2.0, © JetBrains s.r.o. and contributors), in the
 * theme's colours.
 */
const ICONS = {
  error: [
    ['circle', { cx: '8', cy: '8', r: '7', fill: 'var(--cerebro-icon-error)' }],
    [
      'path',
      {
        d: 'M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C7 8.05229 7.44772 8.5 8 8.5C8.55229 8.5 9 8.05228 9 7.5L9 5Z M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z',
        fill: '#ffffff',
      },
    ],
  ],
  warning: [
    [
      'path',
      {
        d: 'M1.27603 10.8634L6.3028 1.98903C7.04977 0.670323 8.94893 0.670326 9.69589 1.98903L14.7227 10.8634C15.516 12.2639 14.5047 14 12.8956 14H3.10308C1.494 14 0.482737 12.2639 1.27603 10.8634Z',
        fill: 'var(--cerebro-icon-warning)',
      },
    ],
    [
      'path',
      {
        d: 'M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C7 8.05229 7.44772 8.5 8 8.5C8.55229 8.5 9 8.05228 9 7.5L9 5Z M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z',
        fill: 'var(--cerebro-icon-warning-mark)',
      },
    ],
  ],
  ok: [['path', { d: 'M3 8.5L6 11.5L12.5 5', class: 'cerebro-problemIcon__ok' }]],
  up: [['path', { d: 'M4.5 9.75L8 6.25L11.5 9.75', class: 'cerebro-problemIcon__chevron' }]],
  down: [['path', { d: 'M11.5 6.25L8 9.75L4.5 6.25', class: 'cerebro-problemIcon__chevron' }]],
} as const satisfies Record<string, readonly (readonly [string, Record<string, string>])[]>;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of ICONS[name]) {
    const part = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) {
      // A colour through the style object: a theme variable, which an attribute can't take, without
      // a rule for it, so the icon shows outside the editor's shadow root too.
      if (key === 'fill') part.style.fill = value;
      else part.setAttribute(key, value);
    }
    svg.append(part);
  }
  return svg;
}

/**
 * A problem's icon, as the Problems tool window lists it: IntelliJ's error or warning, a weak
 * warning's the warning's (a claim: IntelliJ's own wasn't found among its status icons).
 */
export function problemIcon(severity: 'error' | 'warning' | 'weak'): SVGSVGElement {
  return icon(severity === 'error' ? 'error' : 'warning');
}

/**
 * IntelliJ's inspection widget, in the editor's top right corner: the count of errors and of
 * warnings (weak ones counted with them), or a tick for none, and arrows to the previous and next.
 * Not shown before the first answer.
 */
const widget = (onShow: (() => void) | undefined) =>
  ViewPlugin.define((view) => {
    const element = document.createElement('div');
    element.className = 'cerebro-problems';
    element.hidden = true;
    view.dom.append(element);
    const arrow = (forward: boolean) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cerebro-problems__arrow';
      button.title = forward ? 'Next Highlighted Error' : 'Previous Highlighted Error';
      button.append(icon(forward ? 'down' : 'up'));
      // The editor keeps the focus, as IntelliJ's.
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        goToProblem(view, forward);
      });
      return button;
    };
    const draw = (problems: readonly Placed[]) => {
      const errors = problems.filter((p) => p.severity === 'error').length;
      const warnings = problems.filter(
        (p) => p.severity === 'warning' || p.severity === 'weak',
      ).length;
      const counts: Node[] = [];
      const count = (name: 'error' | 'warning', n: number, title: string) => {
        const item = document.createElement('span');
        item.className = `cerebro-problems__count cerebro-problems__count--${name}`;
        item.title = title;
        item.append(icon(name), String(n));
        if (onShow) {
          item.classList.add('cerebro-problems__count--opens');
          item.addEventListener('click', onShow);
        }
        counts.push(item);
      };
      if (errors > 0)
        count('error', errors, `${String(errors)} ${errors === 1 ? 'error' : 'errors'}`);
      if (warnings > 0) {
        count(
          'warning',
          warnings,
          `${String(warnings)} ${warnings === 1 ? 'warning' : 'warnings'}`,
        );
      }
      if (counts.length === 0) {
        const ok = document.createElement('span');
        ok.className = 'cerebro-problems__ok';
        ok.title = 'No problems found';
        ok.append(icon('ok'));
        if (onShow) {
          ok.classList.add('cerebro-problems__count--opens');
          ok.addEventListener('click', onShow);
        }
        counts.push(ok);
      } else counts.push(arrow(false), arrow(true));
      element.replaceChildren(...counts);
    };
    return {
      update(update: ViewUpdate) {
        const problems = update.state.field(problemsField);
        if (!update.transactions.some((tr) => tr.effects.some((e) => e.is(setProblems)))) return;
        element.hidden = false;
        draw(problems);
      },
      destroy() {
        element.remove();
      },
    };
  });

/**
 * The file's problems, asked of `ask` as it opens and once an edit has settled, and shown. A click
 * on the corner's counts runs `onShow`: IntelliJ's shows the Problems tool window.
 */
export function problemHighlights(
  ask: AskProblems,
  onShow?: () => void,
  after = PROBLEMS_AFTER,
): Extension {
  const asker = ViewPlugin.define((view) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (wait: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const { state } = view;
        void ask(state.doc.toString()).then((found) => {
          // Edited since: a later question answers. No answer: what's shown stays.
          if (view.state.doc !== state.doc || !found) return;
          const placed = found
            .map((p) => {
              const from = positionOf(state, p.from);
              return {
                from,
                to: Math.max(from, positionOf(state, p.to)),
                severity: p.severity,
                message: p.message,
                unused: p.unused ?? false,
                deprecated: p.deprecated ?? false,
              };
            })
            .sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.from - b.from);
          view.dispatch({ effects: setProblems.of(placed) });
        });
      }, wait);
    };
    schedule(0);
    return {
      update(update: ViewUpdate) {
        if (update.docChanged) schedule(after);
      },
      destroy() {
        clearTimeout(timer);
      },
    };
  });
  return [problemsField, decorations, asker, stripe, errorStripe, tooltip, widget(onShow)];
}
