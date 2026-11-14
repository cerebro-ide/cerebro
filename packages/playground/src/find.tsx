// Find in Files, as IntelliJ's popup: a search field with Match Case, Words and Regex beside it
// (Alt+C, Alt+W, Alt+X), the lines found with the file and line at the right, and the highlighted
// line's file below, in an editor, its match selected. Enter or a click opens the file there. Under the
// field, the scope: In Project, or a Directory (the active file's, to start with); in the header, a
// File mask (`*.ts, !*.test.ts`). The host searches with ripgrep, as the user types.
// Replace in Files is the same popup with a Replace field: Replace takes the highlighted line's
// matches, Replace All (Mod+Alt+Enter) every match, after asking. ripgrep works out each
// replacement, so a regular expression's groups follow its syntax; they go into the files'
// documents, so an open editor can undo them, and the files are saved.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { applyCase, CodeEditor, findTextIn, preserveCaseIcon } from '@cerebro-ide/ui-editor';
import {
  openPicker,
  SearchHistoryButton,
  showSearchHistory,
  showsHistory,
  type PickerItem,
} from '@cerebro-ide/ui-popup';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { target } from './edit.js';
import { documentFor, saveFiles } from './documents.js';
import type { Occurrences } from './find-window.js';
import { active, hostFor } from './environments.js';
import { icon } from './icons.js';
import { SearchHistory } from './search-history.js';

/** A line found, as the host gives it. */
export interface TextMatch {
  path: string;
  line: number;
  text: string;
  ranges: [number, number][];
  /** What each match would be replaced with, when replacing. */
  replacements?: string[];
}

type Found = { matches: TextMatch[]; limited: boolean } | { error: string };

type Choice = PickerItem & { match: TextMatch };

/**
 * What Find and Replace in Files searched for, and replaced with, as IntelliJ's
 * FindInProjectSettings keeps them: 300 each, the same text moved first.
 */
export const searchHistory = new SearchHistory('cerebro.find.searchHistory', {
  limit: 300,
  loose: false,
});
export const replaceHistory = new SearchHistory('cerebro.find.replaceHistory', {
  limit: 300,
  loose: false,
});

/** Remembers what was searched for, and replaced with: IntelliJ's updateFindSettings. */
function remember(query: string, replacement: string | undefined): void {
  searchHistory.remember(query);
  if (replacement !== undefined) replaceHistory.remember(replacement);
}

/** How long typing pauses before the search runs. */
export const SEARCH_DELAY = 150;

/**
 * The most lines Replace All and the Find window take: past this, Replace All is refused rather
 * than done in part, and the Find window says there's more.
 */
export const WHOLE_LIMIT = 100_000;

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
    // A split has a last part, even of a path without a slash.
    shortcut: `${match.path.split('/').at(-1) as string} ${String(match.line + 1)}`,
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

/** Where to search, kept between searches as IntelliJ keeps it. */
const scope = signal<'project' | 'directory'>('project');
/** The File mask, and whether it's used. */
const maskOn = signal(false);
const mask = signal('');
/** What Replace in Files replaces with, kept as the rest. */
const replacement = signal('');
/** Replace's Preserve case: each replacement in the case of the text it replaces, as IntelliJ's. */
const preserveCase = signal(false);

/**
 * Replaces the matches on these lines, in their files' documents, and saves the files. A line that's
 * changed since it was found (an unsaved edit) is left: how many lines were, and were replaced.
 * With `preserve`, each replacement takes the case of the text it replaces.
 */
export async function replaceLines(
  lines: readonly TextMatch[],
  preserve = false,
): Promise<{ replaced: number; skipped: number }> {
  const byFile = new Map<string, TextMatch[]>();
  for (const line of lines) byFile.set(line.path, [...(byFile.get(line.path) ?? []), line]);
  let replaced = 0;
  let skipped = 0;
  const changed: string[] = [];
  for (const [path, matches] of byFile) {
    const doc = await documentFor(path);
    if ('error' in doc) {
      skipped += matches.length;
      continue;
    }
    const text = doc.text.peek();
    const edits: { from: number; to: number; insert: string }[] = [];
    for (const match of matches) {
      const line = match.line < text.lines ? text.line(match.line + 1) : undefined;
      if (line?.text !== match.text || !match.replacements) {
        skipped++;
        continue;
      }
      match.ranges.forEach(([from, to], i) => {
        const insert = match.replacements?.[i] ?? '';
        edits.push({
          from: line.from + from,
          to: line.from + to,
          insert: preserve ? applyCase(line.text.slice(from, to), insert) : insert,
        });
      });
      replaced++;
    }
    if (edits.length === 0) continue;
    doc.edit(edits);
    changed.push(path);
  }
  // Labelled in the Local History, as IntelliJ labels it.
  await saveFiles(changed, 'Replace in Files');
  return { replaced, skipped };
}

