// Call Hierarchy, as IntelliJ's `CallHierarchy` (Ctrl+Alt+H; `CallHierarchyBrowserBase` and
// `CallHierarchyNodeDescriptor`, read from its source): the Hierarchy tool window shows "Callers of
// {name}", a tree of the function or method at the caret, what calls it, what calls those, and so
// on, each loaded as it's expanded, from the file's language server; or, with Callee Methods
// Hierarchy, "Callees of {name}", what it calls. A node that's called more than once says how many
// times: " (2 usages)". A double click or Enter on one opens where the call is: a caller's, in its
// own file; a callee's, in the file of the one it's under; the one asked about, its name. It shows
// the active worktree's last one, starting with its callers; a new one replaces it. The window is
// registered the first time it's used, as IntelliJ's appears.
// Its toolbar, IntelliJ's in its order (`prependActions`, then `HierarchyBrowserBaseEx` and
// `HierarchyBrowserBase`'s `appendActions`), with what Cerebro has of it: Caller and Callee Methods
// Hierarchy, Sort Alphabetically (by name, numbers by value: `AlphaComparator`), Refresh,
// Navigate with Single Click (selecting a node opens it, the focus left in the tree) and Collapse
// All. Sorting and Navigate with Single Click are off to start with (`HierarchyBrowserManager`'s
// state) and kept in the browser's storage.

import { signal, untracked } from '@cerebro-ide/reactive';
import { effect } from '@cerebro-ide/reactive';
import { onCleanup } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { TreeModel, TreeView, type TreeRow } from '@cerebro-ide/ui-tree';
import { natural } from './compare.js';
import { active } from './environments.js';
import { provideOccurrences, treeOccurrences } from './occurrences.js';
import { icon, symbolIcon } from './icons.js';

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
  /**
   * Where it's called: a caller's, in its own file; a callee's, in the file of the one it's under.
   * None for the root.
   */
  calls: Position[];
  /** The server's item, given back to ask for its callers or callees. */
  item: unknown;
}

/** What calls a call, or what it calls, from its file's language server; null with none. */
export type AskCalls = (call: Call) => Promise<readonly Call[] | null>;

/** A call hierarchy shown: its worktree, and the function or method it's of. */
export interface Hierarchy {
  worktree: string;
  root: Call;
  callers: AskCalls;
  callees: AskCalls;
}

/** Which way the tree goes: IntelliJ's view types. */
type Kind = 'callers' | 'callees';

interface Node {
  key: string;
  call: Call;
  /** Where the call is: the file it's in, and the place. */
  site: Position & { path: string };
}

/** The last one shown, by worktree. */
const shown = signal<ReadonlyMap<string, Hierarchy>>(new Map());

/** Shows a call hierarchy in the Hierarchy window, in place of the worktree's last one. */
export function showHierarchy(hierarchy: Hierarchy): void {
  shown.set(new Map([...shown.peek(), [hierarchy.worktree, hierarchy]]));
}

const SETTINGS_KEY = 'cerebro.hierarchy';

/** The toolbar's settings, as kept; IntelliJ's defaults, both off. */
export function readHierarchySettings(): { alphabetical: boolean; toSource: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as {
      alphabetical?: unknown;
      toSource?: unknown;
    };
    return { alphabetical: stored.alphabetical === true, toSource: stored.toSource === true };
  } catch {
    return { alphabetical: false, toSource: false };
  }
}

const settings = readHierarchySettings();
const alphabetical = signal(settings.alphabetical);
const toSource = signal(settings.toSource);

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ alphabetical: alphabetical.peek(), toSource: toSource.peek() }),
    );
  } catch {
    // Not kept: it still applies until the page is reloaded.
  }
}

/** The tree shown, which the toolbar acts on: its way, and its model. */
const shownTree = signal<{ kind: Kind; model: TreeModel<Node> } | undefined>(undefined);
/** The way each worktree's last hierarchy is shown, while it's the last. */
const kinds = new WeakMap<Hierarchy, ReturnType<typeof signal<Kind>>>();
const kindOf = (hierarchy: Hierarchy) => {
  let kind = kinds.get(hierarchy);
  if (!kind) {
    kind = signal<Kind>('callers');
    kinds.set(hierarchy, kind);
  }
  return kind;
};

