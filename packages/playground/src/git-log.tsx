// The Git tool window's Log, as IntelliJ's: the commits of every branch, remote branch and tag,
// newest first, each with its place in the graph, its subject and the refs at it, its author and
// date. Commits load a page at a time, the next as the list scrolls near its end; the list is read
// again when the window shows and when the app gets the focus back, as files on disk are. Beside
// it, the selected commit's changed files (a double click or Enter opens a file's diff, F4 the file)
// and its details: its message, hash, author and date. On its left, the branches; a double click
// on one, or the toolbar's Branch filter, shows that branch's commits alone. The toolbar's text
// filter shows the commits whose messages have the text, or the commits a hash names (Enter
// applies it, Ctrl+L focuses it); Refresh reads it all again.
//
// From IntelliJ: the refs' colours (VcsLogStandardColors: the current branch and HEAD in the tip's
// yellow, local branches green, remote ones purple, tags grey) and the graph's (DefaultColorGenerator,
// its first eight). Claims: the lane's width, the dot's size, the columns' widths, and the dates
// as "Today 10:15" or the system's short date and time.

import { formatSequence } from '@cerebro-ide/commands';
import { onCleanup } from '@cerebro-ide/jsx';
import { computed, signal } from '@cerebro-ide/reactive';
import type { Tab } from '@cerebro-ide/layout';
import { Splitter } from '@cerebro-ide/ui-layout';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { ToolbarButton, ToolbarDropdown } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { changeContent, diffTab, fileTab, type Change } from './changes.js';
import { active, gitRepository, hostFor, type Host } from './environments.js';
import { Toggle } from './find.js';
import { icon } from './icons.js';
import { branchName, Branches, BranchesPane, type BranchFilter } from './log-branches.js';
import { periodText, pickDate, pickUser, usersText, type Period } from './log-filters.js';
import { resolveUsers, type Author } from './log-users.js';
import { GraphLayout, type Edge, type GraphRow } from './log-graph.js';

/** A commit, as the host's `git.log` gives it. */
export interface LogCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  body: string;
  refs: string[];
}

/** How many commits a page holds. */
export const PAGE = 1000;

/** Rows from the end of those loaded at which the next page loads. */
const AHEAD = 100;

/** A ref's label at a commit. */
export interface Ref {
  name: string;
  kind: 'head' | 'local' | 'remote' | 'tag';
}

const ORDER: Record<Ref['kind'], number> = { head: 0, local: 1, remote: 2, tag: 3 };

/**
 * The labels of a commit's refs, as git decorates it in full: the branch checked out (`HEAD ->`)
 * as the tip, HEAD alone when it's detached; a remote's HEAD isn't one, as IntelliJ hides it.
 */
