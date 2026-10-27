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
import { CodeEditor } from '@cerebro-ide/ui-editor';
import { openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { documentFor, saveFiles } from './documents.js';
import type { Occurrences } from './find-window.js';
import { active, hostFor } from './environments.js';

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

/** Where to search, kept between searches as IntelliJ keeps it. */
const scope = signal<'project' | 'directory'>('project');
/** The File mask, and whether it's used. */
const maskOn = signal(false);
const mask = signal('');
/** What Replace in Files replaces with, kept as the rest. */
const replacement = signal('');

/**
 * Replaces the matches on these lines, in their files' documents, and saves the files. A line that's
 * changed since it was found (an unsaved edit) is left: how many lines were, and were replaced.
 */
export async function replaceLines(
  lines: readonly TextMatch[],
): Promise<{ replaced: number; skipped: number }> {
  const byFile = new Map<string, TextMatch[]>();
  for (const line of lines) byFile.set(line.path, [...(byFile.get(line.path) ?? []), line]);
  let replaced = 0;
  let skipped = 0;
  const changed: string[] = [];
  for (const [path, matches] of byFile) {
    const doc = await documentFor(path, () => '');
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
        edits.push({
          from: line.from + from,
          to: line.from + to,
          insert: match.replacements?.[i] ?? '',
        });
      });
      replaced++;
    }
    if (edits.length === 0) continue;
    doc.edit(edits);
    changed.push(path);
  }
  await saveFiles(changed);
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
            // The first match on the line, selected, as IntelliJ's preview highlights it.
            reveal={() => {
              const [from, to] = props.match.ranges[0] ?? [0, 0];
              return { line: props.match.line, column: from, end: to };
            }}
            revealFocus={false}
          />
        );
      }}
    </div>
  );
}

export interface FindOptions {
  /** Opens a file at a line. */
  open: (at: { path: string; line: number; column: number }) => void;
  /** Shows the lines found in the Find window: Open in Find Window. */
  showOccurrences: (occurrences: Occurrences) => void;
  /** The active file: Directory starts at its folder. */
  file?: string | undefined;
  /** Replace in Files, not Find. */
  replacing?: boolean;
}

/** Opens Find in Files over the active worktree, or Replace in Files. */
export async function findInFiles(options: FindOptions): Promise<void> {
  const { open, file, replacing = false } = options;
  const worktree = active()?.id;
  const host = worktree === undefined ? undefined : hostFor(worktree);
  if (!host || worktree === undefined) return;
  const within = file?.startsWith(`${worktree}/`) ? file.slice(worktree.length + 1) : '';
  const directory = signal(within.split('/').slice(0, -1).join('/'));
  const query = signal('');
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
    const item = picker.highlighted();
    if (!item) return;
    const { skipped } = await replaceLines([item.match]);
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
    reportSkipped((await replaceLines(matches)).skipped);
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
    if (event.key === 'Enter') search();
    if (event.key === 'Escape') close();
  };
  const picker = openPicker<Choice>({
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
            <input
              class="playground-find__field playground-find__replace"
              type="text"
              spellcheck={false}
              aria-label="Replace with"
              placeholder="Replace with"
              value={replacement.peek()}
              on:input={(event) => {
                replacement.set((event.currentTarget as HTMLInputElement).value);
                search();
              }}
              on:keydown={fieldKeys}
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
    preview: (item) => (item ? <Preview match={item.match} /> : null),
    onQueryChange: (text) => {
      query.set(text);
      search();
    },
    onKey: (event) => {
      if (shortcut(event)) return true;
      const on = event.altKey && !event.ctrlKey && !event.metaKey ? keys[event.code] : undefined;
      if (!on) return false;
      toggle(on);
      return true;
    },
  });
  const chosen = await picker.result;
  clearTimeout(timer);
  if (chosen) {
    const { match } = chosen;
    open({ path: match.path, line: match.line, column: match.ranges[0]?.[0] ?? 0 });
  }
}
