// Search Everywhere, as IntelliJ's (double Shift): one popup with tabs along its top, each searching
// one kind: Classes and Symbols through the host's index, Files by name, Actions (the commands),
// and Text through ripgrep. All lists the first few of each but Text, under their kind's header.
// Tab and Shift+Tab move between the tabs. The highlighted result's file shows below, at its place.
// Go to File, Go to Class, Go to Symbol and Find Action open it on their own tab, as IntelliJ's do.

import { signal } from '@cerebro-ide/reactive';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { active, hostFor } from './environments.js';
import { choiceOf, placeOf, Preview, SEARCH_DELAY, type Place, type TextMatch } from './find.js';
import { icon } from './icons.js';

export type SearchTab = 'all' | 'classes' | 'files' | 'symbols' | 'actions' | 'text';

const TABS: readonly { id: SearchTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'classes', label: 'Classes' },
  { id: 'files', label: 'Files' },
  { id: 'symbols', label: 'Symbols' },
  { id: 'actions', label: 'Actions' },
  { id: 'text', label: 'Text' },
];

/** The kinds of definitions the Classes tab lists: types, as IntelliJ's for TypeScript. */
export const CLASS_KINDS = ['class', 'interface', 'enum', 'type'];

/** How many of each kind All lists. */
export const ALL_LIMIT = 8;

/** A result: what choosing it does, and the place its preview shows, if it has one. */
export type Result = PickerItem & { run: () => void; at?: Place };

export interface SearchSources {
  /** The project's files, for the query to filter. */
  files: () => readonly Result[];
  /** The files opened lately, most recent first: what Files and All show before anything's typed. */
  recent: () => readonly Result[];
  /** The commands. */
  actions: () => readonly Result[];
  /** Opens a file at a place. */
  open: (at: Place) => void;
}

/** A definition as the host's index gives it. */
interface Definition {
  name: string;
  kind: string;
  path: string;
  line: number;
  column: number;
}

/** Results under a header, or not (a tab of one kind has none). */
function grouped(results: readonly Result[], group: string | undefined): Result[] {
  return results.map((result) => {
    const copy = { ...result };
    delete copy.group;
    return group === undefined ? copy : { ...copy, group };
  });
}

/** Opens Search Everywhere on a tab. */
export async function searchEverywhere(sources: SearchSources, start: SearchTab): Promise<void> {
  const tab = signal(start);
  const query = signal('');
  const classes = signal<Result[]>([]);
  const symbols = signal<Result[]>([]);
  const text = signal<Result[]>([]);
  const worktree = active()?.id;
  const host = worktree === undefined ? undefined : hostFor(worktree);
  const relative = (path: string) =>
    worktree !== undefined && path.startsWith(`${worktree}/`)
      ? path.slice(worktree.length + 1)
      : path;
  const definition = (d: Definition): Result => {
    const at = { path: d.path, line: d.line, column: d.column, end: d.column + d.name.length };
    return {
      label: d.name,
      detail: `${relative(d.path)}:${String(d.line + 1)}`,
      shortcut: d.kind,
      icon: () => icon('structure'),
      at,
      run: () => {
        sources.open(at);
      },
    };
  };
  let latest = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Asks the host for what the tab shows, for the query; only the latest answer counts. */
  const search = () => {
    clearTimeout(timer);
    const asked = ++latest;
    const q = query.peek();
    const shown = tab.peek();
    classes.set([]);
    symbols.set([]);
    text.set([]);
    if (!host || worktree === undefined || q.trim() === '') return;
    const index = (target: typeof classes, kinds?: string[]) => {
      void host.request('index.symbols', { worktree, query: q, ...(kinds ? { kinds } : {}) }).then(
        (found) => {
          if (asked === latest) target.set((found as Definition[]).map(definition));
        },
        () => undefined,
      );
    };
    if (shown === 'all' || shown === 'classes') index(classes, CLASS_KINDS);
    if (shown === 'all' || shown === 'symbols') index(symbols);
    if (shown === 'text') {
      // As Find in Files: after typing pauses.
      timer = setTimeout(() => {
        void host.request('search.text', { path: worktree, query: q }).then(
          (found) => {
            if (asked !== latest) return;
            text.set(
              (found as { matches: TextMatch[] }).matches.map((match): Result => {
                const at = placeOf(match);
                return {
                  ...choiceOf(match),
                  at,
                  run: () => {
                    sources.open(at);
                  },
                };
              }),
            );
          },
          () => undefined,
        );
      }, SEARCH_DELAY);
    }
  };
  const files = (q: string) =>
    q.trim() === '' ? sources.recent() : fuzzyFilter(sources.files(), q);
  const items = (q: string): Result[] => {
    switch (tab.get()) {
      case 'classes':
        return classes.get();
      case 'files':
        return grouped(files(q), undefined);
      case 'symbols':
        return symbols.get();
      case 'actions':
        return grouped(fuzzyFilter(sources.actions(), q), undefined);
      case 'text':
        return text.get();
      case 'all': {
        const typed = q.trim() !== '';
        // Classes are symbols too: listed once, as classes.
        const others = symbols.get().filter((s) => !CLASS_KINDS.includes(s.shortcut ?? ''));
        return [
          ...grouped(classes.get().slice(0, ALL_LIMIT), 'Classes'),
          ...grouped(files(q).slice(0, ALL_LIMIT), typed ? 'Files' : 'Recent Files'),
          ...grouped(others.slice(0, ALL_LIMIT), 'Symbols'),
          ...(typed
            ? grouped(fuzzyFilter(sources.actions(), q).slice(0, ALL_LIMIT), 'Actions')
            : []),
        ];
      }
    }
  };
  const select = (to: SearchTab) => {
    tab.set(to);
    search();
  };
  const chosen = await openPicker<Result>({
    label: 'Search Everywhere',
    placeholder: 'Search everywhere',
    position: 'top',
    width: 800,
    empty: 'Nothing found',
    header: () =>
      TABS.map(({ id, label }) => (
        <button
          type="button"
          role="tab"
          class="playground-find__scope"
          aria-selected={() => String(tab.get() === id)}
          on:mousedown={(event) => {
            // Keeps the focus in the search field.
            event.preventDefault();
          }}
          on:click={() => {
            select(id);
          }}
        >
          {label}
        </button>
      )),
    items,
    preview: (item) => (item?.at ? <Preview at={item.at} /> : null),
    onQueryChange: (q) => {
      query.set(q);
      search();
    },
    onKey: (event) => {
      if (event.key !== 'Tab' || event.ctrlKey || event.altKey || event.metaKey) return false;
      const at = TABS.findIndex((t) => t.id === tab.peek());
      const next = TABS[
        (at + (event.shiftKey ? TABS.length - 1 : 1)) % TABS.length
      ] as (typeof TABS)[number];
      select(next.id);
      return true;
    },
  }).result;
  clearTimeout(timer);
  chosen?.run();
}
