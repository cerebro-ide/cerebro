// Reformat Code, as IntelliJ's (Ctrl+Alt+L): the file, or the selection, formatted by what's given
// (the file's language server, in the app), as one change undo takes back. A hint at the caret says
// how many lines changed, in IntelliJ's words, or why it wasn't formatted.

import { isolateHistory } from '@codemirror/commands';
import { ChangeSet, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { hinted, showHint } from './hint.js';
import { placeAt, type Place } from './usages.js';

/** An edit that formats: the text from `from` to `to` replaced by `text`. */
export interface FormatEdit {
  from: Place;
  to: Place;
  text: string;
}

/**
 * Asks for the edits that format the text, or the part of it from `from` to `to`; or why it can't
 * be formatted.
 */
export type AskFormat = (
  range: { from: Place; to: Place } | undefined,
) => Promise<readonly FormatEdit[] | { refused: string }>;

/** IntelliJ's words (LangBundle) for a file the formatting didn't change. */
export const ALREADY_FORMATTED = 'No lines changed: content is already properly formatted';

/** IntelliJ's words (CodeInsightBundle) for the lines the formatting changed. */
export function formattedLines(lines: number): string {
  return `Formatted ${String(lines)} ${lines === 1 ? 'line' : 'lines'}`;
}

/** Formats the text, or the selection, through `ask`, if the text's the same once it answers. */
function format(view: EditorView, ask: AskFormat): void {
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
      answer
        .map((e) => ({ from: offset(e.from), to: offset(e.to), insert: e.text }))
        .filter((c) => doc.sliceString(c.from, c.to) !== c.insert),
      doc.length,
    );
    if (changes.empty) {
      showHint(view, ALREADY_FORMATTED);
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
      annotations: isolateHistory.of('full'),
    });
    showHint(view, formattedLines(lines.size));
  });
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
