// Find in Files, as IntelliJ's popup: a search field with Match Case, Words and Regex beside it
// (Alt+C, Alt+W, Alt+X), the lines found with the file and line at the right, and the highlighted
// line's file below, in an editor. Enter or a click opens the file there. The host searches the
// active worktree with ripgrep, as the user types.

import { signal } from '@cerebro-ide/reactive';
import { CodeEditor } from '@cerebro-ide/ui-editor';
import { openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { documentFor } from './documents.js';
import { active, currentHost } from './environments.js';

/** A line found, as the host gives it. */
interface TextMatch {
  path: string;
  line: number;
  text: string;
  ranges: [number, number][];
}

type Found = { matches: TextMatch[]; limited: boolean } | { error: string };

type Choice = PickerItem & { match: TextMatch };

/** How long typing pauses before the search runs. */
export const SEARCH_DELAY = 150;

/** The longest part of a line listed. */
const LINE_LIMIT = 200;

/** A line found as a row: its text without the indent, its matches bold, its file at the right. */
export function choiceOf(match: TextMatch): Choice {
  const indent = match.text.length - match.text.trimStart().length;
  const label = match.text.slice(indent, indent + LINE_LIMIT);
  const highlight: number[] = [];
  for (const [from, to] of match.ranges) {
    for (let i = Math.max(from - indent, 0); i < Math.min(to - indent, label.length); i++) {
      highlight.push(i);
    }
  }
  return {
    label,
    highlight,
    shortcut: `${match.path.split('/').at(-1) ?? match.path} ${String(match.line + 1)}`,
    match,
  };
}

/** What was found, as IntelliJ counts it: "12 matches in 3 files", with + when it stopped early. */
export function countOf(found: Found | undefined): string {
  if (!found || 'error' in found) return '';
  const files = new Set(found.matches.map((m) => m.path)).size;
  const plus = found.limited ? '+' : '';
  const matches = found.matches.reduce((sum, m) => sum + m.ranges.length, 0);
  const plural = (n: number, word: string) => `${String(n)}${plus} ${word}${n === 1 ? '' : 'es'}`;
  return `${plural(matches, 'match')} in ${String(files)}${plus} file${files === 1 ? '' : 's'}`;
}

/** An option's toggle, as IntelliJ's beside the field. */
function Toggle(props: { label: string; text: string; on: () => boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      class="playground-find__option"
      aria-label={props.label}
      aria-pressed={() => String(props.on())}
      ref={tooltip({ text: () => props.label })}
      on:mousedown={(event) => {
        // Keeps the focus in the search field.
        event.preventDefault();
      }}
      on:click={props.toggle}
    >
      {props.text}
    </button>
  );
}

/** The highlighted line's file, read-only, scrolled to the line. */
function Preview(props: { match: TextMatch }) {
  const text = signal<string | undefined>(undefined);
  void documentFor(props.match.path, () => '').then((doc) => {
    text.set('error' in doc ? '' : doc.content());
  });
  return (
    <div class="playground-find__preview">
      {() => {
        const content = text.get();
        if (content === undefined) return null;
        return (
          <CodeEditor
            path={props.match.path}
            text={content}
            reveal={() => ({ line: props.match.line, column: props.match.ranges[0]?.[0] ?? 0 })}
            revealFocus={false}
          />
        );
      }}
    </div>
  );
}

/** Opens Find in Files over the active worktree; `open` opens a file at a line. */
export async function findInFiles(
  open: (at: { path: string; line: number; column: number }) => void,
): Promise<void> {
  const host = currentHost();
  const worktree = active()?.id;
  if (!host || worktree === undefined) return;
  const query = signal('');
  const matchCase = signal(false);
  const words = signal(false);
  const regex = signal(false);
  const found = signal<Found | undefined>(undefined);
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const search = () => {
    clearTimeout(timer);
    const asked = ++latest;
    const text = query.peek();
    if (text === '') {
      found.set(undefined);
      return;
    }
    timer = setTimeout(() => {
      void host
        .request('search.text', {
          path: worktree,
          query: text,
          matchCase: matchCase.peek(),
          words: words.peek(),
          regex: regex.peek(),
        })
        .then(
          (result) => result as Found,
          (error: unknown) => ({ error: (error as Error).message }),
        )
        .then((result) => {
          // Only the latest search's answer counts.
          if (asked === latest) found.set(result);
        });
    }, SEARCH_DELAY);
  };
  const toggle = (option: ReturnType<typeof signal<boolean>>) => {
    option.set(!option.peek());
    search();
  };
  // By the key's place, not its character: on macOS, Option+C types ç.
  const keys: Record<string, ReturnType<typeof signal<boolean>>> = {
    KeyC: matchCase,
    KeyW: words,
    KeyX: regex,
  };
  const option = (label: string, text: string, on: ReturnType<typeof signal<boolean>>) => (
    <Toggle
      label={label}
      text={text}
      on={() => on.get()}
      toggle={() => {
        toggle(on);
      }}
    />
  );
  const chosen = await openPicker<Choice>({
    label: 'Find in Files',
    placeholder: 'Text to find',
    position: 'top',
    width: 800,
    empty: 'Nothing found',
    header: () => [
      <span class="playground-find__title">Find in Files</span>,
      () => {
        const result = found.get();
        // ripgrep's own words, last line: for a bad pattern, what's wrong with it.
        return result && 'error' in result ? (
          <span class="playground-find__error">{result.error.split('\n').at(-1)}</span>
        ) : (
          <span class="playground-find__count">{countOf(result)}</span>
        );
      },
    ],
    options: () => [
      option('Match Case (Alt+C)', 'Cc', matchCase),
      option('Words (Alt+W)', 'W', words),
      option('Regex (Alt+X)', '.*', regex),
    ],
    items: () => {
      const result = found.get();
      return !result || 'error' in result ? [] : result.matches.map(choiceOf);
    },
    preview: (item) => (item ? <Preview match={item.match} /> : null),
    onQueryChange: (text) => {
      query.set(text);
      search();
    },
    onKey: (event) => {
      const on = event.altKey && !event.ctrlKey && !event.metaKey ? keys[event.code] : undefined;
      if (!on) return false;
      toggle(on);
      return true;
    },
  }).result;
  clearTimeout(timer);
  if (chosen) {
    const { match } = chosen;
    open({ path: match.path, line: match.line, column: match.ranges[0]?.[0] ?? 0 });
  }
}
