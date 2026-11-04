// The Git tool window's Log, as IntelliJ's: the commits of every branch, remote branch and tag,
// newest first, each with its place in the graph, its subject and the refs at it, its author and
// date. Commits load a page at a time, the next as the list scrolls near its end; the list is read
// again when the window shows and when the app gets the focus back, as files on disk are.
//
// From IntelliJ: the refs' colours (VcsLogStandardColors: the current branch and HEAD in the tip's
// yellow, local branches green, remote ones purple, tags grey) and the graph's (DefaultColorGenerator,
// its first eight). Claims: the lane's width, the dot's size, the columns' widths, and the dates
// as "Today 10:15" or the system's short date and time.

import { onCleanup } from '@cerebro-ide/jsx';
import { computed, signal } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active, gitRepository, hostFor, type Host } from './environments.js';
import { GraphLayout, type Edge, type GraphRow } from './log-graph.js';

/** A commit, as the host's `git.log` gives it. */
export interface LogCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
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

/** What the Log has loaded, and loads. */
class Log {
  readonly commits = signal<readonly LogCommit[]>([]);
  readonly graph = new Map<string, GraphRow>();
  /** Why it couldn't be read. */
  readonly error = signal<string | undefined>(undefined);
  readonly loaded = signal(false);
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

  private ask(skip: number): Promise<LogCommit[]> {
    return this.host.request('git.log', {
      worktree: this.worktree,
      skip,
      max: PAGE,
    }) as Promise<LogCommit[]>;
  }

  private take(page: readonly LogCommit[], from: readonly LogCommit[]): void {
    for (const [i, row] of this.layout.add(page).entries()) {
      this.graph.set((page[i] as LogCommit).hash, row);
    }
    this.done = page.length < PAGE;
    this.commits.set([...from, ...page]);
    void this.model.load(undefined, true);
  }

  /** Reads the first page again; what's loaded beyond it goes, unless it's all the same. */
  async reload(): Promise<void> {
    try {
      const page = await this.ask(0);
      this.error.set(undefined);
      const before = this.commits.peek();
      const same = page.every((commit, i) => before[i]?.hash === commit.hash);
      if (!(same && before.length >= page.length && this.loaded.peek())) {
        this.layout = new GraphLayout();
        this.graph.clear();
        this.take(page, []);
      }
    } catch (error) {
      this.error.set((error as Error).message);
    }
    this.loaded.set(true);
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

/** The Git tool window's Log, of the active environment's repository. */
export function GitLogView(): Node {
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
        const reload = () => {
          void log.reload();
        };
        reload();
        window.addEventListener('focus', reload);
        onCleanup(() => {
          window.removeEventListener('focus', reload);
        });
        // Only whether there are any: the tree itself follows the commits.
        const empty = computed(() => log.loaded.get() && log.commits.get().length === 0);
        return () => {
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
      }}
    </div>
  );
}
