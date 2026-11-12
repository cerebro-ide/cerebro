import { CommandRegistry, Keymap, MenuRegistry, type CommandSpec } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { Tab } from '@cerebro-ide/layout';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupBranches, type BranchRef } from '../src/branches.js';
import { compareTab, setupCompare } from '../src/compare-branches.js';
import { DiffWithWorkingTree, setupDiffWithWorkingTree } from '../src/diff-with-working-tree.js';
import { useProjects, workspace } from '../src/environments.js';
import { paneSettings, type BranchesSelection } from '../src/log-branches.js';
import { icon } from '../src/icons.js';
import { notifications } from '../src/notifications.js';
import { readState } from '../src/repository-state.js';
import {
  answer,
  closeAll,
  dialog,
  dialogText,
  FakeHost,
  menuItem,
  menuItems,
  popupItems,
  press,
  project,
  savedBefore,
  unsavedEdit,
} from './fakes.js';

/** The repository as the host sees it, and how what's asked of it goes. */
const git = {
  local: ['feature', 'main', 'side'],
  remote: ['origin/main', 'origin/side'],
  current: 'main' as string | undefined,
  /** The branch each local one tracks, by name. */
  upstreams: {} as Record<string, string>,
  /** The remote branch a branch deleted alone tracked, as the host says. */
  tracked: undefined as string | undefined,
  /** Why a remote branch's deletion fails, if it does. */
  remoteFailing: undefined as Error | undefined,
  tagRemotes: 0,
  remoteTag: { deleted: [], failed: [] } as
    { deleted: string[]; failed: { remote: string; error: string }[] } | Error,
  /** What a merge or rebase gives, or the error it fails with. */
  result: 'done' as unknown,
  conflicted: [] as string[],
  /** The tags, or why they can't be read. */
  tags: ['v1', 'v2'] as string[] | Error,
  /** Whether the repository has remotes, as its state says. */
  remotes: true,
  /** What updating a branch gives, or the error it fails with. */
  updated: {} as { worktree?: string } | Error,
  /** Held until it resolves: the branches' reading. */
  branchesHeld: undefined as Promise<void> | undefined,
};
const fail = (method: string) => () => {
  if (git.result instanceof Error) throw git.result;
  return method === 'result' ? git.result : null;
};
const host = new FakeHost({
  'git.branches': async () => {
    await git.branchesHeld;
    return [
      ...git.local.map((b) => ({
        ref: `refs/heads/${b}`,
        current: b === git.current,
        ...(git.upstreams[b] === undefined ? {} : { upstream: `refs/remotes/${git.upstreams[b]}` }),
      })),
      ...git.remote.map((b) => ({ ref: `refs/remotes/${b}`, current: false })),
    ];
  },
  'git.checkout': fail('checkout'),
  'git.checkoutRevision': fail('checkout'),
  'git.tags': () => {
    if (git.tags instanceof Error) throw git.tags;
    return git.tags;
  },
  'git.createBranch': fail('create'),
  'git.renameBranch': fail('rename'),
  'git.deleteBranch': () => {
    if (git.result instanceof Error) throw git.result;
    return {
      hash: 'abc',
      unmerged: git.result === 'unmerged',
      ...(git.tracked === undefined ? {} : { tracked: git.tracked }),
    };
  },
  'git.deleteRemoteBranch': () => {
    if (git.remoteFailing) throw git.remoteFailing;
    return null;
  },
  'git.restoreBranch': () => null,
  'git.deleteTag': () => {
    if (git.result instanceof Error) throw git.result;
    return { hash: 'def', remotes: git.tagRemotes };
  },
  'git.deleteRemoteTag': () => {
    if (git.remoteTag instanceof Error) throw git.remoteTag;
    return git.remoteTag;
  },
  'git.restoreTag': () => {
    if (git.result instanceof Error) throw git.result;
    return null;
  },
  'git.mergeBranch': fail('result'),
  'git.rebaseOnto': fail('result'),
  'git.rebase': fail('result'),
  'git.continue': () => 'done',
  'git.state': () => ({ conflicts: false, ...(git.remotes ? {} : { remotes: false }) }),
  'git.updateBranch': () => {
    if (git.updated instanceof Error) throw git.updated;
    return git.updated;
  },
  'git.conflicts': () => ({
    operation: 'merge',
    files: git.conflicted.map((path) => ({ path, yours: 'modified', theirs: 'modified' })),
  }),
  'git.acceptSide': () => {
    git.conflicted = [];
    return null;
  },
  'git.shelves': () => [],
  'git.stashes': () => [],
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
const readWorktrees = vi.fn(() => Promise.resolve());
const open = vi.fn();
const button = document.createElement('button');
const compared: Tab[] = [];
let revealed = 0;
let pick: (button: HTMLElement) => unknown;

beforeAll(() => {
  // `side` is checked out in another worktree.
  useProjects([
    project('/r', host, [
      { id: '/r', branch: 'main' },
      { id: '/r-side', branch: 'side' },
    ]),
    project('/s', undefined),
  ]);
  document.body.append(button);
  ({ pick } = setupBranches(services, { readWorktrees, open }));
  setupCompare(services, (tab) => compared.push(tab));
  setupDiffWithWorkingTree(() => {
    revealed++;
  });
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.current = 'main';
  git.result = 'done';
  git.conflicted = [];
  git.tags = ['v1', 'v2'];
  git.upstreams = {};
  git.tracked = undefined;
  git.remoteFailing = undefined;
  git.tagRemotes = 0;
  git.remoteTag = { deleted: [], failed: [] };
  git.remotes = true;
  git.updated = {};
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  readWorktrees.mockClear();
  open.mockClear();
  vi.restoreAllMocks();
});

const last = () => notifications.all.get(0);
/** Opens the popup, with the branches read. */
const popup = async () => {
  pick(button);
  await expect.poll(() => document.querySelectorAll('.cerebro-popup-item').length).toBe(9);
};
/** A row of the popup, by its branch's name. */
const row = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-popup-item')].find(
    (r) => r.querySelector('.cerebro-popup-item__label')?.textContent === name,
  ) as HTMLElement;
/** A branch's menu's items, opened from its row. */
const branchMenu = async (name: string) => {
  await userEvent.click(row(name));
  return menuItems();
};
/** Opens the popup and runs an item of a branch's menu, as clicked; waits for what it does. */
const choose = async (name: string, item: string) => {
  await popup();
  await branchMenu(name);
  await userEvent.click(menuItem(item));
};

describe('the branches popup', () => {
  it('opens from the Git menu’s Branches…, at the window’s top, beside New Branch…', async () => {
    const entries = JSON.stringify(menus.entries('main/git'));
    expect(entries.indexOf('git.branches')).toBeLessThan(entries.indexOf('git.newBranch'));
    expect(commands.get('git.branches')?.label).toBe('&Branches');
    commands.execute('git.branches');
    await expect.poll(() => document.querySelectorAll('.cerebro-popup-item').length).toBe(9);
    // Centred, not below the toolbar's button.
    const shown = (document.querySelector('.cerebro-popup') as HTMLElement).getBoundingClientRect();
    expect(Math.abs(shown.left + shown.width / 2 - window.innerWidth / 2)).toBeLessThanOrEqual(1);
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('git.branches')).toBe(false);
  });

  it('lists New Branch… and Checkout Tag or Revision…, then the local and remote branches and the tags, the current checked', async () => {
    await popup();
    expect(await popupItems()).toEqual([
      'New Branch…',
      'Checkout Tag or Revision…',
      'main',
      'feature',
      'side',
      'origin/main',
      'origin/side',
      'v1',
      'v2',
    ]);
    expect(
      [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent),
    ).toEqual(['Local', 'Remote', 'Tags']);
    expect(row('main').querySelector('.cerebro-popup-item__icon svg')).not.toBeNull();
    // The worktree a branch is checked out in.
    expect(row('side').textContent).toContain('r-side');
    // Searched.
    await userEvent.keyboard('orig');
    expect(await popupItems()).toEqual(['origin/main', 'origin/side']);
  });

  it('lists the tags while Show Tags is on, as IntelliJ’s; without them where they can’t be read', async () => {
    paneSettings.showTags.set(false);
    pick(button);
    await expect.poll(() => document.querySelectorAll('.cerebro-popup-item').length).toBe(7);
    expect(host.params('git.tags')).toEqual([]);
    await closeAll();
    paneSettings.showTags.set(true);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.tags = new Error('fatal: bad object');
    pick(button);
    await expect.poll(() => logged.mock.calls[0]?.[0] as unknown).toBe('Reading the tags failed');
    await expect.poll(() => document.querySelectorAll('.cerebro-popup-item').length).toBe(7);
  });

  it('a tag’s menu: Checkout, Merge and Delete, as IntelliJ’s', async () => {
    await popup();
    expect(await branchMenu('v1')).toEqual([
      'Checkout',
      'Show Diff with Working Tree',
      "Merge 'v1' into 'main'",
      'Delete',
    ]);
    await closeAll();
    // Checkout detaches HEAD at it.
    await choose('v2', 'Checkout');
    await expect.poll(() => last()?.content).toBe('Checked out v2');
    expect(host.params('git.checkoutRevision')).toEqual([{ path: '/r', reference: 'v2' }]);
    // Merged, with no deletion proposed.
    await choose('v1', "Merge 'v1' into 'main'");
    await expect.poll(() => last()?.content).toBe('Merged v1 to main');
    expect(last()?.actions).toEqual([]);
    await choose('v1', 'Delete');
    await expect.poll(() => last()?.title).toBe('Deleted Tag: v1');
    expect(host.params('git.deleteTag')).toEqual([{ path: '/r', name: 'v1' }]);
  });

  it('marks favorites, as IntelliJ’s: starred, after the branch checked out; Space or a click on the icon', async () => {
    await popup();
    /** What a row's icon is: the check, a star, a star shown on the row highlighted, or its kind's. */
    const mark = (name: string) => {
      const at = row(name).querySelector('.cerebro-popup-item__icon') as HTMLElement;
      const unmarked = at.querySelector('.playground-branches-popup__unmarked');
      if (unmarked) {
        if (getComputedStyle(unmarked).display !== 'none') return 'hover';
        const kind = at.querySelector('.playground-branches-popup__kind path')?.getAttribute('d');
        return kind === branchIcon ? 'branch' : kind === tagIcon ? 'tag' : 'none';
      }
      return at.querySelector('path')?.getAttribute('d') === star ? 'star' : 'check';
    };
    const drawn = (name: string) =>
      (icon(name) as Element).querySelector('path')?.getAttribute('d') as string;
    const [branchIcon, tagIcon] = [drawn('git'), drawn('tag')];
    const star = row('origin/main')
      .querySelector('.cerebro-popup-item__icon path')
      ?.getAttribute('d');
    // origin/main is one to start with, as IntelliJ's; the one checked out keeps its check; the
    // others have a branch's icon, or a tag's.
    expect(['main', 'feature', 'side', 'origin/main', 'origin/side', 'v1'].map(mark)).toEqual([
      'check',
      'branch',
      'branch',
      'star',
      'branch',
      'tag',
    ]);
    // A click on side's icon marks it, the popup staying open; it goes after the one checked out.
    const sideIcon = row('side').querySelector('.cerebro-popup-item__icon') as HTMLElement;
    await userEvent.hover(sideIcon);
    expect(mark('side')).toBe('hover');
    await userEvent.click(sideIcon);
    await expect
      .poll(popupItems)
      .toEqual([
        'New Branch…',
        'Checkout Tag or Revision…',
        'main',
        'side',
        'feature',
        'origin/main',
        'origin/side',
        'v1',
        'v2',
      ]);
    expect(mark('side')).toBe('star');
    // Filled, as IntelliJ's; the one to click, an outline.
    const fill = (name: string) =>
      getComputedStyle(row(name).querySelector('.cerebro-popup-item__icon path') as Element).fill;
    expect(fill('side')).not.toBe('none');
    expect(fill('feature')).toBe('none');
    expect(document.querySelector('.cerebro-popup')).not.toBeNull();
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    // Space, on the row highlighted: side unmarked, and the search took no space.
    await userEvent.keyboard('sid');
    await userEvent.keyboard(' ');
    expect(mark('side')).toBe('hover');
    expect((document.querySelector('.cerebro-popup input') as HTMLInputElement).value).toBe('sid');
    // On an item that's not a branch, Space does nothing.
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace} ');
    expect(await popupItems()).toContain('feature');
  });

  it('shows each branch’s actions as IntelliJ’s: only those that apply', async () => {
    await popup();
    expect(await branchMenu('feature')).toEqual([
      'Checkout',
      "New Branch from 'feature'…",
      "Checkout and Rebase onto 'main'",
      "Compare with 'main'",
      'Show Diff with Working Tree',
      "Rebase 'main' onto 'feature'",
      "Merge 'feature' into 'main'",
      'Update',
      'Push…',
      'Rename…',
      'Delete',
    ]);
    await userEvent.keyboard('{Escape}');
    // The current branch: none of what it can't be to itself.
    expect(await branchMenu('main')).toEqual([
      "New Branch from 'main'…",
      'Show Diff with Working Tree',
      'Update',
      'Push…',
      'Rename…',
    ]);
    await userEvent.keyboard('{Escape}');
    // Checked out in another worktree: that worktree opened instead.
    expect(await branchMenu('side')).toEqual([
      'Open Worktree',
      "New Branch from 'side'…",
      "Compare with 'main'",
      'Show Diff with Working Tree',
      "Rebase 'main' onto 'side'",
      "Merge 'side' into 'main'",
      'Update',
      'Push…',
      'Rename…',
      'Delete',
    ]);
    await userEvent.keyboard('{Escape}');
    // A remote branch: not renamed.
    expect(await branchMenu('origin/side')).toEqual([
      'Checkout',
      "New Branch from 'origin/side'…",
      "Checkout and Rebase onto 'main'",
      "Compare with 'main'",
      'Show Diff with Working Tree',
      "Rebase 'main' onto 'origin/side'",
      "Merge 'origin/side' into 'main'",
      'Delete',
    ]);
    // Compare with Current opens its tab.
    await userEvent.click(menuItem("Compare with 'main'"));
    expect(compared).toEqual([compareTab('main', 'origin/side')]);
  });

  it('stays open when a branch’s menu is closed; closes with it when an action is chosen', async () => {
    await popup();
    await branchMenu('feature');
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    expect(document.querySelector('.cerebro-popup')).not.toBeNull();
    // Left goes back too.
    await branchMenu('feature');
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    expect(document.querySelector('.cerebro-popup')).not.toBeNull();
    await branchMenu('feature');
    await userEvent.click(menuItem('Checkout'));
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
  });

  it('keeps a branch’s menu open on Right, there being nothing to its right', async () => {
    await popup();
    await branchMenu('feature');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.querySelector('.cerebro-menu')).not.toBeNull();
  });

  it('logs a failure to read the branches, or to read again after an action', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const branches = host.answers['git.branches'];
    host.answers['git.branches'] = () => {
      throw new Error('gone');
    };
    pick(button);
    await expect
      .poll(() => error.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the branches failed');
    await commands.get('git.branch.checkout')?.run({ name: 'feature', remote: false });
    expect(error.mock.calls[1]?.[0]).toBe('Reading again after "Could not checkout feature"');
    host.answers['git.branches'] = branches as never;
  });

  it('rebases only with a branch checked out, as IntelliJ', async () => {
    git.current = undefined;
    await popup();
    await branchMenu('feature');
    expect(menuItem("Rebase 'HEAD' onto 'feature'").getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Checkout', () => {
  it('checks out the branch and says so; reads the branches and worktrees again', async () => {
    await choose('feature', 'Checkout');
    await expect.poll(() => last()?.content).toBe('Checked out feature');
    expect(host.params('git.checkout')).toEqual([{ path: '/r', branch: 'feature', remote: false }]);
    await expect.poll(() => readWorktrees.mock.calls).toEqual([['/r']]);
  });

  it('saves the documents first, a branch or a revision, as IntelliJ’s `GitCheckoutOperation`', async () => {
    await unsavedEdit(host, '/r/a.ts');
    await choose('feature', 'Checkout');
    await expect.poll(() => host.params('git.checkout')).toHaveLength(1);
    expect(savedBefore(host, '/r/a.ts', 'git.checkout')).toBe(true);
    await unsavedEdit(host, '/r/a.ts');
    await checkoutReference('v2');
    await press('OK');
    await expect.poll(() => host.params('git.checkoutRevision')).toHaveLength(1);
    expect(savedBefore(host, '/r/a.ts', 'git.checkoutRevision')).toBe(true);
  });

  it('checks out a remote branch as a local one tracking it', async () => {
    await choose('origin/side', 'Checkout');
    await expect.poll(() => last()?.content).toBe('Checked out side');
    expect(host.params('git.checkout')).toEqual([
      { path: '/r', branch: 'origin/side', remote: true },
    ]);
  });

  it('says why it couldn’t, in git’s words', async () => {
    git.result = new Error('Your local changes would be overwritten');
    await choose('feature', 'Checkout');
    await expect.poll(() => last()?.title).toBe('Could not checkout feature');
    expect(last()).toMatchObject({
      content: 'Your local changes would be overwritten',
      type: 'error',
    });
  });

  const suggestions = () =>
    [...document.querySelectorAll('.playground-git-branch__suggestion')].map((s) => s.textContent);
  /** Chooses Checkout Tag or Revision… from the popup, and types a reference in its dialog. */
  const checkoutReference = async (text: string) => {
    await popup();
    await userEvent.click(row('Checkout Tag or Revision…'));
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe('Checkout');
    await answer(text);
    return shown;
  };

  it('checks out a tag or revision typed, the branches and tags suggested, HEAD detached', async () => {
    const shown = await checkoutReference('');
    expect(shown.querySelector('.cerebro-dialog-field__label')?.textContent.trim()).toBe(
      'Enter reference (branch, tag) name or commit hash:',
    );
    // Nothing typed: nothing to check out.
    const ok = [...shown.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
      (b) => b.textContent === 'OK',
    ) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await answer('sid');
    expect(suggestions()).toEqual(['side', 'origin/side']);
    await answer('v');
    expect(suggestions()).toEqual(['v1', 'v2']);
    await answer(' v2 ');
    await press('OK');
    await expect.poll(() => last()?.content).toBe('Checked out v2');
    expect(host.params('git.checkoutRevision')).toEqual([{ path: '/r', reference: 'v2' }]);
    await expect.poll(() => readWorktrees.mock.calls).toEqual([['/r']]);
  });

  it('checks out none when cancelled; says why git wouldn’t; does without the tags if unread', async () => {
    await checkoutReference('v1');
    await press('Cancel');
    expect(host.params('git.checkoutRevision')).toEqual([]);
    git.result = new Error('fatal: invalid reference: nope');
    await checkoutReference('nope');
    await press('OK');
    await expect.poll(() => last()?.title).toBe('Could not checkout nope');
    expect(last()).toMatchObject({ content: 'fatal: invalid reference: nope', type: 'error' });
    git.result = 'done';
    git.tags = new Error('no tags');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await checkoutReference('v');
    expect(suggestions()).toEqual([]);
    expect(logged).toHaveBeenCalledWith('Reading the tags failed', git.tags);
    await press('Cancel');
  });

  it('opens the worktree a branch is checked out in, instead', async () => {
    await choose('side', 'Open Worktree');
    expect(open).toHaveBeenCalledWith('/r-side');
  });
});

describe('New Branch', () => {
  it('makes a branch from HEAD, checked out, as IntelliJ’s dialog', async () => {
    await popup();
    await userEvent.click(row('New Branch…'));
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Create New Branch');
    await answer('fresh');
    await press('Create');
    await expect
      .poll(() => host.params('git.createBranch'))
      .toEqual([{ path: '/r', name: 'fresh', checkout: true, overwrite: false }]);
  });

  it('saves no document for a branch at HEAD, as IntelliJ’s `GitCheckoutNewBranchOperation`', async () => {
    const doc = await unsavedEdit(host, '/r/head.ts');
    await popup();
    await userEvent.click(row('New Branch…'));
    await dialog();
    await answer('fresh');
    await press('Create');
    await expect.poll(() => host.params('git.createBranch')).toHaveLength(1);
    expect(host.params('fs.write')).toEqual([]);
    expect(doc.modified.peek()).toBe(true);
  });

  it('refuses a name git won’t take or one taken, unless overwriting', async () => {
    await choose('side', "New Branch from 'side'…");
    const box = await dialog();
    const error = () => box.querySelector('.cerebro-dialog-field__error')?.textContent;
    const create = () =>
      [...box.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
        (b) => b.textContent === 'Create',
      ) as HTMLButtonElement;
    const [checkout, overwrite] = box.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(overwrite?.disabled).toBe(true);
    await answer('HEAD');
    expect(error()).toBe('HEAD is a reserved keyword');
    await answer('a..b');
    expect(error()).toBe('Branch name a..b is not valid');
    await answer('bell\u0007');
    expect(error()).toBe('Branch name bell\u0007 is not valid');
    await answer('x.lock/y');
    expect(error()).toBe('Branch name x.lock/y is not valid');
    await answer('origin/main');
    expect(error()).toBe('Branch name origin/main conflicts with remote branch with the same name');
    await answer('feature');
    expect(error()).toBe(
      'Branch name feature already exists. Change the name or overwrite existing branch',
    );
    expect(create().disabled).toBe(true);
    expect(overwrite?.disabled).toBe(false);
    await userEvent.click(overwrite as HTMLInputElement);
    expect(error()).toBe('');
    await userEvent.click(checkout as HTMLInputElement);
    await press('Create');
    await expect
      .poll(() => host.params('git.createBranch'))
      .toEqual([{ path: '/r', name: 'feature', from: 'side', checkout: false, overwrite: true }]);
  });

  it('makes nothing when cancelled; says why git wouldn’t', async () => {
    await choose('side', "New Branch from 'side'…");
    await press('Cancel');
    expect(host.params('git.createBranch')).toEqual([]);
    git.result = new Error('fatal: cannot lock ref');
    await choose('side', "New Branch from 'side'…");
    await answer('fresh');
    await press('Create');
    await expect.poll(() => last()?.title).toBe('Could not create new branch');
  });

  describe('from a commit, in the Log’s menu', () => {
    const refresh = vi.fn(() => Promise.resolve());
    const at = (refs: string[]) => ({
      commit: {
        hash: 'abc1234567890def',
        parents: [],
        author: 't',
        email: 't@t',
        time: 0,
        subject: 's',
        body: '',
        refs,
      },
      worktree: '/r',
      host,
      refresh,
    });
    const run = (refs: string[]) => Promise.resolve(commands.get('log.newBranch')?.run(at(refs)));

    it('makes a branch from the commit, as IntelliJ’s, and reads the Log again', async () => {
      expect(menus.entries('log/commit')).toEqual([{ command: 'log.newBranch' }]);
      expect(commands.get('log.newBranch')).toMatchObject({ label: 'New Branch', dialog: true });
      const done = run(['tag: refs/tags/v1']);
      const box = await dialog();
      expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe(
        'Create Branch from abc12345',
      );
      expect((box.querySelector('input') as HTMLInputElement).value).toBe('');
      await answer('fix');
      await press('Create');
      await done;
      expect(host.params('git.createBranch')).toEqual([
        { path: '/r', name: 'fix', checkout: true, overwrite: false, from: 'abc1234567890def' },
      ]);
      expect(refresh).toHaveBeenCalled();
    });

    it('saves the documents first when it checks the branch out, else not', async () => {
      await unsavedEdit(host, '/r/a.ts');
      const done = run([]);
      await dialog();
      await answer('fix');
      await press('Create');
      await done;
      expect(savedBefore(host, '/r/a.ts', 'git.createBranch')).toBe(true);
      host.asked.length = 0;
      await unsavedEdit(host, '/r/a.ts');
      const unchecked = run([]);
      const box = await dialog();
      await answer('fix2');
      await userEvent.click(box.querySelector('input[type="checkbox"]') as HTMLInputElement);
      await press('Create');
      await unchecked;
      expect(host.params('git.createBranch')).toMatchObject([{ name: 'fix2', checkout: false }]);
      expect(host.params('fs.write')).toEqual([]);
    });

    it('suggests the one branch at the commit, a remote one without its remote', async () => {
      const suggested = async (refs: string[]) => {
        const done = run(refs);
        const value = ((await dialog()).querySelector('input') as HTMLInputElement).value;
        await press('Cancel');
        await done;
        return value;
      };
      expect(await suggested(['HEAD -> refs/heads/main', 'refs/remotes/origin/main'])).toBe('main');
      expect(await suggested(['refs/remotes/origin/side'])).toBe('side');
      expect(await suggested(['HEAD', 'refs/heads/a', 'refs/heads/b'])).toBe('');
      expect(host.params('git.createBranch')).toEqual([]);
    });

    it('checks the name against the branches as they are now, read as the dialog shows', async () => {
      git.local = [...git.local, 'later'];
      let release: () => void = () => undefined;
      git.branchesHeld = new Promise<void>((resolve) => {
        release = resolve;
      });
      const done = run([]);
      // Shown at once, as IntelliJ's: what's typed before they're read isn't lost.
      const box = await dialog();
      await answer('later');
      expect(box.querySelector('.cerebro-dialog-field__error')?.textContent).toBe('');
      release();
      git.branchesHeld = undefined;
      await expect
        .poll(() => box.querySelector('.cerebro-dialog-field__error')?.textContent)
        .toBe('Branch name later already exists. Change the name or overwrite existing branch');
      await press('Cancel');
      await done;
      git.local = git.local.filter((b) => b !== 'later');
      // Unread, it's logged, and checked against those read before.
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      git.branchesHeld = Promise.reject(new Error('gone'));
      const failing = run([]);
      await dialog();
      await expect
        .poll(() => logged.mock.calls[0])
        .toEqual(['Reading the branches failed', new Error('gone')]);
      git.branchesHeld = undefined;
      await press('Cancel');
      await failing;
    });
  });
});

describe('Rename', () => {
  it('renames a branch, as IntelliJ’s dialog, refusing a name taken', async () => {
    await choose('feature', 'Rename…');
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Rename Branch feature');
    expect(box.querySelector('input[type="checkbox"]')).toBeNull();
    // Its own name too, as taken.
    expect(box.querySelector('.cerebro-dialog-field__error')?.textContent).toBe(
      'Branch name feature already exists',
    );
    await answer('side');
    expect(box.querySelector('.cerebro-dialog-field__error')?.textContent).toBe(
      'Branch name side already exists',
    );
    await answer('renamed');
    await press('Rename');
    await expect
      .poll(() => host.params('git.renameBranch'))
      .toEqual([{ path: '/r', from: 'feature', to: 'renamed' }]);
  });

  it('renames nothing when cancelled', async () => {
    await choose('feature', 'Rename…');
    await press('Cancel');
    expect(host.params('git.renameBranch')).toEqual([]);
  });
});

describe('Delete', () => {
  it('deletes the branch, saying if unmerged commits went with it, and restores it', async () => {
    git.result = 'unmerged';
    await choose('feature', 'Delete');
    await expect.poll(() => last()?.title).toBe('Deleted Branch: feature');
    expect(last()?.content).toBe('Unmerged commits were discarded');
    last()?.actions[0]?.run();
    await expect
      .poll(() => host.params('git.restoreBranch'))
      .toEqual([{ path: '/r', name: 'feature', hash: 'abc' }]);
    git.result = 'done';
    await choose('feature', 'Delete');
    await expect.poll(() => host.params('git.deleteBranch').length).toBe(2);
    expect(last()?.content).toBe('');
  });

  it('says why it wasn’t deleted', async () => {
    git.result = new Error('error: cannot delete branch');
    await choose('feature', 'Delete');
    await expect.poll(() => last()?.title).toBe("Branch feature wasn't deleted");
  });

  /** The checkbox of the Delete Remote Branch dialog, if it has one. */
  const tracking = async () => (await dialog()).querySelector<HTMLInputElement>('input');

  it('deletes a remote branch once asked, as IntelliJ, and the local one tracking it if chosen', async () => {
    // The current branch tracks it too: not proposed, as IntelliJ's.
    git.upstreams = { feature: 'origin/side', main: 'origin/side' };
    await choose('origin/side', 'Delete');
    expect((await dialog()).querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Delete Remote Branch',
    );
    expect(await dialogText()).toBe(
      'Delete remote branch origin/side?Delete tracking local branch feature as well',
    );
    expect((await tracking())?.checked).toBe(false);
    await press('Cancel');
    expect(host.params('git.deleteRemoteBranch')).toEqual([]);
    await choose('origin/side', 'Delete');
    await userEvent.click((await tracking()) as HTMLInputElement);
    await press('Delete');
    await expect.poll(() => last()?.title).toBe('Deleted remote branch origin/side');
    expect(last()?.content).toBe('Also deleted local branch: feature');
    expect(host.params('git.deleteRemoteBranch')).toEqual([{ path: '/r', name: 'origin/side' }]);
    expect(host.params('git.deleteBranch')).toEqual([{ path: '/r', name: 'feature' }]);
    expect(readWorktrees).toHaveBeenCalled();
  });

  it('lists the local branches tracking it, deleting none unless chosen; with none, asks the rest', async () => {
    git.upstreams = { feature: 'origin/main', side: 'origin/main' };
    await choose('origin/main', 'Delete');
    expect(await dialogText()).toBe(
      'Delete remote branch origin/main?Delete tracking local branches: feature, side',
    );
    await press('Delete');
    await expect.poll(() => last()?.title).toBe('Deleted remote branch origin/main');
    expect(last()?.content).toBe('');
    expect(host.params('git.deleteBranch')).toEqual([]);
    // Several deleted, one failing: said, the rest listed.
    await choose('origin/main', 'Delete');
    await userEvent.click((await tracking()) as HTMLInputElement);
    const deleting = host.answers['git.deleteBranch'];
    host.answers['git.deleteBranch'] = ({ name }: { name: string }) => {
      if (name === 'side') throw new Error('error: side is in use');
      return { hash: 'abc', unmerged: false };
    };
    await press('Delete');
    await expect.poll(() => last()?.title).toBe('Deleted remote branch origin/main');
    expect(last()?.content).toBe('Also deleted local branch: feature');
    expect(notifications.all.get(1)).toMatchObject({
      title: "Branch side wasn't deleted",
      content: 'error: side is in use',
      type: 'error',
    });
    git.upstreams = { feature: 'origin/main', side: 'origin/main' };
    host.answers['git.deleteBranch'] = deleting as never;
    await choose('origin/main', 'Delete');
    await userEvent.click((await tracking()) as HTMLInputElement);
    await press('Delete');
    await expect.poll(() => last()?.content).toBe('Also deleted local branches: feature, side');
    // None tracking it: the question alone.
    git.upstreams = {};
    await choose('origin/side', 'Delete');
    expect(await dialogText()).toBe('Delete remote branch origin/side?');
    expect(await tracking()).toBeNull();
    await press('Cancel');
  });

  it('says why a remote branch wasn’t deleted, in git’s words', async () => {
    git.remoteFailing = new Error('error: unable to delete');
    await choose('origin/side', 'Delete');
    await press('Delete');
    await expect.poll(() => last()?.title).toBe('Failed to delete remote branch origin/side');
    expect(last()).toMatchObject({ content: 'error: unable to delete', type: 'error' });
  });

  it('offers to delete the remote branch a branch deleted alone tracked, unless it’s protected', async () => {
    git.tracked = 'origin/feature';
    await choose('feature', 'Delete');
    await expect.poll(() => last()?.title).toBe('Deleted Branch: feature');
    const actions = last()?.actions ?? [];
    expect(actions.map((a) => a.label)).toEqual(['Restore', 'Delete Tracked Branch']);
    actions[1]?.run();
    expect(await dialogText()).toBe('Delete remote branch origin/feature?');
    await press('Delete');
    await expect
      .poll(() => host.params('git.deleteRemoteBranch'))
      .toEqual([{ path: '/r', name: 'origin/feature' }]);
    // IntelliJ's protected branches, by default.
    for (const tracked of ['origin/main', 'up/master']) {
      git.tracked = tracked;
      host.asked.length = 0;
      await choose('feature', 'Delete');
      await expect.poll(() => host.params('git.deleteBranch').length).toBe(1);
      await expect.poll(() => last()?.actions.map((a) => a.label)).toEqual(['Restore']);
    }
  });
});

describe('the Log’s branches pane', () => {
  const refresh = vi.fn(() => Promise.resolve());
  const at = (selection: BranchesSelection) => ({ source: 'log' as const, selection, refresh });
  const head = (branch?: string) => at({ kind: 'head', branch });
  const ref = (name: string, current = false) => at({ kind: 'branch', ref: name, current });
  const run = (id: string, context: unknown) => Promise.resolve(commands.get(id)?.run(context));
  afterEach(() => {
    refresh.mockClear();
  });

  it('New Branch: from HEAD, its branch suggested; or from a branch’s commit, as IntelliJ’s', async () => {
    expect(commands.get('log.branches.newBranch')).toMatchObject({
      label: 'New Branch',
      icon: 'add',
      dialog: true,
    });
    // Off for a directory, or nothing selected.
    expect(commands.isEnabled('log.branches.newBranch', at(undefined))).toBe(false);
    expect(commands.isEnabled('log.branches.newBranch', undefined)).toBe(false);
    expect(commands.isEnabled('log.branches.newBranch', head('main'))).toBe(true);
    const shown = async (context: unknown) => {
      const done = run('log.branches.newBranch', context);
      const box = await dialog();
      const title = box.querySelector('.cerebro-dialog__title')?.textContent;
      const value = (box.querySelector('input') as HTMLInputElement).value;
      return { done, title, value };
    };
    const fromHead = await shown(head('main'));
    expect([fromHead.title, fromHead.value]).toEqual(['Create New Branch', 'main']);
    await answer('fix');
    await press('Create');
    await fromHead.done;
    expect(host.params('git.createBranch')).toEqual([
      { path: '/r', name: 'fix', checkout: true, overwrite: false },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // HEAD detached: nothing suggested.
    const detached = await shown(head());
    expect(detached.value).toBe('');
    await press('Cancel');
    await detached.done;
    const local = await shown(ref('refs/heads/side'));
    expect([local.title, local.value]).toEqual(['Create Branch from side', 'side']);
    await answer('side2');
    await press('Create');
    await local.done;
    expect(host.params('git.createBranch').at(-1)).toMatchObject({ name: 'side2', from: 'side^0' });
    // A remote one's name without its remote.
    const remote = await shown(ref('refs/remotes/origin/fix/x'));
    expect([remote.title, remote.value]).toEqual(['Create Branch from origin/fix/x', 'fix/x']);
    await press('Cancel');
    await remote.done;
  });

  it('Update Selected: the branch checked out by Update Project; another from what it tracks, as IntelliJ’s', async () => {
    expect(commands.get('log.branches.update')).toMatchObject({
      label: 'Update Selected',
      icon: 'update',
    });
    const tracking = (name: string, current = false) =>
      at({
        kind: 'branch',
        ref: `refs/heads/${name}`,
        current,
        upstream: 'refs/remotes/origin/main',
      });
    const on = (context: unknown) => commands.isEnabled('log.branches.update', context);
    // Off for a branch that tracks none, a directory, or nothing selected.
    expect(on(ref('refs/heads/side'))).toBe(false);
    expect(on(at(undefined))).toBe(false);
    expect(on(tracking('side'))).toBe(true);
    expect(on(at({ kind: 'head', branch: 'main', upstream: 'refs/remotes/origin/main' }))).toBe(
      true,
    );
    // The branch checked out: Update Project.
    const update = vi.fn();
    commands.register({ id: 'vcs.update', label: 'Update Project', run: update });
    await run('log.branches.update', tracking('main', true));
    await run('log.branches.update', at({ kind: 'head', branch: 'main', upstream: 'x' }));
    expect(update).toHaveBeenCalledTimes(2);
    expect(host.params('git.updateBranch')).toEqual([]);
    // Another: fetched into, the Log read again.
    const notify = vi.spyOn(notifications, 'notify');
    await run('log.branches.update', tracking('side'));
    expect(host.params('git.updateBranch')).toEqual([{ path: '/r', branch: 'side' }]);
    expect(notify).toHaveBeenLastCalledWith({ title: 'Fetched 1 target' });
    expect(refresh).toHaveBeenCalledTimes(1);
    git.updated = { worktree: '/r-side' };
    await run('log.branches.update', tracking('side'));
    expect(notify).toHaveBeenLastCalledWith({
      title: 'Updated 1 branch checked out in other worktrees',
    });
    git.updated = new Error('not a fast-forward');
    await run('log.branches.update', tracking('side'));
    expect(notify).toHaveBeenLastCalledWith({
      title: 'Update failed',
      content: 'not a fast-forward',
      type: 'error',
      display: 'sticky',
    });
    // Off while it runs, as a fetch.
    git.updated = {};
    const running = run('log.branches.update', tracking('side'));
    expect(on(tracking('side'))).toBe(false);
    await running;
    expect(on(tracking('side'))).toBe(true);
    // Off without a remote.
    git.remotes = false;
    await readState('/r');
    expect(on(tracking('side'))).toBe(false);
    git.remotes = true;
    await readState('/r');
    // Without a host, nowhere to update.
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(on(tracking('side'))).toBe(false);
  });

  it('Delete Branch: SafeDelete’s keys, as IntelliJ’s', () => {
    expect(services.keymap?.shortcutsFor('log.branches.delete')).toEqual(['Alt+Delete']);
    const keymap = new Keymap('mac');
    setupBranches(
      { commands: new CommandRegistry(), menus: new MenuRegistry(), keymap },
      { readWorktrees, open },
    );
    expect(keymap.shortcutsFor('log.branches.delete')).toEqual(['Meta+Delete']);
  });

  it('Delete Branch: not the current one or a protected remote one; the Log read again', async () => {
    expect(commands.get('log.branches.delete')).toMatchObject({
      label: 'Delete Branch',
      icon: 'delete',
    });
    const on = (context: unknown) => commands.isEnabled('log.branches.delete', context);
    expect([on(undefined), on(at(undefined)), on(head('main'))]).toEqual([false, false, false]);
    expect(on(ref('refs/heads/main', true))).toBe(false);
    expect(on(ref('refs/remotes/origin/main'))).toBe(false);
    expect(on(ref('refs/remotes/origin/side'))).toBe(true);
    expect(on(ref('refs/heads/feature'))).toBe(true);
    await run('log.branches.delete', ref('refs/heads/feature'));
    expect(last()?.title).toBe('Deleted Branch: feature');
    expect(host.params('git.deleteBranch')).toEqual([{ path: '/r', name: 'feature' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    const remote = run('log.branches.delete', ref('refs/remotes/origin/side'));
    expect(await dialogText()).toBe('Delete remote branch origin/side?');
    await press('Delete');
    await remote;
    expect(host.params('git.deleteRemoteBranch')).toEqual([{ path: '/r', name: 'origin/side' }]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('Delete Branch on a tag: deleted unasked, and restored, as IntelliJ’s', async () => {
    expect(commands.isEnabled('log.branches.delete', ref('refs/tags/v1'))).toBe(true);
    await run('log.branches.delete', ref('refs/tags/release/v1'));
    expect(host.params('git.deleteTag')).toEqual([{ path: '/r', name: 'release/v1' }]);
    expect(last()?.title).toBe('Deleted Tag: release/v1');
    expect(refresh).toHaveBeenCalledTimes(1);
    const deleted = last();
    deleted?.actions[0]?.run();
    await expect.poll(() => last()?.title).toBe('Rollback Successful');
    expect(last()?.content).toBe('Restored tag release/v1');
    expect(host.params('git.restoreTag')).toEqual([
      { path: '/r', name: 'release/v1', hash: 'def' },
    ]);
    // Why it wasn't, in git's words; a restore that fails too.
    git.result = new Error('fatal: tag not found');
    await run('log.branches.delete', ref('refs/tags/v1'));
    expect(last()).toMatchObject({
      title: "Tag v1 wasn't deleted",
      content: 'fatal: tag not found',
    });
    deleted?.actions[0]?.run();
    await expect.poll(() => last()?.title).toBe('Could not Restore release/v1');
  });

  it('offers Delete on Remote when there are remotes, as IntelliJ’s', async () => {
    await run('log.branches.delete', ref('refs/tags/v1'));
    expect(last()?.actions.map((a) => a.label)).toEqual(['Restore']);
    git.tagRemotes = 1;
    git.remoteTag = { deleted: ['origin'], failed: [] };
    await run('log.branches.delete', ref('refs/tags/v1'));
    const one = last();
    expect(one?.actions.map((a) => a.label)).toEqual(['Restore', 'Delete on Remote']);
    one?.actions[1]?.run();
    await expect.poll(() => last()?.title).toBe('Deleted Tag on Remote: v1');
    expect(host.params('git.deleteRemoteTag')).toEqual([{ path: '/r', name: 'v1', hash: 'def' }]);
    git.tagRemotes = 2;
    git.remoteTag = { deleted: [], failed: [] };
    await run('log.branches.delete', ref('refs/tags/v2'));
    const two = last();
    expect(two?.actions[1]?.label).toBe('Delete on Remotes');
    two?.actions[1]?.run();
    await expect.poll(() => last()?.title).toBe("Tag Doesn't Exist on Remotes: v2");
    // Where it failed, in git's words, remote by remote; and a failure to ask at all.
    git.remoteTag = {
      deleted: ['origin'],
      failed: [{ remote: 'moved', error: 'rejected (stale info)' }],
    };
    two?.actions[1]?.run();
    await expect.poll(() => last()?.title).toBe('Failed to delete tag v2 on Remotes');
    expect(last()).toMatchObject({ content: 'moved: rejected (stale info)', type: 'error' });
    expect(notifications.all.get(1)?.title).toBe('Deleted Tag on Remotes: v2');
    // Failed on every remote that has it: the failure alone.
    git.remoteTag = { deleted: [], failed: [{ remote: 'moved', error: 'rejected' }] };
    const before = notifications.all.length;
    two?.actions[1]?.run();
    await expect.poll(() => notifications.all.length).toBe(before + 1);
    expect(last()).toMatchObject({ title: 'Failed to delete tag v2 on Remotes', type: 'error' });
    git.remoteTag = new Error('fatal: no such remote');
    one?.actions[1]?.run();
    await expect.poll(() => last()?.content).toBe('fatal: no such remote');
    expect(last()?.title).toBe('Failed to delete tag v1 on Remote');
  });
});

describe('Merge into Current', () => {
  it('merges and says so, proposing to delete a local branch merged', async () => {
    await choose('feature', "Merge 'feature' into 'main'");
    await expect.poll(() => last()?.content).toBe('Merged feature to main');
    expect(host.params('git.mergeBranch')).toEqual([{ path: '/r', branch: 'feature' }]);
    expect(last()?.actions.map((a) => a.label)).toEqual(['Delete feature']);
    last()?.actions[0]?.run();
    await expect
      .poll(() => host.params('git.deleteBranch'))
      .toEqual([{ path: '/r', name: 'feature' }]);
  });

  it('saves the documents first, as IntelliJ’s `GitMergeOperation`', async () => {
    await unsavedEdit(host, '/r/a.ts');
    await choose('feature', "Merge 'feature' into 'main'");
    await expect.poll(() => host.params('git.mergeBranch')).toHaveLength(1);
    expect(savedBefore(host, '/r/a.ts', 'git.mergeBranch')).toBe(true);
  });

  it('proposes nothing for a remote branch, or one already merged', async () => {
    await choose('origin/side', "Merge 'origin/side' into 'main'");
    await expect.poll(() => last()?.content).toBe('Merged origin/side to main');
    expect(last()?.actions).toEqual([]);
    git.result = 'upToDate';
    await choose('feature', "Merge 'feature' into 'main'");
    await expect.poll(() => last()?.content).toBe('Already up to date');
    expect(last()?.actions).toEqual([]);
  });

  it('stopped at conflicts, commits the merge once they’re resolved', async () => {
    git.result = 'conflicts';
    git.conflicted = ['a.ts'];
    await choose('feature', "Merge 'feature' into 'main'");
    await dialog();
    await press('Accept Yours');
    await expect.poll(() => last()?.content).toBe('Merged feature to main');
    expect(host.params('git.continue')).toEqual([{ path: '/r' }]);
  });

  it('warns of the conflicts left when the dialog is closed with some', async () => {
    git.result = 'conflicts';
    git.conflicted = ['a.ts'];
    await choose('feature', "Merge 'feature' into 'main'");
    await dialog();
    await press('Close');
    await expect.poll(() => last()?.title).toBe('feature Merged with Conflicts');
    expect(last()?.type).toBe('warning');
    expect(host.params('git.continue')).toEqual([]);
  });

  it('says why it couldn’t', async () => {
    git.result = new Error('not something we can merge');
    await choose('feature', "Merge 'feature' into 'main'");
    await expect.poll(() => last()?.title).toBe('Could not merge feature');
  });
});

describe('Rebase Current onto Selected', () => {
  it('rebases and says so', async () => {
    await choose('feature', "Rebase 'main' onto 'feature'");
    await expect.poll(() => last()?.title).toBe('Rebase successful');
    expect(last()?.content).toBe('Rebased main on feature');
    expect(host.params('git.rebaseOnto')).toEqual([{ path: '/r', onto: 'feature' }]);
  });

  it('stopped at conflicts, goes on as Continue Rebase does', async () => {
    git.result = 'conflicts';
    git.conflicted = ['a.ts'];
    await choose('feature', "Rebase 'main' onto 'feature'");
    await dialog();
  });

  it('says why it couldn’t', async () => {
    git.result = new Error('invalid upstream');
    await choose('feature', "Rebase 'main' onto 'feature'");
    await expect.poll(() => last()?.title).toBe('Rebase failed');
  });
});

describe('Update', () => {
  it('updates a local branch as the Log’s Update Selected does: off where it tracks none', async () => {
    git.upstreams = { main: 'origin/main', feature: 'origin/feature' };
    await popup();
    const on = (name: string) => commands.isEnabled('git.branch.update', { name, remote: false });
    const update = commands.get('git.branch.update') as CommandSpec<BranchRef>;
    const shown = (b: BranchRef) => update.visible?.(b);
    expect(on('feature')).toBe(true);
    expect(on('side')).toBe(false);
    // Without a branch, as Find Action asks: off.
    expect(commands.isEnabled('git.branch.update')).toBe(false);
    expect(shown({ name: 'origin/side', remote: true })).toBe(false);
    expect(shown({ name: 'v1', remote: false, tag: true })).toBe(false);
    // Another: fetched into, and the branches read again.
    await userEvent.click(row('feature'));
    await userEvent.click(menuItem('Update'));
    await expect.poll(() => last()?.title).toBe('Fetched 1 target');
    expect(host.params('git.updateBranch')).toEqual([{ path: '/r', branch: 'feature' }]);
    await expect.poll(() => readWorktrees.mock.calls).toEqual([['/r']]);
    // The one checked out: Update Project.
    const execute = vi.spyOn(commands, 'execute').mockReturnValue(true);
    await update.run({ name: 'main', remote: false });
    expect(execute).toHaveBeenCalledWith('vcs.update');
    execute.mockRestore();
    // Not without remotes.
    git.remotes = false;
    await readState('/r');
    expect(shown({ name: 'feature', remote: false })).toBe(false);
    git.remotes = true;
    await readState('/r');
  });
});

describe('Push', () => {
  it('opens the Push dialog for the branch, checked out or not, as IntelliJ’s', async () => {
    // What it would push isn't answered here: the dialog doesn't open, and that's logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await choose('feature', 'Push…');
    await expect
      .poll(() => host.params('git.outgoing'))
      .toEqual([{ path: '/r', source: 'feature' }]);
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading what to push failed');
    await choose('main', 'Push…');
    expect(commands.isEnabled('git.branch.push')).toBe(false);
    await expect.poll(() => host.params('git.outgoing').at(-1)).toEqual({ path: '/r' });
  });
});

describe('Show Diff with Working Tree', () => {
  it('shows the files that differ from the branch’s or tag’s, the documents saved first, as IntelliJ’s', async () => {
    const box = document.createElement('div');
    document.body.append(box);
    const view = render(() => <DiffWithWorkingTree open={open} />, box);
    const before = revealed;
    await unsavedEdit(host, '/r/a.ts');
    await choose('v1', 'Show Diff with Working Tree');
    await expect.poll(() => revealed).toBe(before + 1);
    expect(box.querySelector('.playground-compare__explanation')?.textContent).toBe(
      'Difference between current working tree on main and files in v1:',
    );
    expect(host.params('git.changes')).toContainEqual({ path: '/r', from: 'v1' });
    expect(savedBefore(host, '/r/a.ts', 'git.changes')).toBe(true);
    view.dispose();
    box.remove();
  });
});

describe('Checkout and Rebase onto Current', () => {
  it('checks out the branch and rebases it onto the current one in one step, as IntelliJ’s', async () => {
    await choose('feature', "Checkout and Rebase onto 'main'");
    await expect.poll(() => last()?.title).toBe('Rebase successful');
    expect(last()?.content).toBe('Checked out feature and rebased it on main');
    expect(host.params('git.rebase')).toEqual([
      { path: '/r', upstream: 'HEAD', branch: 'feature' },
    ]);
    expect(host.params('git.createBranch')).toEqual([]);
  });

  it('makes a remote branch’s local branch first, tracking it', async () => {
    await choose('origin/side', "Checkout and Rebase onto 'main'");
    await expect.poll(() => last()?.content).toBe('Checked out side and rebased it on main');
    expect(host.params('git.createBranch')).toEqual([
      { path: '/r', name: 'side', from: 'origin/side', checkout: false, overwrite: false },
    ]);
    expect(host.params('git.rebase')).toEqual([{ path: '/r', upstream: 'HEAD', branch: 'side' }]);
  });

  it('stopped at conflicts, goes on as Continue Rebase does', async () => {
    git.result = 'conflicts';
    git.conflicted = ['a.ts'];
    await choose('feature', "Checkout and Rebase onto 'main'");
    await dialog();
  });

  it('says why it couldn’t, in git’s words', async () => {
    git.result = new Error('a branch named side already exists');
    await choose('origin/side', "Checkout and Rebase onto 'main'");
    await expect.poll(() => last()?.title).toBe('Checkout and Rebase failed');
    expect(last()?.content).toBe('a branch named side already exists');
    expect(host.params('git.rebase')).toEqual([]);
  });
});

describe('without a host', () => {
  it('does nothing, and New Branch isn’t there to run', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('git.newBranch')).toBe(false);
    await commands.get('git.branch.checkout')?.run({ name: 'feature', remote: false });
    // The popup lists what it last read.
    pick(button);
    expect(await popupItems()).toContain('New Branch…');
    expect(host.asked).toEqual([]);
  });
});
