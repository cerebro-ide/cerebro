// The Commit tool window's changes, as IntelliJ's: the active worktree's files changed since its last
// commit ("Changes"), its untracked files ("Unversioned Files"), its ignored ones when asked for
// ("Ignored Files"), then each of its agent's turns (the host keeps a snapshot before and after
// each), the latest first, with the files the turn changed. Files are grouped by directory unless
// that's turned off. Read through the host every few seconds (an agent changes files without
// telling). Each environment keeps its own.
//
// A toolbar above the tree, as IntelliJ's: Refresh, Rollback, Show Diff, View Options (group by
// directory, show ignored files), Select Opened File, Expand All and Collapse All. Opening a file
// (double click, Enter, F4) opens the file; Ctrl/Cmd+D or the context menu opens its diff.

import { formatSequence } from '@cerebro-ide/commands';
import type { Tab } from '@cerebro-ide/layout';
import { onCleanup } from '@cerebro-ide/jsx';
import { computed, signal, untracked } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openContextMenu, openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active, currentHost, gitRepository, hostFor } from './environments.js';
import { icon } from './icons.js';

export interface Change {
  path: string;
  /** `ignored`: listed only when asked for; a folder git ignores whole ends with `/`. */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored';
  from?: string;
}

/** An agent's turn, as the host keeps it: its snapshots before and after. */
export interface Turn {
  id: string;
  start: string;
  end: string;
  prompt: string;
  time: number;
}

/** Two commits to compare: a turn's snapshots. */
export interface Range {
  from: string;
  to: string;
}

type Group = 'changes' | 'unversioned' | 'ignored';

/** A row: a group of files, a folder in one, a turn, or a file changed in any of them. */
type Item =
  | { kind: 'group'; group: Group; count: number }
  | { kind: 'folder'; key: string; name: string; count: number; children: Item[] }
  | { kind: 'turn'; turn: Turn }
  | { kind: 'change'; key: string; change: Change; turn?: Turn };

/**
 * A diff tab's id: the file's path in the worktree, marked as a diff, against its last commit
 * (`diff:path`) or between two commits (`diff@from..to:path`).
 */
const DIFF = 'diff';

export const diffTab = (path: string, range?: Range): Tab => ({
  id: range ? `${DIFF}@${range.from}..${range.to}:${path}` : `${DIFF}:${path}`,
  title: path.split('/').at(-1) as string,
});

const DIFF_ID = /^diff(?:@([^.:]+)\.\.([^:]+))?:(.*)$/s;

/** The file a diff tab shows, if it's one. */
export function diffPath(tabId: string): string | undefined {
  return DIFF_ID.exec(tabId)?.[3];
}

/** The commits a diff tab compares, if it compares two. */
export function diffRange(tabId: string): Range | undefined {
  const match = DIFF_ID.exec(tabId);
  return match?.[1] === undefined ? undefined : { from: match[1], to: match[2] as string };
}

/** How often the list is read again while it shows. */
const REFRESH_MS = 2000;

const GROUPS: Readonly<Record<Group, string>> = {
  changes: 'Changes',
  unversioned: 'Unversioned Files',
  ignored: 'Ignored Files',
};

const groupKey = (group: Group) => `\u0000${group}`;

/** The view options, as IntelliJ's View Options menu: kept in the browser's storage. */
const OPTIONS_KEY = 'cerebro.changes.view';

function readOptions(): { byDirectory: boolean; showIgnored: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Record<string, unknown>;
    return { byDirectory: stored.byDirectory !== false, showIgnored: stored.showIgnored === true };
  } catch {
    return { byDirectory: true, showIgnored: false };
  }
}

const options = readOptions();
/** Files grouped by directory, as IntelliJ's default. */
const byDirectory = signal(options.byDirectory);
const showIgnored = signal(options.showIgnored);

function saveOptions(): void {
  try {
    localStorage.setItem(
      OPTIONS_KEY,
      JSON.stringify({ byDirectory: byDirectory.peek(), showIgnored: showIgnored.peek() }),
    );
  } catch {
    // Not kept: the options still apply until the page is reloaded.
  }
}

