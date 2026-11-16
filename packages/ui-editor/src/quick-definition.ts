// Quick Definition, as IntelliJ's `QuickImplementations` (`ShowImplementationsAction`,
// `ImplementationViewComponent` and `DefinitionSwitcher`, read from its source): a popup at the
// caret's symbol, titled "Definition of {name}", with the lines of its declaration, highlighted, in
// a read-only editor. Above them, the definition's name and its file's, or, with several, a list of
// them to choose from; then Back, "1/2" and Forward, which go through them, round from either end,
// as Left and Right do. Edit Source (F4, or Enter) opens the one shown; Escape, a change of the text
// or the caret, closes it.

import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, showTooltip, type Command, type Tooltip } from '@codemirror/view';
import { languageFor } from './languages.js';
import type { Place } from './usages.js';

/** A definition as Quick Definition shows it. */
export interface QuickDefinition {
  /** Its name, where it's declared. */
  name: string;
  /** The file it's in, which also gives its language. */
  path: string;
  /** Its declaration's lines, whole. */
  text: string;
  /** Opens the definition: Edit Source. */
  open: () => void;
}

/** Asks for the definitions of the symbol at a place, the first shown first; none for none. */
export type AskQuickDefinition = (
  at: Place,
) => Promise<readonly QuickDefinition[] | null | undefined>;

/** Which definition shows. */
interface Choice {
  index: number;
  /** Shows the next definition, or the previous, round from either end. */
  step: (by: 1 | -1) => void;
  /** Draws the one at `index`: the popup's, once it's made. */
  redraw: () => void;
}

interface Shown {
  tooltip: Tooltip;
  /** The definition shown. */
  current: () => QuickDefinition;
  choice: Choice;
}

const show = StateEffect.define<Shown | null>();
const shown = StateField.define<Shown | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(show)) return effect.value;
    return tr.docChanged || tr.selection ? null : value;
  },
  provide: (field) => showTooltip.from(field, (value) => value?.tooltip ?? null),
});

/** The file's name, as IntelliJ's location text shows it. */
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const element = (tag: string, className: string, text = '') => {
  const made = document.createElement(tag);
  made.className = className;
  made.textContent = text;
  return made;
};

/** IntelliJ's Play_back and Play_forward: a triangle pointing left or right (drawn here, a claim). */
function arrow(label: string, points: string, run: () => void) {
  const button = element('button', 'cerebro-quickDef__step') as HTMLButtonElement;
  button.type = 'button';
  button.ariaLabel = label;
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', points);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  button.append(svg);
  // Keeps the keyboard in the editor, where Left, Right and Enter are the popup's.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', run);
  return button;
}

/**
 * The popup: its title; the name and the file, or the list of definitions; the switcher; then the
 * lines in an editor of their own, the one `choice` says.
 */
function popup(
  view: EditorView,
  name: string,
  found: readonly QuickDefinition[],
  look: Extension,
  choice: Choice,
) {
  const dom = element('div', 'cerebro-quickDef');
  const header = element('div', 'cerebro-quickDef__header');
  const code = element('div', 'cerebro-quickDef__code');
  dom.append(element('div', 'cerebro-quickDef__title', `Definition of ${name}`), header, code);
  // One: its name and its file. Several: a list of them, each its name and its file.
  let chooser: HTMLSelectElement | undefined;
  if (found.length === 1) {
    const only = found[0] as QuickDefinition;
    const entry = element('span', 'cerebro-quickDef__entry');
    entry.append(
      element('span', '', only.name),
      element('span', 'cerebro-quickDef__file', fileName(only.path)),
    );
    header.append(entry);
  } else {
    chooser = element('select', 'cerebro-quickDef__chooser') as HTMLSelectElement;
    chooser.ariaLabel = 'Definitions';
    chooser.append(
      ...found.map((each, index) => {
        // Two spaces between, kept: an option's text collapses plain ones (seen in the app).
        const option = element('option', '', `${each.name}\u00a0\u00a0${fileName(each.path)}`);
        (option as HTMLOptionElement).value = String(index);
        return option;
      }),
    );
    chooser.addEventListener('change', () => {
      choice.index = Number((chooser as HTMLSelectElement).value);
      choice.redraw();
      // The keyboard back in the editor, where Left, Right and Enter are the popup's.
      view.focus();
    });
    header.append(chooser);
  }
  const count = element('span', 'cerebro-quickDef__count');
  header.append(
    arrow('Back', 'M11 3v10L4 8z', () => {
      choice.step(-1);
    }),
    count,
    arrow('Forward', 'M5 3v10l7-5z', () => {
      choice.step(1);
    }),
  );
  const preview = new EditorView({ parent: code, root: view.root as ShadowRoot | Document });
  const update = () => {
    const current = found[choice.index] as QuickDefinition;
    count.textContent = `${String(choice.index + 1)}/${String(found.length)}`;
    if (chooser) chooser.value = String(choice.index);
    const language = languageFor(current.path);
    preview.setState(
      EditorState.create({
        doc: current.text,
        extensions: [
          look,
          ...(language ? [language] : []),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ],
      }),
    );
  };
  update();
  choice.redraw = update;
  return {
    dom,
    destroy: () => {
      preview.destroy();
    },
  };
}

/** Shows the definitions of the symbol at the caret, once they're had, if the caret's still there. */
function quickDefinition(ask: AskQuickDefinition, look: Extension): Command {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const word = state.wordAt(head);
    const line = state.doc.lineAt(head);
    void ask({ line: line.number - 1, column: head - line.from }).then((found) => {
      if (
        !found ||
        found.length === 0 ||
        view.state.doc !== state.doc ||
        view.state.selection.main.head !== head
      ) {
        return;
      }
      const name = word ? state.sliceDoc(word.from, word.to) : '';
      // Its `redraw` is the popup's, which is made as this is dispatched.
      const choice = { index: 0 } as Choice;
      choice.step = (by) => {
        choice.index = (choice.index + by + found.length) % found.length;
        choice.redraw();
      };
      view.dispatch({
        effects: show.of({
          tooltip: {
            pos: word?.from ?? head,
            create: (v) => popup(v, name, found, look, choice),
          },
          current: () => found[choice.index] as QuickDefinition,
          choice,
        }),
      });
    });
    return true;
  };
}

/** Closes the popup, running `then` with what it showed; false when none is shown. */
function closing(then: (shown: QuickDefinition) => void): Command {
  return (view) => {
    const value = view.state.field(shown);
    if (!value) return false;
    view.dispatch({ effects: show.of(null) });
    then(value.current());
    return true;
  };
}

/** Goes through the definitions while the popup shows; false when none is shown. */
const stepping =
  (by: 1 | -1): Command =>
  (view) => {
    const value = view.state.field(shown);
    if (!value) return false;
    value.choice.step(by);
    return true;
  };

/**
 * Quick Definition from `ask` on its keys, the popup's lines drawn with `look` (the editor's
 * theme and highlighting); Edit Source's F4 and Enter open the definition shown, Left and Right go
 * through them, Escape closes it.
 */
export function quickDefinitionKeys(
  ask: AskQuickDefinition,
  keys: readonly string[],
  look: Extension,
): Extension {
  const edit = closing((definition) => {
    definition.open();
  });
  return [
    shown,
    keymap.of([
      ...keys.map((key) => ({ key, run: quickDefinition(ask, look) })),
      { key: 'F4', run: edit },
      { key: 'Enter', run: edit },
      { key: 'ArrowLeft', run: stepping(-1) },
      { key: 'ArrowRight', run: stepping(1) },
      { key: 'Escape', run: closing(() => undefined) },
    ]),
  ];
}
