import { CommandRegistry, displayText, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupCherryPick } from '../src/cherry-pick.js';
import { describe as describeConflicts, paneTitles, setupConflicts } from '../src/conflicts.js';
import { useProjects, workspace } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import { notifications } from '../src/notifications.js';
import { readState } from '../src/repository-state.js';
import { closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

/** The repository as the host sees it, and how each pick or continue goes, in turn. */
const git = {
  state: { conflicts: false } as Record<string, unknown>,
  picks: [] as ('picked' | 'empty' | 'conflicts' | Error)[],
  conflicted: [] as string[],
  held: undefined as Promise<void> | undefined,
};
const next = async () => {
  await git.held;
  const pick = git.picks.shift() ?? 'picked';
  if (pick instanceof Error) throw pick;
  if (pick === 'conflicts') git.conflicted = ['a.ts'];
  return pick;
};
const host = new FakeHost({
  'git.state': () => git.state,
  'git.cherryPick': () => next(),
  'git.continueCherryPick': () => next(),
  'git.abort': () => null,
  'git.conflicts': () => ({
    operation: 'cherry-pick',
    commit: { hash: 'abc1234', author: 'Them', message: 'Fix the thing' },
    files: git.conflicted.map((path) => ({ path, yours: 'modified', theirs: 'modified' })),
  }),
  'git.acceptSide': () => {
    git.conflicted = [];
    return null;
  },
  'git.status': () => ({ files: [] }),
  'git.shelves': () => [],
  'git.stashes': () => [],
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

beforeAll(() => {
  useProjects([project('/r', host)]);
  setupConflicts(services);
  setupCherryPick(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.state = { conflicts: false };
  git.picks = [];
  git.conflicted = [];
  git.held = undefined;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const commit: LogCommit = {
  hash: 'abc1234567890def',
  parents: ['0123456789abcdef'],
  author: 'Them',
  email: 'them@t',
  time: 0,
  subject: 'Fix the thing',
  body: '',
  refs: [],
};
const refresh = vi.fn(() => Promise.resolve());
const context = { commit, worktree: '/r', host, refresh };
const last = () => notifications.all.get(0);
const pick = () => Promise.resolve(commands.get('log.cherryPick')?.run(context));

describe('Cherry-Pick, from the Log', () => {
  it('sits in the commit menu after Copy Revision Number, as IntelliJ’s, and picks the commit', async () => {
    expect(menus.entries('log/commit')).toEqual([{ command: 'log.cherryPick' }]);
    expect(commands.get('log.cherryPick')).toMatchObject({ label: 'Cherry-Pick' });
    // From the toolbar with no Log shown: nothing to pick.
    expect(commands.isEnabled('log.cherryPick', { source: 'log' })).toBe(false);
    expect(commands.isEnabled('log.cherryPick', context)).toBe(true);
    await pick();
    expect(host.params('git.cherryPick')).toEqual([
      { path: '/r', hash: commit.hash, protected: ['main', 'master'] },
    ]);
    expect(last()).toMatchObject({
      title: 'Cherry-pick successful',
      content: 'abc12345 Fix the thing',
    });
    // The Log and the lists read again.
    expect(refresh).toHaveBeenCalled();
    expect(host.params('git.state').length).toBeGreaterThan(0);
  });

  it('is off while it picks, and says when the changes are already there', async () => {
    let release: () => void = () => undefined;
    git.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    git.picks = ['empty'];
    const done = pick();
    expect(commands.isEnabled('log.cherryPick', context)).toBe(false);
    release();
    await done;
    expect(commands.isEnabled('log.cherryPick', context)).toBe(true);
    expect(last()).toMatchObject({
      title: 'Nothing to cherry-pick',
      content: 'All changes from abc12345 have already been applied',
      type: 'warning',
    });
  });

  it('shows the Conflicts dialog at conflicts, and commits the pick once none is left', async () => {
    git.picks = ['conflicts', 'picked'];
    const done = pick();
    expect(await dialogText()).toContain(
      'Conflicts during cherry-picking commit abc1234 made by Them\nFix the thing',
    );
    await press('Accept Yours');
    await done;
    expect(host.params('git.continueCherryPick')).toEqual([{ path: '/r' }]);
    expect(last()?.title).toBe('Cherry-pick successful');
  });

  it('says conflicts are left when the dialog’s closed, with Resolve… and Abort', async () => {
    git.picks = ['conflicts'];
    const done = pick();
    await dialog();
    await press('Close');
    await done;
    const left = last();
    expect(left).toMatchObject({
      title: 'Cherry-pick was performed with conflicts',
      content: 'abc12345 Fix the thing\nThere are unresolved conflicts in the working tree.',
      type: 'warning',
      display: 'sticky',
    });
    expect(left?.actions.map((a) => a.label)).toEqual(['Resolve…', 'Abort Cherry-pick']);
    left?.actions[0]?.run();
    await dialog();
    await press('Accept Yours');
    // Resolved from there, it isn't committed: Continue Cherry-Pick does that.
    await expect.poll(() => host.params('git.acceptSide')).toHaveLength(1);
    expect(host.params('git.continueCherryPick')).toEqual([]);
    left?.actions[1]?.run();
    expect(await dialogText()).toBe('Abort cherry-pick?');
    await press('Abort');
    await expect
      .poll(() => host.params('git.abort'))
      .toEqual([{ path: '/r', operation: 'cherry-pick' }]);
    expect(last()?.content).toBe('Cherry-pick abort succeeded');
  });

  it('says why git wouldn’t, in IntelliJ’s words where it has its own', async () => {
    git.picks = [
      new Error('error: Your local changes to the following files would be overwritten by merge:'),
      new Error('error: The following untracked working tree files would be overwritten by merge:'),
      new Error('fatal: bad revision'),
    ];
    await pick();
    expect(last()).toMatchObject({
      title: 'Cherry-pick failed',
      content:
        'abc12345 Fix the thing\nYour local changes will be overwritten by cherry-pick.\nCommit, stash, or revert them to proceed.',
      type: 'error',
      display: 'sticky',
    });
    await pick();
    expect(last()?.title).toBe('Untracked Files Prevent Cherry-pick');
    await pick();
    expect(last()).toMatchObject({
      title: 'Cherry-pick failed',
      content: 'abc12345 Fix the thing\nfatal: bad revision',
    });
    // Reading again failing is logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refresh.mockRejectedValueOnce(new Error('gone'));
    await pick();
    expect(logged).toHaveBeenCalledWith('Reading again after Cherry-Pick', new Error('gone'));
  });
});

describe('the Git menu, while a cherry-pick is under way', () => {
  const menu = async (state: Record<string, unknown>) => {
    git.state = state;
    await readState('/r');
    return visibleEntries(services, 'main/git').map((e) =>
      'command' in e ? displayText(e.label, e.dialog) : '-',
    );
  };
  const exec = (id: string) => Promise.resolve(commands.get(id)?.run(undefined));

  it('has Continue Cherry-Pick once no file is in conflict, and Abort Cherry-Pick', async () => {
    expect(await menu({ conflicts: false })).toEqual([]);
    expect(await menu({ operation: 'cherry-pick', conflicts: true })).toEqual([
      'Resolve Conflicts…',
      '-',
      'Abort Cherry-Pick',
    ]);
    expect(await menu({ operation: 'cherry-pick', conflicts: false })).toEqual([
      'Continue Cherry-Pick',
      'Abort Cherry-Pick',
    ]);
  });

  it('continues it, saying how that went, or why it couldn’t', async () => {
    await menu({ operation: 'cherry-pick', conflicts: false });
    await exec('vcs.continueCherryPick');
    expect(last()).toMatchObject({ title: 'Cherry-pick successful' });
    expect(last()?.content).toBe('');
    git.picks = ['empty'];
    await exec('vcs.continueCherryPick');
    expect(last()).toMatchObject({
      title: 'Nothing to cherry-pick',
      content: 'Empty commit skipped (git cherry-pick --skip)',
    });
    git.picks = ['conflicts'];
    const done = exec('vcs.continueCherryPick');
    await dialog();
    await press('Close');
    await done;
    expect(last()?.content).toBe('There are unresolved conflicts in the working tree.');
    git.picks = [new Error('error: no cherry-pick or revert in progress')];
    await exec('vcs.continueCherryPick');
    expect(last()).toMatchObject({
      title: 'Continue cherry-pick failed',
      content: 'error: no cherry-pick or revert in progress',
      type: 'error',
    });
  });

  it('aborts it, once asked', async () => {
    await menu({ operation: 'cherry-pick', conflicts: true });
    const done = exec('vcs.abortCherryPick');
    expect((await dialog()).querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Abort Cherry-pick',
    );
    await press('Abort');
    await done;
    expect(host.params('git.abort')).toEqual([{ path: '/r', operation: 'cherry-pick' }]);
  });
});

describe('the Conflicts dialog, for a cherry-pick', () => {
  it('names the commit picked, and its merge window’s sides, as IntelliJ’s', () => {
    const conflicts = {
      operation: 'cherry-pick' as const,
      files: [],
      commit: { hash: 'abc1234', author: 'Them', message: 'Fix the thing' },
    };
    expect(describeConflicts(conflicts)).toBe(
      'Conflicts during cherry-picking commit abc1234 made by Them\nFix the thing',
    );
    expect(paneTitles(conflicts)).toEqual(['Local Changes', 'Changes from cherry-pick abc1234']);
    // No commit read: as for nothing under way.
    expect(describeConflicts({ operation: 'cherry-pick', files: [] })).toBe(
      'The following files have conflicts:',
    );
    expect(paneTitles({ operation: 'cherry-pick', files: [] })).toEqual([
      'Local Changes',
      'Changes from cherry-pick ',
    ]);
  });
});