/** A row's key, unique in the tree: files and folders are under their group or turn. */
const fileKey = (scope: string, path: string) => `${scope}:${path}`;

const isDirectory = (change: Change) => change.path.endsWith('/');

/**
 * A list of files as rows: by name, or grouped by directory, folders first. A folder holding only
 * one folder shows as one row (`src/main`), as IntelliJ shows them. `opened` is told each folder's
 * key, to expand the ones it hasn't seen before.
 */
function tree(
  scope: string,
  changes: readonly Change[],
  turn: Turn | undefined,
  opened: (key: string) => void,
): Item[] {
  const file = (change: Change): Item => ({
    kind: 'change',
    key: fileKey(scope, change.path),
    change,
    ...(turn ? { turn } : {}),
  });
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  if (!byDirectory.peek()) return sorted.map(file);
  interface Dir {
    dirs: Map<string, Dir>;
    files: Change[];
  }
  const root: Dir = { dirs: new Map(), files: [] };
  for (const change of sorted) {
    const parts = change.path.replace(/\/$/, '').split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(change);
  }
  const count = (dir: Dir): number =>
    dir.files.length + [...dir.dirs.values()].reduce((sum, d) => sum + count(d), 0);
  const items = (dir: Dir, prefix: string): Item[] => [
    ...[...dir.dirs].map(([name, sub]): Item => {
      let label = name;
      let inner = sub;
      // A folder holding only one folder shows as one row.
      while (inner.files.length === 0 && inner.dirs.size === 1) {
        const [childName, child] = [...inner.dirs][0] as [string, Dir];
        label = `${label}/${childName}`;
        inner = child;
      }
      const key = fileKey(scope, `${prefix}${label}/`);
      opened(key);
      return {
        kind: 'folder',
        key,
        name: label,
        count: count(inner),
        children: items(inner, `${prefix}${label}/`),
      };
    }),
    ...dir.files.map(file),
  ];
  return items(root, '');
}

interface Changes {
  model: TreeModel<Item>;
  /** Whether there's nothing to show: no changes, no turns. */
  empty: () => boolean;
  /** Reads the lists again; the tree is redrawn only if they changed, or if `force`. */
  refresh: (force?: boolean) => Promise<void>;
  /** The uncommitted files that are tracked: what can be rolled back. */
  tracked: () => readonly Change[];
}

const lists = new Map<string, Changes>();

