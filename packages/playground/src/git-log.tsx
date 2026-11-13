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
// its first eight), and the author's and date's columns sized from what they show
// (VcsLogGraphTable). Claims: the lane's width, the dot's size, and the dates as "Today 10:15" or
// the system's short date and time.

import { formatSequence, type Platform } from '@cerebro-ide/commands';
import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { computed, effect, signal, untracked, type Disposable } from '@cerebro-ide/reactive';
import type { Tab } from '@cerebro-ide/layout';
import { Splitter } from '@cerebro-ide/ui-layout';
import { openContextMenu, openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, showSearchHistory, type PickerItem } from '@cerebro-ide/ui-popup';
import { ToolbarButton, ToolbarDropdown, ToolbarRow } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { isFavorite, setFavorite } from './branch-favorites.js';
import {
  changeContent,
  diffTab,
  fileTab,
  folderContent,
  replacing,
  revisionTab,
  type Change,
  type Range,
} from './changes.js';
import { createPatch, patchPaths } from './create-patch.js';
import { directoryTree } from './directory-tree.js';
import { saveBeforeGit } from './documents.js';
import { formatCommitDate } from './dates.js';
import { active, gitRepository, hostFor, showError, type Host } from './environments.js';
import { Toggle } from './find.js';
import { branchField } from './git-options.js';
import { icon } from './icons.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { numbered } from './select-in.js';
import { refreshAll } from './shelf.js';
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
import { SearchHistory } from './search-history.js';

/** A commit, as the host's `git.log` gives it. */
export interface LogCommit {
  hash: string;
  parents: string[];
  /** In a filtered log, the graph's parents: its nearest ancestors listed. */
  joins?: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  body: string;
  refs: string[];
}

/**
 * How the graph is laid out, as IntelliJ's Graph Options (`PermanentGraph.Options`), one at a time:
 * by commit date (IntelliJ's default), topologically, or by first parents alone (`git.log`'s
 * `graph`).
 */
export type LogGraph = 'date' | 'topological' | 'firstParent';

const GRAPH_KEY = 'cerebro.log.graph';

function readGraph(): LogGraph {
  try {
    const stored = localStorage.getItem(GRAPH_KEY);
    return stored === 'topological' || stored === 'firstParent' ? stored : 'date';
  } catch {
    return 'date';
  }
}

function saveGraph(graph: LogGraph): void {
  try {
    localStorage.setItem(GRAPH_KEY, graph);
  } catch {
    // Not kept, where storage can't be had.
  }
}

/** A commit's parents in the graph: those it's joined to in a filtered log, else its own. */
const joined = (commit: LogCommit) => commit.joins ?? commit.parents;

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
  noMerges?: boolean;
  paths?: readonly string[];
}

/** The authors, and who "me" is: the host's `git.authors`. */
export interface Authors {
  authors: Author[];
  me: Author | undefined;
}