/** Says when lines weren't replaced, having changed since the search. */
function reportSkipped(skipped: number): void {
  if (skipped === 0) return;
  openDialog({
    title: 'Replace in Files',
    content: () => (
      <p>
        {skipped === 1 ? '1 line wasn’t' : `${String(skipped)} lines weren’t`} replaced: changed
        since the search.
      </p>
    ),
  });
}

/** A File mask as the host takes it: comma-separated masks, `!` leaving files out. */
export function masksOf(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The folder searched: the worktree, or a folder in it, written relative to it. */
export function folderOf(worktree: string, directory: string): string {
  const relative = directory.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  return relative === '' ? worktree : `${worktree}/${relative}`;
}

/** An option's toggle, as IntelliJ's beside the field. */
export function Toggle(props: {
  label: string;
  text: string | Node;
  on: () => boolean;
  toggle: () => void;
}) {
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

/** A place in a file, its match from `column` to `end`: what a preview shows. */
export interface Place {
  path: string;
  line: number;
  column: number;
  end?: number;
}

/** A file, read-only, scrolled to a place and its match selected, as IntelliJ's previews. */
export function Preview(props: { at: Place }) {
  const text = signal<string | undefined>(undefined);
  void documentFor(props.at.path).then((doc) => {
    text.set('error' in doc ? '' : doc.content());
  });
  return (
    <div class="playground-find__preview">
      {() => {
        const content = text.get();
        if (content === undefined) return null;
        return (
          <CodeEditor
            path={props.at.path}
            text={content}
            reveal={() => ({
              line: props.at.line,
              column: props.at.column,
              end: props.at.end ?? props.at.column,
            })}
            revealFocus={false}
          />
        );
      }}
    </div>
  );
}

/** A line found's first match, as a place. */
export function placeOf(match: TextMatch): Place {
  const [from, to] = match.ranges[0] ?? [0, 0];
  return { path: match.path, line: match.line, column: from, end: to };
}

export interface FindOptions {
  /** Opens a file at a line. */
  open: (at: { path: string; line: number; column: number }) => void;
  /** Shows the lines found in the Find window: Open in Find Window. */
  showOccurrences: (occurrences: Occurrences) => void;
  /** The active file: Directory starts at its folder. */
  file?: string | undefined;
  /**
   * A folder to search, from the Project view: the scope starts as Directory, it, as IntelliJ's
   * (FindInProjectUtil.setDirectoryName, with no editor in the context).
   */
  folder?: string | undefined;
  /** Replace in Files, not Find. */
  replacing?: boolean;
}

/** Opens Find in Files over the active worktree, or Replace in Files. */
export async function findInFiles(options: FindOptions): Promise<void> {
  const { open, file, folder, replacing = false } = options;
  const worktree = active()?.id;
  const host = worktree === undefined ? undefined : hostFor(worktree);
  if (!host || worktree === undefined) return;
  const inside = (path: string | undefined) =>
    path?.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : '';
  const directory = signal(
    folder === undefined ? inside(file).split('/').slice(0, -1).join('/') : inside(folder),
  );
  if (folder !== undefined) scope.set('directory');
  // The editor's selection, or its find bar's text; else the last search, and the last
  // replacement, as IntelliJ's popup opens with (initStringToFindFromDataContext, then
  // getMostRecentFindString).
  const focused = target();
  const asked = focused && findTextIn(focused);
  const query = signal(asked?.search || (searchHistory.texts()[0] ?? ''));
  if (replacing) {
    replacement.set(asked?.replace || (replaceHistory.texts()[0] ?? replacement.peek()));
  }
  const matchCase = signal(false);
  const words = signal(false);
  const regex = signal(false);
  const found = signal<Found | undefined>(undefined);
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The search as it's set now. */
  const settings = () => ({
    path: scope.peek() === 'project' ? worktree : folderOf(worktree, directory.peek()),
    masks: maskOn.peek() ? masksOf(mask.peek()) : [],
    query: query.peek(),
    matchCase: matchCase.peek(),
    words: words.peek(),
    regex: regex.peek(),
    ...(replacing ? { replace: replacement.peek() } : {}),
  });
  /** The search waiting for typing to pause, and the latest one running. */
  let pending: (() => Promise<void>) | undefined;
  let running = Promise.resolve();
  const search = () => {
    clearTimeout(timer);
    pending = undefined;
    const asked = ++latest;
    if (query.peek() === '') {
      found.set(undefined);
      return;
    }
    const run = () => {
      pending = undefined;
      running = host
        .request('search.text', settings())
        .then(
          (result) => result as Found,
          (error: unknown) => ({ error: (error as Error).message }),
        )
        .then((result) => {
          // Only the latest search's answer counts.
          if (asked === latest) found.set(result);
        });
      return running;
    };
    pending = run;
    timer = setTimeout(() => void run(), SEARCH_DELAY);
  };
  /** The search as typed so far, done now: Replace takes what it found, not an earlier answer. */
  const settled = () => {
    clearTimeout(timer);
    return pending ? pending() : running;
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
    ...(replacing ? { KeyE: preserveCase } : {}),
  };
  /** The option an Alt key toggles, by its place. */
  const optionKey = (event: KeyboardEvent) =>
    event.altKey && !event.ctrlKey && !event.metaKey ? keys[event.code] : undefined;
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
  const button = (text: string, run: () => void) => (
    <button
      type="button"
      class="playground-find__button"
      on:mousedown={(event) => {
        // Keeps the focus where it is.
        event.preventDefault();
      }}
      on:click={run}
    >
      {text}
    </button>
  );
  const scopeTab = (text: string, value: 'project' | 'directory') => (
    <button
      type="button"
      role="tab"
      class="playground-find__scope"
      aria-selected={() => String(scope.get() === value)}
      on:mousedown={(event) => {
        // Keeps the focus in the search field.
        event.preventDefault();
      }}
      on:click={() => {
        scope.set(value);
        search();
      }}
    >
      {text}
    </button>
  );
  const close = () => {
    picker.close();
  };
  /** The highlighted line's matches, replaced; the list is searched again. */
  const replaceOne = async () => {
    await settled();
    remember(query.peek(), replacement.peek());
    const item = picker.highlighted();
    if (!item) return;
    const { skipped } = await replaceLines([item.match], preserveCase.peek());
    reportSkipped(skipped);
    search();
  };
  /** Every match, after asking, with the popup closed. */
  const replaceAll = async () => {
    if (query.peek() === '') return;
    picker.close();
    let result: Found;
    try {
      result = (await host.request('search.text', {
        ...settings(),
        limit: WHOLE_LIMIT,
      })) as Found;
    } catch (error) {
      result = { error: (error as Error).message };
    }
    if ('error' in result || result.limited || result.matches.length === 0) {
      const why =
        'error' in result
          ? result.error.split('\n').at(-1)
          : result.limited
            ? `More than ${String(WHOLE_LIMIT)} lines match: narrow the search first.`
            : 'Nothing found.';
      openDialog({ title: 'Replace in Files', content: () => <p>{why}</p> });
      return;
    }
    const { matches } = result;
    const confirmed = await openDialog<true>({
      title: 'Replace in Files',
      ok: { label: 'Replace', accept: () => true },
      content: () => (
        <p>
          Replace {countOf(result)} with “{replacement.peek()}”?
        </p>
      ),
    }).result;
    if (!confirmed) return;
    reportSkipped((await replaceLines(matches, preserveCase.peek())).skipped);
  };
  /** Every line found, in the Find window, with the popup closed. */
  const openInWindow = async () => {
    if (query.peek() === '') return;
    const asked = settings();
    picker.close();
    let result: Found;
    try {
      result = (await host.request('search.text', { ...asked, limit: WHOLE_LIMIT })) as Found;
    } catch (error) {
      result = { error: (error as Error).message };
    }
    if ('error' in result) {
      openDialog({
        title: 'Find in Files',
        content: () => <p>{result.error.split('\n').at(-1)}</p>,
      });
      return;
    }
    const where =
      asked.path === worktree ? 'Project' : `Directory ${asked.path.slice(worktree.length + 1)}`;
    const masks = asked.masks.length > 0 ? ` with mask '${asked.masks.join(', ')}'` : '';
    options.showOccurrences({
      worktree,
      title: `Occurrences of '${asked.query}' in ${where}${masks}`,
      matches: result.matches,
      limited: result.limited,
    });
  };
  /** The popup's own keys, wherever the focus is in it: Replace All, and Open in Find Window. */
  const shortcut = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return false;
    if (event.altKey && !replacing) return false;
    void (event.altKey ? replaceAll() : openInWindow());
    return true;
  };
  /** A field's keys, kept from the app's shortcuts: Enter searches again, Escape closes. */
  const fieldKeys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (shortcut(event)) return;
    const on = optionKey(event);
    if (on) {
      event.preventDefault();
      toggle(on);
      return;
    }
    if (event.key === 'Enter') search();
    if (event.key === 'Escape') close();
  };
  let replaceRow: HTMLElement | undefined;
  let replaceField: HTMLInputElement | undefined;
  /** The Replace field's history, below it; the text chosen put in it. */
  const showReplaceHistory = () => {
    void showSearchHistory({
      label: 'Replace History',
      texts: replaceHistory.texts(),
      below: replaceRow as HTMLElement,
    }).then((text) => {
      if (text === undefined) return;
      const field = replaceField as HTMLInputElement;
      field.value = text;
      field.focus();
      replacement.set(text);
      search();
    });
  };
  const picker = openPicker<Choice>({
    query: query.peek(),
    history: {
      label: 'Search History',
      icon: icon('searchHistory'),
      texts: () => searchHistory.texts(),
    },
    altKeys: Object.keys(keys)
      .map((code) => code.slice('Key'.length))
      .join(''),
    label: replacing ? 'Replace in Files' : 'Find in Files',
    placeholder: 'Text to find',
    position: 'top',
    width: 800,
    empty: 'Nothing found',
    header: () => [
      <span class="playground-find__title">
        {replacing ? 'Replace in Files' : 'Find in Files'}
      </span>,
      () => {
        const result = found.get();
        // ripgrep's own words, last line: for a bad pattern, what's wrong with it.
        return result && 'error' in result ? (
          <span class="playground-find__error">{result.error.split('\n').at(-1)}</span>
        ) : (
          <span class="playground-find__count">{countOf(result)}</span>
        );
      },
      <label class="playground-find__mask">
        <input
          type="checkbox"
          checked={() => maskOn.get()}
          on:change={(event) => {
            maskOn.set((event.currentTarget as HTMLInputElement).checked);
            search();
          }}
          on:keydown={fieldKeys}
        />
        File mask
      </label>,
      <input
        class="playground-find__field playground-find__mask-field"
        type="text"
        spellcheck={false}
        aria-label="File mask"
        placeholder="*.ts, !*.test.ts"
        disabled={() => !maskOn.get()}
        value={mask.peek()}
        on:input={(event) => {
          mask.set((event.currentTarget as HTMLInputElement).value);
          search();
        }}
        on:keydown={fieldKeys}
      />,
    ],
    toolbar: () => (
      <div class="playground-find__toolbar">
        {replacing ? (
          <div class="playground-find__row">
            <div
              class="playground-find__history-field"
              ref={(element: HTMLElement) => {
                replaceRow = element;
              }}
            >
              <SearchHistoryButton
                label="Replace History"
                icon={icon('searchHistory')}
                show={showReplaceHistory}
              />
              <input
                class="playground-find__field playground-find__replace"
                type="text"
                spellcheck={false}
                aria-label="Replace with"
                placeholder="Replace with"
                value={replacement.peek()}
                ref={(input: HTMLInputElement) => {
                  replaceField = input;
                }}
                on:input={(event) => {
                  replacement.set((event.currentTarget as HTMLInputElement).value);
                  search();
                }}
                on:keydown={(event) => {
                  if (showsHistory(event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    showReplaceHistory();
                    return;
                  }
                  fieldKeys(event);
                }}
              />
            </div>
            <Toggle
              label="Preserve case (Alt+E)"
              text={preserveCaseIcon()}
              on={() => preserveCase.get()}
              toggle={() => {
                preserveCase.set(!preserveCase.peek());
              }}
            />
            {button('Replace', () => void replaceOne())}
            {button('Replace All', () => void replaceAll())}
          </div>
        ) : null}
        <div class="playground-find__row">
          {scopeTab('In Project', 'project')}
          {scopeTab('Directory', 'directory')}
          {() =>
            scope.get() === 'directory' ? (
              <input
                class="playground-find__field playground-find__directory"
                type="text"
                spellcheck={false}
                aria-label="Directory"
                placeholder="The project's root"
                value={directory.peek()}
                on:input={(event) => {
                  directory.set((event.currentTarget as HTMLInputElement).value);
                  search();
                }}
                on:keydown={fieldKeys}
              />
            ) : null
          }
          <span class="playground-find__spacer" />
          {button('Open in Find Window', () => void openInWindow())}
        </div>
      </div>
    ),
    options: () => [
      option('Match Case (Alt+C)', 'Cc', matchCase),
      option('Words (Alt+W)', 'W', words),
      option('Regex (Alt+X)', '.*', regex),
    ],
    items: () => {
      const result = found.get();
      return !result || 'error' in result ? [] : result.matches.map(choiceOf);
    },
    preview: (item) => (item ? <Preview at={placeOf(item.match)} /> : null),
    onQueryChange: (text) => {
      query.set(text);
      search();
    },
    onKey: (event) => {
      if (shortcut(event)) return true;
      const on = optionKey(event);
      if (!on) return false;
      toggle(on);
      return true;
    },
  });
  // The last search, found again.
  search();
  const chosen = await picker.result;
  clearTimeout(timer);
  // As IntelliJ's popup saves its settings as it closes.
  remember(query.peek(), replacing ? replacement.peek() : undefined);
  if (chosen) {
    const { match } = chosen;
    open({ path: match.path, line: match.line, column: match.ranges[0]?.[0] ?? 0 });
  }
}