function changesOf(worktree: string): Changes {
  let changes = lists.get(worktree);
  if (!changes) {
    const host = hostFor(worktree) as NonNullable<ReturnType<typeof hostFor>>;
    let tracked: Change[] = [];
    let unversioned: Change[] = [];
    let ignored: Change[] = [];
    let turns: Turn[] = [];
    /** A turn's changes never change: read once, when it's first expanded. */
    const turnChanges = new Map<string, Promise<Change[]>>();
    // What was last read, as JSON: the tree is reloaded only when it changes. Reloading draws the
    // rows again: not while nothing changed, under the user's pointer.
    let last = '';
    // Folders and groups are expanded when they first show, as IntelliJ's changes are; after
    // that, as the user left them.
    const seen = new Set<string>();
    const opened = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      model.expanded.add(key);
    };
    const model: TreeModel<Item> = new TreeModel<Item>({
      children: async (item) => {
        if (item === undefined) {
          const groups: Item[] = [{ kind: 'group', group: 'changes', count: tracked.length }];
          if (unversioned.length > 0) {
            groups.push({ kind: 'group', group: 'unversioned', count: unversioned.length });
          }
          if (ignored.length > 0) {
            groups.push({ kind: 'group', group: 'ignored', count: ignored.length });
          }
          return [...groups, ...turns.map((turn): Item => ({ kind: 'turn', turn }))];
        }
        if (item.kind === 'group') {
          const files = { changes: tracked, unversioned, ignored }[item.group];
          return tree(groupKey(item.group), files, undefined, opened);
        }
        if (item.kind === 'folder') return item.children;
        const { turn } = item as { turn: Turn };
        let read = turnChanges.get(turn.id);
        if (!read) {
          read = host.request('git.changes', {
            path: worktree,
            from: turn.start,
            to: turn.end,
          }) as Promise<Change[]>;
          turnChanges.set(turn.id, read);
          read.catch(() => turnChanges.delete(turn.id));
        }
        return tree(`turn:${turn.id}`, await read, turn, opened);
      },
      key: (item) =>
        item.kind === 'group'
          ? groupKey(item.group)
          : item.kind === 'turn'
            ? `turn:${item.turn.id}`
            : item.key,
      isLeaf: (item) => item.kind === 'change',
    });
    opened(groupKey('changes'));
    opened(groupKey('unversioned'));
    // Ignored files can be many: their group starts closed.
    seen.add(groupKey('ignored'));
    // No changes and no turns: the groups' rows would show nothing.
    const empty = computed(() => {
      const rows = model.rows;
      const first = rows[0]?.node;
      return rows.length === 1 && first?.kind === 'group' && first.count === 0;
    });
    changes = {
      model,
      empty: () => empty.get(),
      tracked: () => tracked,
      refresh: async (force = false) => {
        const ignoredToo = showIgnored.peek();
        const [readChanges, readTurns, readIgnored] = (await Promise.all([
          host.request('git.changes', { path: worktree }),
          host.request('agent.turns', { path: worktree }),
          ignoredToo ? host.request('git.ignored', { path: worktree }) : [],
        ])) as [Change[], Turn[], string[]];
        const json = JSON.stringify([readChanges, readTurns, readIgnored, byDirectory.peek()]);
        if (json === last && !force) return;
        last = json;
        tracked = readChanges.filter((change) => change.status !== 'untracked');
        unversioned = readChanges.filter((change) => change.status === 'untracked');
        ignored = readIgnored.map((path) => ({ path, status: 'ignored' }));
        turns = readTurns;
        await model.refresh();
      },
    };
    lists.set(worktree, changes);
  }
  return changes;
}

/**
 * The active worktree's changes, once the Commit window has shown them. Only looked up, not made:
 * commands' `enabled` call this, and may run in a computed value (Search Everywhere's list), which
 * must not write to observables, as making the tree does.
 */
function current(): Changes | undefined {
  const env = active();
  return env && currentHost() && gitRepository.get() ? lists.get(env.id) : undefined;
}

/** Reads every worktree's lists again: after the view options change. */
function refreshAll(): void {
  for (const changes of lists.values()) {
    changes.refresh().catch((error: unknown) => {
      console.error('Reading the changes failed', error);
    });
  }
}

/** The selected row's item. */
function selectedItem(changes: Changes): Item | undefined {
  const { model } = changes;
  return model.rows.find((row) => row.key === model.selected)?.node;
}

/** The selected file, if a file is selected. */
function selectedChange(
  changes: Changes | undefined,
): Extract<Item, { kind: 'change' }> | undefined {
  const item = changes && selectedItem(changes);
  return item?.kind === 'change' ? item : undefined;
}

/** The files a selected row stands for: itself, or all of its folder's or group's. */
function filesUnder(item: Item | undefined, changes: Changes): Extract<Item, { kind: 'change' }>[] {
  if (!item || item.kind === 'turn') return [];
  if (item.kind === 'change') return [item];
  const children =
    item.kind === 'folder'
      ? item.children
      : item.group === 'changes'
        ? changes.tracked().map((change): Item => ({ kind: 'change', key: change.path, change }))
        : [];
  return children.flatMap((child) => filesUnder(child, changes));
}

/** What rollback acts on: the uncommitted, tracked files the selection stands for. */
function rollbackable(changes: Changes | undefined): Change[] {
  if (!changes) return [];
  return filesUnder(selectedItem(changes), changes)
    .filter(
      (item) =>
        !item.turn && item.change.status !== 'untracked' && item.change.status !== 'ignored',
    )
    .map((item) => item.change);
}

/** A file to open: not one that's gone, nor a folder git ignores whole. */
function openable(
  item: Extract<Item, { kind: 'change' }> | undefined,
): item is Extract<Item, { kind: 'change' }> {
  return item !== undefined && item.change.status !== 'deleted' && !isDirectory(item.change);
}

