// Call Hierarchy, as IntelliJ's `CallHierarchy` (Ctrl+Alt+H; `CallHierarchyBrowserBase` and
// `CallHierarchyNodeDescriptor`, read from its source): the Hierarchy tool window shows "Callers of
// {name}", a tree of the function or method at the caret, what calls it, what calls those, and so
// on, each loaded as it's expanded, from the file's language server. A caller that calls more than
// once says how many times: " (2 usages)". A double click or Enter on a caller opens where it first
// makes the call; on the one asked about, its name. It shows the active worktree's last one; a new
// one replaces it. The window is registered the first time it's used, as IntelliJ's appears.

import { signal, untracked } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active } from './environments.js';
import { symbolIcon } from './icons.js';

interface Position {
  line: number;
  column: number;
}

/** A function or method in a call hierarchy, as the host's `lsp.prepareCalls` gives it. */
export interface Call {
  name: string;
  /** What the server adds to the name: TypeScript's, the file or class it's in. */
  detail?: string;
  kind?: string;
  path: string;
  /** Where its name starts. */
  at: Position;
  /** Where, in its own file, it calls the one it's under; none for the root. */
  calls: Position[];
  /** The server's item, given back to ask for its callers. */
  item: unknown;
}

/** What calls a call, from its file's language server; null with none. */
export type AskCallers = (call: Call) => Promise<readonly Call[] | null>;

/** A call hierarchy shown: its worktree, and the function or method it's of. */
export interface Hierarchy {
  worktree: string;
  root: Call;
  callers: AskCallers;
}

interface Node {
  key: string;
  call: Call;
}

/** The last one shown, by worktree. */
const shown = signal<ReadonlyMap<string, Hierarchy>>(new Map());

/** Shows a call hierarchy in the Hierarchy window, in place of the worktree's last one. */
export function showHierarchy(hierarchy: Hierarchy): void {
  shown.set(new Map([...shown.peek(), [hierarchy.worktree, hierarchy]]));
}

/** A function's or method's name, as IntelliJ's shows one: with its parentheses. */
const named = (call: Call) =>
  call.kind === 'function' || call.kind === 'method' || call.kind === 'constructor'
    ? `${call.name}()`
    : call.name;

/** The active worktree's last call hierarchy, as a tree; `open` opens a place in a file. */
export function HierarchyView(props: { open: (at: Position & { path: string }) => void }) {
  return (
    <div class="playground-occurrences">
      {() => {
        const env = active();
        const hierarchy = env && shown.get().get(env.id);
        if (!hierarchy) return <p class="playground-project__empty">No hierarchy</p>;
        // Made without tracking: the tree's model reads and writes its own state as it's made.
        return untracked(() => <Callers hierarchy={hierarchy} open={props.open} />);
      }}
    </div>
  );
}

/** The tree, under its title: the root expanded, as IntelliJ's opens. */
function Callers(props: { hierarchy: Hierarchy; open: (at: Position & { path: string }) => void }) {
  const { root, callers } = props.hierarchy;
  const top: Node = { key: '0', call: root };
  const model = new TreeModel<Node>({
    children: async (node) => {
      if (node === undefined) return [top];
      const found = (await callers(node.call)) ?? [];
      return found.map((call, index) => ({ key: `${node.key}/${String(index)}`, call }));
    },
    key: (node) => node.key,
    isLeaf: () => false,
  });
  model.expand(top);
  const title = `Callers of ${named(root)}`;
  return [
    <div class="playground-occurrences__title">{title}</div>,
    <TreeView
      model={model}
      label={title}
      openParents
      row={(node) => {
        const { call } = node;
        const usages = call.calls.length;
        return [
          symbolIcon(call.kind),
          <span class="playground-occurrences__name">{named(call)}</span>,
          usages > 1 ? (
            <span class="playground-occurrences__count">{`(${String(usages)} usages)`}</span>
          ) : null,
          call.detail ? <span class="playground-occurrences__count">{call.detail}</span> : null,
        ];
      }}
      onOpen={(node) => {
        const { call } = node;
        props.open({ path: call.path, ...(call.calls[0] ?? call.at) });
      }}
    />,
  ];
}
