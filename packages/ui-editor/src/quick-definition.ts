// Quick Definition, as IntelliJ's `QuickImplementations` (`ShowImplementationsAction` and
// `ImplementationViewComponent`, read from its source): a popup at the caret's symbol, titled
// "Definition of {name}", with the lines of its declaration, highlighted, in a read-only editor;
// the symbol's name and its file's above them. Edit Source (F4, or Enter) opens the definition;
// Escape, a change of the text or the caret, closes it.

import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, keymap, showTooltip, type Command, type Tooltip } from '@codemirror/view';
import { languageFor } from './languages.js';
import type { Place } from './usages.js';

/** A definition as Quick Definition shows it. */
export interface QuickDefinition {
  /** The file it's in, which also gives its language. */
  path: string;
  /** Its declaration's lines, whole. */
  text: string;
  /** Opens the definition: Edit Source. */
  open: () => void;
}

/** Asks for the definition of the symbol at a place; nothing for none. */
export type AskQuickDefinition = (at: Place) => Promise<QuickDefinition | null | undefined>;

interface Shown {
  tooltip: Tooltip;
  open: () => void;
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

/** The popup: its title, the name and the file, then the lines in an editor of their own. */
function popup(view: EditorView, name: string, found: QuickDefinition, look: Extension) {
  const dom = document.createElement('div');
  dom.className = 'cerebro-quickDef';
  const title = document.createElement('div');
  title.className = 'cerebro-quickDef__title';
  title.textContent = `Definition of ${name}`;
  const header = document.createElement('div');
  header.className = 'cerebro-quickDef__header';
  const symbol = document.createElement('span');
  symbol.textContent = name;
  const file = document.createElement('span');
  file.className = 'cerebro-quickDef__file';
  file.textContent = fileName(found.path);
  header.append(symbol, file);
  const code = document.createElement('div');
  code.className = 'cerebro-quickDef__code';
  dom.append(title, header, code);
  const language = languageFor(found.path);
  const preview = new EditorView({
    parent: code,
    root: view.root as ShadowRoot | Document,
    state: EditorState.create({
      doc: found.text,
      extensions: [
        look,
        ...(language ? [language] : []),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ],
    }),
  });
  return {
    dom,
    destroy: () => {
      preview.destroy();
    },
  };
}

/** Shows the definition of the symbol at the caret, once it's had, if the caret's still there. */
function quickDefinition(ask: AskQuickDefinition, look: Extension): Command {
  return (view) => {
    const { state } = view;
    const head = state.selection.main.head;
    const word = state.wordAt(head);
    const line = state.doc.lineAt(head);
    void ask({ line: line.number - 1, column: head - line.from }).then((found) => {
      if (!found || view.state.doc !== state.doc || view.state.selection.main.head !== head) {
        return;
      }
      const name = word ? state.sliceDoc(word.from, word.to) : '';
      view.dispatch({
        effects: show.of({
          tooltip: { pos: word?.from ?? head, create: (v) => popup(v, name, found, look) },
          open: found.open,
        }),
      });
    });
    return true;
  };
}

/** Closes the popup, running `then` with what it showed; false when none is shown. */
function closing(then: (open: () => void) => void): Command {
  return (view) => {
    const value = view.state.field(shown);
    if (!value) return false;
    view.dispatch({ effects: show.of(null) });
    then(value.open);
    return true;
  };
}

/**
 * Quick Definition from `ask` on its keys, the popup's lines drawn with `look` (the editor's
 * theme and highlighting); Edit Source's F4 and Enter open the definition, Escape closes it.
 */
export function quickDefinitionKeys(
  ask: AskQuickDefinition,
  keys: readonly string[],
  look: Extension,
): Extension {
  const edit = closing((open) => {
    open();
  });
  return [
    shown,
    keymap.of([
      ...keys.map((key) => ({ key, run: quickDefinition(ask, look) })),
      { key: 'F4', run: edit },
      { key: 'Enter', run: edit },
      { key: 'Escape', run: closing(() => undefined) },
    ]),
  ];
}