/** What the Commit window's commands get from its toolbar and menus: they act on it. */
const FROM_VIEW = { source: 'changes' };

/** Whether the Commit window has the keyboard: its shortcuts only work then. */
const focused = signal(false);

export interface ChangesSetup {
  /** Opens a tab in the active editor. */
  open: (tab: Tab) => void;
  /** The active editor tab's id: Select Opened File selects its file. */
  activeTab: () => string | undefined;
}

/** The Commit window's commands, shortcuts and menus. */
export function setupChanges(services: MenuServices, setup: ChangesSetup): void {
  const { commands, menus, keymap } = services;
  /** From the window's toolbar or menus, or a shortcut while it has the keyboard. */
  const here = (context: unknown) =>
    (context as { source?: string } | undefined)?.source === 'changes' || focused.get();
  const fail = (title: string) => (error: unknown) => {
    openDialog({
      title,
      content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
    });
  };
  const openFile = (item: Extract<Item, { kind: 'change' }>) => {
    setup.open({ id: item.change.path, title: item.change.path.split('/').at(-1) as string });
  };

  commands.register({
    id: 'changes.refresh',
    label: '&Refresh',
    icon: 'refresh',
    enabled: (c) => here(c) && current() !== undefined,
    run: () => current()?.refresh(true).catch(fail('Couldn’t Read the Changes')),
  });
  commands.register({
    id: 'changes.rollback',
    label: 'Roll&back',
    icon: 'rollback',
    dialog: true,
    enabled: (c) => here(c) && rollbackable(current()).length > 0,
    run: () => rollback(current() as Changes),
  });
  commands.register({
    id: 'changes.showDiff',
    label: 'Show &Diff',
    icon: 'diff',
    enabled: (c) => {
      const item = selectedChange(current());
      return here(c) && item !== undefined && item.change.status !== 'ignored';
    },
    run: () => {
      const { change, turn } = selectedChange(current()) as Extract<Item, { kind: 'change' }>;
      setup.open(diffTab(change.path, turn && { from: turn.start, to: turn.end }));
    },
  });
  commands.register({
    id: 'changes.jumpToSource',
    label: '&Jump to Source',
    enabled: (c) => here(c) && openable(selectedChange(current())),
    run: () => {
      openFile(selectedChange(current()) as Extract<Item, { kind: 'change' }>);
    },
  });
  commands.register({
    id: 'changes.groupByDirectory',
    label: '&Directory',
    checked: () => byDirectory.get(),
    enabled: (c) => here(c),
    run: () => {
      byDirectory.set(!byDirectory.peek());
      saveOptions();
      refreshAll();
    },
  });
  commands.register({
    id: 'changes.showIgnored',
    label: '&Ignored Files',
    checked: () => showIgnored.get(),
    enabled: (c) => here(c),
    run: () => {
      showIgnored.set(!showIgnored.peek());
      saveOptions();
      refreshAll();
    },
  });
  commands.register({
    id: 'changes.selectOpened',
    label: 'Select &Opened File',
    icon: 'locate',
    enabled: (c) => here(c) && current() !== undefined && setup.activeTab() !== undefined,
    run: () => {
      const tab = setup.activeTab() as string;
      void reveal(current() as Changes, diffPath(tab) ?? tab);
    },
  });
  commands.register({
    id: 'changes.expandAll',
    label: '&Expand All',
    icon: 'expandAll',
    enabled: (c) => here(c) && current() !== undefined,
    run: () => current()?.model.expandAll(),
  });
  commands.register({
    id: 'changes.collapseAll',
    label: '&Collapse All',
    icon: 'collapseAll',
    enabled: (c) => here(c) && current() !== undefined,
    run: () => {
      current()?.model.collapseAll();
    },
  });

  // IntelliJ's shortcuts.
  keymap?.bindDefault('Mod+D', 'changes.showDiff');
  keymap?.bindDefault('F4', 'changes.jumpToSource');
  keymap?.bindDefault('Mod+Alt+Z', 'changes.rollback');
  keymap?.bindDefault('Mod+P', 'changes.groupByDirectory');
  keymap?.bindDefault('Mod+=', 'changes.expandAll');
  keymap?.bindDefault('Mod++', 'changes.expandAll');
  keymap?.bindDefault('Mod+-', 'changes.collapseAll');

  menus.contribute({ menu: 'changes/view', item: { heading: 'Group By' }, group: 'a' });
  menus.contribute({
    menu: 'changes/view',
    item: { command: 'changes.groupByDirectory' },
    group: 'a',
  });
  menus.contribute({ menu: 'changes/view', item: { heading: 'Show' }, group: 'b' });
  menus.contribute({ menu: 'changes/view', item: { command: 'changes.showIgnored' }, group: 'b' });

  menus.contribute({ menu: 'changes/item', item: { command: 'changes.showDiff' }, group: 'a' });
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.jumpToSource' }, group: 'a' });
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.rollback' }, group: 'b' });
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.refresh' }, group: 'c' });

  /** Asks, as IntelliJ's Rollback Changes dialog, then rolls the selection's files back. */
  async function rollback(changes: Changes): Promise<void> {
    const files = rollbackable(changes);
    const added = files.some((change) => change.status === 'added');
    const deleteAdded = signal(false);
    const confirmed = await openDialog<true>({
      title: 'Rollback Changes',
      ok: { label: 'Rollback', accept: () => true },
      width: 480,
      content: () => (
        <div class="playground-rollback">
          <p>
            {files.length === 1
              ? 'This file will be rolled back:'
              : `These ${String(files.length)} files will be rolled back:`}
          </p>
          <ul class="playground-rollback__files">
            {files.map((change) => (
              <li class={`playground-change playground-change--${change.status}`}>{change.path}</li>
            ))}
          </ul>
          {added ? (
            <label class="playground-rollback__option">
              <input
                type="checkbox"
                checked={() => deleteAdded.get()}
                on:change={(event) => {
                  deleteAdded.set((event.currentTarget as HTMLInputElement).checked);
                }}
              />
              Delete local copies of added files
            </label>
          ) : null}
        </div>
      ),
    }).result;
    if (!confirmed) return;
    const env = active();
    if (!env) return;
    try {
      await hostFor(env.id)?.request('git.rollback', {
        path: env.id,
        files: files.map((change) => change.path),
        deleteAdded: deleteAdded.peek(),
      });
      await changes.refresh(true);
    } catch (error) {
      fail('Couldn’t Roll Back')(error);
    }
  }
}

