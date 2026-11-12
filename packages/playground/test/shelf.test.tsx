import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { REFRESH_MS, setupChanges, type Change } from '../src/changes.js';
import { useProjects, workspace } from '../src/environments.js';
import {
  CommitTabs,
  CommitWindow,
  setupShelf,
  showCommitTab,
  type Shelf,
  type Stash,
} from '../src/shelf.js';
import {
  closeAll,
  dialog,
  dialogText,
  FakeHost,
  menuItems,
  press,
  project,
  savedBefore,
  unsavedEdit,
} from './fakes.js';

/** The worktree as git sees it. */
const git = {
  changes: [] as Change[],
  shelves: [] as Shelf[],
  stashes: [] as Stash[],
  /** Each shelved list's and stash's files, by their range. */
  files: {} as Record<string, Change[]>,
  failing: undefined as string | undefined,
  /** The next read of the shelf held until it resolves. */
  holdShelves: undefined as Promise<void> | undefined,
};
const fails = (method: string) => {
  if (git.failing === method) throw new Error(`${method} failed`);
};
const done = (method: string) => () => {
  fails(method);
  return null;
};
const host = new FakeHost({
  'git.state': () => ({ conflicts: false }),
  'git.changes': ({ from, to }: { from?: string; to?: string }) => {
    fails('git.changes');
    return from === undefined ? git.changes : (git.files[`${from}..${String(to)}`] ?? []);
  },
  'agent.turns': () => [],
  'git.shelves': async () => {
    fails('git.shelves');
    // As they were when asked, answered once released.
    const shelves = git.shelves;
    const hold = git.holdShelves;
    git.holdShelves = undefined;
    await hold;
    return shelves;
  },
  'git.stashes': () => {
    fails('git.stashes');
    return git.stashes;
  },
  'git.shelve': done('git.shelve'),
  'git.unshelve': done('git.unshelve'),
  'git.deleteShelf': done('git.deleteShelf'),
  'git.stash': done('git.stash'),
  'git.unstash': done('git.unstash'),
  'git.dropStash': done('git.dropStash'),
  'git.clearStashes': done('git.clearStashes'),
});

const SHELF: Shelf = { id: 's1', commit: 'c1', base: 'b1', message: 'Half done', time: 0 };
const STASHES: Stash[] = [
  { ref: 'stash@{0}', hash: 'h0', parent: 'p0', message: 'WIP on main', time: 0 },
  { ref: 'stash@{1}', hash: 'h1', parent: 'p1', message: 'Older', time: 0 },
];
const FROM_SHELF = { source: 'shelf' };
const FROM_STASH = { source: 'stash' };

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };
const opened: Tab[] = [];
/** The files each diff opened goes through. */
const chains: (readonly string[] | undefined)[] = [];
const open = (tab: Tab, chain?: readonly string[]) => {
  opened.push(tab);
  chains.push(chain);
};
let shown = 0;
let dispose: (() => void) | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  useProjects([project('/r', host), project('/s', undefined)]);
  setupChanges(services, {
    open: (tab) => void opened.push(tab),
    activeTab: () => undefined,
    show: () => undefined,
    openAt: () => undefined,
  });
  setupShelf(services, {
    open,
    show: () => {
      shown++;
    },
  });
});

/** Each test's own worktree: the window keeps each one's lists. */
let wt = '/r';
let tests = 0;
beforeEach(() => {
  wt = `/r/t${String(++tests)}`;
  workspace.openOrActivate({ id: wt, name: 'r', branch: 'main' });
  git.changes = [];
  git.shelves = [SHELF];
  git.stashes = STASHES;
  git.files = {
    'b1..c1': [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'added' },
    ],
    'p0..h0': [{ path: 'b.ts', status: 'added' }],
  };
});

afterEach(async () => {
  await closeAll();
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  opened.length = 0;
  chains.length = 0;
  host.asked.length = 0;
  git.failing = undefined;
  showCommitTab();
  workspace.close(wt);
  vi.restoreAllMocks();
});

