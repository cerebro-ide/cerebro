// The Log's branches pane, as IntelliJ's: HEAD (Current Branch), then the local branches, the
// remote ones (under their remote) and the tags, grouped by directory (the parts of a name before a slash). A
// double click or Enter on one filters the log by it, as IntelliJ's Update Branch Filter.
//
// From IntelliJ (BranchesTreeModel, BranchTreeNodeComparator): the groups and their names, and
// the order within one: the branch checked out, then directories, then branches, by name. Claims:
// the order of names (the system's, case and numbers aside), and the groups starting expanded.

import { signal } from '@cerebro-ide/reactive';
import { match, type Match } from '@cerebro-ide/ui-popup';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { isFavorite, repositoryOf } from './branch-favorites.js';
import type { Host } from './environments.js';
import { favoriteIcon, icon } from './icons.js';
import { exactly, ME, resolveUsers, type Author } from './log-users.js';

/** A branch, as the host's `git.branches` gives it. */
export interface Branch {
  ref: string;
  hash: string;
  current: boolean;
  /** The branch a local one tracks, in full (`refs/remotes/origin/main`), if any. */
  upstream?: string;
}

interface Group {
  kind: 'group';
  key: string;
  name: string;
  children: BranchNode[];
  /** Whether a favorite is somewhere under it. */
  favorite: boolean;
}

interface BranchItem {
  kind: 'branch';
  ref: string;
  name: string;
  current: boolean;
  favorite: boolean;
}

export type BranchNode = { kind: 'head' } | Group | BranchItem;

/**
 * What the Log is filtered by: a branch's ref in full, or HEAD; or View Commits' range, git's
 * `start..end` (no ref has `..` in its name, as git's `check-ref-format` rules).
 */
export type BranchFilter = string;

const LOCAL = 'refs/heads/';
const REMOTE = 'refs/remotes/';
const TAG = 'refs/tags/';

/** A branch's name as the Log shows it: `main`, `origin/main`; a tag's, `v1`; HEAD as itself. */
export const branchName = (ref: string): string => {
  for (const prefix of [LOCAL, TAG]) if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  return ref.replace(REMOTE, '');
};

/** Whether a ref in full is a tag's. */
export const isTag = (ref: string): boolean => ref.startsWith(TAG);

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * IntelliJ's order (BranchTreeNodeComparator): the branch checked out, favorites, directories with
 * a favorite under them, other directories, then branches.
 */
const weight = (node: Group | BranchItem) => {
  if (node.kind === 'group') return node.favorite ? 2 : 3;
  if (node.current) return 0;
  return node.favorite ? 1 : 4;
};

/** Branches grouped by the parts of their names before a slash, under `key`. */
type Named = { branch: Pick<Branch, 'ref' | 'current'>; path: string[] };

function grouped(
  key: string,
  branches: readonly Named[],
  favorite: (ref: string) => boolean,
): (Group | BranchItem)[] {
  const nodes: (Group | BranchItem)[] = [];
  const groups = new Map<string, Named[]>();
  for (const { branch, path } of branches) {
    const [first, ...rest] = path as [string, ...string[]];
    if (rest.length === 0) {
      nodes.push({
        kind: 'branch',
        ref: branch.ref,
        name: first,
        current: branch.current,
        favorite: favorite(branch.ref),
      });
    } else {
      groups.set(first, [...(groups.get(first) ?? []), { branch, path: rest }]);
    }
  }
  for (const [name, children] of groups) {
    const at = `${key}/${name}`;
    const under = grouped(at, children, favorite);
    nodes.push({
      kind: 'group',
      key: at,
      name,
      children: under,
      favorite: under.some((node) => node.favorite),
    });
  }
  return nodes.sort((a, b) => weight(a) - weight(b) || byName(a.name, b.name));
}

/**
 * The pane's tree: HEAD, then Local, Remote and Tags, each if there are any. Grouped by directory,
 * or not: a remote's branches are under it either way, as IntelliJ's.
 */
export function branchTree(
  branches: readonly Branch[],
  byDirectory = true,
  favorite: (ref: string) => boolean = () => false,
  tags: readonly string[] = [],
): BranchNode[] {
  const split = (name: string) => (byDirectory ? name.split('/') : [name]);
  const under = (prefix: string) =>
    branches
      .filter((branch) => branch.ref.startsWith(prefix))
      .map((branch) => {
        const name = branch.ref.slice(prefix.length);
        if (prefix === LOCAL) return { branch, path: split(name) };
        const slash = name.indexOf('/');
        return { branch, path: [name.slice(0, slash), ...split(name.slice(slash + 1))] };
      });
  const tagged = tags.map((name) => ({
    branch: { ref: `${TAG}${name}`, current: false },
    path: split(name),
  }));
  const tree: BranchNode[] = [{ kind: 'head' }];
  for (const [name, named] of [
    ['Local', under(LOCAL)],
    ['Remote', under(REMOTE)],
    ['Tags', tagged],
  ] as const) {
    const children = grouped(name, named, favorite);
    if (children.length > 0) {
      tree.push({ kind: 'group', key: name, name, children, favorite: false });
    }
  }
  return tree;
}