/** Selects a file's row, expanding what holds it: the uncommitted groups only. */
async function reveal(changes: Changes, path: string): Promise<void> {
  const { model } = changes;
  const find = async (items: readonly Item[]): Promise<boolean> => {
    for (const item of items) {
      if (item.kind === 'change' && item.change.path === path) {
        model.select(item.key);
        return true;
      }
      let key: string;
      if (item.kind === 'group' && item.group !== 'ignored') key = groupKey(item.group);
      // A folder's key ends with its path and a slash.
      else if (item.kind === 'folder' && path.startsWith(item.key.slice(item.key.indexOf(':') + 1)))
        key = item.key;
      else continue;
      model.expanded.add(key);
      await model.load(item);
      if (await find(model.loaded.get(key) ?? [])) return true;
    }
    return false;
  };
  await find(model.rows.filter((row) => row.depth === 0).map((row) => row.node));
}

/** A turn's label: when it ended, and its prompt's first line. */
function turnLabel(turn: Turn): string {
  const time = new Date(turn.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const prompt = turn.prompt.split('\n')[0] ?? '';
  return prompt === '' ? `Turn at ${time}` : `${time} ${prompt}`;
}

const files = (count: number) => (count === 1 ? '1 file' : `${String(count)} files`);

/**
 * A row: a group's name and how many files it has; a folder's, the same; a turn's time and prompt;
 * a file's name in its status's colour, then its folder unless it's under it.
 */
function row(item: Item): Node[] {
  if (item.kind === 'group') {
    return [
      <span class={`playground-changes__group playground-changes__group--${item.group}`}>
        {GROUPS[item.group]}
      </span>,
      <span class="playground-change__folder">{item.count === 0 ? '' : files(item.count)}</span>,
    ] as Node[];
  }
  if (item.kind === 'folder') {
    return [
      icon('folder'),
      <span class="playground-change">{item.name}</span>,
      <span class="playground-change__folder">{files(item.count)}</span>,
    ] as Node[];
  }
  if (item.kind === 'turn') {
    return [
      icon('agent'),
      <span class="playground-turn" title={item.turn.prompt}>
        {turnLabel(item.turn)}
      </span>,
    ] as Node[];
  }
  const { change } = item;
  const path = change.path.replace(/\/$/, '');
  const slash = path.lastIndexOf('/');
  const folder = slash < 0 ? '' : path.slice(0, slash);
  const after = untracked(() => byDirectory.get()) ? '' : folder;
  return [
    icon(isDirectory(change) ? 'folder' : 'file'),
    <span class={`playground-change playground-change--${change.status}`}>
      {path.slice(slash + 1)}
    </span>,
    <span class="playground-change__folder">
      {change.from === undefined ? after : `${after} ← ${change.from}`}
    </span>,
  ] as Node[];
}

/** The toolbar above the tree, as IntelliJ's Commit window's. */
function Toolbar(props: { services: MenuServices }): Node {
  const { services } = props;
  const shortcut = (id: string) => () => {
    const key = services.keymap?.shortcutsFor(id)[0];
    const keymap = services.keymap;
    return key === undefined || !keymap ? undefined : formatSequence(key, keymap.platform);
  };
  const button = (command: string) => (
    <ToolbarButton
      commands={services.commands}
      command={command}
      icon={icon(services.commands.get(command)?.icon as string)}
      shortcut={shortcut(command)}
      context={() => FROM_VIEW}
    />
  );
  return (
    <div class="playground-changes__toolbar" role="toolbar" aria-label="Changes">
      {button('changes.refresh')}
      {button('changes.rollback')}
      {button('changes.showDiff')}
      <span class="playground-changes__separator" />
      <button
        type="button"
        class="cerebro-toolbar-button"
        aria-label="View Options"
        data-menu="changes/view"
        ref={tooltip({ text: () => 'View Options', placement: 'below' })}
        on:click={(event) => {
          const anchor = event.currentTarget as HTMLElement;
          openMenu(
            services,
            'changes/view',
            { anchor, placement: 'below' },
            { context: FROM_VIEW, owner: anchor },
          );
        }}
      >
        {icon('eye')}
      </button>
      <span class="playground-changes__separator" />
      {button('changes.selectOpened')}
      {button('changes.expandAll')}
      {button('changes.collapseAll')}
    </div>
  );
}

export function ChangesView(props: { services: MenuServices; open: (tab: Tab) => void }): Node {
  return (
    <div
      class="playground-changes"
      on:focusin={() => {
        focused.set(true);
      }}
      on:focusout={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused.set(false);
      }}
    >
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        if (!currentHost()) {
          return <p class="playground-project__empty">Changes show in the desktop app.</p>;
        }
        if (!gitRepository.get()) {
          return <p class="playground-project__empty">Not a git repository</p>;
        }
        const { model, empty, refresh: read } = changesOf(env.id);
        const refresh = () => {
          read().catch((error: unknown) => {
            console.error('Reading the changes failed', error);
          });
        };
        refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        onCleanup(() => {
          clearInterval(timer);
          window.removeEventListener('focus', refresh);
        });
        return [
          <Toolbar services={props.services} />,
          // Only whether there are any: the tree itself follows the lists.
          () =>
            empty() ? (
              <p class="playground-project__empty">No changes</p>
            ) : (
              <TreeView
                model={model}
                label={`${env.name} changes`}
                row={row}
                onOpen={(item) => {
                  // Only files open, as IntelliJ's: the diff is Show Diff's.
                  const change = item as Extract<Item, { kind: 'change' }>;
                  if (openable(change)) {
                    props.open({
                      id: change.change.path,
                      title: change.change.path.split('/').at(-1) as string,
                    });
                  }
                }}
                onContextMenu={(event) => {
                  openContextMenu(props.services, 'changes/item', event, FROM_VIEW);
                }}
              />
            ),
        ];
      }}
    </div>
  );
}
