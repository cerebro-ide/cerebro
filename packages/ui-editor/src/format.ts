// Reformat Code, as IntelliJ's (Ctrl+Alt+L): the file, or the selection, formatted by what's given
// (the file's language server, in the app), as one change undo takes back. A hint at the caret says
// how many lines changed, in IntelliJ's words, or why it wasn't formatted. A plugin's formatter
// (Reformat with Prettier) formats an editor the same way, through `formatIn`. Reindent File, as
// IntelliJ's (from the status bar's indent), indents every line again, through `reindentIn`.

import { isolateHistory } from '@codemirror/commands';
import { forceParsing, indentRange } from '@codemirror/language';
import { ChangeSet, Facet, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { changesTo } from './document.js';
import { hinted, showHint } from './hint.js';
import { historyName } from './history.js';
import { placeAt, type Place } from './usages.js';

/** An edit that formats: the text from `from` to `to` replaced by `text`. */
export interface FormatEdit {
  from: Place;
  to: Place;
  text: string;
}

/**
 * Asks for the edits that format the text, or the part of it from `from` to `to`, or the whole text
 * as it's formatted; or why it can't be formatted.
 */
export type AskFormat = (
  range: { from: Place; to: Place } | undefined,
) => Promise<readonly FormatEdit[] | { text: string } | { refused: string }>;

/** What the change is called (undo's), and what the hint says: the lines formatted, or none. */
export interface FormatWords {
  name: string;
  formatted: (lines: number) => string;
  unchanged: string;
}

/** IntelliJ's words (LangBundle) for a file the formatting didn't change. */
export const ALREADY_FORMATTED = 'No lines changed: content is already properly formatted';

/** IntelliJ's words (CodeInsightBundle) for the lines the formatting changed. */
export function formattedLines(lines: number): string {
  return `Formatted ${String(lines)} ${lines === 1 ? 'line' : 'lines'}`;
}

const INTELLIJ: FormatWords = {
  name: 'Reformat Code',
  formatted: formattedLines,
  unchanged: ALREADY_FORMATTED,
};

/** Formats the text, or the selection, through `ask`, if the text's the same once it answers. */
function format(view: EditorView, ask: AskFormat, words = INTELLIJ): void {
  const { state } = view;
  const { main } = state.selection;
  const range = main.empty
    ? undefined
    : { from: placeAt(state, main.from), to: placeAt(state, main.to) };
  void ask(range).then((answer) => {
    if (view.state.doc !== state.doc) return;
    if ('refused' in answer) {
      showHint(view, answer.refused);
      return;
    }
    const { doc } = state;
    const offset = (at: Place) => doc.line(at.line + 1).from + at.column;
    // What a server gives as it was is no change.
    const changes = ChangeSet.of(
      'text' in answer
        ? changesTo(doc, answer.text)
        : answer
            .map((e) => ({ from: offset(e.from), to: offset(e.to), insert: e.text }))
            .filter((c) => doc.sliceString(c.from, c.to) !== c.insert),
      doc.length,
    );
    if (changes.empty) {
      showHint(view, words.unchanged);
      return;
    }
    const after = changes.apply(doc);
    // The lines the changes are on, as they're formatted (a claim: IntelliJ counts its diff's).
    const lines = new Set<number>();
    changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const last = after.lineAt(toB).number;
      for (let n = after.lineAt(fromB).number; n <= last; n++) lines.add(n);
    });
    view.dispatch({
      changes,
      userEvent: 'input.format',
      annotations: [isolateHistory.of('full'), historyName.of(words.name)],
    });
    showHint(view, words.formatted(lines.size));
  });
}

/** The file an editor edits: an editor that can be edited has it. */
const editedFile = Facet.define<string, string | undefined>({ combine: (paths) => paths[0] });

/** What an editor that edits `path` has, for `fileIn` and `formatIn`. */
export function formattable(path: string): Extension {
  return [editedFile.of(path), hinted];
}

/** The editor `element` is in, if it edits a file. */
function editingView(element: Element): EditorView | undefined {
  const editor = element.closest('.cm-editor');
  const view = editor && EditorView.findFromDOM(editor as HTMLElement);
  return view?.state.facet(editedFile) === undefined ? undefined : view;
}

/** The file the editor `element` is in edits, if it's one that can be edited. */
export function fileIn(element: Element): string | undefined {
  return editingView(element)?.state.facet(editedFile);
}

/**
 * Formats the text, or the selection, of the editor `element` is in, through `ask`, as Reformat
 * Code does, its hint in `words`; returns whether it's in an editor that can be edited.
 */
export function formatIn(element: Element, ask: AskFormat, words?: FormatWords): boolean {
  const view = editingView(element);
  if (view) format(view, ask, words);
  return view !== undefined;
}

/**
 * Indents every line of the editor `element` is in again, as its language does with the editor's
 * indent, as one change undo takes back as `name`; returns whether it's in an editor that can be
 * edited. Lines the language can't tell an indent for stay as they are.
 */
export function reindentIn(element: Element, name: string): boolean {
  const view = editingView(element);
  if (!view) return false;
  // Parsed to its end first, the state given the tree: CodeMirror parses a file as it opens up to
  // a time budget, the rest later, and a line past what's parsed gets no indentation, so kept its
  // own (measured). Up to 5 s of parsing (a claim: enough for any file one would reindent).
  forceParsing(view, view.state.doc.length, 5_000);
  const changes = indentRange(view.state, 0, view.state.doc.length);
  view.dispatch({
    changes,
    userEvent: 'input.indent',
    annotations: [isolateHistory.of('full'), historyName.of(name)],
  });
  return true;
}

/** Reformat Code on `keys`, through `ask`. */
export function formatting(keys: readonly string[], ask: AskFormat): Extension {
  return [
    hinted,
    keymap.of(
      keys.map((key) => ({
        key,
        run: (view: EditorView) => {
          format(view, ask);
          return true;
        },
        preventDefault: true,
      })),
    ),
  ];
}
