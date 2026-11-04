// The Log's branches pane, as IntelliJ's: HEAD (Current Branch), then the local branches and the
// remote ones (under their remote), grouped by directory (the parts of a name before a slash). A
// double click or Enter on one filters the log by it, as IntelliJ's Update Branch Filter.
//
// From IntelliJ (BranchesTreeModel, BranchTreeNodeComparator): the groups and their names, and
// the order within one: the branch checked out, then directories, then branches, by name. Claims:
// the order of names (the system's, case and numbers aside), and the groups starting expanded.

import { signal } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import type { Host } from './environments.js';
import { icon } from './icons.js';

/** A branch, as the host's `git.branches` gives it. */
export interface Branch {
  ref: string;
  hash: string;
  current: boolean;
}

interface Group {
  kind: 'group';
  key: string;
  name: string;
  children: BranchNode[];
}

interface BranchItem {
  kind: 'branch';
  ref: string;
  name: string;
  current: boolean;
}

export type BranchNode = { kind: 'head' } | Group | BranchItem;

/** What the Log is filtered by: a branch's ref in full, or HEAD. */
export type BranchFilter = string;

const LOCAL = 'refs/heads/';
const REMOTE = 'refs/remotes/';

/** A branch's name as the Log shows it: `main`, `origin/main`; HEAD as itself. */
export const branchName = (ref: string): string =>
  ref.startsWith(LOCAL) ? ref.slice(LOCAL.length) : ref.replace(REMOTE, '');

const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const weight = (node: Group | BranchItem) => {
  if (node.kind === 'branch') return node.current ? 0 : 2;
  return 1;
};

/** Branches grouped by the parts of their names before a slash, under `key`. */
function grouped(
  key: string,
  branches: readonly { branch: Branch; path: string[] }[],
): (Group | BranchItem)[] {
  const nodes: (Group | BranchItem)[] = [];
  const groups = new Map<string, { branch: Branch; path: string[] }[]>();
  for (const { branch, path } of branches) {
    const [first, ...rest] = path as [string, ...string[]];
    if (rest.length === 0) {
      nodes.push({ kind: 'branch', ref: branch.ref, name: first, current: branch.current });
    } else {
      groups.set(first, [...(groups.get(first) ?? []), { branch, path: rest }]);
    }
  }
  for (const [name, children] of groups) {
    const at = `${key}/${name}`;
    nodes.push({ kind: 'group', key: at, name, children: grouped(at, children) });
  }
  return nodes.sort((a, b) => weight(a) - weight(b) || byName(a.name, b.name));
}

/** The pane's tree: HEAD, then Local and Remote, each if there are any. */
export function branchTree(branches: readonly Branch[]): BranchNode[] {
  const under = (prefix: string) =>
    branches
      .filter((branch) => branch.ref.startsWith(prefix))
      .map((branch) => ({ branch, path: branch.ref.slice(prefix.length).split('/') }));
  const tree: BranchNode[] = [{ kind: 'head' }];
  for (const [name, prefix] of [
    ['Local', LOCAL],
    ['Remote', REMOTE],
  ] as const) {
    const children = grouped(name, under(prefix));
    if (children.length > 0) tree.push({ kind: 'group', key: name, name, children });
  }
  return tree;
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
      node === undefined ? branchTree(this.branches.peek()) : (node as Group).children,
    key: keyOf,
    isLeaf: (node) => node.kind !== 'group',
  });

  constructor(
    private readonly host: Host,
    private readonly worktree: string,
  ) {
    for (const group of ['Local', 'Remote']) this.model.expanded.add(`group:${group}`);
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
    icon('git'),
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