/** The Commit window, with its tabs above it, as in its header. */
function mount(): void {
  const box = document.createElement('div');
  box.style.height = '600px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  document.body.append(box);
  const handle = render(
    () => (
      <>
        <CommitTabs />
        <CommitWindow services={services} open={open} />
      </>
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
}

const tabs = () =>
  [...document.querySelectorAll('.cerebro-tool-tab')].map((t) => t.textContent.trim());
const tab = (title: string) =>
  [...document.querySelectorAll('.cerebro-tool-tab')].find(
    (t) => t.textContent.trim() === title,
  ) as HTMLElement;
const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((r) =>
    (
      (
        r.querySelector('.playground-shelf__message') ??
        r.querySelector('.cerebro-tree-row__content')
      )?.textContent ?? ''
    ).trim(),
  );
const row = (key: string) =>
  document.querySelector(`.cerebro-tree-row[data-key="${key}"]`) as HTMLElement;
const reads = (method: string) => host.params(method).length;

/** The Commit window on its Shelf or Stash tab, listing what git has. */
async function showTab(title: 'Shelf' | 'Stash'): Promise<void> {
  mount();
  await expect.poll(tabs).toEqual(['Commit', 'Shelf', 'Stash']);
  await userEvent.click(tab(title));
  await expect.poll(() => document.querySelector('.playground-shelf__message')).not.toBeNull();
}

describe('the Commit window’s tabs', () => {
  it('show Shelf and Stash while they have something, each showing its lists', async () => {
    git.shelves = [];
    git.stashes = [];
    mount();
    await expect.poll(() => reads('git.shelves')).toBe(1);
    expect(tabs()).toEqual([]);
    git.shelves = [SHELF];
    vi.advanceTimersByTime(REFRESH_MS);
    await expect.poll(tabs).toEqual(['Commit', 'Shelf']);
    git.stashes = STASHES;
    window.dispatchEvent(new Event('focus'));
    await expect.poll(tabs).toEqual(['Commit', 'Shelf', 'Stash']);
    await userEvent.click(tab('Stash'));
    await expect.poll(rows).toEqual(['WIP on main', 'Older']);
    expect(row('stash:h0').textContent).toContain(
      new Date(0).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
    );
    await userEvent.click(tab('Shelf'));
    await expect.poll(rows).toEqual(['Half done']);
    // A tab that empties shows Commit's again.
    git.shelves = [];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(tabs).toEqual(['Commit', 'Stash']);
    expect(document.querySelector('.playground-shelf__message')).toBeNull();
    // Ctrl/Cmd+K's: the Commit tab.
    await userEvent.click(tab('Stash'));
    showCommitTab();
    await expect.poll(() => document.querySelector('.playground-shelf__message')).toBeNull();
  });

  it('are read every few seconds and on focus while shown, redrawn only if changed', async () => {
    mount();
    await expect.poll(tabs).toHaveLength(3);
    await userEvent.click(tab('Shelf'));
    const drawn = row('shelf:s1');
    vi.advanceTimersByTime(REFRESH_MS);
    await expect.poll(() => reads('git.shelves')).toBe(2);
    expect(row('shelf:s1')).toBe(drawn);
    // Failing, it says so in the console.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.failing = 'git.shelves';
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => logged.mock.calls.length).toBe(1);
    expect(logged.mock.calls[0]?.[0]).toBe('Reading the shelf and stashes failed');
    // Not once closed.
    dispose?.();
    dispose = undefined;
    const now = reads('git.shelves');
    vi.advanceTimersByTime(REFRESH_MS);
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads('git.shelves')).toBe(now);
  });

  it('take the latest read when reads overlap, not an earlier one answered after', async () => {
    mount();
    await expect.poll(tabs).toHaveLength(3);
    let release!: () => void;
    git.holdShelves = new Promise((resolve) => (release = resolve));
    git.shelves = [];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => git.holdShelves).toBeUndefined();
    git.shelves = [SHELF, { ...SHELF, id: 's2', message: 'Newer' }];
    window.dispatchEvent(new Event('focus'));
    await userEvent.click(tab('Shelf'));
    await expect.poll(rows).toEqual(['Half done', 'Newer']);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tabs()).toEqual(['Commit', 'Shelf', 'Stash']);
    expect(rows()).toEqual(['Half done', 'Newer']);
  });

  it('leave the commands off until they’re read', () => {
    expect(commands.isEnabled('vcs.shelve')).toBe(false);
    expect(commands.isEnabled('vcs.showShelf')).toBe(false);
    expect(commands.isEnabled('stash.clear', FROM_STASH)).toBe(false);
    expect(commands.isEnabled('shelf.showDiff', FROM_SHELF)).toBe(false);
  });

  it('leave a tab’s commands off with neither its menu nor the keyboard', async () => {
    await showTab('Shelf');
    expect(commands.isEnabled('shelf.delete')).toBe(false);
  });

  it('show the active worktree’s, and nothing once it closes', async () => {
    await showTab('Shelf');
    const first = wt;
    git.shelves = [{ ...SHELF, id: 's2', message: 'Elsewhere' }];
    wt = `/r/t${String(++tests)}`;
    workspace.openOrActivate({ id: wt, name: 'r', branch: 'main' });
    await expect.poll(rows).toEqual(['Elsewhere']);
    workspace.close(first);
    workspace.close(wt);
    await expect.poll(() => document.querySelector('.cerebro-tree')).toBeNull();
  });

  it('show nowhere without a host', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.asked).toEqual([]);
    expect(tabs()).toEqual([]);
    expect(commands.isEnabled('vcs.stash')).toBe(false);
    workspace.close('/s');
  });
});