/** What the Log has loaded, and loads. */
export class Log {
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
  /** Graph Options' No Merges, a filter as IntelliJ's (its parent filter): off to start with. */
  readonly noMerges = signal(false);
  /** How the graph is laid out, Graph Options' other choice: kept, as IntelliJ's. */
  readonly graphOptions = signal<LogGraph>(readGraph());
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
    if (this.noMerges.peek()) filter.noMerges = true;
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
      ...(this.graphOptions.peek() === 'date' ? {} : { graph: this.graphOptions.peek() }),
    })) as LogCommit[];
  }

  private take(page: readonly LogCommit[], from: readonly LogCommit[]): void {
    const lines = page.map((commit) => ({ hash: commit.hash, parents: joined(commit) }));
    for (const [i, row] of this.layout.add(lines).entries()) {
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

  /** Shows the commits that aren't merges alone, or all. */
  filterMerges(noMerges: boolean): Promise<void> {
    this.noMerges.set(noMerges);
    return this.refilter();
  }

  /** Lays the graph out another way, kept for the Logs read from now on. */
  layOut(graph: LogGraph): Promise<void> {
    this.graphOptions.set(graph);
    saveGraph(graph);
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
  showHistory(path: string, revision = 'HEAD'): Promise<void> {
    return this.showOnly(revision, [path]);
  }

  /** The branch's commits that change the paths (any, if undefined), the other filters cleared. */
  private showOnly(branch: BranchFilter, paths: readonly string[] | undefined): Promise<void> {
    this.branch.set(branch);
    this.text.set(undefined);
    this.users.set(undefined);
    this.period.set(undefined);
    this.paths.set(paths);
    this.noMerges.set(false);
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
    this.noMerges.set(false);
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
      return commits.filter((c) => joined(c).includes(commit.hash)).map((c) => c.hash);
    }
    const at = (hash: string) => {
      const index = this.indexOf(hash);
      return index < 0 ? commits.length : index;
    };
    return [...joined(commit)].sort((a, b) => at(a) - at(b));
  }

  /** Whether any filter applies. */
  private filtered(): boolean {
    return (
      this.noMerges.peek() ||
      [this.branch, this.text, this.users, this.period, this.paths].some(
        (filter) => filter.peek() !== undefined,
      )
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

/** The space between a commit's subject and its labels, and between labels (the CSS's). */
const LABEL_GAP = 8;
/** A label's mark's width, and how far each mark after it in a combined mark goes (the CSS's). */
const MARK = 8;
const MARK_STEP = 3;

/**
 * The room the refs' labels have in a subject `column` pixels wide, whose message takes `message`
 * (IntelliJ's GraphCommitCellRenderer.getAvailableWidth): what the message leaves, and at least
 * half the column, or all but 80 pixels of it, the message cut short to make it.
 */
export function labelsRoom(column: number, message: number): number {
  return Math.max(0, column - message, column / 2, column - 80);
}

/**
 * How many labels, `widths` wide, show with their names in `room`; the rest show as one mark,
 * `rest(i)` wide for those from the i-th on (IntelliJ's LabelPainter): each while it fits with
 * room for the mark of those after it.
 */
export function fittingLabels(
  widths: readonly number[],
  rest: (from: number) => number,
  room: number,
): number {
  let used = 0;
  for (const [i, width] of widths.entries()) {
    const next = used + (i > 0 ? LABEL_GAP : 0) + width;
    const after = i < widths.length - 1 ? LABEL_GAP + rest(i + 1) : 0;
    if (next + after > room) return i;
    used = next;
  }
  return widths.length;
}

/**
 * The kinds a combined mark shows, as IntelliJ's LabelPainter.getColors: each once, in order,
 * twice if more than one ref is of it.
 */
export function markKinds(refs: readonly Ref[]): Ref['kind'][] {
  const counts = new Map<Ref['kind'], number>();
  for (const { kind } of refs) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts].flatMap(([kind, count]) => (count > 1 ? [kind, kind] : [kind]));
}

/**
 * A commit's subject: its message, then the labels of its refs, as many as fit with their names
 * and the rest as one mark (with the first's name, cut short, when none fits), as IntelliJ's.
 * They're fitted again as the subject's width changes.
 */
function Subject(props: { commit: LogCommit; log: Log }): Node {
  const refs = refsOf(props.commit.refs);
  const message = (<Message message={props.commit.subject} log={props.log} />) as HTMLElement;
  const labels = refs.map(
    (ref) =>
      (
        <span class={`playground-log__ref playground-log__ref--${ref.kind}`}>{ref.name}</span>
      ) as HTMLElement,
  );
  const rest = (<span class="playground-log__rest" hidden />) as HTMLElement;
  const subject = (
    <span class="playground-log__subject">
      {message}
      {labels}
      {rest}
    </span>
  ) as HTMLElement;
  if (refs.length === 0) return subject;
  const fit = () => {
    for (const label of labels) label.hidden = false;
    rest.hidden = true;
    const widths = labels.map((label) => label.getBoundingClientRect().width);
    const room = labelsRoom(subject.clientWidth, message.scrollWidth + LABEL_GAP);
    const shown = fittingLabels(
      widths,
      (from) => MARK + (markKinds(refs.slice(from)).length - 1) * MARK_STEP,
      room,
    );
    for (const [i, label] of labels.entries()) label.hidden = i >= shown;
    if (shown === refs.length) return;
    rest.replaceChildren(
      <span class="playground-log__marks">
        {markKinds(refs.slice(shown)).map((kind) => (
          <span class={`playground-log__mark playground-log__mark--${kind}`} />
        ))}
      </span>,
      ...(shown === 0
        ? [<span class="playground-log__rest-name">{(refs[0] as Ref).name}</span>]
        : []),
    );
    rest.style.maxWidth = `${String(room)}px`;
    rest.title = refs
      .slice(shown)
      .map((ref) => ref.name)
      .join(', ');
    rest.hidden = false;
  };
  const observer = new ResizeObserver(fit);
  observer.observe(subject);
  onCleanup(() => {
    observer.disconnect();
  });
  return subject;
}

/**
 * How many rows a column is measured from, and the widest it's made: IntelliJ's
 * (VcsLogGraphTable's MAX_ROWS_TO_CALC_WIDTH and MAX_DEFAULT_DYNAMIC_COLUMN_WIDTH).
 */
const MEASURED_ROWS = 1000;
const MAX_COLUMN = 300;

/**
 * A column's width from what its rows show, as IntelliJ's (VcsLogStringCellRenderer): the widest of
 * the first rows' texts with a `*` after it, at most 300 pixels.
 */
export function columnWidth(texts: readonly string[], measure: (text: string) => number): number {
  const widths = texts.slice(0, MEASURED_ROWS).map((text) => measure(`${text}*`));
  return Math.min(MAX_COLUMN, Math.ceil(Math.max(0, ...widths)));
}

/**
 * Sizes the author's and date's columns of the commits listed in `element` from what they show, as
 * IntelliJ's, again as they change.
 */
export function sizeColumns(element: HTMLElement, commits: () => readonly LogCommit[]): Disposable {
  const metrics = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  const size = (shown: readonly LogCommit[]) => {
    metrics.font = getComputedStyle(element).font;
    const measure = (text: string) => metrics.measureText(text).width;
    for (const [name, texts] of [
      ['author', shown.map((commit) => commit.author)],
      ['date', shown.map((commit) => formatCommitDate(commit.time))],
    ] as const) {
      element.style.setProperty(
        `--playground-log-${name}`,
        `${String(columnWidth(texts, measure))}px`,
      );
    }
  };
  const sizing = effect(() => {
    size(commits());
    return undefined;
  });
  // Its font is known once it's on the page: measured again then.
  const observer = new ResizeObserver(() => {
    size(untracked(commits));
  });
  observer.observe(element);
  return {
    dispose() {
      sizing.dispose();
      observer.disconnect();
    },
  };
}

/** A commit's row: its graph and subject, the refs at it, its author and date. */
export function CommitRow(props: { commit: LogCommit; log: Log }) {
  const { commit, log } = props;
  // Drawn near the end of what's loaded: the next page loads.
  if (log.indexOf(commit.hash) >= log.commits.peek().length - AHEAD) log.more();
  return [
    <Graph row={log.graph.get(commit.hash) as GraphRow} />,
    <Subject commit={commit} log={log} />,
    <span class="playground-log__author" title={commit.email}>
      {commit.author}
    </span>,
    <span class="playground-log__date">{formatCommitDate(commit.time)}</span>,
  ];
}

/** Git's empty tree: what a commit with no parent is compared with (the host's EMPTY_TREE). */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * The commits a commit's changes are between: its first parent and it. A merge's files are those
 * it changes against its other parents too (`otherParents`), each shown against the first, where
 * IntelliJ's diff shows all its parents (not yet).
 */
export const rangeOf = (commit: LogCommit) => ({
  from: commit.parents[0] ?? EMPTY_TREE,
  to: commit.hash,
});

/** A commit's whole message: its subject, then its body. */
export const messageOf = (commit: LogCommit) =>
  commit.body === '' ? commit.subject : `${commit.subject}\n\n${commit.body}`;

/** A commit's author and when, as IntelliJ's details give them, after its short hash. */
const signature = (commit: LogCommit) =>
  `${commit.hash.slice(0, 8)} ${commit.author} <${commit.email}> on ${new Date(
    commit.time,
  ).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;

/**
 * How a commit's files show, kept in the browser's storage:
 * - grouped by directory, as IntelliJ's changes trees are to start with (ChangesTree's
 *   DEFAULT_GROUPING_KEYS), kept apart from the Commit window's, as IntelliJ keeps them;
 * - only those the Log's Paths filter holds, or all (IntelliJ's Show Only Affected Changes, off to
 *   start with: VcsLogUiPropertiesImpl).
 */
const FILES_KEY = 'cerebro.log.files';

export function readFilesSettings(): {
  byDirectory: boolean;
  onlyAffected: boolean;
  toParents: boolean;
} {
  try {
    const stored = JSON.parse(localStorage.getItem(FILES_KEY) ?? '{}') as {
      byDirectory?: unknown;
      onlyAffected?: unknown;
      toParents?: unknown;
    };
    return {
      byDirectory: stored.byDirectory !== false,
      onlyAffected: stored.onlyAffected === true,
      toParents: stored.toParents === true,
    };
  } catch {
    return { byDirectory: true, onlyAffected: false, toParents: false };
  }
}

const filesSettings = readFilesSettings();
const filesByDirectory = signal(filesSettings.byDirectory);
const onlyAffected = signal(filesSettings.onlyAffected);
/** IntelliJ's Show Changes to Parents: a merge's changes against each parent too, under its own. */
const toParents = signal(filesSettings.toParents);

function saveFilesSettings() {
  try {
    localStorage.setItem(
      FILES_KEY,
      JSON.stringify({
        byDirectory: filesByDirectory.peek(),
        onlyAffected: onlyAffected.peek(),
        toParents: toParents.peek(),
      }),
    );
  } catch {
    // Not kept: it still applies until the page is reloaded.
  }
}

/**
 * Whether a change touches one of `paths` (the Paths filter's: a folder's ends with "/"), before
 * or after a rename, as IntelliJ's (FileHistoryUtil.affectsFile and affectsDirectory).
 */
const affects = (change: Change, paths: readonly string[]) =>
  [change.path, change.from].some(
    (path) =>
      path !== undefined && paths.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p)),
  );

/** A file's right-click menu among a commit's files. */
const FILES_MENU = 'log/files';

/** The files' Group By menu, from the button over them. */
const FILES_GROUP_BY = 'log/files/groupBy';
/** Graph Options' menu, from its button after the filters. */
const GRAPH_MENU = 'log/graphOptions';

/**
 * Makes the file at `path` as commit `hash` has it at `source` (where it was, if renamed since),
 * or deletes it where the commit hasn't it, as IntelliJ's Get (`GetVersionAction`): asked first
 * where the file has a change here, untracked or not saved yet too, then the edits saved; then read
 * again.
 */
export async function getRevision(
  host: Host,
  worktree: string,
  hash: string,
  path: string,
  source = path,
): Promise<void> {
  if (!(await replacing(host, worktree, path, 'Get Revision'))) return;
  await saveBeforeGit();
  try {
    await host.request('git.getVersion', {
      path: worktree,
      hash,
      file: path,
      ...(source === path ? {} : { source }),
    });
  } catch (error) {
    // IntelliJ's words.
    showError('Get Revision Content', `Cannot load revision: ${(error as Error).message}`);
  }
  await refreshAll(worktree);
}

/** A commit's files' list, as its commands act on it. */
interface FilesTarget {
  /** The file selected, if any and it can be opened. */
  selected: () => Change | undefined;
  /** Opens the selected file's diff, with one selected. */
  showDiff: () => void;
  /**
   * What the selected file differs between: the commit's, or under "Changes to …" a merge's parent
   * and it. Without `to`, the working tree.
   */
  range: () => Range;
  worktree: string;
  /** Opens a tab: a file, or a diff. */
  open: (tab: Tab) => void;
  /** Applies to the files what the commit changed in one, or undoes it (`reverse`). */
  apply: (change: Change, reverse: boolean) => Promise<void>;
  /** Makes a file as the commit left it: Get from Revision. */
  get: (change: Change) => Promise<void>;
  /** Create Patch… of what the commit changed in one. */
  createPatch: (change: Change) => Promise<void>;
  /** Its rows, which Expand and Collapse All open and close. */
  tree: TreeModel<ChangeNode>;
  /** The Log's Paths filter's paths, which Show Only Affected Changes keeps to; none, if none. */
  affected: () => readonly string[] | undefined;
}

/** The list of a commit's files that has the keyboard, if one has. */
const focusedFiles = signal<FilesTarget | undefined>(undefined);

/** The list a command acts on: the one it came from, else the one with the keyboard. */
const filesOf = (context: unknown) =>
  (context as { files?: FilesTarget } | undefined)?.files ?? focusedFiles.get();

/** Whether a file is selected in a commit's files, not the working tree's. */
const atCommit = (context: unknown) => {
  const files = filesOf(context);
  return files?.range().to !== undefined && files.selected() !== undefined;
};

/** A row of a commit's files: a file's change, or a folder of them. */
/** A file or folder under "Changes to …" has `parent`, the merge's parent its change is against. */
type ChangeNode =
  | { kind: 'file'; change: Change; parent?: string }
  | {
      kind: 'folder';
      path: string;
      name: string;
      count: number;
      children: ChangeNode[];
      parent?: string;
    }
  /** IntelliJ's "Changes to …": a merge's changes against one of its parents. */
  | { kind: 'parent'; hash: string; text: string; children: ChangeNode[] }
  /** IntelliJ's row where a merge has no changes of its own, over its parents'. */
  | { kind: 'note'; text: string };

/** A row's key: a file's is its path, which selects it from outside; under a parent, after it. */
function fileNodeKey(node: ChangeNode): string {
  const under = (parent: string | undefined) => (parent === undefined ? '' : `${parent}:`);
  switch (node.kind) {
    case 'file':
      return `${under(node.parent)}${node.change.path}`;
    case 'folder':
      return `folder:${under(node.parent)}${node.path}`;
    case 'parent':
      return `parent:${node.hash}`;
    case 'note':
      return 'note';
  }
}

/**
 * The files as rows: by directory, all folders open, as IntelliJ's; else as git lists them. Under
 * "Changes to …", `parent` is the merge's parent they're against.
 */
function fileNodes(
  changes: readonly Change[],
  opened: (key: string) => void,
  parent?: string,
): ChangeNode[] {
  const under = parent === undefined ? {} : { parent };
  const file = (change: Change): ChangeNode => ({ kind: 'file', change, ...under });
  if (!filesByDirectory.get()) return changes.map(file);
  return directoryTree<Change, ChangeNode>(changes, (change) => change.path, {
    file,
    folder: (folder) => {
      const node: ChangeNode = { kind: 'folder', ...folder, ...under };
      opened(fileNodeKey(node));
      return node;
    },
  });
}

/** A merge's parents, each with its subject where it's known; none for another commit. */
export const mergeParents = (
  commit: LogCommit,
  find: (hash: string) => LogCommit | undefined,
): MergeParent[] | undefined =>
  commit.parents.length > 1
    ? commit.parents.map((hash) => ({ hash, subject: find(hash)?.subject }))
    : undefined;

/** A merge's parent, as its files name it ("Changes to …"). */
interface MergeParent {
  hash: string;
  subject?: string | undefined;
}

/**
 * The files changed between two commits, as a tree: the Log's selected commit's, and the Push
 * dialog's. With `open`, Enter or a double click opens a file's diff, and F4 the file itself, as
 * IntelliJ's Jump to Source.
 */
export function CommitFiles(props: {
  services: MenuServices;
  host: Host;
  worktree: string;
  /** Without `to`: from a commit to the working tree. */
  range: Range;
  /** What the tree is, for a screen reader. */
  label: string;
  /** What shows when nothing differs; nothing, if not given. */
  empty?: string;
  /**
   * A merge's parents: its files are only those it changes against all of them, as IntelliJ lists
   * a merge's ("No merged conflicts" when there are none); under Show Changes to Parents, its
   * changes against each parent too.
   */
  parents?: readonly MergeParent[] | undefined;
  open?: (tab: Tab, chain?: readonly string[]) => void;
  /** The file to select once they're read. */
  selected?: string | undefined;
  /** Given, as it shows, what reads the selected file's change (reactively). */
  selection?: (selected: () => Change | undefined) => void;
  /** A file's context menu: the file is selected first. */
  onContextMenu?: (event: MouseEvent, change: Change) => void;
  /** The Log's Paths filter's paths, read reactively: Show Only Affected Changes keeps to them. */
  affected?: () => readonly string[] | undefined;
  /** The commit's message, a patch's header. */
  message?: string;
}) {
  const { range, open, onContextMenu: menu } = props;
  /** All it changes, as read. */
  const read = signal<readonly Change[]>([]);
  const affected = () => props.affected?.();
  /** Those shown: under Show Only Affected Changes, those the Paths filter's paths touch. */
  const changes = computed(() => {
    const paths = affected();
    const all = read.get();
    return onlyAffected.get() && paths ? all.filter((change) => affects(change, paths)) : all;
  });
  const parents = props.parents ?? [];
  /** The merge's parents but the first, whose changes it's compared with too. */
  const merged = parents.slice(1).map((parent) => parent.hash);
  const showingParents = computed(() => toParents.get() && parents.length > 0);
  /** Under Show Changes to Parents, what it changes against each parent, as read. */
  const byParent = signal<readonly { parent: MergeParent; changes: readonly Change[] }[]>([]);
  let nodes: ChangeNode[] = [];
  /** The file rows, by key, as they were last made. */
  let fileByKey = new Map<string, Extract<ChangeNode, { kind: 'file' }>>();
  const files = new TreeModel<ChangeNode>({
    // Only the root, folders and parents have any.
    children: (node) =>
      node?.kind === 'folder' || node?.kind === 'parent' ? node.children : nodes,
    key: fileNodeKey,
    isLeaf: (node) => node.kind === 'file' || node.kind === 'note',
  });
  /** The selected file's row. */
  const selectedFile = () => {
    const key = files.selected;
    return key === undefined ? undefined : fileByKey.get(key);
  };
  /** What a file's change is between: under "Changes to …", that parent and the merge. */
  const rangeFor = (node: Extract<ChangeNode, { kind: 'file' }> | undefined): Range =>
    node?.parent === undefined ? range : { ...range, from: node.parent };
  const failed = signal<string | undefined>(undefined);
  /** The rows' last loading. */
  let loading: Promise<void> = Promise.resolve();
  const showDiff = (node: Extract<ChangeNode, { kind: 'file' }>) => {
    // Through the files beside it, as IntelliJ's.
    const beside = [...fileByKey.values()].filter((other) => other.parent === node.parent);
    open?.(
      diffTab(node.change.path, rangeFor(node)),
      beside.map((other) => other.change.path),
    );
  };
  const target: FilesTarget = {
    selected: () => {
      // Read again as the rows change.
      changes.get();
      byParent.get();
      return open ? selectedFile()?.change : undefined;
    },
    showDiff: () => {
      showDiff(selectedFile() as Extract<ChangeNode, { kind: 'file' }>);
    },
    range: () => rangeFor(selectedFile()),
    worktree: props.worktree,
    open: (tab) => open?.(tab),
    apply: async (change, reverse) => {
      // As IntelliJ's, which saves all documents first.
      await saveBeforeGit();
      try {
        await props.host.request('git.applyChanges', {
          path: props.worktree,
          from: rangeFor(selectedFile()).from,
          to: range.to,
          // A rename's both, applied as one.
          files: change.from === undefined ? [change.path] : [change.from, change.path],
          reverse,
        });
      } catch (error) {
        // IntelliJ's words (VcsBundle's, `choice` for each).
        const [title, verb] = reverse ? ['Revert', 'revert'] : ['Apply', 'apply'];
        showError(`${title} Changes`, `Failed to ${verb} changes: ${(error as Error).message}`);
      }
      await refreshAll(props.worktree);
    },
    get: (change) => getRevision(props.host, props.worktree, range.to as string, change.path),
    createPatch: (change) => {
      const paths = patchPaths(change);
      return createPatch({
        host: props.host,
        worktree: props.worktree,
        from: rangeFor(selectedFile()).from,
        to: range.to as string,
        files: paths,
        changed: paths,
        message: props.message,
      });
    },
    tree: files,
    affected,
  };
  onCleanup(() => {
    if (focusedFiles.peek() === target) focusedFiles.set(undefined);
  });
  // Again as they're read, or grouped otherwise.
  const grouping = effect(() => {
    const opened = (key: string) => {
      files.expanded.add(key);
    };
    const own = changes.get();
    nodes = fileNodes(own, opened);
    if (showingParents.get()) {
      const paths = affected();
      const groups = byParent.get().flatMap(({ parent, changes: all }): ChangeNode[] => {
        const shown =
          onlyAffected.get() && paths ? all.filter((change) => affects(change, paths)) : all;
        if (shown.length === 0) return [];
        const subject = parent.subject === undefined ? '' : ` ${shortenText(parent.subject, 50)}`;
        const node: ChangeNode = {
          kind: 'parent',
          hash: parent.hash,
          text: `Changes to ${parent.hash.slice(0, 8)}${subject}`,
          children: fileNodes(shown, opened, parent.hash),
        };
        opened(fileNodeKey(node));
        return [node];
      });
      nodes = [
        ...(own.length === 0 ? [{ kind: 'note', text: 'No merged conflicts' } as const] : []),
        ...nodes,
        ...groups,
      ];
    }
    fileByKey = new Map();
    const index = (node: ChangeNode) => {
      if (node.kind === 'file') fileByKey.set(fileNodeKey(node), node);
      if (node.kind === 'folder' || node.kind === 'parent') node.children.forEach(index);
    };
    nodes.forEach(index);
    // The roots and every group and folder loaded, for what each holds now.
    loading = untracked(() => files.refresh());
    return undefined;
  });
  // Each parent's changes, read the first time they're shown.
  let parentsAsked = false;
  const readingParents = effect(() => {
    if (!showingParents.get() || parentsAsked) return undefined;
    parentsAsked = true;
    Promise.all(
      parents.map(
        (parent) =>
          props.host.request('git.changes', {
            path: props.worktree,
            from: parent.hash,
            to: range.to,
          }) as Promise<Change[]>,
      ),
    ).then(
      (lists) => {
        byParent.set(parents.map((parent, i) => ({ parent, changes: lists[i] as Change[] })));
      },
      (error: unknown) => {
        failed.set((error as Error).message);
      },
    );
    return undefined;
  });
  onCleanup(() => {
    grouping.dispose();
    readingParents.dispose();
  });
  props.selection?.(() => {
    changes.get();
    return selectedFile()?.change;
  });
  /** Some were read, and Show Only Affected Changes hides them all. */
  const allHidden = computed(() => changes.get().length === 0 && read.get().length > 0);
  /** Read, and none differ. */
  const none = signal(false);
  const empty = merged.length > 0 ? 'No merged conflicts' : props.empty;
  void props.host
    .request('git.changes', {
      path: props.worktree,
      ...range,
      ...(merged.length > 0 ? { merged } : {}),
    })
    .then(
      (listed) => {
        read.set(listed as Change[]);
        none.set((listed as Change[]).length === 0);
        void loading.then(() => {
          files.select(props.selected);
        });
      },
      (error: unknown) => {
        failed.set((error as Error).message);
      },
    );
  return () => {
    const error = failed.get();
    if (error === undefined && none.get() && empty !== undefined && !showingParents.get()) {
      return <p class="playground-project__empty">{empty}</p>;
    }
    return error === undefined ? (
      <div
        class="playground-log__files"
        on:focusin={() => {
          focusedFiles.set(target);
        }}
        on:focusout={(event) => {
          const to = event.relatedTarget as Node | null;
          if (!(event.currentTarget as HTMLElement).contains(to)) focusedFiles.set(undefined);
        }}
      >
        <div class="playground-log__files-toolbar" role="toolbar" aria-label="Changes">
          <ToolbarButton
            commands={props.services.commands}
            command="log.files.showDiff"
            icon={icon('diff')}
            shortcut={shortcutOf(props.services, 'log.files.showDiff')}
            context={() => ({ files: target })}
          />
          <ToolbarButton
            commands={props.services.commands}
            command="log.files.revert"
            icon={icon('rollback')}
            context={() => ({ files: target })}
          />
          <ToolbarButton
            commands={props.services.commands}
            command="log.files.showHistory"
            icon={icon('history')}
            context={() => ({ files: target })}
          />
          {/* While the Log has a Paths filter, as IntelliJ's (HAS_AFFECTED_FILES). */}
          {() =>
            affected() ? (
              <ToolbarButton
                commands={props.services.commands}
                command="log.files.showOnlyAffected"
                icon={icon('folder')}
                context={() => ({ files: target })}
              />
            ) : null
          }
          <button
            type="button"
            class="cerebro-toolbar-button"
            aria-label="Group By"
            data-menu={FILES_GROUP_BY}
            ref={tooltip({ text: () => 'Group By' })}
            on:click={(event) => {
              const anchor = event.currentTarget as HTMLElement;
              openMenu(
                props.services,
                FILES_GROUP_BY,
                { anchor, placement: 'below' },
                { owner: anchor, context: { files: target } },
              );
            }}
          >
            {icon('groupBy')}
          </button>
          {/* At its end, as IntelliJ's TreeActionsToolbarPanel puts them. */}
          <div class="playground-log__files-tree-actions">
            {(['log.files.expandAll', 'log.files.collapseAll'] as const).map((command) => (
              <ToolbarButton
                commands={props.services.commands}
                command={command}
                icon={icon(command === 'log.files.expandAll' ? 'expandAll' : 'collapseAll')}
                context={() => ({ files: target })}
              />
            ))}
          </div>
        </div>
        {() =>
          allHidden.get() ? (
            // IntelliJ's words (VcsLogChangesTreeComponents), and its link that shows them all.
            <p class="playground-project__empty">
              No changes that affect selected paths.{' '}
              <button
                type="button"
                class="playground-link"
                on:click={() => {
                  props.services.commands.execute('log.files.showOnlyAffected', { files: target });
                }}
              >
                Show changes for all paths
              </button>
            </p>
          ) : (
            <TreeView
              model={files}
              label={props.label}
              row={(node) => {
                if (node.kind === 'folder') return folderContent(node.name, node.count);
                if (node.kind === 'file') {
                  return changeContent(node.change, !filesByDirectory.peek());
                }
                return <span>{node.text}</span>;
              }}
              {...(menu || open
                ? {
                    // A file's: the one given, else IntelliJ's for a commit's; a folder has none.
                    onContextMenu: (event: MouseEvent, node: ChangeNode) => {
                      if (node.kind !== 'file') return;
                      if (menu) menu(event, node.change);
                      else openContextMenu(props.services, FILES_MENU, event, { files: target });
                    },
                  }
                : {})}
              onOpen={(node) => {
                // A folder or a parent opens and closes instead; a note does nothing.
                if (node.kind === 'file') showDiff(node);
              }}
            />
          )
        }
      </div>
    ) : (
      <p class="playground-project__empty">{error}</p>
    );
  };
}

/** The selected commit's changed files, then its details. */
export function CommitPane(props: {
  services: MenuServices;
  log: Log;
  host: Host;
  worktree: string;
  open: (tab: Tab, chain?: readonly string[]) => void;
}) {
  const { log } = props;
  // The selected commit's hash while the Log has it: none once it's gone, read again (after Undo
  // Commit, say), and the same as more are loaded, so its files aren't made again.
  const shown = computed(() => {
    const hash = log.model.selected;
    return log.commits.get().some((commit) => commit.hash === hash) ? hash : undefined;
  });
  return () => {
    const hash = shown.get();
    const commit = hash === undefined ? undefined : log.commit(hash);
    if (!commit) return <p class="playground-project__empty">No commits selected</p>;
    return [
      <CommitFiles
        services={props.services}
        host={props.host}
        worktree={props.worktree}
        range={rangeOf(commit)}
        parents={mergeParents(commit, (parent) => log.commit(parent))}
        label={`${commit.subject} changes`}
        open={props.open}
        selected={log.file.peek()?.hash === hash ? log.file.peek()?.path : undefined}
        affected={() => log.paths.get()}
        message={messageOf(commit)}
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
export const PANE_WIDTH = 400;
const BRANCHES_WIDTH = 200;

/** The Log shown, for its commands. */
const shown = signal<{ log: Log; branches: Branches } | undefined>(undefined);

/** Where the toolbar's commands come from. */
const FROM_LOG = { source: 'log' };

/** What the commit menu acts on, for a commit of `log`; `refresh` reads it again after a change. */
export function commitContext(
  log: Log,
  commit: LogCommit,
  refresh: () => Promise<void>,
): LogCommitContext {
  const head = log.commits
    .peek()
    .find((c) => c.refs.some((r) => r === 'HEAD' || r.startsWith('HEAD -> ')));
  return {
    commit,
    worktree: log.worktree,
    host: log.host,
    ...(head ? { head: head.hash } : {}),
    refresh,
    select: (hash) => log.select(hash),
  };
}

/** What the branches pane's toolbar acts on. */
function branchesContext(log: Log, branches: Branches): BranchesContext {
  const current = branches.branches.peek().find((branch) => branch.current);
  return {
    source: 'log',
    selection: branches.selection(),
    refresh: () => refresh(log, branches),
    ...(current ? { current: branchName(current.ref) } : {}),
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
  const pane = branchesContext(at.log, at.branches);
  // The search field hides the selection from the actions, as IntelliJ's (BranchesTreeSearchField).
  return document.activeElement.closest('.playground-branches__search')
    ? { ...pane, selection: undefined }
    : pane;
}

/** The Log's selected commit, as its commit menu has it: what its toolbar's Cherry-Pick picks. */
export function selectedCommit(): LogCommitContext | undefined {
  const at = shown.get();
  if (!at) return undefined;
  const hash = at.log.model.selected;
  const commit = hash === undefined ? undefined : at.log.commit(hash);
  return commit && commitContext(at.log, commit, () => refresh(at.log, at.branches));
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
  /** Selects a commit in the Log, as IntelliJ focuses one an action made; whether it's there. */
  select: (hash: string) => Promise<boolean>;
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
export function showHistory(path: string, revision?: string): void {
  wantedView.set((log) => log.showHistory(path, revision));
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
  // Graph Options, as IntelliJ's (VcsLogGraphOptionsChooserGroup): how the graph is sorted, or its
  // first parents alone (one of them at a time, First Parent off back to by date), and No Merges.
  const showing = () => shown.peek()?.log as Log;
  for (const [id, label, graph] of [
    ['log.graph.byDate', 'By Commit Date', 'date'],
    ['log.graph.topological', 'Topologically', 'topological'],
    ['log.graph.firstParent', 'First Parent', 'firstParent'],
  ] as const) {
    commands.register({
      id,
      label,
      enabled: (c) => here(c) && shown.get() !== undefined,
      checked: () => shown.get()?.log.graphOptions.get() === graph,
      run: () => {
        const log = showing();
        const on = log.graphOptions.peek() === graph;
        void log.layOut(graph === 'firstParent' && on ? 'date' : graph);
      },
    });
  }
  commands.register({
    id: 'log.graph.noMerges',
    label: 'No Merges',
    enabled: (c) => here(c) && shown.get() !== undefined,
    checked: () => shown.get()?.log.noMerges.get() === true,
    run: () => {
      const log = showing();
      void log.filterMerges(!log.noMerges.peek());
    },
  });
  menus.contribute({ menu: GRAPH_MENU, item: { heading: 'Sort' }, group: 'a' });
  for (const id of ['log.graph.byDate', 'log.graph.topological']) {
    menus.contribute({ menu: GRAPH_MENU, item: { command: id }, group: 'a' });
  }
  menus.contribute({ menu: GRAPH_MENU, item: { heading: 'Options' }, group: 'b' });
  for (const id of ['log.graph.firstParent', 'log.graph.noMerges']) {
    menus.contribute({ menu: GRAPH_MENU, item: { command: id }, group: 'b' });
  }
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
  // Find's key, in the branches pane: from the tree to its search field, or back, as IntelliJ's
  // (BranchesDashboardTreeComponent). Before Go To Hash/Branch/Tag, which takes it in the rest of
  // the Log.
  commands.register({
    id: 'log.branches.focusSearch',
    label: 'Focus Branches Search',
    enabled: () => paneContext(undefined) !== undefined,
    run: () => {
      const pane = (document.activeElement as Element).closest('.playground-branches') as Element;
      const field = pane.querySelector('.playground-branches__search-field') as HTMLElement;
      const tree = pane.querySelector<HTMLElement>('.cerebro-tree');
      // With no tree, its error shown instead, the field keeps it.
      (document.activeElement === field ? tree : field)?.focus();
    },
  });
  keymap?.bindDefault('Mod+F', 'log.branches.focusSearch');
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
    enabled: (c) => paneContext(c)?.selection !== undefined,
    run: (c) => {
      const { log } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      const selection = (paneContext(c) as BranchesContext)
        .selection as NonNullable<BranchesSelection>;
      if (selection.kind === 'head') void navigate(log, 'HEAD');
      else void navigate(log, selection.ref, branchName(selection.ref));
    },
  });
  // Select In's key (Alt+F1, Option+F1 on macOS), while the pane has the keyboard, as IntelliJ's
  // (`use-shortcut-of="SelectIn"`): bound before Select In, which takes it elsewhere.
  keymap?.bindDefault('Alt+F1', 'log.branches.navigate');
  // Show My Branches, as IntelliJ's (ShowMyBranchesAction, a toggle, its icon Find's).
  commands.register({
    id: 'log.branches.showMy',
    label: 'Show My Branches',
    icon: 'search',
    enabled: () => shown.get() !== undefined,
    checked: () => shown.get()?.branches.onlyMy.get() === true,
    run: () => {
      const { branches } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      void branches.showOnlyMy(!branches.onlyMy.peek());
    },
  });
  // A branch marked a favorite, or not, as IntelliJ's ToggleFavoriteAction: the pane sorts it again.
  commands.register<BranchesContext | undefined>({
    id: 'log.branches.toggleFavorite',
    label: 'Toggle Favorite',
    icon: 'favorite',
    enabled: (c) => c?.selection?.kind === 'branch' && shown.get() !== undefined,
    run: (c) => {
      const { branches } = shown.peek() as NonNullable<ReturnType<typeof shown.peek>>;
      const { ref } = (c as BranchesContext).selection as { ref: string };
      setFavorite(branches.repository, ref, !isFavorite(branches.repository, ref));
      void branches.model.refresh();
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
  // A commit's files' Show Diff, as IntelliJ's changes browser's (its first action), on the file
  // selected in the list it came from or that has the keyboard.
  commands.register({
    id: 'log.files.showDiff',
    label: 'Show Diff',
    icon: 'diff',
    enabled: (context) => filesOf(context)?.selected() !== undefined,
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      files.showDiff();
    },
  });
  keymap?.bindDefault('Mod+D', 'log.files.showDiff');
  // The file in the working tree against the commit's version of it, or the one before: IntelliJ's
  // Compare with Local and Compare Before with Local (Vcs.ShowDiffWithLocal and its .Before). Not
  // for a version the commit hasn't: it deleted the file, or added it. A rename's version before is
  // at its old path: the host finds the rename to the working tree, as IntelliJ compares the old
  // path's version with the file renamed.
  for (const [id, label, before] of [
    ['log.files.compareWithLocal', 'Compare with Local', false],
    ['log.files.compareBeforeWithLocal', 'Compare Before with Local', true],
  ] as const) {
    commands.register({
      id,
      label,
      enabled: (context) => {
        const status = filesOf(context)?.selected()?.status;
        return atCommit(context) && status !== (before ? 'added' : 'deleted');
      },
      run: (context) => {
        const files = filesOf(context) as FilesTarget;
        const { path } = files.selected() as Change;
        const { from, to } = files.range() as Required<Range>;
        files.open(diffTab(path, { from: before ? from : to }));
      },
    });
  }
  // The file itself, as IntelliJ's Edit Source (Vcs.EditSource), on F4 as the Commit window's Jump
  // to Source; not one the commit deleted.
  commands.register({
    id: 'log.files.editSource',
    label: 'Edit Source',
    enabled: (context) => {
      const status = filesOf(context)?.selected()?.status;
      return status !== undefined && status !== 'deleted';
    },
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      files.open(fileTab(files.worktree, (files.selected() as Change).path));
    },
  });
  keymap?.bindDefault('F4', 'log.files.editSource');
  // The file made as the commit left it, or deleted if the commit deleted it, as IntelliJ's Get in
  // the Log (Vcs.GetVersion, named there by GetVersionFromRepositoryActionProvider).
  commands.register({
    id: 'log.files.get',
    label: 'Get from Revision',
    enabled: atCommit,
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      return files.get(files.selected() as Change);
    },
  });
  // Create Patch… of the file selected, as IntelliJ's (ChangesView.CreatePatchFromChanges in
  // Vcs.RepositoryChangesBrowserMenu): what the commit changed in it.
  commands.register({
    id: 'log.files.createPatch',
    label: 'Create Patch…',
    enabled: (context) => atCommit(context),
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      return files.createPatch(files.selected() as Change);
    },
  });
  // The file as the commit left it, read-only, as IntelliJ's Open Repository Version
  // (Vcs.OpenRepositoryVersion): not one the commit deleted.
  commands.register({
    id: 'log.files.openRepositoryVersion',
    label: 'Open Repository Version',
    enabled: (context) => atCommit(context) && filesOf(context)?.selected()?.status !== 'deleted',
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      files.open(revisionTab((files.selected() as Change).path, files.range().to as string));
    },
  });
  // IntelliJ's (Vcs.Log.ChangesBrowser.Popup): its changes browser's Show Diff, then
  // Vcs.RepositoryChangesBrowserMenu with what Cerebro has of it.
  for (const [command, group] of [
    ['log.files.showDiff', 'a'],
    ['log.files.compareWithLocal', 'b'],
    ['log.files.compareBeforeWithLocal', 'b'],
    ['log.files.editSource', 'b'],
    ['log.files.openRepositoryVersion', 'b'],
    ['log.files.revert', 'c'],
    ['log.files.cherryPick', 'c'],
    ['log.files.createPatch', 'c'],
    ['log.files.get', 'c'],
    ['log.files.showHistory', 'c'],
  ] as const) {
    menus.contribute({ menu: FILES_MENU, item: { command }, group });
  }
  // Next in IntelliJ's (Vcs.RepositoryChangesBrowserToolbar's Vcs.RevertSelectedChanges): what the
  // commit changed in the file undone in it, uncommitted. Cerebro has no changelists, so there's no
  // Select Target Changelist dialog, as IntelliJ's without them.
  // Its menu's Cherry-Pick Selected Changes (Vcs.ApplySelectedChanges) is the same, not reversed.
  for (const [id, label, reverse] of [
    ['log.files.revert', 'Revert Selected Changes', true],
    ['log.files.cherryPick', 'Cherry-Pick Selected Changes', false],
  ] as const) {
    commands.register({
      id,
      label,
      ...(reverse ? { icon: 'rollback' } : {}),
      enabled: atCommit,
      run: (context) => {
        const files = filesOf(context) as FilesTarget;
        return files.apply(files.selected() as Change, reverse);
      },
    });
  }
  // Then (Vcs.ShowHistoryForRevision): the
  // file's commits up to this one, in the Log as Git → Current File → Show History shows them.
  commands.register({
    id: 'log.files.showHistory',
    label: 'History Up to Here',
    icon: 'history',
    enabled: atCommit,
    run: (context) => {
      const files = filesOf(context) as FilesTarget;
      showHistory((files.selected() as Change).path, files.range().to);
    },
  });
  // At the toolbar's end, as IntelliJ's changes browser's (TreeActionsToolbarPanel.createTreeActions).
  for (const [id, label, open] of [
    ['log.files.expandAll', 'Expand All', true],
    ['log.files.collapseAll', 'Collapse All', false],
  ] as const) {
    commands.register({
      id,
      label,
      icon: open ? 'expandAll' : 'collapseAll',
      enabled: (context) => filesOf(context) !== undefined,
      run: (context) => {
        const { tree } = filesOf(context) as FilesTarget;
        if (open) void tree.expandAll();
        else tree.collapseAll();
      },
    });
  }
  // A commit's files, as IntelliJ's changes trees (ChangesView.GroupBy): by directory or not. Its
  // key, as theirs, acts in a commit's files only.
  commands.register({
    id: 'log.files.groupByDirectory',
    label: 'Directory',
    enabled: (context) => filesOf(context) !== undefined,
    checked: () => filesByDirectory.get(),
    run: () => {
      filesByDirectory.set(!filesByDirectory.peek());
      saveFilesSettings();
    },
  });
  // Before Group By, as IntelliJ's (Vcs.Log.ShowOnlyAffectedChanges): only the files the Log's
  // Paths filter holds, or all; kept for every commit.
  commands.register({
    id: 'log.files.showOnlyAffected',
    label: 'Show Only Affected Changes',
    icon: 'folder',
    // Off, and so out of Find Action, without a Paths filter (IntelliJ hides it then).
    enabled: (context) => filesOf(context)?.affected() !== undefined,
    checked: () => onlyAffected.get(),
    run: () => {
      onlyAffected.set(!onlyAffected.peek());
      saveFilesSettings();
    },
  });
  // Last in a file's menu, as IntelliJ's (Vcs.Log.ChangesBrowser.Popup's
  // Vcs.Log.ShowChangesFromParents, off to start with): a merge's changes against each parent too,
  // under "Changes to …"; kept for every commit.
  commands.register({
    id: 'log.files.showChangesToParents',
    label: 'Show Changes to Parents',
    checked: () => toParents.get(),
    run: () => {
      toParents.set(!toParents.peek());
      saveFilesSettings();
    },
  });
  menus.contribute({
    menu: FILES_MENU,
    item: { command: 'log.files.showChangesToParents' },
    group: 'z',
  });
  keymap?.bindDefault('Mod+P', 'log.files.groupByDirectory');
  menus.contribute({ menu: FILES_GROUP_BY, item: { heading: 'Group By' }, group: 'a' });
  menus.contribute({
    menu: FILES_GROUP_BY,
    item: { command: 'log.files.groupByDirectory' },
    group: 'a',
  });
  // Show Tags, as IntelliJ's (git.branches.show.tags): on to start with; the tags read again.
  commands.register({
    id: 'log.branches.showTags',
    label: 'Show Tags',
    checked: () => paneSettings.showTags.get(),
    run: () => {
      paneSettings.showTags.set(!paneSettings.showTags.peek());
      savePaneSettings();
      void shown.peek()?.branches.reload();
    },
  });
  menus.contribute({
    menu: SETTINGS_MENU,
    item: { command: 'log.branches.showTags' },
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
  // Next, as IntelliJ's (ChangesView.CreatePatchFromChanges): all the commit changed, against its
  // first parent, as IntelliJ takes a commit's changes.
  commands.register<LogCommitContext>({
    id: 'log.createPatch',
    label: 'Create Patch…',
    enabled: (at?: LogCommitContext) => at !== undefined,
    run: async ({ host, worktree, commit }) => {
      const range = rangeOf(commit);
      const changes = (await host.request('git.changes', { path: worktree, ...range })) as Change[];
      await createPatch({
        host,
        worktree,
        ...range,
        changed: changes.flatMap(patchPaths),
        message: messageOf(commit),
      });
    },
  });
  menus.contribute({ menu: 'log/commit', item: { command: 'log.createPatch' }, group: 'a' });
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

/**
 * The text filter's history, as IntelliJ's SearchTextField keeps it: five, trimmed, the same text
 * in another case moved first.
 */
export const logTextHistory = new SearchHistory('cerebro.log.textHistory', {
  limit: 5,
  loose: true,
});

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
    logTextHistory.remember(typed.peek());
    void showSearchHistory({
      label: 'Search History',
      texts: logTextHistory.texts(),
      below: search as HTMLElement,
    }).then((text) => {
      if (text === undefined) return;
      put(text);
      logTextHistory.remember(text);
    });
  };
  // Where Alt+Up is in the history, as IntelliJ's myCurrentHistoryIndex.
  let at = 0;
  const previous = () => {
    if (!logTextHistory.texts().includes(typed.peek())) logTextHistory.remember(typed.peek());
    const history = logTextHistory.texts();
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
          if (logTextHistory.texts().length > 0) showHistory();
        }}
      >
        {icon('searchHistory')}
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
            logTextHistory.remember(typed.peek());
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
/** A branch's name; a commit's hash, or a range's, short. */
const branchText = (branch: BranchFilter) =>
  branch
    .split('..')
    .map((part) => (/^[0-9a-f]{40}$/.test(part) ? part.slice(0, 8) : branchName(part)))
    .join('..');

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
          // After the filters, as IntelliJ's (VcsLogClassicFilterUi's graph component).
          <button
            type="button"
            class="cerebro-toolbar-button"
            aria-label="Graph Options"
            data-menu={GRAPH_MENU}
            ref={tooltip({ text: () => 'Graph Options' })}
            on:click={(event) => {
              const anchor = event.currentTarget as HTMLElement;
              openMenu(
                services,
                GRAPH_MENU,
                { anchor, placement: 'below' },
                { owner: anchor, context: FROM_LOG },
              );
            }}
          >
            {/* Badged while anything but by date is chosen, as IntelliJ's. */}
            {() => icon('graphOptions', log.graphOptions.get() !== 'date' || log.noMerges.get())}
          </button>,
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
      {/* What doesn't fit, behind a » at the bottom, as IntelliJ's vertical toolbars. */}
      <ToolbarRow
        label="Branches Actions"
        orientation="vertical"
        items={() => (
          <>
            {button('log.branches.hide', 'arrowCollapse')}
            <span class="playground-log__branches-separator" />
            {button('log.branches.newBranch', 'add')}
            {button('log.branches.update', 'update')}
            {button('log.branches.delete', 'delete')}
            {button('log.branches.compare', 'diff')}
            {button('log.branches.showMy', 'search')}
            {button('vcs.fetch', 'fetch')}
            {button('log.branches.toggleFavorite', 'favorite')}
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
          </>
        )}
      />
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
              void navigate(log, ref, branchName(ref));
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
                  commitContext(log, commit, () => refresh(log, branches)),
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
            <CommitPane
              services={props.services}
              log={log}
              host={host}
              worktree={env.id}
              open={props.open}
            />
          </div>
        ) as HTMLElement;
        pane.style.width = `${String(PANE_WIDTH)}px`;
        const sizing = sizeColumns(commits, () => log.commits.get());
        onCleanup(() => {
          sizing.dispose();
        });
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
