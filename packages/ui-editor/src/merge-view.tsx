// A conflicted file's three-way merge, as IntelliJ's merge window: yours on the left, the result in
// the middle (the base to start with, editable), theirs on the right. Each change is marked in all
// three in IntelliJ's colours, its lines aligned by spacers, as the two-way diff aligns them; beside
// each side's, between the panes, an arrow takes it into the result and a cross ignores it. Once a
// side of a conflict is taken, the other's arrow adds it after. A change taken or ignored is
// resolved and no longer marked. The panes scroll together, in one frame.

import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Text,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  lineNumbers,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal } from '@cerebro-ide/reactive';
import { gutterObstacle, highlight, scroller, selection, theme, variable } from './editor.js';
import { languageFor } from './languages.js';
import { mergeChanges, type Lines, type MergeChange } from './merge.js';
import { fullWidth } from './width.js';

export interface MergeEditorProps {
  /** The file's path: its language comes from the extension. */
  path: string;
  base: string;
  yours: string;
  theirs: string;
  /** Read reactively. Default: 13. */
  fontSize?: () => number;
  /** Read reactively. Default: 4. */
  tabSize?: () => number;
  /** Given the merge's controls, once it shows. */
  control?: (merge: MergeControl) => void;
}

/** What's left to resolve: changes on one side, and conflicts. */
export interface MergeLeft {
  changes: number;
  conflicts: number;
}

export interface MergeControl {
  /** The result, as merged so far. */
  text(): string;
  /** Read reactively. */
  left(): MergeLeft;
  /**
   * Whether the result has changed since the window opened, typed into or a change taken (IntelliJ's
   * `getContentModified`): what's lost if the merge is cancelled.
   */
  modified(): boolean;
  /** Takes the changes that aren't in conflict: one side's, or both's (IntelliJ's Apply non-conflicting changes). */
  applyNonConflicting(side: 'yours' | 'theirs' | 'all'): void;
}

type Side = 'yours' | 'theirs';

/** A change as the merge goes: where it is in the result, and what's been done with each side. */
interface Tracked {
  change: MergeChange;
  /** In the result: from the start of its first line to the start of the line after. */
  from: number;
  to: number;
  done: Record<Side, 'no' | 'taken' | 'ignored'>;
}

/** The pane of the side that didn't make a change, by its kind. */
const other: Partial<Record<MergeChange['kind'], Side>> = { yours: 'theirs', theirs: 'yours' };

/** A range of lines' text, each line's. */
const linesOf = (doc: Text, lines: Lines) =>
  Array.from({ length: lines.to - lines.from }, (_, i) => doc.line(lines.from + i + 1).text);

/** Whether a change needs nothing more. */
const resolved = (t: Tracked) => t.done.yours !== 'no' && t.done.theirs !== 'no';

/** Its colour, as IntelliJ's (`TextDiffType`): a conflict's, or what its side did to the base. */
function colour(t: Tracked): string {
  const { kind, base } = t.change;
  if (kind === 'conflict') return 'conflict';
  const lines = kind === 'theirs' ? t.change.theirs : t.change.yours;
  if (base.from === base.to) return 'inserted';
  return lines.from === lines.to ? 'deleted' : 'modified';
}

/** A gap that keeps a change's lines level with the other panes'. */
class Spacer extends WidgetType {
  constructor(
    readonly height: number,
    readonly kind: string | undefined,
  ) {
    super();
  }
  override eq(other: Spacer) {
    return other.height === this.height && other.kind === this.kind;
  }
  toDOM() {
    const gap = document.createElement('div');
    gap.className = `cm-merge3-spacer${this.kind ? ` cm-merge3-${this.kind}` : ''}`;
    // Through the style object, which the page's Content-Security-Policy allows.
    gap.style.height = `${String(this.height)}px`;
    return gap;
  }
  override get estimatedHeight() {
    return this.height;
  }
}

