// A search field's history, as IntelliJ's (SearchTextArea's ShowHistoryAction, SearchTextField's):
// the texts it remembers, the latest first, in a list below it; the one chosen goes in the field.
// Its button is the magnifier with an arrow (IntelliJ's SearchWithHistory); Alt+Down shows it too
// (ShowSearchHistory), from the field.

import type { Child } from '@cerebro-ide/jsx';
import { fuzzyFilter } from './match.js';
import { openPicker } from './popup.js';

export interface SearchHistoryOptions {
  /** IntelliJ's words: Search History, Replace History. */
  label: string;
  texts: readonly string[];
  /** The field, or the row it's in: the list opens below it. */
  below: Element;
}

/** Shows the history; the text chosen, or undefined. Nothing shows with none. */
export async function showSearchHistory(
  options: SearchHistoryOptions,
): Promise<string | undefined> {
  const { label, texts, below } = options;
  if (texts.length === 0) return undefined;
  const handle = openPicker({
    label,
    placeholder: 'Search',
    position: { below },
    // As wide as the field, at least a list's width below one (a claim: IntelliJ's is as wide as
    // its texts, up to the field's width and 200 more).
    width: Math.max(360, Math.round(below.getBoundingClientRect().width)),
    items: (query) =>
      fuzzyFilter(
        texts.map((text) => ({ label: text })),
        query,
      ),
  });
  return (await handle.result)?.label;
}

/** Whether a key shows the history: Alt+Down, as IntelliJ's ShowSearchHistory. */
export function showsHistory(event: KeyboardEvent): boolean {
  return (
    event.key === 'ArrowDown' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  );
}

/** The history's button, at a field's start: a press shows it, the field keeping the focus. */
export function SearchHistoryButton(props: { label: string; icon: Child; show: () => void }): Node {
  return (
    <button
      type="button"
      class="cerebro-popup__history"
      aria-label={props.label}
      title={props.label}
      tabIndex={-1}
      on:mousedown={(event) => {
        event.preventDefault();
        props.show();
      }}
    >
      {props.icon}
    </button>
  );
}