describe('the Shelf tab', () => {
  it('expands a list to its files, read once, which open their diff', async () => {
    await showTab('Shelf');
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => row('shelf:s1:src/a.ts')).not.toBeNull();
    expect(host.params('git.changes')).toContainEqual({ path: wt, from: 'b1', to: 'c1' });
    await userEvent.dblClick(row('shelf:s1:src/a.ts'));
    expect(opened.map((t) => t.id)).toEqual(['diff@b1..c1:src/a.ts']);
    // Through the list's files, as IntelliJ's shelf.
    expect(chains).toEqual([['src/a.ts', 'src/b.ts']]);
    // Collapsed and expanded again, its files aren't read again.
    const read = reads('git.changes');
    await userEvent.dblClick(row('shelf:s1'));
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => row('shelf:s1:src/a.ts')).not.toBeNull();
    expect(reads('git.changes')).toBe(read);
    // Nor when the lists are read again.
    git.stashes = [STASHES[0] as Stash];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => reads('git.stashes')).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reads('git.changes')).toBe(read);
    // Show Diff, from the keyboard on a file.
    await userEvent.click(row('shelf:s1:src/a.ts'));
    expect(commands.isEnabled('shelf.showDiff')).toBe(true);
    commands.execute('shelf.showDiff');
    expect(opened).toHaveLength(2);
    expect(chains[1]).toEqual(chains[0]);
    expect(keymap.shortcutsFor('shelf.showDiff')).toEqual(['Ctrl+D']);
    // Not on a list, nor once the keyboard left.
    await userEvent.click(row('shelf:s1'));
    expect(commands.isEnabled('shelf.showDiff')).toBe(false);
    (document.activeElement as HTMLElement).blur();
    expect(commands.isEnabled('shelf.unshelve')).toBe(false);
  });

  it('reads a list’s files again after a read failed', async () => {
    await showTab('Shelf');
    git.failing = 'git.changes';
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => reads('git.changes')).toBeGreaterThan(0);
    await userEvent.dblClick(row('shelf:s1'));
    git.failing = undefined;
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => row('shelf:s1:src/a.ts')).not.toBeNull();
  });

  it('unshelves a list, or a file’s, once agreed, then reads it all again', async () => {
    await showTab('Shelf');
    await userEvent.click(row('shelf:s1'), { button: 'right' });
    expect(await menuItems()).toEqual(['Unshelve…', 'Show Diff', 'Delete']);
    await closeAll();
    // From a file, its list.
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => row('shelf:s1:src/a.ts')).not.toBeNull();
    await userEvent.click(row('shelf:s1:src/a.ts'));
    commands.execute('shelf.unshelve');
    expect(await dialogText()).toContain('“Half done” will be applied');
    await press('Cancel');
    expect(host.params('git.unshelve')).toEqual([]);
    const read = reads('git.shelves');
    commands.execute('shelf.unshelve', FROM_SHELF);
    await press('Unshelve');
    await expect.poll(() => host.params('git.unshelve')).toEqual([{ path: wt, id: 's1' }]);
    await expect.poll(() => reads('git.shelves')).toBe(read + 1);
    expect(keymap.shortcutsFor('shelf.unshelve')).toEqual(['Ctrl+Shift+U']);
    // Failing, it says why, and still reads it all again.
    git.failing = 'git.unshelve';
    commands.execute('shelf.unshelve', FROM_SHELF);
    await press('Unshelve');
    expect(await dialogText()).toBe('git.unshelve failed');
    expect((await dialog()).textContent).toContain('Couldn’t Unshelve');
    await expect.poll(() => reads('git.shelves')).toBe(read + 2);
  });

  it('deletes a list, once agreed', async () => {
    await showTab('Shelf');
    await userEvent.click(row('shelf:s1'));
    commands.execute('shelf.delete');
    expect(await dialogText()).toBe('Delete the changes shelved as “Half done”?');
    await press('Cancel');
    commands.execute('shelf.delete', FROM_SHELF);
    await press('Delete');
    await expect.poll(() => host.params('git.deleteShelf')).toEqual([{ path: wt, id: 's1' }]);
    // Stash's commands aren't the shelf's.
    expect(commands.isEnabled('stash.drop', FROM_SHELF)).toBe(false);
    expect(commands.isEnabled('stash.clear', FROM_SHELF)).toBe(false);
  });

  it('is shown by Show Shelf, while there is one', async () => {
    mount();
    await expect.poll(tabs).toHaveLength(3);
    const before = shown;
    commands.execute('vcs.showShelf');
    expect(shown).toBe(before + 1);
    await expect.poll(rows).toEqual(['Half done']);
    git.shelves = [];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => commands.isEnabled('vcs.showShelf')).toBe(false);
  });

  it('is shown by Show Stash, while there is one', async () => {
    mount();
    await expect.poll(tabs).toHaveLength(3);
    const before = shown;
    commands.execute('vcs.showStash');
    expect(shown).toBe(before + 1);
    await expect.poll(rows).toEqual(['WIP on main', 'Older']);
    git.stashes = [];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => commands.isEnabled('vcs.showStash')).toBe(false);
  });
});