/** The toolbar's commands. */
export function setupCallHierarchy(services: MenuServices): void {
  const { commands } = services;
  const showing = () => {
    const env = active();
    return env && shown.get().get(env.id);
  };
  for (const [id, label, kind] of [
    ['hierarchy.callers', 'Caller Methods Hierarchy', 'callers'],
    ['hierarchy.callees', 'Callee Methods Hierarchy', 'callees'],
  ] as const) {
    commands.register({
      id,
      label,
      icon: kind,
      enabled: () => showing() !== undefined,
      checked: () => shownTree.get()?.kind === kind,
      run: () => {
        kindOf(showing() as Hierarchy).set(kind);
      },
    });
  }
  for (const [id, label, setting, name] of [
    ['hierarchy.sortAlphabetically', 'Alphabetically', alphabetical, 'sorted'],
    ['hierarchy.autoscrollToSource', 'Navigate with Single Click', toSource, 'autoscroll'],
  ] as const) {
    commands.register({
      id,
      label,
      icon: name,
      checked: () => setting.get(),
      run: () => {
        setting.set(!setting.peek());
        saveSettings();
      },
    });
  }
  commands.register({
    id: 'hierarchy.refresh',
    label: 'Refresh',
    icon: 'refresh',
    enabled: () => shownTree.get() !== undefined,
    run: () => shownTree.peek()?.model.refresh(),
  });
  commands.register({
    id: 'hierarchy.collapseAll',
    label: 'Collapse All',
    icon: 'collapseAll',
    enabled: () => shownTree.get() !== undefined,
    run: () => {
      shownTree.peek()?.model.collapseAll();
    },
  });
}

/** A function's or method's name, as IntelliJ's shows one: with its parentheses. */
const named = (call: Call) =>
  call.kind === 'function' || call.kind === 'method' || call.kind === 'constructor'
    ? `${call.name}()`
    : call.name;

/** The active worktree's last call hierarchy, as a tree; `open` opens a place in a file. */
export function HierarchyView(props: {
  services: MenuServices;
  open: (at: Position & { path: string }, focus: boolean) => void;
}) {
  return (
    <div class="playground-occurrences">
      {() => {
        const env = active();
        const hierarchy = env && shown.get().get(env.id);
        if (!hierarchy) return <p class="playground-project__empty">No hierarchy</p>;
        const kind = kindOf(hierarchy).get();
        // Made without tracking: the tree's model reads and writes its own state as it's made.
        return untracked(() => (
          <Calls hierarchy={hierarchy} kind={kind} services={props.services} open={props.open} />
        ));
      }}
    </div>
  );
}

const TOOLBAR = [
  ['hierarchy.callers', 'callers'],
  ['hierarchy.callees', 'callees'],
  ['hierarchy.sortAlphabetically', 'sorted'],
  ['hierarchy.refresh', 'refresh'],
  ['hierarchy.autoscrollToSource', 'autoscroll'],
  ['hierarchy.collapseAll', 'collapseAll'],
] as const;

/** The toolbar, then the tree under its title: the root expanded, as IntelliJ's opens. */
function Calls(props: {
  hierarchy: Hierarchy;
  kind: Kind;
  services: MenuServices;
  open: (at: Position & { path: string }, focus: boolean) => void;
}) {
  const { root } = props.hierarchy;
  const ask = props.hierarchy[props.kind];
  const top: Node = { key: '0', call: root, site: { path: root.path, ...root.at } };
  const model = new TreeModel<Node>({
    children: async (node) => {
      if (node === undefined) return [top];
      const found = (await ask(node.call)) ?? [];
      const nodes = found.map((call, index) => ({
        key: `${node.key}/${String(index)}`,
        call,
        // A caller calls in its own file; the one it's under calls a callee in its file. With no
        // place given, its name.
        site: call.calls[0]
          ? { path: props.kind === 'callers' ? call.path : node.call.path, ...call.calls[0] }
          : { path: call.path, ...call.at },
      }));
      return alphabetical.peek()
        ? nodes.sort((a, b) => natural(named(a.call), named(b.call)))
        : nodes;
    },
    key: (node) => node.key,
    isLeaf: () => false,
  });
  model.expand(top);
  shownTree.set({ kind: props.kind, model });
  // Sorted otherwise: read again, what's expanded and selected kept.
  let sorting = alphabetical.peek();
  const resorting = effect(() => {
    if (alphabetical.get() !== sorting) {
      sorting = alphabetical.peek();
      void model.refresh();
    }
    return undefined;
  });
  // Navigate with Single Click: the node selected opened, the focus left in the tree; turned on,
  // it waits for the next one, as IntelliJ's (`setAutoScrollMode` alone).
  let opened: string | undefined;
  const following = effect(() => {
    const key = model.selected;
    if (key === undefined || key === opened) return undefined;
    opened = key;
    if (!untracked(() => toSource.get())) return undefined;
    const row = untracked(() => model.rows.find((r) => r.key === key)) as TreeRow<Node>;
    props.open(row.node.site, false);
    return undefined;
  });
  // Every node, for Next and Previous Occurrence.
  onCleanup(
    provideOccurrences(
      'hierarchy',
      treeOccurrences(
        model,
        () => true,
        (node) => {
          props.open(node.site, true);
        },
      ),
    ),
  );
  onCleanup(() => {
    resorting.dispose();
    following.dispose();
    // A tree goes before the next one's made.
    shownTree.set(undefined);
  });
  const title = `${props.kind === 'callers' ? 'Callers' : 'Callees'} of ${named(root)}`;
  return [
    <div class="playground-changes__toolbar" role="toolbar" aria-label="Hierarchy">
      {TOOLBAR.map(([command, name]) => (
        <ToolbarButton commands={props.services.commands} command={command} icon={icon(name)} />
      ))}
    </div>,
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
        props.open(node.site, true);
      }}
    />,
  ];
}