/**
 * What the pane's toolbar acts on: HEAD, with the branch checked out if one is; a branch, by its
 * ref in full; or nothing, with a directory or nothing selected. With what the branch tracks.
 */
export type BranchesSelection =
  | { kind: 'head'; branch: string | undefined; upstream?: string }
  | { kind: 'branch'; ref: string; current: boolean; upstream?: string }
  | undefined;

/** The pane's toolbar's context: what's selected, and how to read the Log again after a change. */
export interface BranchesContext {
  source: 'log';
  selection: BranchesSelection;
  refresh: () => Promise<void>;
  /** The branch checked out, by its name; none when HEAD is detached. */
  current?: string;
}

/** What a single click on a branch does, as IntelliJ's pane settings ("On Single Click"). */
export type OnSelection = 'filter' | 'navigate' | undefined;

/**
 * Where the branches' settings are kept, the pane's and the popup's together, as IntelliJ keeps them
 * (`GitVcsSettings`): one for every repository, as IntelliJ's.
 */
const SETTINGS = 'cerebro.log.branchesPane';

/**
 * The branches' settings, as kept: a single click doing nothing, grouped by directory, the tags, the
 * popup's recent branches and its actions in search results shown, to start with, as IntelliJ's
 * (`Change.Log.Filter.on.Branch.Selection`, `Navigate.Log.To.Branch.on.Branch.Selection`,
 * `git.branches.group.by.directory`, `GitVcsOptions`).
 */
export function readPaneSettings(): {
  onSelection: OnSelection;
  byDirectory: boolean;
  showTags: boolean;
  showRecent: boolean;
  actionsInSearch: boolean;
} {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Record<string, unknown>;
    const { onSelection } = stored;
    return {
      onSelection: onSelection === 'filter' || onSelection === 'navigate' ? onSelection : undefined,
      byDirectory: stored.byDirectory !== false,
      showTags: stored.showTags !== false,
      showRecent: stored.showRecent !== false,
      actionsInSearch: stored.actionsInSearch !== false,
    };
  } catch {
    return {
      onSelection: undefined,
      byDirectory: true,
      showTags: true,
      showRecent: true,
      actionsInSearch: true,
    };
  }
}

const settings = readPaneSettings();
export const paneSettings = {
  onSelection: signal<OnSelection>(settings.onSelection),
  byDirectory: signal(settings.byDirectory),
  showTags: signal(settings.showTags),
  showRecent: signal(settings.showRecent),
  actionsInSearch: signal(settings.actionsInSearch),
};

/** Keeps the pane's settings as they are now. */
export function savePaneSettings(): void {
  try {
    localStorage.setItem(
      SETTINGS,
      JSON.stringify({
        onSelection: paneSettings.onSelection.peek(),
        byDirectory: paneSettings.byDirectory.peek(),
        showTags: paneSettings.showTags.peek(),
        showRecent: paneSettings.showRecent.peek(),
        actionsInSearch: paneSettings.actionsInSearch.peek(),
      }),
    );
  } catch {
    // Not kept: they apply until the page is reloaded.
  }
}

const keyOf = (node: BranchNode) => {
  if (node.kind === 'head') return 'HEAD';
  return node.kind === 'group' ? `group:${node.key}` : node.ref;
};

/** The repository's branches, as the pane shows them, read again with the Log. */
export class Branches {
  readonly branches = signal<readonly Branch[]>([]);
  /** The tags' names, while Show Tags is on. */
  readonly tags = signal<readonly string[]>([]);
  readonly error = signal<string | undefined>(undefined);
  /** What the search field holds: the pane shows the branches it matches. (Before the model, which reads it as it's made.) */
  readonly query = signal('');
  /** Show My Branches, on: IntelliJ's starts off each time, and isn't kept. */
  readonly onlyMy = signal(false);
  /** The branches that are mine, by ref, once they're found while Show My Branches is on. */
  private mine: ReadonlySet<string> | undefined;
  readonly model = new TreeModel<BranchNode>({
    children: (node) =>
      // Only groups have children to ask for.
      node === undefined
        ? branchTree(
            this.matching(this.mineOf(this.branches.peek()), (branch) => branch.ref),
            paneSettings.byDirectory.peek(),
            (ref) => isFavorite(this.repository, ref),
            // Only branches can be mine, as IntelliJ's.
            this.mine ? [] : this.matching(this.tags.peek(), (tag) => `${TAG}${tag}`),
          )
        : (node as Group).children,
    key: keyOf,
    isLeaf: (node) => node.kind !== 'group',
  });