describe('the Stash tab', () => {
  it('pops, applies and drops the stash chosen', async () => {
    await showTab('Stash');
    await userEvent.click(row('stash:h1'), { button: 'right' });
    expect(await menuItems()).toEqual(['Show Diff', 'Pop', 'Apply', 'Drop', 'Clear']);
    await closeAll();
    await userEvent.click(row('stash:h1'));
    commands.execute('stash.pop');
    await expect
      .poll(() => host.params('git.unstash'))
      .toEqual([{ path: wt, ref: 'stash@{1}', pop: true, reinstateIndex: false }]);
    commands.execute('stash.apply', FROM_STASH);
    await expect.poll(() => host.params('git.unstash')).toHaveLength(2);
    expect(host.params('git.unstash')[1]).toMatchObject({ pop: false });
    commands.execute('stash.drop', FROM_STASH);
    expect(await dialogText()).toBe('Remove stash@{1}, “Older”?');
    await press('Cancel');
    commands.execute('stash.drop', FROM_STASH);
    await press('Drop');
    await expect.poll(() => host.params('git.dropStash')).toEqual([{ path: wt, ref: 'stash@{1}' }]);
    // A stash's files open their diff too.
    await userEvent.dblClick(row('stash:h0'));
    await expect.poll(() => row('stash:h0:b.ts')).not.toBeNull();
    await userEvent.dblClick(row('stash:h0:b.ts'));
    expect(opened.map((t) => t.id)).toEqual(['diff@p0..h0:b.ts']);
    expect(chains).toEqual([['b.ts']]);
    // The shelf's commands aren't the stash's.
    expect(commands.isEnabled('shelf.unshelve', FROM_STASH)).toBe(false);
  });

  it('clears every stash, once agreed', async () => {
    await showTab('Stash');
    commands.execute('stash.clear', FROM_STASH);
    expect(await dialogText()).toBe('Remove all stashes? They can’t be brought back.');
    await press('Cancel');
    commands.execute('stash.clear', FROM_STASH);
    await press('Clear');
    await expect.poll(() => host.params('git.clearStashes')).toEqual([{ path: wt }]);
    git.stashes = [];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => commands.isEnabled('stash.clear', FROM_STASH)).toBe(false);
  });
});

