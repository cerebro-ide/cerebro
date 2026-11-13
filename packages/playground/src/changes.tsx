// The Commit tool window's changes, as IntelliJ's: the active worktree's files changed since its last
// commit ("Changes"), its untracked files ("Unversioned Files"), and its ignored ones when asked for
// ("Ignored Files"). Files are grouped by directory unless that's turned off. Read through the host
// every few seconds (an agent changes files without telling). Each environment keeps its own.
//
// The Agent Changes tool window, Cerebro's own: each of the agent's turns (the host keeps a
// snapshot before and after each), the latest first, with the files the turn changed; each file
// opens, or opens its diff, as in the Commit window.
//
// A toolbar above the tree, as IntelliJ's: Refresh, Rollback, Show Diff, View Options (group by
// directory, show ignored files), Select Opened File, Expand All and Collapse All. Opening a file
// (double click, Enter, F4) opens the file; Ctrl/Cmd+D or the context menu opens its diff. F4 in a
// diff opens the file where its caret is, as IntelliJ's.
//
// Committing, as IntelliJ's Commit tool window: a checkbox on each uncommitted file, folder and
// group says what goes in (Space flips the selected row's), then Amend, the message and Commit
// below the tree. Ctrl/Cmd+K shows the window with the message focused; Ctrl+Enter commits.

import { formatSequence } from '@cerebro-ide/commands';
import type { Tab } from '@cerebro-ide/layout';
import { onCleanup } from '@cerebro-ide/jsx';
import {
  batch,
  computed,
  effect,
  ObservableSet,
  signal,
  untracked,
  type Signal,
} from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openContextMenu, openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { diffSource } from '@cerebro-ide/ui-editor';
import { TreeModel, TreeView, type TreeRow } from '@cerebro-ide/ui-tree';
import { copyPatch, createPatch, type PatchRequest } from './create-patch.js';
import { onEdited, saveBeforeGit, saveFiles, unsavedFiles } from './documents.js';
import { active, currentHost, gitRepository, hostFor, type Host } from './environments.js';
import { target } from './edit.js';
import { projectFile } from './project.js';
import { formatCommitDate } from './dates.js';
import type { LogCommit } from './git-log.js';
import { compareRefs } from './compare-branches.js';
import { branchName, natural } from './git-refs.js';
import { isFavorite, repositoryOf } from './branch-favorites.js';
import { directoryTree } from './directory-tree.js';
import { favoriteIcon, icon } from './icons.js';
import { carets } from './navigation.js';
import { notifications } from './notifications.js';
import { openPush } from './push.js';
import { stateOf } from './repository-state.js';

