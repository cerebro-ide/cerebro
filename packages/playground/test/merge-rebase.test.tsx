import { CommandRegistry, displayText, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupConflicts } from '../src/conflicts.js';
import { useProjects, workspace } from '../src/environments.js';
import { setupMergeRebase } from '../src/merge-rebase.js';
import { notifications } from '../src/notifications.js';
import { readState } from '../src/repository-state.js';
import { closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

/** The repository as the host sees it, and how what's asked of it goes. */
const git = {
  state: { conflicts: false } as Record<string, unknown>,
  /** What each continue or skip gives, in turn: done, conflicts, or an error. */
  stops: [] as ('done' | 'conflicts' | Error)[],
  conflicted: [] as string[],
  fails: undefined as Error | undefined,
  /** The branch rebased: none for a detached HEAD. */
  yours: 'feature' as string | undefined,
};
const host = new FakeHost({
  'git.state': () => git.state,
  'git.continue': () => next(),
  'git.skipCommit': () => next(),
  'git.abort': () => {
    if (git.fails) throw git.fails;
    git.state = { conflicts: false };
    return null;
  },
  'git.conflicts': () => ({
    operation: 'rebase',
    yours: git.yours,
    theirs: 'main',
    files: git.conflicted.map((path) => ({ path, yours: 'modified', theirs: 'modified' })),
  }),
  'git.acceptSide': () => {
    git.conflicted = [];
    return null;
  },
  'git.shelves': () => [],
  'git.stashes': () => [],
});
const next = () => {
  const stop = git.stops.shift() ?? 'done';
  if (stop instanceof Error) throw stop;
  if (stop === 'conflicts') git.conflicted = ['a.ts'];
  return stop;
};

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

beforeAll(() => {
  useProjects([project('/r/feature', host), project('/s', undefined)]);
  setupConflicts(services);
  setupMergeRebase(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r/feature', name: 'feature', branch: 'feature' });
  git.stops = [];
  git.conflicted = [];
  git.fails = undefined;
  git.yours = 'feature';
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

/** The Git menu's items as it shows them, its Rebase menu's after, in `state`. */
const menu = async (state: Record<string, unknown>) => {
  git.state = state;
  await readState('/r/feature');
  const labels = (name: string) =>
    visibleEntries(services, name).map((e) =>
      'command' in e ? displayText(e.label, e.dialog) : 'label' in e ? displayText(e.label) : '-',
    );
  return [...labels('main/git'), ...labels('main/git/rebase')];
};
const last = () => notifications.all.get(0);
/** Runs a command, as the menu does, giving what it does to wait on. */
const exec = (id: string) => Promise.resolve(commands.get(id)?.run(undefined));
const run = (id: string) => Promise.resolve({ done: exec(id) });

describe('the Git menu during a merge or a rebase', () => {
  it('shows each action only while it applies, as IntelliJ’s', async () => {
    expect(await menu({ conflicts: false })).toEqual([]);
    expect(await menu({ operation: 'merge', conflicts: true })).toEqual([
      'Abort Merge',
      'Resolve Conflicts…',
    ]);
    expect(await menu({ operation: 'merge', conflicts: false })).toEqual([
      'Commit Merge',
      'Abort Merge',
    ]);
    expect(await menu({ operation: 'rebase', conflicts: true })).toEqual([
      'Rebase',
      'Resolve Conflicts…',
      'Abort Rebase',
      'Continue Rebase',
      'Skip Commit',
    ]);
    // Without a host, none.
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(visibleEntries(services, 'main/git')).toEqual([]);
    await exec('vcs.abortMerge');
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });
});

describe('Commit Merge', () => {
  it('commits the merge, or says why it couldn’t', async () => {
    await menu({ operation: 'merge', conflicts: false });
    await exec('vcs.commitMerge');
    expect(host.params('git.continue')).toEqual([{ path: '/r/feature' }]);
    // The menu read again after.
    expect(host.params('git.state').length).toBeGreaterThan(1);
    git.stops = [new Error('nothing to commit')];
    await exec('vcs.commitMerge');
    expect(last()).toMatchObject({
      title: 'Merge commit failed',
      content: 'nothing to commit',
      type: 'error',
    });
  });
});

describe('Abort Merge and Abort Rebase', () => {
  it('ask first, as IntelliJ’s, then abort and say so', async () => {
    await menu({ operation: 'merge', conflicts: true });
    let done = exec('vcs.abortMerge');
    await dialog();
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toBe('Abort Merge');
    expect(await dialogText()).toBe('Abort merge?');
    await press('Cancel');
    await done;
    expect(host.params('git.abort')).toEqual([]);
    done = exec('vcs.abortMerge');
    await press('Abort');
    await done;
    expect(host.params('git.abort')).toEqual([{ path: '/r/feature', operation: 'merge' }]);
    expect(last()).toMatchObject({ title: '', content: 'Merge abort succeeded' });
    await menu({ operation: 'rebase', conflicts: true });
    done = exec('vcs.abortRebase');
    expect(await dialogText()).toBe('Abort rebase in feature?');
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toBe('Abort Rebase');
    await press('Abort');
    await done;
    expect(last()).toMatchObject({ content: 'Abort rebase succeeded' });
  });

  it('say why they couldn’t', async () => {
    git.fails = new Error('fatal: no rebase in progress');
    for (const [operation, command, title] of [
      ['merge', 'vcs.abortMerge', 'Merge abort failed'],
      ['rebase', 'vcs.abortRebase', 'Abort rebase failed'],
    ] as const) {
      await menu({ operation, conflicts: false });
      const done = exec(command);
      await press('Abort');
      await done;
      expect(last()).toMatchObject({
        title,
        content: 'fatal: no rebase in progress',
        type: 'error',
        display: 'sticky',
      });
    }
  });
});

describe('Continue Rebase and Skip Commit', () => {
  it('say the rebase succeeded, naming the branch rebased', async () => {
    await menu({ operation: 'rebase', conflicts: false });
    await exec('vcs.continueRebase');
    expect(last()).toMatchObject({ title: 'Rebase successful', content: 'Rebased feature' });
    // A detached HEAD's: no branch to name.
    git.yours = undefined;
    await exec('vcs.skipCommit');
    expect(host.params('git.skipCommit')).toEqual([{ path: '/r/feature' }]);
    expect(last()).toMatchObject({ title: 'Rebase successful', content: 'Rebased' });
  });

  it('show the Conflicts dialog at conflicts, and go on once none is left', async () => {
    await menu({ operation: 'rebase', conflicts: false });
    git.stops = ['conflicts', 'done'];
    const { done } = await run('vcs.continueRebase');
    expect(await dialogText()).toContain('Rebasing branch feature onto branch main');
    await press('Accept Yours');
    await done;
    expect(host.params('git.continue')).toHaveLength(2);
    expect(last()?.title).toBe('Rebase successful');
  });

  it('say the rebase stopped when the dialog’s closed, with Resolve…, Continue and Abort', async () => {
    await menu({ operation: 'rebase', conflicts: true });
    git.stops = ['conflicts'];
    let { done } = await run('vcs.skipCommit');
    await dialog();
    await press('Close');
    await done;
    const stopped = last();
    expect(stopped).toMatchObject({
      title: 'Rebase stopped due to conflicts',
      type: 'warning',
      display: 'sticky',
    });
    expect(stopped?.actions.map((a) => a.label)).toEqual(['Resolve…', 'Continue', 'Abort']);
    // Resolve…: the dialog again, closed with files left; then resolved, and on.
    stopped?.actions[0]?.run();
    await dialog();
    await press('Close');
    await expect.poll(() => host.params('git.state').length).toBeGreaterThan(1);
    stopped?.actions[0]?.run();
    await dialog();
    await press('Accept Yours');
    await expect.poll(() => last()?.title).toBe('Rebase successful');
    // Continue and Abort.
    git.conflicted = ['a.ts'];
    stopped?.actions[1]?.run();
    await expect.poll(() => host.params('git.continue').length).toBeGreaterThan(1);
    stopped?.actions[2]?.run();
    await press('Abort');
    await expect.poll(() => host.params('git.abort')).toHaveLength(1);
    ({ done } = await run('vcs.continueRebase'));
    await done;
  });

  it('say why the rebase couldn’t go on', async () => {
    await menu({ operation: 'rebase', conflicts: false });
    git.stops = [new Error('error: you have unstaged changes')];
    await exec('vcs.continueRebase');
    expect(last()).toMatchObject({
      title: 'Continue rebase failed',
      content: 'error: you have unstaged changes',
      type: 'error',
    });
  });
});

describe('what fails besides', () => {
  it('is logged: the lists read after, say', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await menu({ operation: 'merge', conflicts: false });
    host.answers['git.shelves'] = () => {
      throw new Error('gone');
    };
    await exec('vcs.commitMerge');
    expect(error.mock.calls[0]?.[0]).toBe('Commit Merge failed');
    host.answers['git.shelves'] = () => [];
    // Without a host, nothing runs.
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(await exec('vcs.commitMerge')).toBeUndefined();
  });
});
