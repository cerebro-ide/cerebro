// The Problems tool window's File tab, as IntelliJ's: the active file's errors and warnings as its
// language server last gave them, in a tree under the file, the worst first. Double-click, Enter or
// F4 (Jump to Source) goes to one. The files with errors are marked in their tabs and in the
// Project tree, as IntelliJ marks problem files: their names underlined with the error's wave.
//
// IntelliJ's wording and rows, from its source (`ProblemsViewBundle.properties`, `ProblemNode.kt`,
// `FileNode.kt`): a problem's message and its line in grey (` :12`); the file's name, its folder
// and "N problems" in grey; "No problems in a.ts", "Analyzing a.ts", "Open file in editor to see
// problems". Sorted by severity, its default (`ProblemsViewState.sortBySeverity`).

import { onCleanup } from '@cerebro-ide/jsx';
import {
  computed,
  effect,
  ObservableMap,
  ObservableSet,
  signal,
  untracked,
} from '@cerebro-ide/reactive';
import { openContextMenu, openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { problemIcon, type Problem } from '@cerebro-ide/ui-editor';
import { TreeModel, TreeView, type TreeSource } from '@cerebro-ide/ui-tree';
import { icon } from './icons.js';

/** Each file's errors and warnings, by path, as its language server last gave them. */
export const fileProblems = new ObservableMap<string, readonly Problem[]>();

/** Files whose problems are asked for and not yet answered the first time. */
const analyzing = new ObservableSet<string>();

/**
 * Asks for a file's problems and keeps the answer, for the Problems tool window and the marks on
 * files with errors. No answer (no language server for it) is none.
 */
export async function askProblems(
  path: string,
  ask: () => Promise<readonly Problem[] | null>,
): Promise<readonly Problem[] | null> {
  if (!fileProblems.has(path)) analyzing.add(path);
  try {
    const found = await ask();
    fileProblems.set(path, found ?? []);
    return found;
  } finally {
    analyzing.delete(path);
  }
}

/** Whether a file has errors: warnings don't mark it, as IntelliJ's problem files. */
export function hasErrors(path: string): boolean {
  return fileProblems.get(path)?.some((p) => p.severity === 'error') ?? false;
}

/** Whether a folder has a file with errors in it, at any depth: IntelliJ marks it too. */
export function hasErrorsBeneath(folder: string): boolean {
  const prefix = `${folder}/`;
  for (const [path, problems] of fileProblems) {
    if (path.startsWith(prefix) && problems.some((p) => p.severity === 'error')) return true;
  }
  return false;
}

/** A row of the tree: the file, or one of its problems. Flat, so a reload compares them. */
type Row =
  | { kind: 'file'; key: string; path: string }
  | {
      kind: 'problem';
      key: string;
      path: string;
      severity: 'error' | 'warning' | 'weak';
      message: string;
      line: number;
      column: number;
    };

type ProblemRow = Extract<Row, { kind: 'problem' }>;

const RANK = { error: 0, warning: 1, weak: 2 } as const;

/** The View Options, as IntelliJ's (`ProblemsViewState`), kept in the browser's storage. */
const OPTIONS_KEY = 'cerebro.problems.view';

interface ViewOptions {
  /** The severities not shown: errors always are, as IntelliJ's filters stop below them. */
  hidden: ('warning' | 'weak')[];
  sortBySeverity: boolean;
  sortByName: boolean;
}

/** The View Options as kept, or IntelliJ's defaults: all shown, by severity, not by name. */
export function readViewOptions(): ViewOptions {
  try {
    // What's kept may be anything: read as what it might be.
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as {
      hidden?: unknown;
      sortBySeverity?: unknown;
      sortByName?: unknown;
    };
    return {
      hidden: Array.isArray(stored.hidden)
        ? stored.hidden.filter((s): s is 'warning' | 'weak' => s === 'warning' || s === 'weak')
        : [],
      sortBySeverity: stored.sortBySeverity !== false,
      sortByName: stored.sortByName === true,
    };
  } catch {
    return { hidden: [], sortBySeverity: true, sortByName: false };
  }
}

const viewOptions = readViewOptions();
const hidden = new ObservableSet<'warning' | 'weak'>(viewOptions.hidden);
const sortBySeverity = signal(viewOptions.sortBySeverity);
const sortByName = signal(viewOptions.sortByName);

function saveViewOptions(): void {
  try {
    localStorage.setItem(
      OPTIONS_KEY,
      JSON.stringify({
        hidden: [...hidden],
        sortBySeverity: sortBySeverity.peek(),
        sortByName: sortByName.peek(),
      }),
    );
  } catch {
    // Not kept: they still apply until the page is reloaded.
  }
}

/** Two texts in order, numbers by their value (IntelliJ's `naturalCompare`). */
const natural = new Intl.Collator(undefined, { numeric: true }).compare;

type Shown = Pick<ProblemRow, 'severity' | 'message' | 'line' | 'column'>;

/**
 * Two problems in the View Options' order, as IntelliJ's ProblemsViewNodeComparator: the worst
 * first, if sorted by severity; then by message and place, if by name, else by place and message.
 */
export function compareProblems(
  a: Shown,
  b: Shown,
  by: { severity: boolean; name: boolean },
): number {
  const place = a.line - b.line || a.column - b.column;
  return (
    (by.severity ? RANK[a.severity] - RANK[b.severity] : 0) ||
    (by.name ? natural(a.message, b.message) || place : place || natural(a.message, b.message))
  );
}

/**
 * A file's problems as rows: errors, warnings and weak warnings, as the View Options show and
 * sort them. A row's key is what it says, so a new answer keeps the same problem selected.
 */
function rowsOf(path: string): ProblemRow[] {
  const keys = new Set<string>();
  const by = { severity: sortBySeverity.get(), name: sortByName.get() };
  return (fileProblems.get(path) ?? [])
    .filter((p): p is Problem & { severity: ProblemRow['severity'] } => p.severity !== 'hint')
    .filter((p) => p.severity === 'error' || !hidden.has(p.severity))
    .map((p) => ({ severity: p.severity, message: p.message, ...p.from }))
    .sort((a, b) => compareProblems(a, b, by))
    .map((p) => {
      const said = `${path}#${p.severity}:${String(p.line)}:${String(p.column)}:${p.message}`;
      // The same problem twice is two rows.
      let key = said;
      for (let n = 2; keys.has(key); n++) key = `${said}#${String(n)}`;
      keys.add(key);
      return { kind: 'problem', key, path, ...p };
    });
}

const fileName = (path: string) => path.split('/').at(-1) as string;

/** Whether the Problems tool window's tree has the keyboard: F4 then acts on it. */
const inside = signal(false);

/** The problem selected in the Problems tool window, while it lists some. */
let selected: (() => ProblemRow | undefined) | undefined;

export interface ProblemsSetup {
  /** Opens a file at a line and column, zero-based, focusing the editor. */
  openAt: (at: { path: string; line: number; column: number }) => void;
}

/** The Problems tool window's commands: Jump to Source, with F4, and in its context menu. */
export function setupProblems(services: MenuServices, setup: ProblemsSetup): void {
  const { commands, menus, keymap } = services;
  /** From its context menu, or a shortcut while it has the keyboard. */
  const target = (context: unknown) =>
    (context as { source?: string } | undefined)?.source === 'problems' || inside.get()
      ? selected?.()
      : undefined;
  commands.register({
    id: 'problems.jumpToSource',
    label: '&Jump to Source',
    enabled: (c) => target(c) !== undefined,
    run: (c) => {
      const row = target(c) as ProblemRow;
      setup.openAt({ path: row.path, line: row.line, column: row.column });
    },
  });
  keymap?.bindDefault('F4', 'problems.jumpToSource');
  menus.contribute({
    menu: 'problems/item',
    item: { command: 'problems.jumpToSource' },
    group: 'a',
  });
  // View Options, as IntelliJ's for the File tab (ProblemsView.Options): Show, then Sort By.
  menus.contribute({ menu: VIEW_MENU, item: { heading: 'Show' }, group: 'a' });
  for (const [severity, label] of [
    ['warning', 'Warning'],
    ['weak', 'Weak Warning'],
  ] as const) {
    const id = `problems.show.${severity}`;
    commands.register({
      id,
      label,
      checked: () => !hidden.has(severity),
      run: () => {
        if (hidden.has(severity)) hidden.delete(severity);
        else hidden.add(severity);
        saveViewOptions();
      },
    });
    menus.contribute({ menu: VIEW_MENU, item: { command: id }, group: 'a' });
  }
  menus.contribute({ menu: VIEW_MENU, item: { heading: 'Sort By' }, group: 'b' });
  for (const [id, label, option] of [
    ['problems.sortBySeverity', 'Severity', sortBySeverity],
    ['problems.sortByName', 'Name', sortByName],
  ] as const) {
    commands.register({
      id,
      label,
      checked: () => option.get(),
      run: () => {
        option.set(!option.peek());
        saveViewOptions();
      },
    });
    menus.contribute({ menu: VIEW_MENU, item: { command: id }, group: 'b' });
  }
}

/** The View Options' menu. */
const VIEW_MENU = 'problems/view';

/** The File tab: the active file's problems, in a tree under the file. */
export function ProblemsView(props: {
  services: MenuServices;
  /** The active editor tab's file, if one is open. */
  file: () => string | undefined;
  /** Opens a file at a line and column, zero-based, focusing the editor. */
  openAt: (at: { path: string; line: number; column: number }) => void;
}): Node {
  return (
    <div class="playground-problems">
      <div
        class="playground-problems__toolbar"
        role="toolbar"
        aria-label="Problems"
        aria-orientation="vertical"
      >
        <button
          type="button"
          class="cerebro-toolbar-button"
          aria-label="View Options"
          data-menu={VIEW_MENU}
          ref={tooltip({ text: () => 'View Options', placement: 'right' })}
          on:click={(event) => {
            const anchor = event.currentTarget as HTMLElement;
            openMenu(props.services, VIEW_MENU, { anchor, placement: 'right' }, { owner: anchor });
          }}
        >
          {icon('eye')}
        </button>
      </div>
      <div class="playground-problems__file">
        {() => {
          const path = props.file();
          if (path === undefined) {
            return <p class="playground-project__empty">Open file in editor to see problems</p>;
          }
          return untracked(() => <FileView path={path} {...props} />);
        }}
      </div>
    </div>
  );
}

/** A file's problems, or why there are none: drawn again only when that changes. */
function FileView(props: {
  path: string;
  services: MenuServices;
  openAt: (at: { path: string; line: number; column: number }) => void;
}): Node {
  const { path } = props;
  const state = computed(() => {
    if (!fileProblems.has(path) && analyzing.has(path)) return 'analyzing';
    return rowsOf(path).length === 0 ? 'none' : 'some';
  });
  return (
    <>
      {() => {
        const now = state.get();
        if (now === 'analyzing') {
          return <p class="playground-project__empty">Analyzing {fileName(path)}</p>;
        }
        if (now === 'none') {
          return (
            <p class="playground-project__empty">
              No problems in {fileName(path)}
              {() =>
                hidden.size > 0 ? (
                  <>
                    <br />
                    Problems could be filtered out
                  </>
                ) : null
              }
            </p>
          );
        }
        return untracked(() => <FileProblems {...props} />);
      }}
    </>
  );
}

function FileProblems(props: {
  path: string;
  services: MenuServices;
  openAt: (at: { path: string; line: number; column: number }) => void;
}): Node {
  const { path } = props;
  const source: TreeSource<Row> = {
    children: (node) => (node === undefined ? [{ kind: 'file', key: path, path }] : rowsOf(path)),
    key: (node) => node.key,
    isLeaf: (node) => node.kind === 'problem',
  };
  const model = new TreeModel(source);
  // The file shows open, as IntelliJ's.
  model.expanded.add(path);
  // New answers, and the View Options, show as they come, the selection kept where it was.
  const watch = effect(() => {
    rowsOf(path);
    void untracked(() => model.refresh());
    return undefined;
  });
  const current = () => {
    const row = model.rows[model.selectedIndex]?.node;
    return row?.kind === 'problem' ? row : undefined;
  };
  selected = current;
  // The list it replaces, for another file, has gone first.
  onCleanup(() => {
    watch.dispose();
    selected = undefined;
    inside.set(false);
  });
  // Only a problem is opened: the file's row folds.
  const go = (row: Row) => {
    const { line, column } = row as ProblemRow;
    props.openAt({ path, line, column });
  };
  return (
    <div
      class="playground-problems__tree"
      on:focusin={() => {
        inside.set(true);
      }}
      on:focusout={() => {
        // The tree is all that takes the focus in it.
        inside.set(false);
      }}
    >
      <TreeView
        model={model}
        label="Problems"
        row={(row) =>
          row.kind === 'file'
            ? [
                icon('file'),
                fileName(row.path),
                <span class="playground-change__folder">
                  {row.path.split('/').slice(0, -1).join('/')}
                </span>,
                () => {
                  const count = rowsOf(row.path).length;
                  return (
                    <span class="playground-change__folder">
                      {count === 1 ? '1 problem' : `${String(count)} problems`}
                    </span>
                  );
                },
              ]
            : [
                <span class="playground-problems__icon">{problemIcon(row.severity)}</span>,
                <span class="playground-problems__message">{row.message}</span>,
                <span class="playground-change__folder">:{row.line + 1}</span>,
              ]
        }
        onOpen={go}
        onContextMenu={(event, row) => {
          if (row.kind === 'problem') {
            openContextMenu(props.services, 'problems/item', event, { source: 'problems' });
          }
        }}
      />
    </div>
  );
}
