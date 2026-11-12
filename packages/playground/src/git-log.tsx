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

import { formatSequence, type Platform } from '@cerebro-ide/commands';
import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { computed, effect, signal, untracked, type Disposable } from '@cerebro-ide/reactive';
import type { Tab } from '@cerebro-ide/layout';
import { Splitter } from '@cerebro-ide/ui-layout';
import { openContextMenu, openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { ToolbarButton, ToolbarDropdown, ToolbarRow } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { changeContent, diffTab, fileTab, type Change } from './changes.js';
import { formatCommitDate } from './dates.js';
import { active, gitRepository, hostFor, type Host } from './environments.js';
import { Toggle } from './find.js';
import { branchField } from './git-options.js';
import { icon } from './icons.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { numbered } from './select-in.js';
import {
  branchName,
  Branches,
  BranchesPane,
  paneSettings,
  savePaneSettings,
  type BranchesContext,
  type BranchesSelection,
  type BranchFilter,
} from './log-branches.js';
import {
  openFilterPicker,
  periodText,
  pickDate,
  pickUser,
  usersText,
  usersTooltip,
  type Period,
} from './log-filters.js';
import { pathsText, pathsTooltip, pickPaths, shortenText } from './log-paths.js';
import type { FileNode } from './project.js';
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
  paths?: readonly string[];
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
  /** The file to select among a commit's changes, as shown in the Log from an annotation. */
  readonly file = signal<{ hash: string; path: string } | undefined>(undefined);
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
  /** The Paths filter's files and folders, from the repository's top; any, if none. */
  readonly paths = signal<readonly string[] | undefined>(undefined);
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
    readonly host: Host,
    readonly worktree: string,
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
    const paths = this.paths.peek();
    if (paths) filter.paths = paths;
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
      // The same commits with the same refs: a tag or branch made at one since changes the page.
      const same = page.every(
        (commit, i) =>
          before[i]?.hash === commit.hash && before[i].refs.join('\n') === commit.refs.join('\n'),
      );
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

  /**
   * Shows the commits after `start` up to `end` alone (git's `start..end`): IntelliJ's View
   * Commits, whose tab has only the range and the Log's Paths filter, so the others are cleared.
   */
  showRange(range: HashRange): Promise<void> {
    return this.showOnly(`${range.start}..${range.end}`, this.paths.peek());
  }

  /**
   * Shows the commits of HEAD that change `path`: IntelliJ's file history, whose other branches are
   * off to start with (`FileHistoryUiProperties`' `isShowOtherBranches`).
   */
  showHistory(path: string): Promise<void> {
    return this.showOnly('HEAD', [path]);
  }

  /** The branch's commits that change the paths (any, if undefined), the other filters cleared. */
  private showOnly(branch: BranchFilter, paths: readonly string[] | undefined): Promise<void> {
    this.branch.set(branch);
    this.text.set(undefined);
    this.users.set(undefined);
    this.period.set(undefined);
    this.paths.set(paths);
    return this.refilter();
  }

  /** Shows the commits that change these paths alone, or every commit (undefined). */
  filterPaths(paths: readonly string[] | undefined): Promise<void> {
    this.paths.set(paths);
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

  /** Clears every filter, as a Log tab IntelliJ opens to show a commit the others don't. */
  clearFilters(): Promise<void> {
    this.branch.set(undefined);
    this.text.set(undefined);
    this.users.set(undefined);
    this.period.set(undefined);
    this.paths.set(undefined);
    return this.refilter();
  }

  /**
   * Selects a commit, loading pages until it's among them, as IntelliJ's `jumpToCommit`; with the
   * filters cleared if they leave it out. Says whether it was found.
   */
  async select(hash: string): Promise<boolean> {
    const found =
      (await this.find(hash)) ||
      (this.filtered() && (await this.clearFilters(), await this.find(hash)));
    if (found) this.model.select(hash);
    return found;
  }

  /** Loads pages until a commit is among them, or all are; says whether it is. */
  async find(hash: string): Promise<boolean> {
    while (this.indexOf(hash) < 0 && !this.done && this.error.peek() === undefined) {
      this.more();
      await this.loading;
    }
    return this.indexOf(hash) >= 0;
  }

  /**
   * The commits a commit's row joins in the graph, in the Log's order, as IntelliJ's
   * `getAdjacentRows`: its parents (those not loaded yet last, in git's order), or its children,
   * all loaded before it (the list is in `--date-order`).
   */
  adjacent(commit: LogCommit, parents: boolean): string[] {
    const commits = this.commits.peek();
    if (!parents) {
      return commits.filter((c) => c.parents.includes(commit.hash)).map((c) => c.hash);
    }
    const at = (hash: string) => {
      const index = this.indexOf(hash);
      return index < 0 ? commits.length : index;
    };
    return [...commit.parents].sort((a, b) => at(a) - at(b));
  }

  /** Whether any filter applies. */
  private filtered(): boolean {
    return [this.branch, this.text, this.users, this.period, this.paths].some(
      (filter) => filter.peek() !== undefined,
    );
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

/**
 * Where a message matches the text filter, as IntelliJ's matchingRanges: each place the text is,
 * from the end of the last (in any case unless Match Case), or each match of the expression.
 */
export function matchRanges(message: string, filter: TextFilter): [number, number][] {
  let pattern: RegExp;
  try {
    const source = filter.regex ? filter.text : filter.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(source, filter.matchCase ? 'g' : 'gi');
  } catch {
    // git's expressions aren't all JavaScript's: one JavaScript can't read shows no matches.
    return [];
  }
  return [...message.matchAll(pattern)]
    .filter((match) => match[0] !== '')
    .map((match) => [match.index, match.index + match[0].length]);
}

/** A message with the text filter's matches marked, as IntelliJ's Log marks them (on by default). */
function Message(props: { message: string; log: Log }) {
  const { message, log } = props;
  return (
    <span class="playground-log__message">
      {() => {
        const text = log.text.get();
        if (text === undefined) return message;
        const ranges = matchRanges(message, {
          text,
          regex: log.regex.get(),
          matchCase: log.matchCase.get(),
        });
        const parts: Child[] = [];
        let at = 0;
        for (const [start, end] of ranges) {
          parts.push(message.slice(at, start));
          parts.push(<span class="playground-log__match">{message.slice(start, end)}</span>);
          at = end;
        }
        parts.push(message.slice(at));
        return parts;
      }}
    </span>
  );
}

/** A commit's row: its graph and subject, the refs at it, its author and date. */
function CommitRow(props: { commit: LogCommit; log: Log }) {
  const { commit, log } = props;
  // Drawn near the end of what's loaded: the next page loads.
  if (log.indexOf(commit.hash) >= log.commits.peek().length - AHEAD) log.more();
  return [
    <Graph row={log.graph.get(commit.hash) as GraphRow} />,
    <span class="playground-log__subject">
      <Message message={commit.subject} log={log} />
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

/**
 * The files changed between two commits, as a tree: the Log's selected commit's, and the Push
 * dialog's. With `open`, Enter or a double click opens a file's diff, and F4 the file itself, as
 * IntelliJ's Jump to Source.
 */
export function CommitFiles(props: {
  host: Host;
  worktree: string;
  range: { from: string; to: string };
  /** What the tree is, for a screen reader. */
  label: string;
  open?: (tab: Tab, chain?: readonly string[]) => void;
  /** The file to select once they're read. */
  selected?: string | undefined;
}) {
  const { range, open } = props;
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
      void files.load(undefined, true).then(() => {
        files.select(props.selected);
      });
    },
    (error: unknown) => {
      failed.set((error as Error).message);
    },
  );
  return () => {
    const error = failed.get();
    return error === undefined ? (
      <div
        class="playground-log__files"
        on:keydown={(event) => {
          // F4 opens the file itself, as IntelliJ's Jump to Source; one deleted is gone.
          const selected = changes.peek().find((c) => c.path === files.selected);
          if (event.key !== 'F4' || !open || !selected || selected.status === 'deleted') return;
          event.preventDefault();
          open(fileTab(props.worktree, selected.path));
        }}
      >
        <TreeView
          model={files}
          label={props.label}
          row={(change) => changeContent(change, true)}
          onOpen={(change) => {
            // Through the commit's files, as IntelliJ's.
            open?.(
              diffTab(change.path, range),
              changes.peek().map((c) => c.path),
            );
          }}
        />
      </div>
    ) : (
      <p class="playground-project__empty">{error}</p>
    );
  };
}

/** The selected commit's changed files, then its details. */
function CommitPane(props: {
  log: Log;
  host: Host;
  worktree: string;
  open: (tab: Tab, chain?: readonly string[]) => void;
}) {
  const { log } = props;
  return () => {
    const hash = log.model.selected;
    const commit = hash === undefined ? undefined : log.commit(hash);
    if (!commit) return <p class="playground-project__empty">No commits selected</p>;
    return [
      <CommitFiles
        host={props.host}
        worktree={props.worktree}
        range={rangeOf(commit)}
        label={`${commit.subject} changes`}
        open={props.open}
        selected={log.file.peek()?.hash === hash ? log.file.peek()?.path : undefined}
      />,
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

/** What the commit menu acts on, for a commit of `log`. */
function commitContext(log: Log, branches: Branches, commit: LogCommit): LogCommitContext {
  const head = log.commits
    .peek()
    .find((c) => c.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')));
  return {
    commit,
    worktree: log.worktree,
    host: log.host,
    ...(head ? { head: head.hash } : {}),
    refresh: () => refresh(log, branches),
  };
}

/** What the branches pane's toolbar acts on. */
function branchesContext(log: Log, branches: Branches): BranchesContext {
  return {
    source: 'log',
    selection: branches.selection(),
    refresh: () => refresh(log, branches),
  };
}

/**
 * What the branches pane's actions act on: their toolbar's context, or, from the keys, the pane's
 * selection while it has the keyboard.
 */
export function paneContext(context: unknown): BranchesContext | undefined {
  if (
    (context as Partial<BranchesContext> | undefined)?.source === 'log' &&
    'selection' in (context as object)
  )
    return context as BranchesContext;
  const at = shown.get();
  if (!at || !document.activeElement?.closest('.playground-branches')) return undefined;
  return branchesContext(at.log, at.branches);
}

/** The Log's selected commit, as its commit menu has it: what its toolbar's Cherry-Pick picks. */
export function selectedCommit(): LogCommitContext | undefined {
  const at = shown.get();
  if (!at) return undefined;
  const hash = at.log.model.selected;
  const commit = hash === undefined ? undefined : at.log.commit(hash);
  return commit && commitContext(at.log, at.branches, commit);
}

/** From the Log's toolbar, or a shortcut while it has the keyboard. */
const here = (context: unknown) =>
  (context as { source?: string } | undefined)?.source === 'log' ||
  document.activeElement?.closest('.playground-log') != null;

/** Reads the Log and its branches again; done once the Log's first page is read. */
function refresh(log: Log, branches: Branches): Promise<void> {
  log.forgetAuthors();
  void branches.reload();
  return log.reload();
}

/**
 * A commit to show in the Log, and a file to select among its changes: IntelliJ's
 * `jumpToRevisionAsync`, from a click on an annotation. The Log takes it when it shows.
 */
const wanted = signal<{ hash: string; path: string } | undefined>(undefined);

/** What the Log's commit menu acts on: the commit right-clicked, and its worktree's Log. */
export interface LogCommitContext {
  commit: LogCommit;
  worktree: string;
  host: Host;
  /** The commit HEAD is at, among those loaded; undefined if it isn't. */
  head?: string;
  /** Reads the Log again, as Refresh: after an action changed what it shows (a tag made). */
  refresh: () => Promise<void>;
}

/** Shows a commit in the Log (the Git tool window shown by the caller), its file selected. */
export function showInLog(hash: string, path: string): void {
  wanted.set({ hash, path });
}

/**
 * IntelliJ's Go To Hash/Branch/Tag (`GoToHashOrRefAction`, `GoToHashOrRefPopup`): a hash, or a
 * branch's or tag's name, typed, the branches and tags that hold it suggested; the commit selected,
 * the filters cleared if they hide it (as a commit shown from an annotation); "x not found" if git
 * knows of none. IntelliJ's is a popup; here a dialog (Claude's, open to change), its label without
 * the ellipsis as IntelliJ's.
 */
async function goToRef(log: Log, branches: Branches): Promise<void> {
  const tags = (await log.host
    .request('git.tags', { path: log.worktree })
    .catch((error: unknown) => {
      console.error('Reading the tags failed', error);
      return [];
    })) as string[];
  const names = [...branches.branches.peek().map((b) => branchName(b.ref)), ...tags];
  const typed = signal('');
  const reference = await openDialog<string>({
    title: 'Go To Hash/Branch/Tag',
    width: 420,
    ok: {
      label: 'OK',
      enabled: () => typed.get().trim() !== '',
      accept: () => typed.peek().trim(),
    },
    content: () => (
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">Enter hash or branch/tag name:</span>
        {branchField(typed, () => names, { label: 'Hash or name', placeholder: () => '' })}
      </label>
    ),
  }).result;
  if (reference === undefined) return;
  await navigate(log, reference);
}

/** Selects the commit `revision` names in the Log; says so if it isn't there, by `name`. */
async function navigate(log: Log, revision: string, name = revision): Promise<void> {
  const hash = (await log.host.request('git.resolveRevision', {
    path: log.worktree,
    revision,
  })) as string | null;
  if (hash === null || !(await log.select(hash))) {
    notifications.notify({ title: `${name} not found`, type: 'warning' });
  }
}

/** HEAD before and after an update or a merge: the host's. */
export interface HashRange {
  start: string;
  end: string;
}

/** What the Log is asked to show (View Commits' range, Show History's file), taken as it shows. */
const wantedView = signal<((log: Log) => Promise<void>) | undefined>(undefined);

/** Shows the Git tool window: given by `setupLog`. */
let showLog: () => void;

/**
 * View Commits, after an update, a pull or a merge: the Git tool window shown, its Log's commits
 * those between (IntelliJ's `GitUpdateInfoAsLog`).
 */
export function viewCommits(range: HashRange): void {
  wantedView.set((log) => log.showRange(range));
  showLog();
}

/**
 * Git → Current File → Show History: the Git tool window shown, its Log the commits of HEAD that
 * change the file (`path`, from the repository's top), as IntelliJ's file history.
 */
export function showHistory(path: string): void {
  wantedView.set((log) => log.showHistory(path));
  showLog();
}

/** The Log's commands and shortcuts; `show` shows the Git tool window. */
export function setupLog(services: MenuServices, show: () => void): void {
  const { commands, keymap, menus } = services;
  showLog = show;
  commands.register({
    id: 'log.refresh',
    label: '&Refresh',
    icon: 'refresh',
    enabled: (c) => here(c) && shown.get() !== undefined,
    run: () => {
      const { log, branches } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      void refresh(log, branches);
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
  commands.register({
    id: 'log.goToRef',
    label: 'Go To Hash/Branch/Tag',
    icon: 'search',
    enabled: (c) => here(c) && shown.get() !== undefined,
    run: () => {
      const { log, branches } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      void goToRef(log, branches);
    },
  });
  // IntelliJ's takes Find's shortcut: Ctrl+F, Cmd+F on macOS.
  keymap?.bindDefault('Mod+F', 'log.goToRef');
  // The branches pane's toolbar's (IntelliJ's BranchesDashboardActions): the Log at the commit
  // HEAD or the branch selected is at, and the pane's groups opened or closed.
  commands.register<BranchesContext | undefined>({
    id: 'log.branches.navigate',
    label: 'Navigate Log to Selected Branch Head',
    icon: 'locate',
    enabled: (c) => c?.selection !== undefined && shown.get() !== undefined,
    run: (c) => {
      const { log } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      const selection = (c as BranchesContext).selection as NonNullable<BranchesSelection>;
      if (selection.kind === 'head') void navigate(log, 'HEAD');
      else void navigate(log, selection.ref, branchName(selection.ref));
    },
  });
  // The pane hidden, as IntelliJ's (`Git.Log.Hide.Branches`): a stripe shows it again.
  commands.register({
    id: 'log.branches.hide',
    label: 'Hide Git Branches',
    icon: 'arrowCollapse',
    enabled: () => shown.get() !== undefined && branchesShown.get(),
    run: () => {
      showBranches(false);
    },
  });
  // The pane's settings, in its gear's menu as IntelliJ's (`Git.Log.Branches.Settings`): what a
  // single click does, one or neither; then how the branches are grouped.
  const SETTINGS_MENU = 'log/branchesSettings';
  menus.contribute({ menu: SETTINGS_MENU, item: { heading: 'On Single Click' }, group: 'a' });
  for (const [mode, label] of [
    ['filter', 'Update Branch Filter'],
    ['navigate', 'Navigate Log to Branch Head'],
  ] as const) {
    const id = `log.branches.onSelection.${mode}`;
    commands.register({
      id,
      label,
      checked: () => paneSettings.onSelection.get() === mode,
      run: () => {
        paneSettings.onSelection.set(paneSettings.onSelection.peek() === mode ? undefined : mode);
        savePaneSettings();
      },
    });
    menus.contribute({ menu: SETTINGS_MENU, item: { command: id }, group: 'a' });
  }
  commands.register({
    id: 'log.branches.groupByDirectory',
    label: 'Group by Directory',
    checked: () => paneSettings.byDirectory.get(),
    run: () => {
      paneSettings.byDirectory.set(!paneSettings.byDirectory.peek());
      savePaneSettings();
      void shown.peek()?.branches.model.refresh();
    },
  });
  menus.contribute({
    menu: SETTINGS_MENU,
    item: { command: 'log.branches.groupByDirectory' },
    group: 'b',
  });
  for (const [id, label, open] of [
    ['log.branches.expandAll', 'Expand All', true],
    ['log.branches.collapseAll', 'Collapse All', false],
  ] as const) {
    commands.register({
      id,
      label,
      icon: open ? 'expandAll' : 'collapseAll',
      enabled: () => shown.get() !== undefined,
      run: () => {
        const { model } = (shown.peek() as NonNullable<ReturnType<typeof shown.peek>>).branches;
        if (open) void model.expandAll();
        else model.collapseAll();
      },
    });
  }
  // A commit's menu, first in IntelliJ's (Vcs.Log.ContextMenu): the full hash, as its own copies.
  commands.register<LogCommitContext>({
    id: 'log.copyRevision',
    label: 'Copy Revision Number',
    run: (c) => navigator.clipboard.writeText(c.commit.hash),
  });
  menus.contribute({ menu: 'log/commit', item: { command: 'log.copyRevision' }, group: 'a' });
  // Last in IntelliJ's commit menu, after Git's; Right and Left while the commits have the keyboard.
  for (const [id, parent] of [
    ['log.goToChild', false],
    ['log.goToParent', true],
  ] as const) {
    /** The commit right-clicked, or with the keys, the one selected. */
    const target = (context: unknown) => {
      const at = shown.peek();
      const commit =
        (context as Partial<LogCommitContext> | undefined)?.commit ??
        (document.activeElement?.closest('.playground-log__list') == null
          ? undefined
          : selectedCommit()?.commit);
      return at && commit && { log: at.log, commit };
    };
    commands.register({
      id,
      label: parent ? 'Go to Parent Commit' : 'Go to Child Commit',
      enabled: (context) => {
        const at = target(context);
        return at !== undefined && at.log.adjacent(at.commit, parent).length > 0;
      },
      run: (context) => {
        const at = target(context);
        return at && goToAdjacent(services, at.log, at.commit, parent);
      },
    });
    menus.contribute({ menu: 'log/commit', item: { command: id }, group: 'z' });
  }
  keymap?.bindDefault('ArrowRight', 'log.goToParent');
  keymap?.bindDefault('ArrowLeft', 'log.goToChild');
}

const ADJACENT = 'log/adjacent';

/** What the Go to Parent or Child popup's items act on: the commits to choose from, and their Log. */
interface AdjacentContext {
  log: Log;
  rows: readonly string[];
  /** Each one's item, as IntelliJ's names it. */
  texts: readonly string[];
}

/** A commit as IntelliJ's popup names it: hash, subject (to 40 characters), author, date and time. */
function adjacentText(commit: LogCommit): string {
  const date = new Date(commit.time);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${commit.hash.slice(0, 8)} "${shortenText(commit.subject)}" by ${commit.author} on ${date.toLocaleDateString()} at ${time}`;
}

/** Selects a commit, loading pages until it's there, and gives the commits the keyboard. */
async function goTo(log: Log, hash: string): Promise<void> {
  if (!(await log.find(hash))) return;
  log.model.select(hash);
  document.querySelector<HTMLElement>('.playground-log__list .cerebro-tree')?.focus();
}

/**
 * The popup's items registered so far, one command for each place in it: they stay, as a menu runs
 * its item's command once it's closed.
 */
let adjacentItems = 0;

/**
 * IntelliJ's Go to Parent Commit and Go to Child Commit (`GoToParentOrChildAction`): the one
 * selected, the commits given the keyboard; of several, a numbered popup at the selected row
 * ("Select Parent to Navigate") to choose from.
 */
async function goToAdjacent(
  services: MenuServices,
  log: Log,
  commit: LogCommit,
  parent: boolean,
): Promise<void> {
  const rows = log.adjacent(commit, parent);
  if (rows.length === 1) {
    await goTo(log, rows[0] as string);
    return;
  }
  const { commands, menus } = services;
  for (; adjacentItems < rows.length; adjacentItems++) {
    const i = adjacentItems;
    commands.register<AdjacentContext>({
      id: `log.adjacent.${String(i)}`,
      label: 'Go to Commit',
      // Only from the popup: not among Find Action's.
      enabled: (context?: AdjacentContext) => context?.rows[i] !== undefined,
      text: (context) => numbered(i, context.texts[i] as string),
      run: (context) => goTo(context.log, context.rows[i] as string),
    });
  }
  const texts = rows.map((hash) => {
    const loaded = log.commit(hash);
    return (loaded ? adjacentText(loaded) : hash.slice(0, 8)).replaceAll('&', '&&');
  });
  const contributions: Disposable[] = [
    menus.contribute({
      menu: ADJACENT,
      item: { heading: parent ? 'Select Parent to Navigate' : 'Select Child to Navigate' },
    }),
    ...rows.map((_, i) =>
      menus.contribute({
        menu: ADJACENT,
        item: { command: `log.adjacent.${String(i)}` },
        order: i,
      }),
    ),
  ];
  const row = document
    .querySelector('.playground-log__list .cerebro-tree-row--selected')
    ?.getBoundingClientRect();
  openMenu(
    services,
    ADJACENT,
    { x: row?.left ?? 0, y: row?.bottom ?? 0 },
    {
      context: { log, rows, texts } satisfies AdjacentContext,
      focusFirst: true,
      onClose: () => {
        for (const c of contributions) c.dispose();
      },
    },
  );
}

type BranchChoice = PickerItem & { branch: BranchFilter | undefined };

/** The Branch filter's popup: All, HEAD, then the local and remote branches. */
function pickBranch(button: HTMLElement, log: Log, branches: Branches, platform: Platform) {
  const chosen = (branch: BranchFilter | undefined) =>
    log.branch.peek() === branch ? { icon: () => icon('check') } : {};
  const handle = openFilterPicker<BranchChoice>(
    {
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
    },
    platform,
    () => void log.filter(undefined),
  );
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

/** Where whether the Log shows its branches is kept: one for every repository. */
const BRANCHES_SHOWN = 'cerebro.log.showBranches';

/** Whether the Log shows its branches pane, as kept; shown to start with, as IntelliJ's. */
export function readBranchesShown(): boolean {
  try {
    return localStorage.getItem(BRANCHES_SHOWN) !== 'false';
  } catch {
    return true;
  }
}

/** IntelliJ's `Show.Git.Branches`, a property of the Log's tab. */
const branchesShown = signal(readBranchesShown());

function showBranches(show: boolean): void {
  branchesShown.set(show);
  try {
    localStorage.setItem(BRANCHES_SHOWN, String(show));
  } catch {
    // Not kept: it applies until the page is reloaded.
  }
}

/** Where the text filter's history is kept: one for every repository, as IntelliJ's. */
const TEXT_HISTORY = 'cerebro.log.textHistory';

/** The text filter's history, the latest first. */
export function textHistory(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(TEXT_HISTORY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((text) => typeof text === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Adds text to the history, as IntelliJ's SearchTextField: trimmed, none if blank, the same in
 * another case moved first (left as it was if first already), five at most.
 */
export function rememberText(text: string): void {
  const item = text.trim();
  const history = textHistory();
  const same = (other: string) => other.toLowerCase() === item.toLowerCase();
  if (item === '' || (history[0] !== undefined && same(history[0]))) return;
  try {
    localStorage.setItem(
      TEXT_HISTORY,
      JSON.stringify([item, ...history.filter((other) => !same(other))].slice(0, 5)),
    );
  } catch {
    // Not remembered: the history stays as it was.
  }
}

/**
 * The text filter, as IntelliJ's: the text typed applies on Enter, or as the field loses the focus
 * changed; emptied, or cleared with its button, it's off. Regex and Match Case sit in it. Its
 * history (SearchTextField's): what Enter applied, in a popup on Alt+Down or a click on the
 * magnifier, a choice put in the field to apply; Alt+Up goes round it in the field.
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
  let search: HTMLElement | undefined;
  const put = (text: string) => {
    (field as HTMLInputElement).value = text;
    typed.set(text);
  };
  const showHistory = () => {
    rememberText(typed.peek());
    const history = textHistory();
    if (history.length === 0) return;
    const below = search as HTMLElement;
    const handle = openPicker({
      label: 'Search History',
      placeholder: 'Search',
      position: { below },
      owner: below,
      items: (query) =>
        fuzzyFilter(
          history.map((label) => ({ label })),
          query,
        ),
    });
    void handle.result.then((choice) => {
      if (!choice) return;
      put(choice.label);
      rememberText(choice.label);
    });
  };
  // Where Alt+Up is in the history, as IntelliJ's myCurrentHistoryIndex.
  let at = 0;
  const previous = () => {
    if (!textHistory().includes(typed.peek())) rememberText(typed.peek());
    const history = textHistory();
    if (history.length < 2) return;
    at = (at - 1 + history.length) % history.length;
    put(history[at] as string);
  };
  // The filter changed from elsewhere (cleared, to show a commit it left out): the field follows.
  // Never at first, when they agree: by then the field is there.
  const following = effect(() => {
    const text = log.text.get() ?? '';
    if (!same()) {
      typed.set(text);
      (field as HTMLInputElement).value = text;
    }
    return undefined;
  });
  onCleanup(() => {
    following.dispose();
  });
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
    <div
      class="playground-log__search"
      ref={(element: HTMLElement) => {
        search = element;
      }}
    >
      <span
        class="playground-log__search-history"
        on:mousedown={(event) => {
          // The field keeps the focus, as IntelliJ's, until the popup takes it.
          event.preventDefault();
          // Only once there's a history, as IntelliJ's.
          if (textHistory().length > 0) showHistory();
        }}
      >
        {icon('search')}
      </span>
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
          if (event.key === 'Enter') {
            rememberText(typed.peek());
            apply();
          } else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            if (event.key === 'ArrowDown') showHistory();
            else previous();
          }
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
/** The Branch filter's: a branch's name, or a range's ends shortened (Claude's, open to change). */
const branchText = (branch: BranchFilter) =>
  branch.includes('..')
    ? branch
        .split('..')
        .map((hash) => hash.slice(0, 8))
        .join('..')
    : branchName(branch);

const filterText = <T,>(name: string, value: T | undefined, text: (value: T) => string) =>
  value === undefined ? name : `${name}: ${text(value)}`;

/** What clears a filter, while it's on. */
const clearing = (value: unknown, clear: () => void) => (value === undefined ? undefined : clear);

/**
 * Above the commits, as IntelliJ's: the text filter; the Branch, User, Date and Paths filters, each with
 * an X that clears it while it's on; then Refresh; those that don't fit are hidden behind a ».
 */
function LogToolbar(props: {
  services: MenuServices;
  log: Log;
  branches: Branches;
  name: string;
  worktree: string;
}): Node {
  const { services, log, branches } = props;
  const platform = services.keymap?.platform ?? 'other';
  return (
    <div class="playground-log__toolbar" role="toolbar" aria-label="Log">
      <TextFilterField services={services} log={log} name={props.name} />
      <ToolbarRow
        label="Filters and actions"
        items={() => [
          <ToolbarDropdown
            services={services}
            label="Branch"
            text={() => filterText('Branch', log.branch.get(), branchText)}
            tooltip={() => {
              const branch = log.branch.get();
              if (branch === undefined) return '';
              return branch.includes('..') ? branch : branchName(branch);
            }}
            popup={(button) => pickBranch(button, log, branches, platform)}
            clear={() => clearing(log.branch.get(), () => void log.filter(undefined))}
          />,
          <ToolbarDropdown
            services={services}
            label="User"
            text={() => filterText('User', log.users.get(), usersText)}
            tooltip={() => {
              const users = log.users.get();
              return users ? usersTooltip(users) : '';
            }}
            popup={(button) => {
              void log.readAuthors();
              return pickUser(button, {
                worktree: props.worktree,
                platform,
                authors: () => log.authors.get(),
                current: () => log.users.peek(),
                choose: (users) => void log.filterUsers(users),
              });
            }}
            clear={() => clearing(log.users.get(), () => void log.filterUsers(undefined))}
          />,
          <ToolbarDropdown
            services={services}
            label="Date"
            text={() => filterText('Date', log.period.get(), periodText)}
            tooltip={() => ''}
            popup={(button) =>
              pickDate(button, {
                platform,
                current: () => log.period.peek(),
                choose: (period) => void log.filterPeriod(period),
              })
            }
            clear={() => clearing(log.period.get(), () => void log.filterPeriod(undefined))}
          />,
          <ToolbarDropdown
            services={services}
            label="Paths"
            text={() => filterText('Paths', log.paths.get(), pathsText)}
            tooltip={() => {
              const paths = log.paths.get();
              return paths ? pathsTooltip(paths) : '';
            }}
            popup={(button) =>
              pickPaths(button, {
                worktree: props.worktree,
                platform,
                list: async (folder) =>
                  (await log.host.request('fs.list', {
                    path: folder ?? props.worktree,
                  })) as FileNode[],
                current: () => log.paths.peek(),
                choose: (paths) => void log.filterPaths(paths),
              })
            }
            clear={() => clearing(log.paths.get(), () => void log.filterPaths(undefined))}
          />,
          <ToolbarButton
            commands={services.commands}
            command="log.refresh"
            icon={icon('refresh')}
            shortcut={shortcutOf(services, 'log.refresh')}
            context={() => FROM_LOG}
          />,
          // IntelliJ's Vcs.Log.Toolbar, between Refresh and the presentation settings.
          <ToolbarButton
            commands={services.commands}
            command="log.cherryPick"
            icon={icon('cherryPick')}
            context={() => FROM_LOG}
          />,
          // After the presentation settings in IntelliJ's (`Vcs.Log.ToolbarGroup`).
          <ToolbarButton
            commands={services.commands}
            command="log.goToRef"
            icon={icon('search')}
            shortcut={shortcutOf(services, 'log.goToRef')}
            context={() => FROM_LOG}
          />,
        ]}
      />
    </div>
  );
}

/**
 * The branches pane's toolbar, down its side as IntelliJ's (`Git.Log.Branches`): what of its
 * actions are here, in its order.
 */
function BranchesToolbar(props: { services: MenuServices; log: Log; branches: Branches }): Node {
  const { services } = props;
  const context = () => branchesContext(props.log, props.branches);
  const button = (command: string, name: string) => (
    <ToolbarButton
      commands={services.commands}
      command={command}
      icon={icon(name)}
      shortcut={shortcutOf(services, command)}
      context={context}
    />
  );
  return (
    <div
      class="playground-log__branches-toolbar"
      role="toolbar"
      aria-label="Branches"
      aria-orientation="vertical"
    >
      {button('log.branches.hide', 'arrowCollapse')}
      <span class="playground-log__branches-separator" />
      {button('log.branches.newBranch', 'add')}
      {button('log.branches.update', 'update')}
      {button('log.branches.delete', 'delete')}
      {button('vcs.fetch', 'fetch')}
      {button('log.branches.navigate', 'locate')}
      <span class="playground-log__branches-separator" />
      <button
        type="button"
        class="cerebro-toolbar-button"
        aria-label="Branches Pane Settings"
        data-menu="log/branchesSettings"
        ref={tooltip({ text: () => 'Branches Pane Settings', placement: 'right' })}
        on:click={(event) => {
          const anchor = event.currentTarget as HTMLElement;
          openMenu(
            services,
            'log/branchesSettings',
            { anchor, placement: 'right' },
            { owner: anchor, context: anchor },
          );
        }}
      >
        {icon('settings')}
      </button>
      {button('log.branches.expandAll', 'expandAll')}
      {button('log.branches.collapseAll', 'collapseAll')}
    </div>
  );
}

/** The Git tool window's Log, of the active environment's repository. */
export function GitLogView(props: {
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  // Read through these, the Log is made again only when they change: the worktrees' list, which
  // they read, is read again after every checkout.
  const hostOf = computed(() => {
    const env = active();
    return env && hostFor(env.id);
  });
  const repository = computed(() => gitRepository.get());
  return (
    <div class="playground-log">
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        const host = hostOf.get();
        if (!host)
          return <p class="playground-project__empty">The log shows in the desktop app.</p>;
        if (!repository.get()) {
          return <p class="playground-project__empty">Not a git repository</p>;
        }
        const log = new Log(host, env.id);
        const branches = new Branches(host, env.id);
        const reload = () => {
          void refresh(log, branches);
        };
        const first = refresh(log, branches);
        shown.set({ log, branches });
        // Taken once the first page is read; its file selected once its changes are.
        const taking = effect(() => {
          const want = wanted.get();
          if (!want) return undefined;
          wanted.set(undefined);
          // The file first: the commit's changes, once it's selected, select it as they're read.
          log.file.set(want);
          void first.then(async () => {
            if (await log.select(want.hash)) return;
            log.file.set(undefined);
            notifications.notify({
              title: `Commit ${want.hash.slice(0, 8)} isn’t in the log`,
              type: 'warning',
            });
          });
          return undefined;
        });
        // A single click on a branch, as the pane's settings say (IntelliJ's
        // BranchesDashboardTreeController): the Branch filter set to it (All for a directory), or
        // the Log taken to its head.
        let clicked = untracked(() => branches.model.selected);
        const selecting = effect(() => {
          const key = branches.model.selected;
          if (key === clicked) return undefined;
          clicked = key;
          untracked(() => {
            const mode = paneSettings.onSelection.peek();
            const at = branches.selection();
            const ref = at && (at.kind === 'head' ? 'HEAD' : at.ref);
            if (mode === 'filter') void log.filter(ref);
            else if (mode === 'navigate' && ref !== undefined) {
              void navigate(log, ref, ref === 'HEAD' ? ref : branchName(ref));
            }
          });
          return undefined;
        });
        // As IntelliJ's Log follows the repository: read again when the refs change, whatever
        // changed them (Cerebro, a terminal, an agent), as the repository's state is read.
        let refs: string | undefined;
        const following = effect(() => {
          const now = stateOf(env.id).refs;
          if (now === undefined || now === refs) return undefined;
          const seen = refs !== undefined;
          refs = now;
          if (seen) reload();
          return undefined;
        });
        const viewing = effect(() => {
          const view = wantedView.get();
          if (!view) return undefined;
          wantedView.set(undefined);
          void first.then(() => view(log));
          return undefined;
        });
        window.addEventListener('focus', reload);
        onCleanup(() => {
          taking.dispose();
          following.dispose();
          selecting.dispose();
          viewing.dispose();
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
              onContextMenu={(event, commit) => {
                openContextMenu(
                  props.services,
                  'log/commit',
                  event,
                  commitContext(log, branches, commit),
                );
              }}
            />
          );
        };
        // What takes the keyboard as the window is activated, as IntelliJ's commits table.
        const commits = (
          <div class="playground-log__list" data-focus-first>
            {list}
          </div>
        ) as HTMLElement;
        const pane = (
          <div class="playground-log__pane">
            <CommitPane log={log} host={host} worktree={env.id} open={props.open} />
          </div>
        ) as HTMLElement;
        pane.style.width = `${String(PANE_WIDTH)}px`;
        const side = (
          <div class="playground-log__branches">
            <BranchesToolbar services={props.services} log={log} branches={branches} />
            <BranchesPane
              branches={branches}
              filter={(branch) => {
                void log.filter(branch);
              }}
            />
          </div>
        ) as HTMLElement;
        side.style.width = `${String(BRANCHES_WIDTH)}px`;
        const splitter = (
          <Splitter
            line="vertical"
            start={() => side.offsetWidth}
            onDrag={(width, delta) => {
              side.style.width = `${String(Math.max(0, width + delta))}px`;
            }}
          />
        );
        // Hidden, a stripe in its toolbar's place shows it again, as IntelliJ's ExpandStripeButton.
        const stripe = (
          <button
            type="button"
            class="playground-log__branches-stripe"
            title="Branches"
            on:click={() => {
              showBranches(true);
            }}
          >
            {icon('arrowExpand')}
            <span class="playground-log__branches-stripe-text">Branches</span>
          </button>
        );
        return [
          () => {
            if (branchesShown.get()) return [side, splitter];
            // What had the keyboard goes with the pane: the commits take it.
            if (side.contains(document.activeElement)) {
              commits.querySelector<HTMLElement>('[tabindex]')?.focus();
            }
            return stripe;
          },
          <div class="playground-log__commits">
            <LogToolbar
              services={props.services}
              log={log}
              branches={branches}
              name={env.name}
              worktree={env.id}
            />
            {commits}
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