describe('the Git menu’s Uncommitted Changes', () => {
  it('shelves the files checked, with a comment, which it needs', async () => {
    git.changes = [
      { path: 'a.ts', status: 'modified' },
      { path: 'n.ts', status: 'untracked' },
    ];
    mount();
    await expect.poll(() => commands.isEnabled('vcs.shelve')).toBe(true);
    commands.execute('vcs.shelve');
    const box = await dialog();
    const checks = [...box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    // What goes in starts checked: the tracked files.
    expect(checks.map((c) => c.checked)).toEqual([true, false]);
    const shelveButton = [...box.querySelectorAll('.cerebro-dialog__button')].find(
      (b) => b.textContent === 'Shelve Changes',
    ) as HTMLButtonElement;
    expect(shelveButton.disabled).toBe(true);
    await expect
      .poll(() => document.activeElement?.className)
      .toBe('playground-shelf__message-field');
    await userEvent.keyboard('Later');
    await userEvent.click(checks[1] as HTMLInputElement);
    await userEvent.click(checks[0] as HTMLInputElement);
    await press('Shelve Changes');
    await expect
      .poll(() => host.params('git.shelve'))
      .toEqual([{ path: wt, files: ['n.ts'], message: 'Later' }]);
    // Cancelled, nothing's shelved.
    commands.execute('vcs.shelve');
    await press('Cancel');
    expect(host.params('git.shelve')).toHaveLength(1);
  });

  it('stashes, with a message and the options chosen', async () => {
    mount();
    await expect.poll(() => commands.isEnabled('vcs.stash')).toBe(true);
    commands.execute('vcs.stash');
    const box = await dialog();
    await expect
      .poll(() => document.activeElement?.className)
      .toBe('playground-shelf__message-field');
    await userEvent.keyboard('Aside');
    const [keepIndex, untracked] = [
      ...box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ] as [HTMLInputElement, HTMLInputElement];
    await userEvent.click(keepIndex);
    await userEvent.click(untracked);
    await userEvent.click(untracked);
    await press('Create Stash');
    await expect
      .poll(() => host.params('git.stash'))
      .toEqual([{ path: wt, message: 'Aside', keepIndex: true, includeUntracked: false }]);
    commands.execute('vcs.stash');
    await press('Cancel');
    expect(host.params('git.stash')).toHaveLength(1);
    // Failing, it says why.
    git.failing = 'git.stash';
    commands.execute('vcs.stash');
    await press('Create Stash');
    expect(await dialogText()).toBe('git.stash failed');
  });

  it('unstashes the stash chosen, applied or popped, its index reinstated if asked', async () => {
    mount();
    await expect.poll(() => commands.isEnabled('vcs.unstash')).toBe(true);
    commands.execute('vcs.unstash');
    const box = await dialog();
    const radios = [...box.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    await userEvent.click(radios[1] as HTMLInputElement);
    await userEvent.click(box.querySelector('input[type="checkbox"]') as HTMLInputElement);
    await press('Pop Stash');
    await expect
      .poll(() => host.params('git.unstash'))
      .toEqual([{ path: wt, ref: 'stash@{1}', pop: true, reinstateIndex: true }]);
    commands.execute('vcs.unstash');
    await press('Apply Stash');
    await expect.poll(() => host.params('git.unstash')).toHaveLength(2);
    expect(host.params('git.unstash')[1]).toEqual({
      path: wt,
      ref: 'stash@{0}',
      pop: false,
      reinstateIndex: false,
    });
    commands.execute('vcs.unstash');
    await press('Cancel');
    expect(host.params('git.unstash')).toHaveLength(2);
  });

  it('saves the documents first, as IntelliJ’s: before Shelve, Stash, Unstash… and Unshelve', async () => {
    git.changes = [{ path: 'a.ts', status: 'modified' }];
    await showTab('Shelf');
    const saved = async (method: string, run: () => Promise<void>) => {
      host.asked.length = 0;
      await unsavedEdit(host, `${wt}/a.ts`);
      await run();
      await expect.poll(() => host.params(method)).toHaveLength(1);
      return savedBefore(host, `${wt}/a.ts`, method);
    };
    await expect.poll(() => commands.isEnabled('vcs.shelve')).toBe(true);
    const shelve = async () => {
      commands.execute('vcs.shelve');
      await dialog();
      await expect
        .poll(() => document.activeElement?.className)
        .toBe('playground-shelf__message-field');
      await userEvent.keyboard('Later');
      await press('Shelve Changes');
    };
    expect(await saved('git.shelve', shelve)).toBe(true);
    const stash = async () => {
      commands.execute('vcs.stash');
      await press('Create Stash');
    };
    expect(await saved('git.stash', stash)).toBe(true);
    const unstash = async () => {
      commands.execute('vcs.unstash');
      await press('Apply Stash');
    };
    expect(await saved('git.unstash', unstash)).toBe(true);
    const unshelve = async () => {
      commands.execute('shelf.unshelve', FROM_SHELF);
      await press('Unshelve');
    };
    await userEvent.click(row('shelf:s1'));
    expect(await saved('git.unshelve', unshelve)).toBe(true);
    // The stash list's Apply doesn't, as IntelliJ's (`GitStashActions`).
    await userEvent.click(tab('Stash'));
    await expect.poll(() => row('stash:h1')).not.toBeNull();
    await userEvent.click(row('stash:h1'));
    const apply = () => {
      commands.execute('stash.apply', FROM_STASH);
      return Promise.resolve();
    };
    expect(await saved('git.unstash', apply)).toBe(false);
    expect(host.params('fs.write')).toEqual([]);
  });

  it('says when there are no stashes to unstash, or they can’t be read', async () => {
    git.stashes = [];
    mount();
    await expect.poll(() => commands.isEnabled('vcs.unstash')).toBe(true);
    commands.execute('vcs.unstash');
    expect(await dialogText()).toContain('No stashes');
    const apply = [...(await dialog()).querySelectorAll('.cerebro-dialog__button')].find(
      (b) => b.textContent === 'Apply Stash',
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await press('Pop Stash');
    expect(host.params('git.unstash')).toEqual([]);
    git.failing = 'git.stashes';
    commands.execute('vcs.unstash');
    expect(await dialogText()).toBe('git.stashes failed');
    expect((await dialog()).textContent).toContain('Couldn’t Read the Stashes');
  });

  it('is in the Git menu, after Commit…', () => {
    expect(menus.entries('main/git')).toEqual([
      { command: 'changes.commit' },
      { separator: true },
      { submenu: 'main/git/uncommitted', label: '&Uncommitted Changes' },
    ]);
  });
});

it('binds no shortcuts without a keymap', () => {
  const alone = new CommandRegistry();
  setupShelf(
    { commands: alone, menus: new MenuRegistry() },
    { open: () => undefined, show: () => undefined },
  );
  expect(alone.isEnabled('vcs.stash')).toBe(true);
});