export function refsOf(decorations: readonly string[]): Ref[] {
  const refs: Ref[] = [];
  for (const decoration of decorations) {
    if (decoration === 'HEAD') refs.push({ name: 'HEAD', kind: 'head' });
    else if (decoration.startsWith('HEAD -> refs/heads/')) {
      refs.push({ name: decoration.slice('HEAD -> refs/heads/'.length), kind: 'head' });
    } else if (decoration.startsWith('refs/heads/')) {
      refs.push({ name: decoration.slice('refs/heads/'.length), kind: 'local' });
    } else if (decoration.startsWith('refs/remotes/') && !decoration.endsWith('/HEAD')) {
      refs.push({ name: decoration.slice('refs/remotes/'.length), kind: 'remote' });
    } else if (decoration.startsWith('tag: refs/tags/')) {
      refs.push({ name: decoration.slice('tag: refs/tags/'.length), kind: 'tag' });
    }
  }
  return refs.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** A commit's date as IntelliJ's Log shows it: today's and yesterday's by name, with the time. */
export function formatCommitDate(time: number, now = Date.now()): string {
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  if (sameDay(date, today)) return `Today ${clock}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clock}`;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/** A lane's width, and a row's height (the tree's), in pixels. */
const LANE = 14;
const ROW = 24;

const x = (lane: number) => lane * LANE + LANE / 2;

/** A row's graph: its lines, then its dot over them. */
function Graph(props: { row: GraphRow }) {
  const line = (edge: Edge, top: number) => (
    <line
      class={`playground-log__line playground-log__color-${String(edge.color)}`}
      x1={String(x(edge.from))}
      y1={String(top)}
      x2={String(x(edge.to))}
      y2={String(top + ROW / 2)}
    />
  );
  return (
    <svg
      class="playground-log__graph"
      width={String(props.row.width * LANE)}
      height={String(ROW)}
      aria-hidden="true"
    >
      {props.row.up.map((edge) => line(edge, 0))}
      {props.row.down.map((edge) => line(edge, ROW / 2))}
      <circle
        class={`playground-log__dot playground-log__color-${String(props.row.color)}`}
        cx={String(x(props.row.lane))}
        cy={String(ROW / 2)}
        r="3.5"
      />
    </svg>
  );
}

/** What the Log's text filter asks the host for (its `git.log` filter's `text`). */
export interface TextFilter {
  text: string;
  regex: boolean;
  matchCase: boolean;
}

/** What the Log's filters ask the host for, beyond the branch (`git.log`'s `filter`). */
export interface LogFilter {
  text?: TextFilter;
  authors?: string[];
  after?: number;
  before?: number;
}

/** The authors, and who "me" is: the host's `git.authors`. */
export interface Authors {
  authors: Author[];
  me: Author | undefined;
}

/** What the Log has loaded, and loads. */
class Log {
  readonly commits = signal<readonly LogCommit[]>([]);
  readonly graph = new Map<string, GraphRow>();
  /** Why it couldn't be read. */
  readonly error = signal<string | undefined>(undefined);
  readonly loaded = signal(false);
  /** The branch it shows the commits of; all, if none. */
  readonly branch = signal<BranchFilter | undefined>(undefined);
  /** The text its commits' messages have, or a hash; any, if none. */
  readonly text = signal<string | undefined>(undefined);
  /** How the text is matched, as IntelliJ's text filter settings (both off to start with). */
  readonly regex = signal(false);
  readonly matchCase = signal(false);
  /** The User filter's names (ME for "me"); anyone's, if none. */
  readonly users = signal<readonly string[] | undefined>(undefined);
  /** The Date filter's period; any time, if none. */
  readonly period = signal<Period | undefined>(undefined);
  /** The authors, once read: what the User filter's names stand for, and its popup lists. */
  readonly authors = signal<Authors | undefined>(undefined);
  private reading: Promise<Authors> | undefined;
  /** Counts the filters' changes: what was asked for under an earlier one is dropped. */
  private filtering = 0;
  private layout = new GraphLayout();
  /** All there are, loaded. */
  private done = false;
  private loading: Promise<void> | undefined;
  readonly model: TreeModel<LogCommit>;

  constructor(
    private readonly host: Host,
    private readonly worktree: string,
  ) {
    this.model = new TreeModel<LogCommit>({
      children: () => this.commits.peek(),
      key: (commit) => commit.hash,
      isLeaf: () => true,
    });
  }

  /** Reads the authors again, for the User filter. */
  readAuthors(): Promise<Authors> {
    this.reading = (
      this.host.request('git.authors', { worktree: this.worktree }) as Promise<Authors>
    ).then((authors) => {
      this.authors.set(authors);
      return authors;
    });
    return this.reading;
  }

  /** Reads the authors anew when next they're needed: the Log is read again. */
  forgetAuthors(): void {
    this.reading = undefined;
  }

  /** What the filters ask for, the User filter's names as the authors they stand for. */
  private async filters(): Promise<LogFilter | undefined> {
    const filter: LogFilter = {};
    const text = this.text.peek();
    if (text !== undefined) {
      filter.text = { text, regex: this.regex.peek(), matchCase: this.matchCase.peek() };
    }
    const users = this.users.peek();
    if (users) {
      const { authors, me } = await (this.reading ?? this.readAuthors());
      filter.authors = resolveUsers(users, authors, me);
    }
    Object.assign(filter, this.period.peek());
    return Object.keys(filter).length === 0 ? undefined : filter;
  }

  private async ask(skip: number): Promise<LogCommit[]> {
    const filter = await this.filters();
    return (await this.host.request('git.log', {
      worktree: this.worktree,
      skip,
      max: PAGE,
      ...(this.branch.peek() === undefined ? {} : { branches: [this.branch.peek()] }),
      ...(filter ? { filter } : {}),
    })) as LogCommit[];
  }

  private take(page: readonly LogCommit[], from: readonly LogCommit[]): void {
    for (const [i, row] of this.layout.add(page).entries()) {
      this.graph.set((page[i] as LogCommit).hash, row);
    }
    this.done = page.length < PAGE;
    this.commits.set([...from, ...page]);
    void this.model.load(undefined, true);
  }

  /**
   * Reads the first page again; what's loaded beyond it goes, unless it's all the same. A new
   * filter's commits replace the old whatever they are.
   */
  async reload(replace = false): Promise<void> {
    const filtering = this.filtering;
    try {
      const page = await this.ask(0);
      // Asked for before a filter changed: the new filter's is on its way.
      if (this.filtering !== filtering) return;
      this.error.set(undefined);
      const before = this.commits.peek();
      const same = page.every((commit, i) => before[i]?.hash === commit.hash);
      if (replace || !(same && before.length >= page.length && this.loaded.peek())) {
        this.layout = new GraphLayout();
        this.graph.clear();
        this.take(page, []);
      }
    } catch (error) {
      this.error.set((error as Error).message);
    }
    this.loaded.set(true);
  }

  /** Shows a branch's commits alone, or all (undefined). */
  filter(branch: BranchFilter | undefined): Promise<void> {
    this.branch.set(branch);
    return this.refilter();
  }

  /** Shows the commits a text matches, or all (undefined, or blank, as IntelliJ's). */
  search(text: string | undefined): Promise<void> {
    this.text.set(text?.trim() === '' ? undefined : text);
    return this.refilter();
  }

  /** Shows the commits of these users alone, or anyone's (undefined). */
  filterUsers(users: readonly string[] | undefined): Promise<void> {
    this.users.set(users);
    return this.refilter();
  }

  /** Shows the commits made in a period alone, or at any time (undefined). */
  filterPeriod(period: Period | undefined): Promise<void> {
    this.period.set(period);
    return this.refilter();
  }

  /** Turns Regex or Match Case on or off; the text filter, if any, applies with it. */
  setOption(option: 'regex' | 'matchCase', on: boolean): Promise<void> {
    this[option].set(on);
    return this.text.peek() === undefined ? Promise.resolve() : this.refilter();
  }

  private async refilter(): Promise<void> {
    this.filtering++;
    // A page on its way, of the filter before, is dropped as these replace the list.
    await this.reload(true);
  }

  /** Loads the next page, once, unless all are loaded; dropped if the list is read again first. */
  more(): void {
    if (this.done || this.loading) return;
    const before = this.commits.peek();
    this.loading = this.ask(before.length)
      .then(
        (page) => {
          if (this.commits.peek() === before) this.take(page, before);
        },
        (error: unknown) => {
          this.error.set((error as Error).message);
        },
      )
      .finally(() => {
        this.loading = undefined;
      });
  }

  /** A commit loaded, by its hash. */
  commit(hash: string): LogCommit | undefined {
    return this.commits.peek().find((commit) => commit.hash === hash);
  }

  /** Where a commit is among those loaded. */
  indexOf(hash: string): number {
    return this.commits.peek().findIndex((commit) => commit.hash === hash);
  }
}

/** A commit's row: its graph and subject, the refs at it, its author and date. */
function CommitRow(props: { commit: LogCommit; log: Log }) {
  const { commit, log } = props;
  // Drawn near the end of what's loaded: the next page loads.
  if (log.indexOf(commit.hash) >= log.commits.peek().length - AHEAD) log.more();
  return [
    <Graph row={log.graph.get(commit.hash) as GraphRow} />,
    <span class="playground-log__subject">
      <span class="playground-log__message">{commit.subject}</span>
      {refsOf(commit.refs).map((ref) => (
        <span class={`playground-log__ref playground-log__ref--${ref.kind}`}>{ref.name}</span>
      ))}
    </span>,
    <span class="playground-log__author" title={commit.email}>
      {commit.author}
    </span>,
    <span class="playground-log__date">{formatCommitDate(commit.time)}</span>,
  ];
}

/** Git's empty tree: what a commit with no parent is compared with (the host's EMPTY_TREE). */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The commits a commit's changes are between: its first parent's, as IntelliJ shows a merge's. */
export const rangeOf = (commit: LogCommit) => ({
  from: commit.parents[0] ?? EMPTY_TREE,
  to: commit.hash,
});

/** A commit's author and when, as IntelliJ's details give them, after its short hash. */
const signature = (commit: LogCommit) =>
  `${commit.hash.slice(0, 8)} ${commit.author} <${commit.email}> on ${new Date(
    commit.time,
  ).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

/** The selected commit's changed files, then its details. */
function CommitPane(props: { log: Log; host: Host; worktree: string; open: (tab: Tab) => void }) {
  const { log } = props;
  return () => {
    const hash = log.model.selected;
    const commit = hash === undefined ? undefined : log.commit(hash);
    if (!commit) return <p class="playground-project__empty">No commits selected</p>;
    const range = rangeOf(commit);
    const changes = signal<readonly Change[]>([]);
    const files = new TreeModel<Change>({
      children: () => changes.peek(),
      key: (change) => change.path,
      isLeaf: () => true,
    });
    const failed = signal<string | undefined>(undefined);
    void props.host.request('git.changes', { path: props.worktree, ...range }).then(
      (listed) => {
        changes.set(listed as Change[]);
        void files.load(undefined, true);
      },
      (error: unknown) => {
        failed.set((error as Error).message);
      },
    );
    return [
      () => {
        const error = failed.get();
        return error === undefined ? (
          <div
            class="playground-log__files"
            on:keydown={(event) => {
              // F4 opens the file itself, as IntelliJ's Jump to Source; one deleted is gone.
              const selected = changes.peek().find((c) => c.path === files.selected);
              if (event.key !== 'F4' || !selected || selected.status === 'deleted') return;
              event.preventDefault();
              props.open(fileTab(props.worktree, selected.path));
            }}
          >
            <TreeView
              model={files}
              label={`${commit.subject} changes`}
              row={(change) => changeContent(change, true)}
              onOpen={(change) => {
                props.open(diffTab(change.path, range));
              }}
            />
          </div>
        ) : (
          <p class="playground-project__empty">{error}</p>
        );
      },
      <div class="playground-log__details cerebro-selectable">
        <p class="playground-log__details-subject">{commit.subject}</p>
        {commit.body === '' ? null : <p class="playground-log__details-body">{commit.body}</p>}
        <p class="playground-log__details-signature">{signature(commit)}</p>
      </div>,
    ];
  };
}

/** How wide the commit's pane and the branches are to start with, in pixels (claims). */
const PANE_WIDTH = 400;
const BRANCHES_WIDTH = 200;

/** The Log shown, for its commands. */
const shown = signal<{ log: Log; branches: Branches } | undefined>(undefined);

/** Where the toolbar's commands come from. */
const FROM_LOG = { source: 'log' };

/** From the Log's toolbar, or a shortcut while it has the keyboard. */
const here = (context: unknown) =>
  (context as { source?: string } | undefined)?.source === 'log' ||
  document.activeElement?.closest('.playground-log') != null;

/** Reads the Log and its branches again. */
function refresh(log: Log, branches: Branches) {
  log.forgetAuthors();
  void log.reload();
  void branches.reload();
}

/** The Log's commands and shortcuts. */
export function setupLog(services: MenuServices): void {
  const { commands, keymap } = services;
  commands.register({
    id: 'log.refresh',
    label: '&Refresh',
    icon: 'refresh',
    enabled: (c) => here(c) && shown.get() !== undefined,
    run: () => {
      const { log, branches } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      refresh(log, branches);
    },
  });
  // IntelliJ's Refresh, in its macOS keymap and the others.
  keymap?.bindDefault(keymap.platform === 'mac' ? 'Mod+R' : 'Ctrl+F5', 'log.refresh');
  commands.register({
    id: 'log.focusTextFilter',
    label: 'Focus Text Filter',
    enabled: (c) => here(c) && shown.get() !== undefined,
    run: () => {
      // The text filter, or from it back to the commits, as IntelliJ's.
      const field = document.querySelector<HTMLElement>('.playground-log__search-field');
      const list = document.querySelector<HTMLElement>('.playground-log__list .cerebro-tree');
      (document.activeElement === field ? list : field)?.focus();
    },
  });
  // IntelliJ's, Ctrl+L in its default keymap: Cmd+L on macOS, which takes it with Ctrl as Cmd.
  keymap?.bindDefault('Mod+L', 'log.focusTextFilter');
}

type BranchChoice = PickerItem & { branch: BranchFilter | undefined };

/** The Branch filter's popup: All, HEAD, then the local and remote branches. */
function pickBranch(button: HTMLElement, log: Log, branches: Branches) {
  const chosen = (branch: BranchFilter | undefined) =>
    log.branch.peek() === branch ? { icon: () => icon('check') } : {};
  const handle = openPicker<BranchChoice>({
    label: 'Branch',
    placeholder: 'Search',
    position: { below: button },
    owner: button,
    items: (query) =>
      fuzzyFilter(
        [
          { label: 'All', branch: undefined, ...chosen(undefined) },
          { label: 'HEAD (Current Branch)', branch: 'HEAD', ...chosen('HEAD') },
          ...branches.branches.get().map((b) => ({
            label: branchName(b.ref),
            group: b.ref.startsWith('refs/heads/') ? 'Local' : 'Remote',
            branch: b.ref,
            ...chosen(b.ref),
          })),
        ],
        query,
      ),
  });
  void handle.result.then((choice) => {
    if (choice) void log.filter(choice.branch);
  });
  return handle;
}

/** A command's first shortcut, as menus show it. */
const shortcutOf = (services: MenuServices, command: string) => () => {
  const keymap = services.keymap;
  const key = keymap?.shortcutsFor(command)[0];
  return key === undefined || !keymap ? undefined : formatSequence(key, keymap.platform);
};

/**
 * The text filter, as IntelliJ's: the text typed applies on Enter, or as the field loses the focus
 * changed; emptied, or cleared with its button, it's off. Regex and Match Case sit in it.
 */
function TextFilterField(props: { services: MenuServices; log: Log; name: string }): Node {
  const { log } = props;
  const typed = signal(log.text.peek() ?? '');
  // As IntelliJ's isSameFilterAs: blank is the same as none.
  const same = () => {
    const applied = log.text.peek() ?? '';
    return typed.peek().trim() === '' ? applied === '' : typed.peek() === applied;
  };
  const apply = () => {
    void log.search(typed.peek());
  };
  let field: HTMLInputElement | undefined;
  const option = (label: string, text: string, name: 'regex' | 'matchCase') => (
    <Toggle
      label={label}
      text={text}
      on={() => log[name].get()}
      toggle={() => {
        void log.setOption(name, !log[name].peek());
      }}
    />
  );
  return (
    <div class="playground-log__search">
      {icon('search')}
      <input
        class="playground-log__search-field"
        type="text"
        spellcheck={false}
        placeholder="Text or hash"
        aria-label={`${props.name} log text or hash filter`}
        value={typed.peek()}
        ref={(input: HTMLInputElement) => {
          field = input;
          tooltip({
            text: () => 'Filter by Commit Message or Hashes',
            shortcut: shortcutOf(props.services, 'log.focusTextFilter'),
          })(input);
        }}
        on:input={(event) => {
          typed.set((event.currentTarget as HTMLInputElement).value);
        }}
        on:keydown={(event) => {
          if (event.key === 'Enter') apply();
        }}
        on:blur={() => {
          if (!same()) apply();
        }}
      />
      {() =>
        typed.get() === '' ? null : (
          <button
            type="button"
            class="playground-log__search-clear"
            aria-label="Clear"
            on:mousedown={(event) => {
              event.preventDefault();
            }}
            on:click={() => {
              (field as HTMLInputElement).value = '';
              typed.set('');
              void log.search(undefined);
            }}
          >
            {icon('clear')}
          </button>
        )
      }
      {option('Regex', '.*', 'regex')}
      {option('Match Case', 'Cc', 'matchCase')}
    </div>
  );
}

/** A filter's text, as IntelliJ's: its name alone while it's off, else its name and value. */
const filterText = <T,>(name: string, value: T | undefined, text: (value: T) => string) =>
  value === undefined ? name : `${name}: ${text(value)}`;

/** What clears a filter, while it's on. */
const clearing = (value: unknown, clear: () => void) => (value === undefined ? undefined : clear);

/**
 * Above the commits, as IntelliJ's: the text filter; the Branch, User and Date filters, each with
 * an X that clears it while it's on; then Refresh.
 */
function LogToolbar(props: {
  services: MenuServices;
  log: Log;
  branches: Branches;
  name: string;
  worktree: string;
}): Node {
  const { services, log, branches } = props;
  return (
    <div class="playground-log__toolbar" role="toolbar" aria-label="Log">
      <TextFilterField services={services} log={log} name={props.name} />
      <ToolbarDropdown
        services={services}
        label="Branch"
        text={() => filterText('Branch', log.branch.get(), branchName)}
        popup={(button) => pickBranch(button, log, branches)}
        clear={() => clearing(log.branch.get(), () => void log.filter(undefined))}
      />
      <ToolbarDropdown
        services={services}
        label="User"
        text={() => filterText('User', log.users.get(), usersText)}
        popup={(button) => {
          void log.readAuthors();
          return pickUser(button, {
            worktree: props.worktree,
            authors: () => log.authors.get(),
            current: () => log.users.peek(),
            choose: (users) => void log.filterUsers(users),
          });
        }}
        clear={() => clearing(log.users.get(), () => void log.filterUsers(undefined))}
      />
      <ToolbarDropdown
        services={services}
        label="Date"
        text={() => filterText('Date', log.period.get(), periodText)}
        popup={(button) =>
          pickDate(
            button,
            () => log.period.peek(),
            (period) => void log.filterPeriod(period),
          )
        }
        clear={() => clearing(log.period.get(), () => void log.filterPeriod(undefined))}
      />
      <ToolbarButton
        commands={services.commands}
        command="log.refresh"
        icon={icon('refresh')}
        shortcut={shortcutOf(services, 'log.refresh')}
        context={() => FROM_LOG}
      />
    </div>
  );
}

/** The Git tool window's Log, of the active environment's repository. */
export function GitLogView(props: { services: MenuServices; open: (tab: Tab) => void }): Node {
  return (
    <div class="playground-log">
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        const host = hostFor(env.id);
        if (!host)
          return <p class="playground-project__empty">The log shows in the desktop app.</p>;
        if (!gitRepository.get()) {
          return <p class="playground-project__empty">Not a git repository</p>;
        }
        const log = new Log(host, env.id);
        const branches = new Branches(host, env.id);
        const reload = () => {
          refresh(log, branches);
        };
        reload();
        shown.set({ log, branches });
        window.addEventListener('focus', reload);
        onCleanup(() => {
          window.removeEventListener('focus', reload);
          shown.set(undefined);
        });
        // Only whether there are any: the tree itself follows the commits.
        const empty = computed(() => log.loaded.get() && log.commits.get().length === 0);
        const list = () => {
          const error = log.error.get();
          if (error !== undefined) return <p class="playground-project__empty">{error}</p>;
          if (empty.get()) return <p class="playground-project__empty">No commits</p>;
          return (
            <TreeView
              model={log.model}
              label={`${env.name} log`}
              row={(commit) => <CommitRow commit={commit} log={log} />}
            />
          );
        };
        const pane = (
          <div class="playground-log__pane">
            <CommitPane log={log} host={host} worktree={env.id} open={props.open} />
          </div>
        ) as HTMLElement;
        pane.style.width = `${String(PANE_WIDTH)}px`;
        const side = (
          <div class="playground-log__branches">
            <BranchesPane
              branches={branches}
              filter={(branch) => {
                void log.filter(branch);
              }}
            />
          </div>
        ) as HTMLElement;
        side.style.width = `${String(BRANCHES_WIDTH)}px`;
        return [
          side,
          <Splitter
            line="vertical"
            start={() => side.offsetWidth}
            onDrag={(width, delta) => {
              side.style.width = `${String(Math.max(0, width + delta))}px`;
            }}
          />,
          <div class="playground-log__commits">
            <LogToolbar
              services={props.services}
              log={log}
              branches={branches}
              name={env.name}
              worktree={env.id}
            />
            <div class="playground-log__list">{list}</div>
          </div>,
          <Splitter
            line="vertical"
            start={() => pane.offsetWidth}
            onDrag={(width, delta) => {
              pane.style.width = `${String(Math.max(0, width - delta))}px`;
            }}
          />,
          pane,
        ];
      }}
    </div>
  );
}