/** The marks and spacers, as the merge sets them. */
const setMarks = StateEffect.define<DecorationSet>();
const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) =>
    tr.effects.reduce((v, e) => (e.is(setMarks) ? e.value : v), value.map(tr.changes)),
  provide: (field) => EditorView.decorations.from(field),
});

/** The changes' colours, from IntelliJ's colour schemes. */
const mergeTheme = EditorView.theme({
  '.cm-merge3-modified': { backgroundColor: variable('diff-modified') },
  '.cm-merge3-inserted': { backgroundColor: variable('diff-inserted') },
  '.cm-merge3-deleted': { backgroundColor: variable('diff-deleted') },
  '.cm-merge3-conflict': { backgroundColor: variable('diff-conflict') },
  // A change with no lines here: a line where it would be.
  '.cm-merge3-spacer': { borderTop: `1px solid ${variable('diff-edge')}`, marginTop: '-1px' },
  // The frame scrolls, not each pane.
  '&': { height: 'auto' },
  '.cm-scroller': { overflowY: 'visible' },
});

/** The frame and its panes' layout, as a constructable sheet: the page allows no style element. */
const LAYOUT = `
.cm-merge3 { height: 100%; overflow: auto; }
.cm-merge3-panes { display: flex; min-height: 100%; }
.cm-merge3-panes > .cm-editor { flex: 1 1 0; min-width: 0; }
.cm-merge3-divider { flex: 0 0 34px; position: relative; background: var(--cerebro-background); }
.cm-merge3-control {
  position: absolute; width: 16px; height: 16px; padding: 0; border: none; border-radius: 3px;
  background: transparent; color: var(--cerebro-text); font: 12px/16px sans-serif; cursor: pointer;
}
.cm-merge3-control:hover { background: var(--cerebro-diff-edge); }
`;