  /** The repository's path, which favorites are kept by. */
  readonly repository: string;

  constructor(
    private readonly host: Host,
    private readonly worktree: string,
  ) {
    this.repository = repositoryOf(worktree);
    for (const group of ['Local', 'Remote', 'Tags']) this.model.expanded.add(`group:${group}`);
  }

  /** The branches, those that are mine alone once they're found while Show My Branches is on. */
  private mineOf(branches: readonly Branch[]): readonly Branch[] {
    const { mine } = this;
    return mine ? branches.filter((branch) => mine.has(branch.ref)) : branches;
  }

  /**
   * Show My Branches, as IntelliJ's (ShowMyBranchesAction, BranchesDashboardUtil): only the local
   * and remote branches whose exclusive commits, if they have any, are all by "me", as the User
   * filter has "me". Until they're found, all show; where they can't be, all do.
   */
  async showOnlyMy(on: boolean): Promise<void> {
    this.onlyMy.set(on);
    this.mine = on ? await this.findMine() : undefined;
    await this.model.refresh();
  }

  private async findMine(): Promise<ReadonlySet<string> | undefined> {
    try {
      const { branches, me } = (await this.host.request('git.exclusiveAuthors', {
        path: this.worktree,
      })) as { branches: Record<string, Author[]>; me: Author | undefined };
      const authors = Object.values(branches).flat();
      const mine = new Set(resolveUsers([ME], authors, me));
      return new Set(
        Object.entries(branches)
          .filter(([, by]) => by.length > 0 && by.every((author) => mine.has(exactly(author))))
          .map(([ref]) => ref),
      );
    } catch (error) {
      console.error('Finding my branches failed', error);
      return undefined;
    }
  }

  /** What was expanded as a search started, expanded again once it's cleared. */
  private expandedBefore: string[] | undefined;

  /** Those the search matches, by their names (a remote branch's with its remote), by `ref`. */
  private matching<T>(all: readonly T[], ref: (item: T) => string): readonly T[] {
    const query = this.query.peek();
    return query.trim() === '' ? all : all.filter((item) => match(query, branchName(ref(item))));
  }

  /**
   * Searches, as IntelliJ's pane (FilteringBranchesTree): only the branches that match, with their
   * directories, all expanded, the best match selected; cleared, the directories expanded before.
   */
  async search(query: string): Promise<void> {
    const { model } = this;
    const searching = query.trim() !== '';
    if (searching && this.expandedBefore === undefined) this.expandedBefore = [...model.expanded];
    this.query.set(query);
    await model.refresh();
    if (!searching) {
      if (this.expandedBefore === undefined) return;
      model.expanded.clear();
      for (const key of this.expandedBefore) model.expanded.add(key);
      this.expandedBefore = undefined;
      await model.refresh();
      return;
    }
    await model.expandAll();
    let best: { key: string; score: number } | undefined;
    for (const { node, key } of model.rows) {
      if (node.kind !== 'branch') continue;
      const score = (match(query, branchName(node.ref)) as Match).score;
      if (best === undefined || score > best.score) best = { key, score };
    }
    if (best) model.select(best.key);
  }

  /** The node selected, as the toolbar acts on it. */
  selection(): BranchesSelection {
    const node = this.model.rows.find((row) => row.key === this.model.selected)?.node;
    const tracked = (branch: Branch | undefined) =>
      branch?.upstream === undefined ? {} : { upstream: branch.upstream };
    if (node?.kind === 'head') {
      const current = this.branches.get().find((branch) => branch.current);
      return { kind: 'head', branch: current && branchName(current.ref), ...tracked(current) };
    }
    if (node?.kind !== 'branch') return undefined;
    const { ref, current } = node;
    return {
      kind: 'branch',
      ref,
      current,
      ...tracked(this.branches.get().find((branch) => branch.ref === ref)),
    };
  }

