// Putting changes aside, as IntelliJ's shelf and git's stash: the Commit tool window's Shelf and
// Stash tabs (in its header, after Commit, while there's something in them), the Git menu's
// Uncommitted Changes (Shelve Changes…, Show Shelf, Stash Changes…, Unstash Changes…), and
// Shelve Changes… in the Commit window's menu.
//
// Each tab lists its shelved lists or stashes, the latest first; each expands to its files, which
// open their diff (double click, Enter, Ctrl/Cmd+D). The shelf's lists unshelve (Ctrl/Cmd+Shift+U)
// or are deleted; stashes pop, apply, drop, or are all cleared, as IntelliJ's. The host does the
// work (`git.shelve`, `git.stash` and the rest).

import type { Environment, Tab } from '@cerebro-ide/layout';
import { onCleanup } from '@cerebro-ide/jsx';
import { computed, ObservableMap, signal, untracked, type Signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { ToolTabs } from '@cerebro-ide/ui-layout';
import { openContextMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import {
  ChangesView,
  changeContent,
  diffTab,
  REFRESH_MS,
  refreshChanges,
  toShelve,
  type Change,
  type Range,
} from './changes.js';
import { saveBeforeGit } from './documents.js';
import { active, currentHost, gitRepository, hostFor } from './environments.js';
import { icon } from './icons.js';
import { readState } from './repository-state.js';

/** A shelved list, as the host gives it. */
export interface Shelf {
  id: string;
  commit: string;
  base: string;
  message: string;
  time: number;
}

/** A stash, as the host gives it: `stash@{0}` is the latest. */
export interface Stash {
  ref: string;
  hash: string;
  parent: string;
  message: string;
  time: number;
}

/** A row: a shelved list, a stash, or a file in one, with what it's compared between. */
type Item =
  | { kind: 'shelf'; shelf: Shelf }
  | { kind: 'stash'; stash: Stash }
  | { kind: 'file'; key: string; change: Change; range: Range; list: Item };

interface Lists {
  shelves: Signal<Shelf[]>;
  stashes: Signal<Stash[]>;
  shelfModel: TreeModel<Item>;
  stashModel: TreeModel<Item>;
  refresh: () => Promise<void>;
}

/** Observable: the tabs show once a worktree's lists are first read. */
const all = new ObservableMap<string, Lists>();

const keyOf = (item: Item) =>
  item.kind === 'shelf'
    ? `shelf:${item.shelf.id}`
    : item.kind === 'stash'
      ? `stash:${item.stash.hash}`
      : item.key;

function listsOf(worktree: string): Lists {
  // Made where it's shown, which needn't rerun when it is.
  let lists = untracked(() => all.get(worktree));
  if (!lists) {
    const host = hostFor(worktree) as NonNullable<ReturnType<typeof hostFor>>;
    const shelves = signal<Shelf[]>([]);
    const stashes = signal<Stash[]>([]);
    /** A list's files never change: read once, when it's first expanded. */
    const read = new Map<string, Promise<Change[]>>();
    const filesOf = async (list: Item, range: Range): Promise<Item[]> => {
      const id = `${range.from}..${range.to}`;
      let files = read.get(id);
      if (!files) {
        files = host.request('git.changes', { path: worktree, ...range }) as Promise<Change[]>;
        read.set(id, files);
        files.catch(() => read.delete(id));
      }
      return (await files).map((change) => ({
        kind: 'file',
        key: `${keyOf(list)}:${change.path}`,
        change,
        range,
        list,
      }));
    };
    const model = (lists: () => Item[]) =>
      new TreeModel<Item>({
        children: (item) => {
          if (item === undefined) return lists();
          if (item.kind === 'shelf') {
            return filesOf(item, { from: item.shelf.base, to: item.shelf.commit });
          }
          const { stash } = item as Extract<Item, { kind: 'stash' }>;
          return filesOf(item, { from: stash.parent, to: stash.hash });
        },
        key: keyOf,
        isLeaf: (item) => item.kind === 'file',
      });
    const shelfModel = model(() => shelves.peek().map((shelf) => ({ kind: 'shelf', shelf })));
    const stashModel = model(() => stashes.peek().map((stash) => ({ kind: 'stash', stash })));
    let last = '';
    // Reads asked for: only the latest one's answer is shown.
    let reads = 0;
    lists = {
      shelves,
      stashes,
      shelfModel,
      stashModel,
      refresh: async () => {
        const asked = ++reads;
        const [readShelves, readStashes] = (await Promise.all([
          host.request('git.shelves', { path: worktree }),
          host.request('git.stashes', { path: worktree }),
        ])) as [Shelf[], Stash[]];
        // A later read was asked for while this one ran: it has what's newer.
        if (asked !== reads) return;
        const json = JSON.stringify([readShelves, readStashes]);
        if (json === last) return;
        last = json;
        shelves.set(readShelves);
        stashes.set(readStashes);
        await Promise.all([shelfModel.refresh(), stashModel.refresh()]);
      },
    };
    all.set(worktree, lists);
  }
  return lists;
}

/** The active worktree's lists, once read. Only looked up, as `current()` in changes.tsx. */
function current(): Lists | undefined {
  const env = active();
  return env && currentHost() && gitRepository.get() ? all.get(env.id) : undefined;
}

/** The active worktree: commands that act on one are enabled only while there is one. */
const worktree = () => (active() as Environment).id;

/** Whether the active environment is a git repository the host can work on. */
const inRepository = () =>
  active() !== undefined && currentHost() !== undefined && gitRepository.get();

/**
 * Reads the active worktree's changes and lists again, and its state for the Git menu: after
 * anything changes them.
 */
export async function refreshAll(worktree: string): Promise<void> {
  await Promise.all([refreshChanges(worktree), listsOf(worktree).refresh(), readState(worktree)]);
}

type View = 'shelf' | 'stash';
type CommitTab = 'commit' | View;

/** The Commit window's tab chosen; it shows while it has something in it. */
const chosen = signal<CommitTab>('commit');

/** The tabs that show: Commit, then Shelf and Stash while they have something in them. */
function tabs(): CommitTab[] {
  const lists = current();
  const shown: CommitTab[] = ['commit'];
  if (lists && lists.shelves.get().length > 0) shown.push('shelf');
  if (lists && lists.stashes.get().length > 0) shown.push('stash');
  return shown;
}

/** Ctrl/Cmd+K's: the Commit tab, where the message is. */
export function showCommitTab(): void {
  chosen.set('commit');
}

const shownTab = computed<CommitTab>(() => {
  const tab = chosen.get();
  return tabs().includes(tab) ? tab : 'commit';
});

const TITLES: Readonly<Record<CommitTab, string>> = {
  commit: 'Commit',
  shelf: 'Shelf',
  stash: 'Stash',
};

/** The Commit window's tabs, in its header, while Shelf or Stash has something. */
export function CommitTabs(): Node {
  return (
    <>
      {() =>
        tabs().length === 1 ? null : (
          <ToolTabs
            tabs={() =>
              tabs().map((tab) => ({
                id: tab,
                title: TITLES[tab],
                active: shownTab.get() === tab,
                select: () => {
                  chosen.set(tab);
                },
              }))
            }
          />
        )
      }
    </>
  );
}

/** What a tab's commands get from its menus: they act on it. */
const FROM_SHELF = { source: 'shelf' };
const FROM_STASH = { source: 'stash' };

/** Which tab has the keyboard, if either. */
const focused = signal<View | undefined>(undefined);

const viewOf = (context: unknown): View | undefined => {
  const source = (context as { source?: string } | undefined)?.source;
  return source === 'shelf' || source === 'stash' ? source : focused.get();
};

const modelOf = (lists: Lists, view: View) =>
  view === 'shelf' ? lists.shelfModel : lists.stashModel;

/** The selected row in a tab's tree. */
function selected(view: View | undefined): Item | undefined {
  const lists = current();
  if (!lists || !view) return undefined;
  const model = modelOf(lists, view);
  return model.rows.find((row) => row.key === model.selected)?.node;
}

/** Opens a file's diff, through its list's files, as IntelliJ's shelf. */
function openDiff(
  open: (tab: Tab, chain?: readonly string[]) => void,
  model: TreeModel<Item>,
  file: Extract<Item, { kind: 'file' }>,
): void {
  const files = model.loaded.get(keyOf(file.list)) as Extract<Item, { kind: 'file' }>[];
  open(
    diffTab(file.change.path, file.range),
    files.map((each) => each.change.path),
  );
}

/** The shelved list or stash the selection is in. */
function selectedList(view: View | undefined): Item | undefined {
  const item = selected(view);
  return item?.kind === 'file' ? item.list : item;
}

const selectedShelf = (context: unknown) => {
  const view = viewOf(context);
  const item = view === 'shelf' ? selectedList(view) : undefined;
  return item?.kind === 'shelf' ? item.shelf : undefined;
};

const selectedStash = (context: unknown) => {
  const view = viewOf(context);
  const item = view === 'stash' ? selectedList(view) : undefined;
  return item?.kind === 'stash' ? item.stash : undefined;
};

/** When a list was made, as IntelliJ shows it: the date and time. */
const when = (time: number) =>
  new Date(time).toLocaleString([], {
    dateStyle: 'short',
    timeStyle: 'short',
  });

function content(item: Item): Node[] {
  if (item.kind === 'file') return changeContent(item.change);
  const [name, message, time] =
    item.kind === 'shelf'
      ? ['shelf', item.shelf.message, item.shelf.time]
      : ['stash', item.stash.message, item.stash.time];
  return [
    icon(name),
    <span class="playground-shelf__message">{message}</span>,
    <span class="playground-change__folder">{when(time)}</span>,
  ] as Node[];
}

export interface ShelfSetup {
  /** Opens a tab in the active editor. */
  open: (tab: Tab, chain?: readonly string[]) => void;
  /** Shows the Commit tool window. */
  show: () => void;
}

/** Says why something failed, as the Commit window does. */
const fail = (title: string) => (error: unknown) => {
  openDialog({
    title,
    content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
  });
};

/** Asks, as IntelliJ's confirmations: resolves whether the user agreed. */
async function confirm(title: string, text: string, label: string): Promise<boolean> {
  return (
    (await openDialog<true>({
      title,
      ok: { label, accept: () => true },
      content: () => <p>{text}</p>,
    }).result) === true
  );
}

/** Asks a host for something that changes the worktree, then reads it all again. */
async function change(worktree: string, title: string, method: string, params: object) {
  try {
    await hostFor(worktree)?.request(method, { path: worktree, ...params });
  } catch (error) {
    fail(title)(error);
  }
  await refreshAll(worktree);
}

/** The shelf's and stash's commands, shortcuts and menus, and the Git menu's. */
export function setupShelf(services: MenuServices, setup: ShelfSetup): void {
  const { commands, menus, keymap } = services;

  commands.register({
    id: 'vcs.shelve',
    label: 'S&helve Changes',
    icon: 'shelf',
    dialog: true,
    enabled: (c) => inRepository() && (toShelve(c)?.files.length ?? 0) > 0,
    run: (c) => shelve(toShelve(c) as NonNullable<ReturnType<typeof toShelve>>),
  });
  commands.register({
    id: 'vcs.showShelf',
    label: 'Show &Shelf',
    enabled: () => (current()?.shelves.get().length ?? 0) > 0,
    run: () => {
      chosen.set('shelf');
      setup.show();
    },
  });
  // As Show Shelf: where Update Project's View saved changes… goes, after a stash.
  commands.register({
    id: 'vcs.showStash',
    label: 'Show Stash',
    enabled: () => (current()?.stashes.get().length ?? 0) > 0,
    run: () => {
      chosen.set('stash');
      setup.show();
    },
  });
  commands.register({
    id: 'vcs.stash',
    label: 'Sta&sh Changes',
    dialog: true,
    enabled: inRepository,
    run: stash,
  });
  commands.register({
    id: 'vcs.unstash',
    label: '&Unstash Changes',
    dialog: true,
    enabled: inRepository,
    run: unstash,
  });
  commands.register({
    id: 'shelf.showDiff',
    label: 'Show &Diff',
    icon: 'diff',
    enabled: (c) => selected(viewOf(c))?.kind === 'file',
    run: (c) => {
      const view = viewOf(c) as View;
      const file = selected(view) as Extract<Item, { kind: 'file' }>;
      openDiff(setup.open, modelOf(current() as Lists, view), file);
    },
  });
  commands.register({
    id: 'shelf.unshelve',
    label: '&Unshelve',
    dialog: true,
    enabled: (c) => selectedShelf(c) !== undefined,
    run: async (c) => {
      const shelf = selectedShelf(c) as Shelf;
      const path = worktree();
      const agreed = await confirm(
        'Unshelve Changes',
        `The changes shelved as “${shelf.message}” will be applied to the files, and leave the shelf.`,
        'Unshelve',
      );
      if (!agreed) return;
      // As IntelliJ's `UnshelveWithDialogAction`.
      await saveBeforeGit();
      await change(path, 'Couldn’t Unshelve', 'git.unshelve', { id: shelf.id });
    },
  });
  commands.register({
    id: 'shelf.delete',
    label: '&Delete',
    enabled: (c) => selectedShelf(c) !== undefined,
    run: async (c) => {
      const shelf = selectedShelf(c) as Shelf;
      const path = worktree();
      const agreed = await confirm(
        'Delete Shelved Changes',
        `Delete the changes shelved as “${shelf.message}”?`,
        'Delete',
      );
      if (agreed) await change(path, 'Couldn’t Delete', 'git.deleteShelf', { id: shelf.id });
    },
  });
  const unstashing = (id: string, label: string, pop: boolean) => {
    commands.register({
      id,
      label,
      enabled: (c) => selectedStash(c) !== undefined,
      run: async (c) => {
        const { ref } = selectedStash(c) as Stash;
        await change(worktree(), 'Couldn’t Unstash', 'git.unstash', {
          ref,
          pop,
          reinstateIndex: false,
        });
      },
    });
  };
  unstashing('stash.pop', '&Pop', true);
  unstashing('stash.apply', '&Apply', false);
  commands.register({
    id: 'stash.drop',
    label: '&Drop',
    enabled: (c) => selectedStash(c) !== undefined,
    run: async (c) => {
      const { ref, message } = selectedStash(c) as Stash;
      const path = worktree();
      const agreed = await confirm('Drop Stash', `Remove ${ref}, “${message}”?`, 'Drop');
      if (agreed) await change(path, 'Couldn’t Drop the Stash', 'git.dropStash', { ref });
    },
  });
  commands.register({
    id: 'stash.clear',
    label: '&Clear',
    enabled: (c) => viewOf(c) === 'stash' && (current()?.stashes.get().length ?? 0) > 0,
    run: async () => {
      const path = worktree();
      const agreed = await confirm(
        'Clear Stashes',
        'Remove all stashes? They can’t be brought back.',
        'Clear',
      );
      if (agreed) await change(path, 'Couldn’t Clear the Stashes', 'git.clearStashes', {});
    },
  });

  // IntelliJ's shortcuts.
  keymap?.bindDefault('Mod+D', 'shelf.showDiff');
  keymap?.bindDefault('Mod+Shift+U', 'shelf.unshelve');
  keymap?.bindDefault('Delete', 'shelf.delete');
  keymap?.bindDefault('Delete', 'stash.drop');

  // IntelliJ's Git menu, after View and Navigate: Commit…, then Uncommitted Changes.
  menus.contribute({ menu: 'main', item: { submenu: 'main/git', label: '&Git' }, order: 7 });
  menus.contribute({ menu: 'main/git', item: { command: 'changes.commit' }, group: 'a' });
  menus.contribute({
    menu: 'main/git',
    item: { submenu: 'main/git/uncommitted', label: '&Uncommitted Changes' },
    group: 'b',
  });
  const add = (menu: string, command: string, group: string) => {
    menus.contribute({ menu, item: { command }, group });
  };
  add('main/git/uncommitted', 'vcs.shelve', 'a');
  add('main/git/uncommitted', 'vcs.showShelf', 'a');
  add('main/git/uncommitted', 'vcs.stash', 'b');
  add('main/git/uncommitted', 'vcs.unstash', 'b');
  add('changes/item', 'vcs.shelve', 'b');
  add('shelf/item', 'shelf.unshelve', 'a');
  add('shelf/item', 'shelf.showDiff', 'a');
  add('shelf/item', 'shelf.delete', 'b');
  add('stash/item', 'shelf.showDiff', 'a');
  add('stash/item', 'stash.pop', 'b');
  add('stash/item', 'stash.apply', 'b');
  add('stash/item', 'stash.drop', 'c');
  add('stash/item', 'stash.clear', 'c');
}

/**
 * IntelliJ's Shelve Changes dialog: the uncommitted files, each with a checkbox (those the user
 * chose start checked), and a comment, which names the shelved list.
 */
async function shelve(offered: { files: Change[]; chosen: Change[] }): Promise<void> {
  const path = worktree();
  const checked = signal(new Set(offered.chosen.map((change) => change.path)));
  const message = signal('');
  const files = await openDialog<string[]>({
    title: 'Shelve Changes',
    width: 480,
    ok: {
      label: 'Shelve Changes',
      enabled: () => checked.get().size > 0 && message.get().trim() !== '',
      accept: () => [...checked.peek()],
    },
    content: () => (
      <div class="playground-rollback">
        <ul class="playground-rollback__files">
          {offered.files.map((change) => (
            <li>
              <label class="playground-rollback__option">
                <input
                  type="checkbox"
                  checked={() => checked.get().has(change.path)}
                  on:change={(event) => {
                    const next = new Set(checked.peek());
                    if ((event.currentTarget as HTMLInputElement).checked) next.add(change.path);
                    else next.delete(change.path);
                    checked.set(next);
                  }}
                />
                <span class={`playground-change playground-change--${change.status}`}>
                  {change.path}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <label class="playground-shelf__field">
          Comment:
          <input
            type="text"
            class="playground-shelf__message-field"
            ref={(field) => {
              requestAnimationFrame(() => {
                field.focus();
              });
            }}
            on:input={(event) => {
              message.set((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
      </div>
    ),
  }).result;
  if (!files) return;
  // As IntelliJ's, through its commit workflow (`AbstractCommitWorkflow`).
  await saveBeforeGit();
  await change(path, 'Couldn’t Shelve', 'git.shelve', { files, message: message.peek() });
}

/** IntelliJ's Stash dialog: a message, Keep index, Include untracked; then Create Stash. */
async function stash(): Promise<void> {
  const path = worktree();
  const message = signal('');
  const keepIndex = signal(false);
  const includeUntracked = signal(false);
  const option = (label: string, value: Signal<boolean>) => (
    <label class="playground-rollback__option">
      <input
        type="checkbox"
        checked={() => value.get()}
        on:change={(event) => {
          value.set((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      {label}
    </label>
  );
  const agreed = await openDialog<true>({
    title: 'Stash',
    width: 420,
    ok: { label: 'Create Stash', accept: () => true },
    content: () => (
      <div class="playground-rollback">
        <label class="playground-shelf__field">
          Message:
          <input
            type="text"
            class="playground-shelf__message-field"
            ref={(field) => {
              requestAnimationFrame(() => {
                field.focus();
              });
            }}
            on:input={(event) => {
              message.set((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        {option('Keep index', keepIndex)}
        {option('Include untracked', includeUntracked)}
      </div>
    ),
  }).result;
  if (!agreed) return;
  // As IntelliJ's `GitStash`, a `GitRepositoryAction`.
  await saveBeforeGit();
  await change(path, 'Couldn’t Stash', 'git.stash', {
    message: message.peek(),
    keepIndex: keepIndex.peek(),
    includeUntracked: includeUntracked.peek(),
  });
}

/**
 * IntelliJ's Unstash Changes dialog: the stashes, one selected, and Reinstate index; then Apply
 * Stash, or Pop Stash, which drops it after.
 */
async function unstash(): Promise<void> {
  const path = worktree();
  let stashes: Stash[];
  try {
    stashes = (await hostFor(path)?.request('git.stashes', { path })) as Stash[];
  } catch (error) {
    fail('Couldn’t Read the Stashes')(error);
    return;
  }
  const ref = signal(stashes[0]?.ref);
  const reinstateIndex = signal(false);
  const pop = await openDialog<boolean>({
    title: 'Unstash Changes',
    width: 480,
    ok: { label: 'Apply Stash', enabled: () => ref.get() !== undefined, accept: () => false },
    choices: [{ label: 'Pop Stash', accept: () => true }],
    content: () => (
      <div class="playground-rollback">
        <p>Stashes:</p>
        <ul class="playground-rollback__files" role="listbox" aria-label="Stashes">
          {stashes.length === 0 ? <li>No stashes</li> : null}
          {stashes.map((stash) => (
            <li>
              <label class="playground-rollback__option">
                <input
                  type="radio"
                  name="stash"
                  checked={() => ref.get() === stash.ref}
                  on:change={() => {
                    ref.set(stash.ref);
                  }}
                />
                {`${stash.ref}: ${stash.message}`}
              </label>
            </li>
          ))}
        </ul>
        <label class="playground-rollback__option">
          <input
            type="checkbox"
            checked={() => reinstateIndex.get()}
            on:change={(event) => {
              reinstateIndex.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Reinstate index
        </label>
      </div>
    ),
  }).result;
  const chosenRef = ref.peek();
  if (pop === undefined || chosenRef === undefined) return;
  // As IntelliJ's `GitUnstash`, a `GitRepositoryAction`; the stash list's Apply and Pop don't.
  await saveBeforeGit();
  await change(path, 'Couldn’t Unstash', 'git.unstash', {
    ref: chosenRef,
    pop,
    reinstateIndex: reinstateIndex.peek(),
  });
}

/** A Shelf or Stash tab's tree, of a worktree's lists. */
function ListView(props: {
  view: View;
  worktree: Environment;
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  const { view, worktree } = props;
  const lists = listsOf(worktree.id);
  return (
    <div
      class="playground-changes"
      on:focusin={() => {
        focused.set(view);
      }}
      on:focusout={() => {
        // Only its tree takes the focus.
        focused.set(undefined);
      }}
    >
      <TreeView
        model={modelOf(lists, view)}
        label={`${worktree.name} ${view}`}
        row={content}
        onOpen={(item) => {
          // A file opens its diff, as in IntelliJ's shelf.
          openDiff(props.open, modelOf(lists, view), item as Extract<Item, { kind: 'file' }>);
        }}
        onContextMenu={(event) => {
          openContextMenu(
            props.services,
            `${view}/item`,
            event,
            view === 'shelf' ? FROM_SHELF : FROM_STASH,
          );
        }}
      />
    </div>
  );
}

/**
 * The Commit tool window: the tab chosen in its header. Its shelved lists and stashes are read every
 * few seconds while it shows, as its changes are.
 */
export function CommitWindow(props: {
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  return (
    <>
      {() => {
        const env = active();
        if (!env || !currentHost() || !gitRepository.get()) return null;
        const lists = listsOf(env.id);
        const refresh = () => {
          lists.refresh().catch((error: unknown) => {
            console.error('Reading the shelf and stashes failed', error);
          });
        };
        refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        onCleanup(() => {
          clearInterval(timer);
          window.removeEventListener('focus', refresh);
        });
        return null;
      }}
      {() => {
        const tab = shownTab.get();
        return tab === 'commit' ? (
          <ChangesView services={props.services} open={props.open} />
        ) : (
          <ListView
            view={tab}
            // Shelf and Stash show only while the active worktree's lists have something.
            worktree={active() as Environment}
            services={props.services}
            open={props.open}
          />
        );
      }}
    </>
  );
}