/** A three-way merge of one file. */
export function MergeEditor(props: MergeEditorProps): Node {
  const container = document.createElement('div');
  container.className = 'cerebro-editor-merge';
  const shadow = container.attachShadow({ mode: 'open' });
  const layout = new CSSStyleSheet();
  layout.replaceSync(LAYOUT);
  shadow.adoptedStyleSheets = [layout];
  const frame = document.createElement('div');
  frame.className = 'cm-merge3';
  const panes = document.createElement('div');
  panes.className = 'cm-merge3-panes';
  frame.append(panes);
  shadow.append(frame);

  let tracked: Tracked[] = [];
  const left = signal<MergeLeft>({ changes: 0, conflicts: 0 });

  const language = languageFor(props.path);
  const settings = [new Compartment(), new Compartment(), new Compartment()] as const;
  const configure = (): Extension => [
    EditorState.tabSize.of(props.tabSize?.() ?? 4),
    EditorView.theme({ '.cm-scroller': scroller(props.fontSize?.() ?? 13) }),
  ];
  let modified = false;
  const pane = (doc: string, compartment: Compartment, editable: boolean) =>
    new EditorView({
      doc,
      root: shadow,
      extensions: [
        lineNumbers(),
        gutterObstacle,
        fullWidth,
        selection,
        editable
          ? EditorView.updateListener.of((update) => {
              if (!update.docChanged) return;
              modified = true;
              // Typed at a change's first line, it's in the change; at the line after, it isn't.
              // The change being taken or ignored is placed by `replace`.
              for (const t of tracked) {
                if (t === applying) continue;
                t.from = update.changes.mapPos(t.from, -1);
                t.to = Math.max(t.from, update.changes.mapPos(t.to, -1));
              }
              if (!applying) queueMicrotask(refresh);
            })
          : EditorState.readOnly.of(true),
        marks,
        theme,
        mergeTheme,
        syntaxHighlighting(highlight),
        ...(language ? [language] : []),
        compartment.of(configure()),
        EditorView.updateListener.of((update) => {
          if (!update.geometryChanged && !update.viewportChanged) return;
          // The spacers are in lines of the height measured: again when it's measured anew.
          queueMicrotask(views.result.defaultLineHeight === spaced ? place : refresh);
        }),
      ],
    });
  const views = {
    yours: pane(props.yours, settings[0], false),
    result: pane(props.base, settings[1], true),
    theirs: pane(props.theirs, settings[2], false),
  };
  const dividers = { yours: document.createElement('div'), theirs: document.createElement('div') };
  dividers.yours.className = dividers.theirs.className = 'cm-merge3-divider';
  panes.append(
    views.yours.dom,
    dividers.yours,
    views.result.dom,
    dividers.theirs,
    views.theirs.dom,
  );

  // The texts as the panes split them into lines; the result starts as the base.
  const texts = { yours: views.yours.state.doc, theirs: views.theirs.state.doc };
  const base = views.result.state.doc;
  const at = (doc: Text, line: number) => (line < doc.lines ? doc.line(line + 1).from : doc.length);
  tracked = mergeChanges(base, texts.yours, texts.theirs).map((change) => ({
    change,
    from: at(base, change.base.from),
    to: at(base, change.base.to),
    done: {
      yours: change.kind === 'theirs' ? 'ignored' : 'no',
      theirs: change.kind === 'yours' ? 'ignored' : 'no',
    },
  }));

  /** The result's lines a change has now: a position at a line's start begins that line. */
  const resultLines = (t: Tracked): Lines => {
    const doc = views.result.state.doc;
    const line = (pos: number) => {
      const found = doc.lineAt(pos);
      return pos > found.from ? found.number : found.number - 1;
    };
    return { from: line(t.from), to: line(t.to) };
  };

  let applying: Tracked | undefined;
  /** The line height the spacers were made for. */
  let spaced = 0;
  /**
   * Puts lines in place of a change's in the result, as lines: where the change reaches the end, the
   * newline before it goes with it, so a text with no last newline keeps none.
   */
  const replace = (t: Tracked, lines: readonly string[]) => {
    const doc = views.result.state.doc;
    const { from, to } = resultLines(t);
    const change =
      to < doc.lines
        ? { from: at(doc, from), to: at(doc, to), insert: lines.map((l) => `${l}\n`).join('') }
        : from > 0
          ? { from: doc.line(from).to, to: doc.length, insert: lines.map((l) => `\n${l}`).join('') }
          : { from: 0, to: doc.length, insert: lines.join('\n') };
    applying = t;
    views.result.dispatch({ changes: change });
    applying = undefined;
    const after = views.result.state.doc;
    t.from = at(after, from);
    t.to = at(after, from + lines.length);
  };

  /** Takes a side's change into the result: in its place, or after the other side's, if taken. */
  const take = (t: Tracked, side: Side) => {
    const lines = linesOf(texts[side], t.change[side]);
    const other: Side = side === 'yours' ? 'theirs' : 'yours';
    replace(
      t,
      t.done[other] === 'taken'
        ? [...linesOf(views.result.state.doc, resultLines(t)), ...lines]
        : lines,
    );
    t.done[side] = 'taken';
    // One side's change, or the same on both: nothing more to do with it.
    if (t.change.kind !== 'conflict' && t.done[other] === 'no') t.done[other] = 'ignored';
    refresh();
  };
  const ignore = (t: Tracked, side: Side) => {
    t.done[side] = 'ignored';
    if (t.change.kind === 'both') t.done[side === 'yours' ? 'theirs' : 'yours'] = 'ignored';
    refresh();
  };

  /** Marks each change in each pane, with spacers to keep them level, and places the controls. */
  function refresh() {
    const height = (spaced = views.result.defaultLineHeight);
    const sets: Record<'yours' | 'result' | 'theirs', Range<Decoration>[]> = {
      yours: [],
      result: [],
      theirs: [],
    };
    for (const t of tracked) {
      const marking = resolved(t) ? undefined : colour(t);
      const lines = { yours: t.change.yours, result: resultLines(t), theirs: t.change.theirs };
      const tallest = Math.max(...Object.values(lines).map((l) => l.to - l.from));
      for (const name of ['yours', 'result', 'theirs'] as const) {
        const doc = views[name].state.doc;
        const { from, to } = lines[name];
        // Marked where it is: not in the pane of a side that didn't make it.
        const kind = name === other[t.change.kind] ? undefined : marking;
        if (kind) {
          for (let n = from; n < to; n++) {
            sets[name].push(
              Decoration.line({ class: `cm-merge3-${kind}` }).range(doc.line(n + 1).from),
            );
          }
        }
        const gap = tallest - (to - from);
        if (gap > 0 || (from === to && kind)) {
          const widget = new Spacer(gap * height, from === to ? kind : undefined);
          const pos = to < doc.lines ? doc.line(to + 1).from : doc.length;
          const below = to < doc.lines;
          sets[name].push(
            Decoration.widget({ widget, block: true, side: below ? -1 : 1 }).range(pos),
          );
        }
      }
    }
    for (const name of ['yours', 'result', 'theirs'] as const) {
      views[name].dispatch({ effects: setMarks.of(Decoration.set(sets[name], true)) });
    }
    left.set({
      changes: tracked.filter((t) => !resolved(t) && t.change.kind !== 'conflict').length,
      conflicts: tracked.filter((t) => !resolved(t) && t.change.kind === 'conflict').length,
    });
    place();
  }

  /** The arrows and crosses beside each side's changes not yet done with, level with them. */
  function place() {
    for (const side of ['yours', 'theirs'] as const) {
      const divider = dividers[side];
      const top = views.result.documentTop - divider.getBoundingClientRect().top;
      divider.replaceChildren(
        ...tracked
          .filter((t) => t.done[side] === 'no')
          .flatMap((t) => {
            const y = top + views.result.lineBlockAt(t.from).top;
            const button = (label: string, glyph: string, x: number, run: () => void) => {
              const b = document.createElement('button');
              b.className = 'cm-merge3-control';
              b.title = label;
              b.setAttribute('aria-label', label);
              b.textContent = glyph;
              b.style.top = `${String(y + 3)}px`;
              b.style.left = `${String(x)}px`;
              b.addEventListener('click', run);
              return b;
            };
            // As IntelliJ's: the arrow points at the result, the cross is on the far side.
            const arrow = side === 'yours' ? '»' : '«';
            return side === 'yours'
              ? [
                  button('Ignore', '×', 1, () => {
                    ignore(t, side);
                  }),
                  button('Accept', arrow, 17, () => {
                    take(t, side);
                  }),
                ]
              : [
                  button('Accept', arrow, 1, () => {
                    take(t, side);
                  }),
                  button('Ignore', '×', 17, () => {
                    ignore(t, side);
                  }),
                ];
          }),
      );
    }
  }

  refresh();
  const watch = effect(() => {
    const configured = configure();
    for (const [i, view] of [views.yours, views.result, views.theirs].entries()) {
      view.dispatch({ effects: (settings[i] as Compartment).reconfigure(configured) });
    }
    queueMicrotask(refresh);
    return undefined;
  });
  props.control?.({
    text: () => views.result.state.doc.toString(),
    left: () => left.get(),
    modified: () => modified,
    applyNonConflicting(side) {
      for (const t of tracked) {
        if (resolved(t) || t.change.kind === 'conflict') continue;
        const which: Side = t.change.kind === 'theirs' ? 'theirs' : 'yours';
        if (side === 'all' || side === which || t.change.kind === 'both') take(t, which);
      }
    },
  });
  onCleanup(() => {
    watch.dispose();
    for (const view of Object.values(views)) view.destroy();
  });
  return container;
}