  async reload(): Promise<void> {
    try {
      const [branches, tags] = await Promise.all([
        this.host.request('git.branches', { worktree: this.worktree }) as Promise<Branch[]>,
        paneSettings.showTags.peek()
          ? (this.host.request('git.tags', { path: this.worktree }) as Promise<string[]>).catch(
              (error: unknown) => {
                // The branches show without them.
                console.error('Reading the tags failed', error);
                return [];
              },
            )
          : [],
      ]);
      this.error.set(undefined);
      this.branches.set(branches);
      this.tags.set(tags);
      // Found again, as IntelliJ's, while it's on.
      if (this.onlyMy.peek()) this.mine = await this.findMine();
      await this.model.refresh();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

/** A name, with what the search matched in its full name (`full`, which ends with it) marked. */
function marked(name: string, full: string, query: string): Node | string {
  const found = query.trim() === '' ? undefined : match(query, full);
  if (!found) return name;
  const offset = full.length - name.length;
  const at = new Set(found.indices.map((i) => i - offset));
  const text = document.createDocumentFragment();
  // Runs of matched characters, and of the others.
  for (let i = 0; i < name.length;) {
    let end = i + 1;
    while (end < name.length && at.has(end) === at.has(i)) end++;
    const run = name.slice(i, end);
    text.append(at.has(i) ? <span class="playground-branches__match">{run}</span> : run);
    i = end;
  }
  return text;
}

/** A row: a directory or a branch, the one checked out marked as IntelliJ's. */
function row(node: BranchNode, query: string) {
  if (node.kind === 'head') {
    return [icon('git'), <span class="playground-branches__name">HEAD (Current Branch)</span>];
  }
  if (node.kind === 'group') {
    return [icon('folder'), <span class="playground-branches__name">{node.name}</span>];
  }
  return [
    // A favorite's star, as IntelliJ's.
    node.favorite ? favoriteIcon() : icon(isTag(node.ref) ? 'tag' : 'git'),
    <span
      class={
        node.current
          ? 'playground-branches__name playground-branches__name--current'
          : 'playground-branches__name'
      }
    >
      {marked(node.name, branchName(node.ref), query)}
    </span>,
  ];
}

/**
 * The branches pane: its search field over the tree, as IntelliJ's (BranchesTreeSearchField). A
 * double click or Enter on a branch, or on HEAD, filters the Log by it.
 */
export function BranchesPane(props: {
  branches: Branches;
  filter: (branch: BranchFilter) => void;
}): Node {
  const { branches } = props;
  let field!: HTMLInputElement;
  const tree = () =>
    field.closest('.playground-branches')?.querySelector<HTMLElement>('.cerebro-tree');
  const search = (query: string) => {
    field.value = query;
    void branches.search(query);
  };
  /** Searched, and nothing matched: the field says so, as IntelliJ's. */
  const nothing = () => {
    const query = branches.query.get();
    return (
      query.trim() !== '' &&
      ![...branches.branches.get().map((b) => branchName(b.ref)), ...branches.tags.get()].some(
        (name) => match(query, name),
      )
    );
  };
  return (
    <div
      class="playground-branches"
      on:keydown={(event) => {
        // Typing in the tree types in the field, as IntelliJ's speed search.
        const typed = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
        if (!typed || event.target === field || event.key === ' ') return;
        event.preventDefault();
        field.focus();
        search(field.value + event.key);
      }}
    >
      <div
        class={() =>
          nothing()
            ? 'playground-branches__search playground-branches__search--nothing'
            : 'playground-branches__search'
        }
      >
        {icon('search')}
        <input
          class="playground-branches__search-field"
          type="text"
          spellcheck={false}
          placeholder="Branch or tag"
          aria-label="Git branches search"
          ref={(input: HTMLInputElement) => {
            field = input;
          }}
          on:input={() => {
            void branches.search(field.value);
          }}
          on:keydown={(event) => {
            // Up and Down go on in the tree; Escape goes back to it once there's nothing to clear.
            const keys = event.key === 'ArrowDown' || event.key === 'ArrowUp';
            if (!keys && !(event.key === 'Escape' && field.value === '')) return;
            event.preventDefault();
            event.stopPropagation();
            const at = tree();
            at?.focus();
            if (keys) at?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key }));
          }}
        />
        {() =>
          branches.query.get() === '' ? null : (
            <button
              type="button"
              class="playground-branches__search-clear"
              aria-label="Clear"
              on:mousedown={(event) => {
                event.preventDefault();
              }}
              on:click={() => {
                search('');
              }}
            >
              {icon('clear')}
            </button>
          )
        }
      </div>
      {() => {
        const error = branches.error.get();
        return error === undefined ? (
          <TreeView
            model={branches.model}
            label="Branches"
            row={(node) => row(node, branches.query.peek())}
            onOpen={(node) => {
              props.filter(node.kind === 'branch' ? node.ref : 'HEAD');
            }}
          />
        ) : (
          <p class="playground-project__empty">{error}</p>
        );
      }}
    </div>
  );
}