export interface Change {
  path: string;
  /** `ignored`: listed only when asked for; a folder git ignores whole ends with `/`. */
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflict';
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

/**
 * Two commits to compare (a turn's snapshots); or a commit, a branch or a tag (named in full, as
 * `refs/tags/v1`) with the file as it is: Compare with Branch or Tag.
 */
export interface Range {
  from: string;
  to?: string;
}

type Group = 'conflicts' | 'changes' | 'unversioned' | 'ignored';

/** A row: a group of files, a folder in one, a turn, or a file changed in any of them. */
type Item =
  | { kind: 'group'; group: Group; count: number }
  | { kind: 'folder'; key: string; name: string; count: number; children: Item[] }
  | { kind: 'turn'; turn: Turn }
  | { kind: 'change'; key: string; change: Change; turn?: Turn };

/**
 * A diff tab's id: the file's path in the worktree, marked as a diff, against its last commit
 * (`diff:path`), between two commits (`diff@from..to:path`), or against a branch or tag as it is
 * (`diff@refs/heads/b..:path`). A ref's name has neither `..` nor `:` (git check-ref-format).
 */
const DIFF = 'diff';

/** A changed file's own tab: named by its whole path, as files opened elsewhere are. */
export const fileTab = (worktree: string, path: string): Tab => ({
  id: `${worktree}/${path}`,
  title: path.split('/').at(-1) as string,
});

export const diffTab = (path: string, range?: Range): Tab => ({
  id: range ? `${DIFF}@${range.from}..${range.to ?? ''}:${path}` : `${DIFF}:${path}`,
  title: path.split('/').at(-1) as string,
});

const DIFF_ID = /^diff(?:@([^:]+?)\.\.([^:]*))?:(.*)$/s;

/** The file a diff tab shows, if it's one. */
export function diffPath(tabId: string): string | undefined {
  return DIFF_ID.exec(tabId)?.[3];
}

/**
 * A file as it was at a commit, read-only: IntelliJ's Open Repository Version, its tab named as
 * IntelliJ's (`AbstractVcsVirtualFile.getPresentableName`), the file's name and the revision.
 */
export const revisionTab = (path: string, hash: string): Tab => ({
  id: `rev@${hash}:${path}`,
  title: `${path.split('/').at(-1) as string} (${hash})`,
});

const REVISION_ID = /^rev@([^:]+):(.*)$/s;

/** The file and commit a repository version's tab shows, if it's one. */
export function revisionOf(tabId: string): { path: string; hash: string } | undefined {
  const match = REVISION_ID.exec(tabId);
  return match ? { hash: match[1] as string, path: match[2] as string } : undefined;
}

/**
 * The file a tab shows: its own (its id), its diff's, or the one a repository version is of; none
 * for a comparison of branches.
 */
export function tabPath(tabId: string): string | undefined {
  return compareRefs(tabId) ? undefined : (diffPath(tabId) ?? revisionOf(tabId)?.path ?? tabId);
}

/** The commits a diff tab compares, if it compares two. */
export function diffRange(tabId: string): Range | undefined {
  const match = DIFF_ID.exec(tabId);
  if (match?.[1] === undefined) return undefined;
  return match[2] ? { from: match[1], to: match[2] } : { from: match[1] };
}

/** How often the list is read again while it shows. */
export const REFRESH_MS = 2000;

const GROUPS: Readonly<Record<Group, string>> = {
  conflicts: 'Merge Conflicts',
  changes: 'Changes',
  unversioned: 'Unversioned Files',
  ignored: 'Ignored Files',
};

const groupKey = (group: Group) => `\u0000${group}`;

/** The view options, as IntelliJ's View Options menu: kept in the browser's storage. */
const OPTIONS_KEY = 'cerebro.changes.view';

/** The view options as kept, or the defaults where they can't be read. */
export function readOptions(): { byDirectory: boolean; showIgnored: boolean } {
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
 * A list of files as rows: by name, or grouped by directory (`directoryTree`). `opened` is told
 * each folder's key, to expand the ones it hasn't seen before.
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
  if (!byDirectory.peek()) {
    return [...changes].sort((a, b) => a.path.localeCompare(b.path)).map(file);
  }
  return directoryTree<Change, Item>(changes, (change) => change.path, {
    file,
    folder: ({ path, name, count, children }) => {
      const key = fileKey(scope, path);
      opened(key);
      return { kind: 'folder', key, name, count, children };
    },
  });
}

interface Changes {
  /** The worktree. */
  path: string;
  model: TreeModel<Item>;
  /** The agent's turns, for the Agent Changes window. */
  turnsModel: TreeModel<Item>;
  /** Whether there's nothing to show: no changes. */
  empty: () => boolean;
  /** Reads the lists again; the tree is redrawn only if they changed, or if `force`. */
  refresh: (force?: boolean) => Promise<void>;
  /** The uncommitted files that are tracked: what can be rolled back. */
  tracked: () => readonly Change[];
  /** The untracked files. */
  unversioned: () => readonly Change[];
  /**
   * What goes into the next commit, as IntelliJ's: every tracked file unless taken out
   * (`excluded`), untracked files only once put in (`included`).
   */
  excluded: ObservableSet<string>;
  included: ObservableSet<string>;
  /** The commit message being written, and whether it amends the last commit. */
  message: Signal<string>;
  amend: Signal<boolean>;
  /** Amend's message, and the one it replaced: put back if Amend is turned off before an edit. */
  amended: { before: string; message: string } | undefined;
}

const lists = new Map<string, Changes>();

/** The Merge Conflicts group's Resolve: given by `setupChanges`. */
let resolveFromList: (() => void) | undefined;

/**
 * `listed` with the tracked files edited and not saved yet, as modified: IntelliJ lists a file in
 * Changes as it's edited, not once it's saved.
 */
async function withUnsaved(
  host: Host,
  worktree: string,
  listed: Change[],
  unsaved: readonly string[],
): Promise<Change[]> {
  const root = `${worktree}/`;
  const known = new Set(listed.map((change) => change.path));
  const files = unsaved
    .filter((path) => path.startsWith(root))
    .map((path) => path.slice(root.length))
    .filter((path) => !known.has(path));
  if (files.length === 0) return listed;
  const tracked = (await host.request('git.tracked', { path: worktree, files })) as string[];
  return [...listed, ...tracked.map((path): Change => ({ path, status: 'modified' }))];
}

/** A worktree's lists, made the first time they're asked for. */
function changesOf(worktree: string): Changes {
  // Made where they're shown, which needn't run again when they are: making them writes what it
  // reads, and the view would run twice, reading them twice.
  return untracked(() => made(worktree));
}

/** Puts a message in a worktree's Commit window: Undo Commit's, as IntelliJ's, to commit again. */
export function setCommitMessage(worktree: string, message: string): void {
  changesOf(worktree).message.set(message);
}

function made(worktree: string): Changes {
  let changes = lists.get(worktree);
  if (!changes) {
    const host = hostFor(worktree) as NonNullable<ReturnType<typeof hostFor>>;
    let conflicted: Change[] = [];
    let tracked: Change[] = [];
    let unversioned: Change[] = [];
    let ignored: Change[] = [];
    let turns: Turn[] = [];
    /** A turn's changes never change: read once, when it's first expanded. */
    const turnChanges = new Map<string, Promise<Change[]>>();
    // What was last read, as JSON: the tree is reloaded only when it changes. Reloading draws the
    // rows again: not while nothing changed, under the user's pointer.
    let last = '';
    // Reads asked for: only the latest one's answer is shown.
    let reads = 0;
    const root = `${worktree}/`;
    /** The files whose first edit read the lists: asked about again once saved. */
    const firstEdits = new Set<string>();
    // Folders and groups are expanded when they first show, as IntelliJ's changes are; after
    // that, as the user left them.
    const seen = new Set<string>();
    const openedIn = (tree: TreeModel<Item>) => (key: string) => {
      if (seen.has(key)) return;
      seen.add(key);
      tree.expanded.add(key);
    };
    const opened = (key: string) => {
      openedIn(model)(key);
    };
    const turnFiles = async (turn: Turn) => {
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
      return tree(`turn:${turn.id}`, await read, turn, openedIn(turnsModel));
    };
    const key = (item: Item) =>
      item.kind === 'group'
        ? groupKey(item.group)
        : item.kind === 'turn'
          ? `turn:${item.turn.id}`
          : item.key;
    const model: TreeModel<Item> = new TreeModel<Item>({
      children: (item) => {
        if (item === undefined) {
          // Files in conflict first, as IntelliJ's Merge Conflicts.
          const groups: Item[] =
            conflicted.length > 0
              ? [{ kind: 'group', group: 'conflicts', count: conflicted.length }]
              : [];
          groups.push({ kind: 'group', group: 'changes', count: tracked.length });
          if (unversioned.length > 0) {
            groups.push({ kind: 'group', group: 'unversioned', count: unversioned.length });
          }
          if (ignored.length > 0) {
            groups.push({ kind: 'group', group: 'ignored', count: ignored.length });
          }
          return groups;
        }
        if (item.kind === 'group') {
          const files = { conflicts: conflicted, changes: tracked, unversioned, ignored }[
            item.group
          ];
          return tree(groupKey(item.group), files, undefined, opened);
        }
        return (item as Extract<Item, { kind: 'folder' }>).children;
      },
      key,
      isLeaf: (item) => item.kind === 'change',
    });
    const turnsModel: TreeModel<Item> = new TreeModel<Item>({
      children: (item) => {
        if (item === undefined) return turns.map((turn): Item => ({ kind: 'turn', turn }));
        if (item.kind === 'turn') return turnFiles(item.turn);
        return (item as Extract<Item, { kind: 'folder' }>).children;
      },
      key,
      isLeaf: (item) => item.kind === 'change',
    });
    opened(groupKey('conflicts'));
    opened(groupKey('changes'));
    opened(groupKey('unversioned'));
    // Ignored files can be many: their group starts closed.
    seen.add(groupKey('ignored'));
    // No changes: the group's row would show nothing.
    const empty = computed(() => {
      const rows = model.rows;
      const first = rows[0]?.node;
      return rows.length === 1 && first?.kind === 'group' && first.count === 0;
    });
    const message = signal('');
    /** The merge whose message was given, so it's given once: cleared, it stays so. */
    let mergeMessage: string | undefined;
    changes = {
      path: worktree,
      model,
      turnsModel,
      empty: () => empty.get(),
      tracked: () => tracked,
      unversioned: () => unversioned,
      excluded: new ObservableSet<string>(),
      included: new ObservableSet<string>(),
      message,
      amend: signal(false),
      amended: undefined,
      refresh: async (force = false) => {
        const asked = ++reads;
        const ignoredToo = showIgnored.peek();
        const [listed, readTurns, readIgnored] = (await Promise.all([
          host.request('git.changes', { path: worktree }),
          host.request('agent.turns', { path: worktree }),
          ignoredToo ? host.request('git.ignored', { path: worktree }) : [],
        ])) as [Change[], Turn[], string[]];
        const unsaved = unsavedFiles();
        for (const file of firstEdits) if (!unsaved.includes(root + file)) firstEdits.delete(file);
        const readChanges = await withUnsaved(host, worktree, listed, unsaved);
        // A later read was asked for while this one ran: it has what's newer.
        if (asked !== reads) return;
        // During a merge, git's message for it, as IntelliJ's Commit window starts with; taken
        // out, unedited, once the merge is over (committed by Update Project, say, or aborted),
        // or replaced by the next merge's.
        const merge = stateOf(worktree).message;
        if (merge !== mergeMessage) {
          if (message.peek() === (mergeMessage ?? '')) message.set(merge ?? '');
          mergeMessage = merge;
        }
        const json = JSON.stringify([readChanges, readTurns, readIgnored, byDirectory.peek()]);
        if (json === last && !force) return;
        last = json;
        conflicted = readChanges.filter((change) => change.status === 'conflict');
        tracked = readChanges.filter(
          (change) => change.status !== 'untracked' && change.status !== 'conflict',
        );
        unversioned = readChanges.filter((change) => change.status === 'untracked');
        ignored = readIgnored.map((path) => ({ path, status: 'ignored' }));
        turns = readTurns;
        await Promise.all([model.refresh(), turnsModel.refresh()]);
      },
    };
    lists.set(worktree, changes);
    const these = changes;
    // A file's first edit lists it at once, not at the next read. Asked once until it's saved, so
    // typing in a file git doesn't track doesn't read the lists at every key.
    onEdited((path) => {
      const file = path.slice(root.length);
      if (!path.startsWith(root) || firstEdits.has(file)) return;
      if ([...conflicted, ...tracked, ...unversioned].some((change) => change.path === file))
        return;
      firstEdits.add(file);
      these.refresh().catch((error: unknown) => {
        console.error('Reading the changes failed', error);
      });
    });
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

/** The two windows listing changes: Commit's, and Agent Changes'. */
type View = 'changes' | 'agent';

/** A window's tree. */
const modelOf = (changes: Changes, view: View) =>
  view === 'agent' ? changes.turnsModel : changes.model;

/** The selected row's item, in a window's tree (the Commit window's by default). */
function selectedItem(changes: Changes, view: View = 'changes'): Item | undefined {
  const model = modelOf(changes, view);
  return model.rows.find((row) => row.key === model.selected)?.node;
}

/** The selected file, if a file is selected. */
function selectedChange(
  changes: Changes | undefined,
  view: View = 'changes',
): Extract<Item, { kind: 'change' }> | undefined {
  const item = changes && selectedItem(changes, view);
  return item?.kind === 'change' ? item : undefined;
}

/**
 * The files Compare Previous and Next File go through from the selected file, as IntelliJ's diff
 * chain: its group's (its changelist's, or the unversioned files) or its turn's, in the tree's
 * order.
 */
function chainOf(changes: Changes, view: View = 'changes'): string[] {
  const model = modelOf(changes, view);
  const rows = model.rows;
  const at = rows.findIndex((row) => row.key === model.selected);
  const top = rows.slice(0, at + 1).findLast((row) => row.depth === 0) as TreeRow<Item>;
  // A group's or a turn's rows are folders and files.
  const files = (items: readonly Item[]): string[] =>
    items.flatMap((item) =>
      item.kind === 'folder'
        ? files(item.children)
        : [(item as Extract<Item, { kind: 'change' }>).change.path],
    );
  return files(model.loaded.get(top.key) as readonly Item[]);
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

/** The files a row's checkbox stands for: uncommitted ones, not a turn's or ignored ones. */
function committable(item: Item, changes: Changes): Change[] {
  if (item.kind === 'change') {
    // Nor one in conflict: it's resolved first.
    return item.turn || item.change.status === 'ignored' || item.change.status === 'conflict'
      ? []
      : [item.change];
  }
  if (item.kind === 'folder') return item.children.flatMap((child) => committable(child, changes));
  // A group: a turn's window has no checkboxes, and never asks.
  const { group } = item as Extract<Item, { kind: 'group' }>;
  return group === 'changes'
    ? [...changes.tracked()]
    : group === 'unversioned'
      ? [...changes.unversioned()]
      : [];
}

/** Whether a file goes into the next commit. */
function isIncluded(changes: Changes, change: Change): boolean {
  return change.status === 'untracked'
    ? changes.included.has(change.path)
    : !changes.excluded.has(change.path);
}

/** Puts a row's files into the next commit, or takes them out if they're all in, as IntelliJ's. */
function flipIncluded(changes: Changes, item: Item): void {
  const files = committable(item, changes);
  const include = !files.every((change) => isIncluded(changes, change));
  batch(() => {
    for (const { path, status } of files) {
      if (status === 'untracked') {
        if (include) changes.included.add(path);
        else changes.included.delete(path);
      } else if (include) changes.excluded.delete(path);
      else changes.excluded.add(path);
    }
  });
}

/**
 * What Shelve Changes offers: the uncommitted files, and those it starts with: the Commit window's
 * selection's, from its menu, else those going into the commit, as IntelliJ's. Undefined until the
 * Commit window has read them.
 */
export function toShelve(context: unknown): { files: Change[]; chosen: Change[] } | undefined {
  const changes = current();
  if (!changes) return undefined;
  const files = [...changes.tracked(), ...changes.unversioned()];
  const item = viewOf(context) === 'changes' ? selectedItem(changes) : undefined;
  const chosen = item
    ? committable(item, changes)
    : files.filter((change) => isIncluded(changes, change));
  return { files, chosen };
}

/**
 * Whether the Commit window's lists know a file as one git hasn't committed: untracked, or added.
 * IntelliJ's Annotate and Show Diff are off for it (`fileInVcsByFileStatus`). Unknown until they're
 * read: false.
 */
export function notCommitted(worktree: string, path: string): boolean {
  const changes = lists.get(worktree);
  const listed = changes && [...changes.tracked(), ...changes.unversioned()];
  const status = listed?.find((change) => change.path === path)?.status;
  return status === 'untracked' || status === 'added';
}

/**
 * Whether to go on making `path` as a commit or branch has it: at once where it has no change here,
 * else as answered when asked, in IntelliJ's words (`ReplaceFileConfirmationDialog`), its changes
 * being lost. `title` is the action's. An edit not saved yet is a change, as IntelliJ's file status
 * has it (`FileStatusManagerImpl`, a modified document's file MODIFIED).
 */
export async function replacing(
  host: Host,
  worktree: string,
  path: string,
  title: string,
): Promise<boolean> {
  if (!unsavedFiles().includes(`${worktree}/${path}`)) {
    const here = (await host.request('git.changes', { path: worktree })) as Change[];
    if (!here.some((c) => c.path === path)) return true;
  }
  const overwrite = await openDialog<true>({
    title,
    content: () => <p class="cerebro-selectable">File {path} has been locally modified.</p>,
    ok: { label: 'Overwrite Modified File', accept: () => true },
  }).result;
  return overwrite === true;
}

/** Reads a worktree's changes again, if the Commit window has shown them: after shelving. */
export async function refreshChanges(worktree: string): Promise<void> {
  await lists.get(worktree)?.refresh(true);
}

/** A file to open: not one that's gone, nor a folder git ignores whole. */
function openable(
  item: Extract<Item, { kind: 'change' }> | undefined,
): item is Extract<Item, { kind: 'change' }> {
  return item !== undefined && item.change.status !== 'deleted' && !isDirectory(item.change);
}

/** What a window's commands get from its toolbar and menus: they act on it. */
const FROM_VIEW = { source: 'changes' };
const FROM_AGENT = { source: 'agent' };

/** Which window has the keyboard, if either: its shortcuts only work then. */
const focused = signal<View | undefined>(undefined);

/** The window a command acts on: the one it came from, else the one with the keyboard. */
const viewOf = (context: unknown): View | undefined =>
  ((context as { source?: string } | undefined)?.source as View | undefined) ?? focused.get();

export interface ChangesSetup {
  /** Opens a tab in the active editor; a diff tab at a line of the file as it is, if given. */
  open: (tab: Tab, chain?: readonly string[], line?: number) => void;
  /** The active editor tab's id: Select Opened File selects its file. */
  activeTab: () => string | undefined;
  /** Shows the Commit tool window. */
  show: () => void;
  /** Opens a file at a line and column, zero-based. */
  openAt: (at: { path: string; line: number; column: number }) => void;
  /** Shows a file's history in the Log, its path from the repository's top. */
  showHistory: (path: string) => void;
}

/** The commit message's field, if it shows. */
const messageField = () =>
  document.querySelector<HTMLTextAreaElement>('.playground-commit__message') ?? undefined;

/** Why the last Commit didn't, as IntelliJ says it: under the message. */
const commitError = signal('');
/** While a commit is under way. */
const committing = signal(false);

/**
 * Commits the files put in, with the message, as IntelliJ's Commit button: it says what's missing
 * first. Amending needs no files: it can change only the message. How it went is a notification,
 * as IntelliJ's ShowNotificationCommitResultHandler: "2 files committed" with the message, or
 * "Commit failed with error" with why, each replacing the last. Says whether it committed.
 */
async function commit(changes: Changes): Promise<boolean> {
  if (committing.peek()) return false;
  const files = [...changes.tracked(), ...changes.unversioned()].filter((change) =>
    isIncluded(changes, change),
  );
  const message = changes.message.peek();
  const amend = changes.amend.peek();
  const noFiles = files.length === 0 && !amend;
  const noMessage = message.trim() === '';
  if (noFiles || noMessage) {
    commitError.set(
      noFiles && noMessage
        ? 'Select files to commit and specify commit message'
        : noFiles
          ? 'Select files to commit'
          : 'Specify commit message',
    );
    return false;
  }
  commitError.set('');
  committing.set(true);
  try {
    // What's committed is what's on disk: the files put in are saved first, as IntelliJ's.
    await saveFiles(files.map((change) => `${changes.path}/${change.path}`));
    await hostFor(changes.path)?.request('git.commit', {
      path: changes.path,
      files: files.map((change) => change.path),
      message,
      amend,
    });
    batch(() => {
      changes.message.set('');
      changes.amend.set(false);
      changes.amended = undefined;
    });
    notifications.notify({
      title: `${files.length === 0 ? 'No' : String(files.length)} ${files.length === 1 ? 'file' : 'files'} committed`,
      content: message,
      display: 'sticky',
      group: 'commit',
    });
    await changes.refresh(true);
    return true;
  } catch (error) {
    notifications.notify({
      title: 'Commit failed with error',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
      group: 'commit',
    });
    return false;
  } finally {
    committing.set(false);
  }
}

/** Commit and Push…, as IntelliJ's: commits, then opens the Push dialog with what's to push. */
async function commitAndPush(changes: Changes): Promise<void> {
  if (await commit(changes)) await openPush(changes.path);
}

/**
 * Turns Amend on or off, as IntelliJ's: on, the last commit's message replaces the one being
 * written; off, that one comes back, unless the message was edited since.
 */
async function flipAmend(changes: Changes): Promise<void> {
  const on = !changes.amend.peek();
  changes.amend.set(on);
  if (!on) {
    const amended = changes.amended;
    changes.amended = undefined;
    if (amended && changes.message.peek() === amended.message) changes.message.set(amended.before);
    return;
  }
  const last = (await hostFor(changes.path)?.request('git.lastMessage', {
    path: changes.path,
  })) as string;
  // Turned off again meanwhile.
  if (!changes.amend.peek()) return;
  const before = changes.message.peek();
  const same = (a: string, b: string) => a.replace(/\s/g, '') === b.replace(/\s/g, '');
  if (last === '' || same(before, last)) return;
  changes.amended = { before, message: last };
  changes.message.set(last);
  messageField()?.focus();
}

/** The Commit window's commands, shortcuts and menus. */
/**
 * IntelliJ's popup for Compare with Branch or Tag (`GitCompareWithBranchPopup`, read in its
 * source): the worktree's recent branches but the current one, as checked out; its other local
 * branches, its remote ones and its tags, favorites first, searchable; the one chosen, named in
 * full. A favorite has its star, which can't be clicked here, as IntelliJ's.
 */
async function pickRef(host: Host, worktree: string): Promise<string | undefined> {
  const [refs, tags, checkouts] = (await Promise.all([
    host.request('git.branches', { worktree }),
    host.request('git.tags', { path: worktree }),
    // Where they can't be read (no commit yet), none is recent.
    (host.request('git.recentCheckouts', { path: worktree }) as Promise<string[]>).catch(
      (error: unknown) => {
        console.error('Reading the recent branches failed', error);
        return [];
      },
    ),
  ])) as [{ ref: string; current: boolean }[], string[], string[]];
  const repository = repositoryOf(worktree);
  type Choice = PickerItem & { ref: string };
  const choice = (ref: string, label: string, group: string): Choice => ({
    label,
    group,
    ref,
    ...(isFavorite(repository, ref) ? { icon: () => favoriteIcon() } : {}),
  });
  /** IntelliJ's order (GitBranchesTreeModel): favorites first, then by name. */
  const sorted = (choices: Choice[]) =>
    choices.sort(
      (a, b) =>
        Number(isFavorite(repository, b.ref)) - Number(isFavorite(repository, a.ref)) ||
        natural(a.label, b.label),
    );
  const others = refs.filter((r) => !r.current);
  const recent = checkouts.filter((name) => others.some((r) => r.ref === `refs/heads/${name}`));
  const branches = (prefix: string, group: string): Choice[] =>
    sorted(
      others
        .filter((r) => r.ref.startsWith(prefix))
        .flatMap((r) => {
          const name = branchName(r.ref);
          return name === undefined || (group === 'Local' && recent.includes(name))
            ? []
            : [choice(r.ref, name, group)];
        }),
    );
  const groups = [
    recent.map((name) => choice(`refs/heads/${name}`, name, 'Recent')),
    branches('refs/heads/', 'Local'),
    branches('refs/remotes/', 'Remote'),
    sorted(tags.map((tag) => choice(`refs/tags/${tag}`, tag, 'Tags'))),
  ];
  const title = 'Select Branch to Compare';
  const chosen = await openPicker<Choice>({
    label: title,
    header: () => <span class="playground-popup__title">{title}</span>,
    placeholder: 'Search for branches and tags',
    position: 'top',
    items: (query) => groups.flatMap((group) => fuzzyFilter(group, query)),
  }).result;
  return chosen?.ref;
}

/**
 * IntelliJ's popup for Compare with Revision (`CompareWithSelectedRevisionAction.showListPopup`,
 * read in its source): "File Revisions", the file's commits newest first, each its hash, date and
 * author, searchable by them; the highlighted one's commit message below. The first thousand, as
 * the Log's Paths filter finds them: renames aren't followed, as IntelliJ's file history's are.
 */
async function pickRevision(host: Host, worktree: string, path: string) {
  const commits = (await host.request('git.log', {
    worktree,
    skip: 0,
    max: 1000,
    filter: { paths: [path] },
  })) as LogCommit[];
  type Choice = PickerItem & { commit: LogCommit };
  const items: Choice[] = commits.map((commit) => ({
    label: commit.hash,
    detail: `${formatCommitDate(commit.time)} ${commit.author}`,
    commit,
  }));
  const title = 'File Revisions';
  const choice = await openPicker<Choice>({
    label: title,
    header: () => <span class="playground-popup__title">{title}</span>,
    position: 'top',
    items: (query) => fuzzyFilter(items, query),
    preview: (item) =>
      item ? (
        <div class="playground-revisions__message">
          <div class="playground-revisions__label">Commit message</div>
          <div class="playground-revisions__text">
            {[item.commit.subject, item.commit.body].filter(Boolean).join('\n\n')}
          </div>
        </div>
      ) : null,
  }).result;
  return choice?.commit.hash;
}

export function setupChanges(services: MenuServices, setup: ChangesSetup): void {
  const { commands, menus, keymap } = services;
  resolveFromList = () => {
    commands.execute('vcs.resolveConflicts');
  };
  /** From the window's toolbar or menus, or a shortcut while it has the keyboard. */
  /** Whether a command acts on the Commit window. */
  const here = (context: unknown) => viewOf(context) === 'changes';
  const fail = (title: string) => (error: unknown) => {
    openDialog({
      title,
      content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
    });
  };
  const openFile = (item: Extract<Item, { kind: 'change' }>) => {
    setup.open(fileTab((current() as Changes).path, item.change.path));
  };

  commands.register({
    id: 'changes.commit',
    label: '&Commit',
    icon: 'commit',
    dialog: true,
    enabled: () => active() !== undefined && currentHost() !== undefined && gitRepository.get(),
    run: () => {
      setup.show();
      // Once the window has drawn, when it was hidden.
      requestAnimationFrame(() => {
        messageField()?.focus();
      });
    },
  });
  commands.register({
    id: 'changes.amend',
    label: '&Amend',
    checked: () => current()?.amend.get() ?? false,
    enabled: (c) => here(c) && current() !== undefined,
    run: () => flipAmend(current() as Changes).catch(fail('Couldn’t Read the Last Commit')),
  });
  commands.register({
    id: 'changes.refresh',
    label: '&Refresh',
    icon: 'refresh',
    enabled: (c) => viewOf(c) !== undefined && current() !== undefined,
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
  // Create Patch… and Copy as Patch to Clipboard, as IntelliJ's (ChangesViewPopupMenu's
  // ChangesView.CreatePatch and ChangesView.CreatePatchToClipboard): the changes selected, else
  // those included, untracked files as new ones; saved first. Their message is the commit message
  // being written, as IntelliJ's takes the change list's comment.
  const toPatch = (c: unknown): PatchRequest | undefined => {
    const changes = current();
    const chosen = here(c) ? (toShelve(c)?.chosen ?? []) : [];
    if (!changes || chosen.length === 0) return undefined;
    const paths = chosen.flatMap((change) =>
      change.from === undefined ? [change.path] : [change.from, change.path],
    );
    const message = changes.message.peek().trim();
    return {
      host: hostFor(changes.path) as Host,
      worktree: changes.path,
      files: paths,
      changed: paths,
      untracked: chosen.filter((change) => change.status === 'untracked').map((c) => c.path),
      ...(message === '' ? {} : { message }),
    };
  };
  for (const [id, label, make] of [
    ['changes.createPatch', 'Create Patch…', createPatch],
    ['changes.copyPatch', 'Copy as Patch to Clipboard', copyPatch],
  ] as const) {
    commands.register({
      id,
      label,
      enabled: (c) => toPatch(c) !== undefined,
      run: async (c) => {
        const request = toPatch(c) as PatchRequest;
        await saveBeforeGit();
        await make(request);
      },
    });
  }
  commands.register({
    id: 'changes.showDiff',
    label: 'Show &Diff',
    icon: 'diff',
    enabled: (c) => {
      const view = viewOf(c);
      const item = view && selectedChange(current(), view);
      return item !== undefined && item.change.status !== 'ignored';
    },
    run: (c) => {
      const { change, turn } = selectedChange(current(), viewOf(c)) as Extract<
        Item,
        { kind: 'change' }
      >;
      setup.open(
        diffTab(change.path, turn && { from: turn.start, to: turn.end }),
        chainOf(current() as Changes, viewOf(c)),
      );
    },
  });
  /**
   * The file Git → Current File acts on, and its worktree, if it's in the active worktree's
   * repository: the Project view's selected file while it has the focus; none while another tool
   * window has it; else the active editor's.
   */
  const currentFile = () => {
    const env = active();
    const selected = projectFile();
    const tab =
      selected !== undefined
        ? (selected ?? undefined)
        : target()?.closest('.cerebro-tool-window')
          ? undefined
          : setup.activeTab();
    if (!env || tab === undefined || !currentHost() || !gitRepository.get()) return undefined;
    const path = tab.startsWith(`${env.id}/`) ? tab.slice(env.id.length + 1) : undefined;
    return path === undefined ? undefined : { worktree: env.id, path };
  };
  // Git → Current File's Show Diff: IntelliJ's Compare with the Same Repository Version, which it
  // names so for git (GitVcs). The file against its last commit; not for one git hasn't committed
  // (untracked or added), as the Commit window's lists know it.
  commands.register({
    id: 'git.file.showDiff',
    label: 'Show Diff',
    icon: 'diff',
    visible: () => currentFile() !== undefined,
    enabled: () => {
      const file = currentFile();
      return file !== undefined && !notCommitted(file.worktree, file.path);
    },
    run: () => {
      const file = currentFile() as { worktree: string; path: string };
      // At the editor's caret line, as IntelliJ's (SCROLL_TO_LINE).
      const caret = carets.get(`${file.worktree}/${file.path}`);
      setup.open(diffTab(file.path), undefined, caret?.line);
    },
  });
  // Git → Current File's Compare with Revision…: IntelliJ's `Compare.Selected`
  // (`CompareWithSelectedRevisionAction`). The file as it is against one of its commits, chosen in
  // a popup of them; on when Show Diff is, as IntelliJ's (`AbstractShowDiffAction.updateDiffAction`).
  commands.register({
    id: 'git.file.compareWithRevision',
    label: 'Compare with Revision',
    dialog: true,
    visible: () => currentFile() !== undefined,
    enabled: () => commands.isEnabled('git.file.showDiff'),
    run: () => {
      const file = currentFile() as { worktree: string; path: string };
      pickRevision(hostFor(file.worktree) as Host, file.worktree, file.path).then(
        (hash) => {
          if (hash !== undefined) setup.open(diffTab(file.path, { from: hash }));
        },
        (error: unknown) => {
          console.error('Reading the file’s revisions failed', error);
        },
      );
    },
  });
  // Git → Current File's Compare with Branch or Tag…: IntelliJ's `GitCompareWithRefAction`. The
  // file as it is against a branch or a tag, chosen in a popup of them. On for any file, as
  // IntelliJ's: for one that isn't in the branch, the diff says so.
  commands.register({
    id: 'git.file.compareWithBranch',
    label: 'Compare with Branch or Tag',
    dialog: true,
    visible: () => currentFile() !== undefined,
    run: () => {
      const file = currentFile() as { worktree: string; path: string };
      pickRef(hostFor(file.worktree) as Host, file.worktree).then(
        (ref) => {
          if (ref !== undefined) setup.open(diffTab(file.path, { from: ref }));
        },
        (error: unknown) => {
          console.error('Reading the branches failed', error);
        },
      );
    },
  });
  // Git → Current File's Show History: IntelliJ's `Vcs.ShowTabbedFileHistory`, the file's commits
  // in a Log of their own. On when Show Diff is: IntelliJ's checks the same
  // (`TabbedShowHistoryAction`, `fileInVcsByFileStatus`).
  commands.register({
    id: 'git.file.showHistory',
    label: 'Show History',
    visible: () => currentFile() !== undefined,
    enabled: () => commands.isEnabled('git.file.showDiff'),
    run: () => {
      setup.showHistory((currentFile() as { worktree: string; path: string }).path);
    },
  });
  /** The file and place Jump to Source goes to from the focused diff, if a diff has the focus. */
  const fromDiff = () => {
    const tab = setup.activeTab();
    const path = tab === undefined ? undefined : diffPath(tab);
    const focused = document.activeElement;
    const at = path !== undefined && focused ? diffSource(focused) : undefined;
    return at && { path: path as string, ...at };
  };
  commands.register({
    id: 'changes.jumpToSource',
    label: '&Jump to Source',
    enabled: (c) => {
      const view = viewOf(c);
      return (
        (view !== undefined && openable(selectedChange(current(), view))) ||
        fromDiff() !== undefined
      );
    },
    run: async (c) => {
      const view = viewOf(c);
      const selected = view && selectedChange(current(), view);
      if (openable(selected)) {
        openFile(selected);
        return;
      }
      // Enabled: if not for a file selected, for the focused diff.
      const at = fromDiff() as NonNullable<ReturnType<typeof fromDiff>>;
      const env = active();
      // A deleted file's diff: there's no file to go to.
      if (
        !env ||
        !(await hostFor(env.id)?.request('fs.exists', { path: `${env.id}/${at.path}` }))
      ) {
        return;
      }
      setup.openAt({ ...at, path: `${env.id}/${at.path}` });
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
    enabled: (c) => {
      const tab = setup.activeTab();
      return here(c) && current() !== undefined && tab !== undefined && tabPath(tab) !== undefined;
    },
    run: () => {
      const changes = current() as Changes;
      const path = tabPath(setup.activeTab() as string) as string;
      const root = `${changes.path}/`;
      void reveal(changes, path.startsWith(root) ? path.slice(root.length) : path);
    },
  });
  commands.register({
    id: 'changes.expandAll',
    label: '&Expand All',
    icon: 'expandAll',
    enabled: (c) => viewOf(c) !== undefined && current() !== undefined,
    run: (c) => modelOf(current() as Changes, viewOf(c) as View).expandAll(),
  });
  commands.register({
    id: 'changes.collapseAll',
    label: '&Collapse All',
    icon: 'collapseAll',
    enabled: (c) => viewOf(c) !== undefined && current() !== undefined,
    run: (c) => {
      modelOf(current() as Changes, viewOf(c) as View).collapseAll();
    },
  });

  // IntelliJ's shortcuts.
  keymap?.bindDefault('Mod+K', 'changes.commit');
  keymap?.bindDefault('Alt+M', 'changes.amend');
  keymap?.bindDefault('Mod+D', 'changes.showDiff');
  // IntelliJ's Compare.SameVersion key: after the editor's Duplicate and the Commit window's Show
  // Diff, so it's the Project view's, as in IntelliJ.
  keymap?.bindDefault('Mod+D', 'git.file.showDiff');
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
  // After Annotate, as IntelliJ's Git.FileActions.
  menus.contribute({ menu: 'main/git/file', item: { command: 'git.file.showDiff' }, order: 1 });
  menus.contribute({
    menu: 'main/git/file',
    item: { command: 'git.file.compareWithRevision' },
    order: 2,
  });
  menus.contribute({
    menu: 'main/git/file',
    item: { command: 'git.file.compareWithBranch' },
    order: 3,
  });
  menus.contribute({
    menu: 'main/git/file',
    item: { command: 'git.file.showHistory' },
    order: 4,
  });
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.jumpToSource' }, group: 'a' });
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.rollback' }, group: 'b' });
  // Before Shelve Changes, as IntelliJ's.
  for (const command of ['changes.createPatch', 'changes.copyPatch']) {
    menus.contribute({ menu: 'changes/item', item: { command }, group: 'b' });
  }
  menus.contribute({ menu: 'changes/item', item: { command: 'changes.refresh' }, group: 'c' });
  menus.contribute({ menu: 'agent/item', item: { command: 'changes.showDiff' }, group: 'a' });
  menus.contribute({ menu: 'agent/item', item: { command: 'changes.jumpToSource' }, group: 'a' });
  menus.contribute({ menu: 'agent/item', item: { command: 'changes.refresh' }, group: 'b' });

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
      // As IntelliJ's `RollbackDialogAction`: what's rolled back is what's on disk.
      await saveBeforeGit();
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
      // Loaded: the Commit window's children are there at once.
      if (await find(model.loaded.get(key) as Item[])) return true;
    }
    return false;
  };
  await find(model.rows.filter((row) => row.depth === 0).map((row) => row.node));
}

/** A turn's label: when it ended, and its prompt's first line. */
function turnLabel(turn: Turn): string {
  const time = new Date(turn.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const prompt = turn.prompt.split('\n')[0] as string;
  return prompt === '' ? `Turn at ${time}` : `${time} ${prompt}`;
}

const files = (count: number) => (count === 1 ? '1 file' : `${String(count)} files`);

/**
 * A row's checkbox, for what it stands for to go into the next commit: checked when all of it
 * does, partly when some.
 */
function Include(props: { changes: Changes; item: Item }): Node {
  const { changes, item } = props;
  const files = committable(item, changes);
  const count = () => files.filter((change) => isIncluded(changes, change)).length;
  return (
    <input
      type="checkbox"
      class="playground-changes__include"
      tabIndex={-1}
      aria-label="Include in commit"
      checked={() => count() === files.length}
      indeterminate={() => count() > 0 && count() < files.length}
      on:mousedown={(event) => {
        // The tree keeps the keyboard.
        event.preventDefault();
      }}
      on:dblclick={(event) => {
        event.stopPropagation();
      }}
      on:change={() => {
        flipIncluded(changes, item);
      }}
    />
  );
}

/**
 * A row: a group's name and how many files it has; a folder's, the same; a turn's time and prompt;
 * a file's name in its status's colour, then its folder unless it's under it. Those that can go
 * into a commit start with a checkbox.
 */
function row(changes: Changes, item: Item): Node[] {
  const include =
    committable(item, changes).length > 0 ? [<Include changes={changes} item={item} />] : [];
  return [...include, ...content(item)] as Node[];
}

function content(item: Item): Node[] {
  if (item.kind === 'group') {
    return [
      <span class={`playground-changes__group playground-changes__group--${item.group}`}>
        {GROUPS[item.group]}
      </span>,
      <span class="playground-change__folder">{item.count === 0 ? '' : files(item.count)}</span>,
      // As IntelliJ's Merge Conflicts: Resolve, a link on the group's row.
      ...(item.group === 'conflicts'
        ? [
            <button
              class="playground-link"
              on:click={() => {
                resolveFromList?.();
              }}
            >
              Resolve
            </button>,
          ]
        : []),
    ] as Node[];
  }
  if (item.kind === 'folder') return folderContent(item.name, item.count);
  if (item.kind === 'turn') {
    return [
      icon('agent'),
      <span class="playground-turn" title={item.turn.prompt}>
        {turnLabel(item.turn)}
      </span>,
    ] as Node[];
  }
  return changeContent(item.change);
}

/** A folder's row in a tree of changes: its name, then how many files are under it. */
export function folderContent(name: string, count: number): Node[] {
  return [
    icon('folder'),
    <span class="playground-change">{name}</span>,
    <span class="playground-change__folder">{files(count)}</span>,
  ] as Node[];
}

/** A changed file's row: its name in its status's colour, then its folder if the list is flat. */
export function changeContent(change: Change, flat = !untracked(() => byDirectory.get())): Node[] {
  const path = change.path.replace(/\/$/, '');
  const slash = path.lastIndexOf('/');
  const folder = slash < 0 ? '' : path.slice(0, slash);
  const after = flat ? folder : '';
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

/** Below the tree, as IntelliJ's: Amend, the commit message, then Commit. */
function CommitPanel(props: { changes: Changes; services: MenuServices }): Node {
  const { changes } = props;
  const mac = props.services.keymap?.platform === 'mac';
  return (
    <div class="playground-commit">
      <label class="playground-commit__amend">
        <input
          type="checkbox"
          checked={() => changes.amend.get()}
          on:change={() => {
            flipAmend(changes).catch((error: unknown) => {
              console.error('Reading the last commit failed', error);
            });
          }}
        />
        Amend
      </label>
      <textarea
        class={() =>
          commitError.get() === ''
            ? 'playground-commit__message'
            : 'playground-commit__message playground-commit__message--invalid'
        }
        placeholder="Commit Message"
        aria-label="Commit Message"
        spellcheck={false}
        ref={(field) => {
          // Set from outside only when it differs: setting it moves the caret to the end.
          const follow = effect(() => {
            const message = changes.message.get();
            if (field.value !== message) field.value = message;
            return undefined;
          });
          onCleanup(() => {
            follow.dispose();
          });
        }}
        on:input={(event) => {
          changes.message.set((event.currentTarget as HTMLTextAreaElement).value);
          commitError.set('');
        }}
        on:keydown={(event) => {
          // IntelliJ's: Ctrl+Enter, and on macOS Cmd+Enter too (CommitActionsPanel).
          if (event.key !== 'Enter' || !(event.ctrlKey || (mac && event.metaKey))) return;
          event.preventDefault();
          event.stopPropagation();
          void commit(changes);
        }}
      />
      {() =>
        commitError.get() === '' ? null : (
          <p class="playground-commit__error" role="alert">
            {commitError.get()}
          </p>
        )
      }
      <div class="playground-commit__buttons">
        <button
          type="button"
          class="cerebro-dialog__button cerebro-dialog__button--primary"
          disabled={() => committing.get()}
          on:click={() => {
            void commit(changes);
          }}
        >
          Commit
        </button>
        <button
          type="button"
          class="cerebro-dialog__button"
          disabled={() => committing.get()}
          on:click={() => {
            commitAndPush(changes).catch((error: unknown) => {
              console.error('Reading what to push failed', error);
            });
          }}
        >
          {() => (changes.amend.get() ? 'Amend Commit and Push…' : 'Commit and Push…')}
        </button>
      </div>
    </div>
  );
}

export function ChangesView(props: {
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  return (
    <div
      class="playground-changes"
      on:focusin={() => {
        focused.set('changes');
      }}
      on:focusout={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !(event.currentTarget as HTMLElement).contains(next)) focused.set(undefined);
      }}
      on:keydown={(event) => {
        // Space puts the selected row's files in the commit, or takes them out, as IntelliJ's.
        if (event.key !== ' ' || !(event.target as Element).classList.contains('cerebro-tree')) {
          return;
        }
        const changes = current();
        const item = changes && selectedItem(changes);
        if (!changes || !item) return;
        event.preventDefault();
        flipIncluded(changes, item);
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
        const changes = changesOf(env.id);
        const { model, empty, refresh: read } = changes;
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
                row={(item) => row(changes, item)}
                onOpen={(item) => {
                  // Only files open, as IntelliJ's: the diff is Show Diff's.
                  const change = item as Extract<Item, { kind: 'change' }>;
                  if (openable(change)) props.open(fileTab(env.id, change.change.path));
                }}
                onContextMenu={(event) => {
                  openContextMenu(props.services, 'changes/item', event, FROM_VIEW);
                }}
              />
            ),
          <CommitPanel changes={changes} services={props.services} />,
        ];
      }}
    </div>
  );
}

/** The Agent Changes tool window: each of the agent's turns, with the files it changed. */
export function AgentChangesView(props: {
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  return (
    <div
      class="playground-changes"
      on:focusin={() => {
        focused.set('agent');
      }}
      on:focusout={() => {
        // Only its tree takes the focus: leaving it leaves the window.
        focused.set(undefined);
      }}
    >
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        if (!currentHost()) {
          return <p class="playground-project__empty">Agent changes show in the desktop app.</p>;
        }
        if (!gitRepository.get()) {
          return <p class="playground-project__empty">Not a git repository</p>;
        }
        const changes = changesOf(env.id);
        const { turnsModel, refresh: read } = changes;
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
        return () =>
          turnsModel.rows.length === 0 ? (
            <p class="playground-project__empty">No turns yet</p>
          ) : (
            <TreeView
              model={turnsModel}
              label={`${env.name} agent changes`}
              row={(item) => content(item)}
              onOpen={(item) => {
                const change = item as Extract<Item, { kind: 'change' }>;
                if (openable(change)) props.open(fileTab(env.id, change.change.path));
              }}
              onContextMenu={(event) => {
                openContextMenu(props.services, 'agent/item', event, FROM_AGENT);
              }}
            />
          );
      }}
    </div>
  );
}
