// The Log's branches pane, as IntelliJ's: HEAD (Current Branch), then the local branches and the
// remote ones (under their remote), grouped by directory (the parts of a name before a slash). A
// double click or Enter on one filters the log by it, as IntelliJ's Update Branch Filter.
//
// From IntelliJ (BranchesTreeModel, BranchTreeNodeComparator): the groups and their names, and
// the order within one: the branch checked out, then directories, then branches, by name. Claims:
// the order of names (the system's, case and numbers aside), and the groups starting expanded.

import { signal } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { isFavorite, repositoryOf } from './branch-favorites.js';
import type { Host } from './environments.js';
import { favoriteIcon, icon } from './icons.js';

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

/** A branch's name as the Log shows it: `main`, `origin/main`; HEAD as itself. */
export const branchName = (ref: string): string =>
  ref.startsWith(LOCAL) ? ref.slice(LOCAL.length) : ref.replace(REMOTE, '');

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
function grouped(
  key: string,
  branches: readonly { branch: Branch; path: string[] }[],
  favorite: (ref: string) => boolean,
): (Group | BranchItem)[] {
  const nodes: (Group | BranchItem)[] = [];
  const groups = new Map<string, { branch: Branch; path: string[] }[]>();
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
 * The pane's tree: HEAD, then Local and Remote, each if there are any. Grouped by directory, or
 * not: a remote's branches are under it either way, as IntelliJ's.
 */
export function branchTree(
  branches: readonly Branch[],
  byDirectory = true,
  favorite: (ref: string) => boolean = () => false,
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
  const tree: BranchNode[] = [{ kind: 'head' }];
  for (const [name, prefix] of [
    ['Local', LOCAL],
    ['Remote', REMOTE],
  ] as const) {
    const children = grouped(name, under(prefix), favorite);
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
}

/** What a single click on a branch does, as IntelliJ's pane settings ("On Single Click"). */
export type OnSelection = 'filter' | 'navigate' | undefined;

/** Where the pane's settings are kept: one for every repository, as IntelliJ's. */
const SETTINGS = 'cerebro.log.branchesPane';

/**
 * The pane's settings, as kept: a single click doing nothing, and grouped by directory, to start
 * with, as IntelliJ's (`Change.Log.Filter.on.Branch.Selection`,
 * `Navigate.Log.To.Branch.on.Branch.Selection`, `git.branches.group.by.directory`).
 */
export function readPaneSettings(): { onSelection: OnSelection; byDirectory: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Record<string, unknown>;
    const { onSelection } = stored;
    return {
      onSelection: onSelection === 'filter' || onSelection === 'navigate' ? onSelection : undefined,
      byDirectory: stored.byDirectory !== false,
    };
  } catch {
    return { onSelection: undefined, byDirectory: true };
  }
}

const settings = readPaneSettings();
export const paneSettings = {
  onSelection: signal<OnSelection>(settings.onSelection),
  byDirectory: signal(settings.byDirectory),
};

/** Keeps the pane's settings as they are now. */
export function savePaneSettings(): void {
  try {
    localStorage.setItem(
      SETTINGS,
      JSON.stringify({
        onSelection: paneSettings.onSelection.peek(),
        byDirectory: paneSettings.byDirectory.peek(),
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
  readonly error = signal<string | undefined>(undefined);
  readonly model = new TreeModel<BranchNode>({
    children: (node) =>
      // Only groups have children to ask for.
      node === undefined
        ? branchTree(this.branches.peek(), paneSettings.byDirectory.peek(), (ref) =>
            isFavorite(this.repository, ref),
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
    for (const group of ['Local', 'Remote']) this.model.expanded.add(`group:${group}`);
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
      const branches = (await this.host.request('git.branches', {
        worktree: this.worktree,
      })) as Branch[];
      this.error.set(undefined);
      this.branches.set(branches);
      await this.model.refresh();
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}

/** A row: a directory or a branch, the one checked out marked as IntelliJ's. */
function row(node: BranchNode) {
  if (node.kind === 'head') {
    return [icon('git'), <span class="playground-branches__name">HEAD (Current Branch)</span>];
  }
  if (node.kind === 'group') {
    return [icon('folder'), <span class="playground-branches__name">{node.name}</span>];
  }
  return [
    // A favorite's star, as IntelliJ's.
    node.favorite ? favoriteIcon() : icon('git'),
    <span
      class={
        node.current
          ? 'playground-branches__name playground-branches__name--current'
          : 'playground-branches__name'
      }
    >
      {node.name}
    </span>,
  ];
}

/** The branches pane: a double click or Enter on a branch, or on HEAD, filters the Log by it. */
export function BranchesPane(props: {
  branches: Branches;
  filter: (branch: BranchFilter) => void;
}): Node {
  const { branches } = props;
  return (
    <div class="playground-branches">
      {() => {
        const error = branches.error.get();
        return error === undefined ? (
          <TreeView
            model={branches.model}
            label="Branches"
            row={row}
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
