import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { globalSettings } from '../src/settings.js';
import { setupUpdate, updateProject, updating } from '../src/update.js';
import { closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

/** How the host says the update went: what it gives, or the error it fails with. */
const git = {
  updated: { kind: 'nothing' } as unknown,
  /** Held until it resolves: an update under way. */
  hold: undefined as Promise<void> | undefined,
  /** The files in conflict, and how the update goes on once none is. */
  conflicted: [] as string[],
  continued: { kind: 'updated', files: 1, commits: 1, restored: true } as unknown,
};
const host = new FakeHost({
  'git.update': async () => {
    await git.hold;
    if (git.updated instanceof Error) throw git.updated;
    return git.updated;
  },
  'git.continueUpdate': () => git.continued,
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
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };
const shown: string[] = [];

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupUpdate(services);
  for (const id of ['vcs.showShelf', 'vcs.showStash']) {
    commands.register({
      id,
      label: id,
      run: () => {
        shown.push(id);
      },
    });
  }
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.updated = { kind: 'nothing' };
  git.hold = undefined;
  git.conflicted = [];
  shown.length = 0;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  for (const id of ['git.updateMethod', 'git.saveChanges', 'vcs.showUpdateOptions']) {
    globalSettings.layers.global.reset(id);
  }
  vi.restoreAllMocks();
});

const last = () => notifications.all.get(0);
const radios = async () =>
  [...(await dialog()).querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((r) => [
    r.parentElement?.textContent,
    r.checked,
  ]);
/** Updates without the dialog, as after Don't show again. */
const silently = () => {
  globalSettings.layers.global.set('vcs.showUpdateOptions', false);
};
/** Runs Update Project silently and waits for its notification. */
const updated = async (as: unknown) => {
  git.updated = as;
  silently();
  const before = notifications.all.length;
  commands.execute('vcs.update');
  await expect.poll(() => notifications.all.length).toBeGreaterThan(before);
};

describe('Update Project', () => {
  it('asks Merge or Rebase first, as IntelliJ’s dialog, and keeps the choice', async () => {
    expect(keymap.shortcutsFor('vcs.update')).toEqual(['Ctrl+T']);
    expect(JSON.stringify(menus.entries('main/git'))).toContain('vcs.update');
    commands.execute('vcs.update');
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe('Update Project');
    expect(await radios()).toEqual([
      ['Merge', true],
      ['Rebase', false],
    ]);
    await userEvent.click(shown.querySelectorAll('input[type="radio"]')[1] as HTMLElement);
    await press('OK');
    await expect
      .poll(() => host.params('git.update'))
      .toEqual([{ path: '/r', method: 'rebase', save: 'shelve' }]);
    expect(globalSettings.get('git.updateMethod')).toBe('rebase');
    // Asked again next time, with the choice kept.
    await expect.poll(() => commands.isEnabled('vcs.update')).toBe(true);
    commands.execute('vcs.update');
    expect(await radios()).toEqual([
      ['Merge', false],
      ['Rebase', true],
    ]);
  });

  it('does nothing when the dialog is cancelled', async () => {
    commands.execute('vcs.update');
    await dialog();
    await press('Cancel');
    expect(host.params('git.update')).toEqual([]);
  });

  it('doesn’t ask again after Don’t show again, until the setting brings it back', async () => {
    commands.execute('vcs.update');
    const shown = await dialog();
    await userEvent.click(shown.querySelector('input[type="checkbox"]') as HTMLElement);
    await press('OK');
    expect(globalSettings.get('vcs.showUpdateOptions')).toBe(false);
    await expect.poll(() => host.params('git.update')).toHaveLength(1);
    await expect.poll(() => commands.isEnabled('vcs.update')).toBe(true);
    globalSettings.layers.global.set('git.saveChanges', 'stash');
    commands.execute('vcs.update');
    await expect.poll(() => host.params('git.update')).toHaveLength(2);
    expect(host.params('git.update')[1]).toEqual({ path: '/r', method: 'merge', save: 'stash' });
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('is disabled while one runs, and outside a git project with a host', async () => {
    let release!: () => void;
    git.hold = new Promise((resolve) => (release = resolve));
    silently();
    commands.execute('vcs.update');
    await expect.poll(() => updating.get()).toBe(true);
    expect(commands.isEnabled('vcs.update')).toBe(false);
    release();
    await expect.poll(() => updating.get()).toBe(false);
    expect(commands.isEnabled('vcs.update')).toBe(true);
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('vcs.update')).toBe(false);
  });

  it('doesn’t start from elsewhere (the Push dialog’s banner) while one runs, or without a host', async () => {
    let release!: () => void;
    git.hold = new Promise((resolve) => (release = resolve));
    silently();
    commands.execute('vcs.update');
    await expect.poll(() => updating.get()).toBe(true);
    await updateProject('/r');
    await updateProject('/s');
    release();
    await expect.poll(() => updating.get()).toBe(false);
    expect(host.params('git.update')).toHaveLength(1);
  });

  it('says what it brought, in IntelliJ’s words', async () => {
    await updated({ kind: 'updated', files: 2, commits: 1, restored: true });
    expect(last()).toMatchObject({ title: '2 files updated in 1 commit', type: 'information' });
    await updated({ kind: 'updated', files: 1, commits: 3, restored: true });
    expect(last()?.title).toBe('1 file updated in 3 commits');
    await updated({ kind: 'nothing' });
    expect(last()).toMatchObject({ title: 'Nothing to update', type: 'warning' });
  });

  it('says why it couldn’t, in IntelliJ’s words', async () => {
    const cases: [unknown, string, string][] = [
      [
        { kind: 'unfinished', state: 'merge' },
        'Cannot update',
        'You have unfinished merge. These conflicts must be resolved before update.',
      ],
      [
        { kind: 'unfinished', state: 'rebase' },
        'Cannot update',
        'You have unfinished rebase process. These conflicts must be resolved before update.',
      ],
      [
        { kind: 'unfinished', state: 'unmerged' },
        'Cannot update',
        'Unmerged files detected. These conflicts must be resolved before update.',
      ],
      [
        { kind: 'detached' },
        'Cannot Update: No Current Branch',
        "You are in the 'detached HEAD' state, which means that you're not on any branch. Checkout a branch to be able to update the project.",
      ],
      [{ kind: 'noUpstream', branch: 'alone' }, 'Cannot update', 'alone has no tracked branch'],
      [
        new Error('fatal: could not read from remote repository'),
        'Update failed',
        'fatal: could not read from remote repository',
      ],
    ];
    for (const [as, title, content] of cases) {
      await updated(as);
      expect(last()).toMatchObject({ title, content, type: 'error', display: 'sticky' });
    }
  });

  it('says when local changes saved weren’t put back, and shows them', async () => {
    await updated({ kind: 'updated', files: 1, commits: 1, restored: false });
    expect(last()).toMatchObject({
      title: 'Local changes were not restored',
      content: 'Before update your uncommitted changes were saved to shelf.',
      type: 'warning',
    });
    last()?.actions[0]?.run();
    expect(shown).toEqual(['vcs.showShelf']);
    // A rebase's conflicts, the changes stashed: both said.
    globalSettings.layers.global.set('git.saveChanges', 'stash');
    git.conflicted = ['a.ts'];
    git.updated = { kind: 'conflicts', method: 'rebase', saved: true, resume: {} };
    silently();
    commands.execute('vcs.update');
    await dialog();
    await press('Close');
    await expect
      .poll(() => notifications.all.get(1))
      .toMatchObject({
        title: 'Cannot continue rebase',
        content:
          'There are pending unresolved conflicts. Then you may continue rebase. You also may abort rebase to restore the original branch and stop rebasing.',
      });
    expect(last()?.content).toBe('Before update your uncommitted changes were saved to stash.');
    last()?.actions[0]?.run();
    expect(shown).toEqual(['vcs.showShelf', 'vcs.showStash']);
  });

  it('shows the Conflicts dialog at conflicts, and carries on once none is left', async () => {
    const resume = { method: 'merge', before: 'abc', commits: 1 };
    git.conflicted = ['a.ts'];
    git.updated = { kind: 'conflicts', method: 'merge', saved: false, resume };
    silently();
    commands.execute('vcs.update');
    expect(await dialogText()).toContain(
      'Merge conflicts detected. Resolve them before continuing update.',
    );
    await press('Accept Yours');
    await expect.poll(() => last()?.title).toBe('1 file updated in 1 commit');
    expect(host.params('git.continueUpdate')).toEqual([{ path: '/r', resume }]);
  });

  it('says conflicts are left when the dialog is closed, and Resolve… shows it again', async () => {
    git.conflicted = ['a.ts'];
    git.updated = { kind: 'conflicts', method: 'merge', saved: false, resume: {} };
    silently();
    commands.execute('vcs.update');
    await dialog();
    await press('Close');
    await expect.poll(last).toMatchObject({
      title: 'Cannot complete update',
      content: 'There are pending unresolved conflicts.',
      type: 'warning',
      display: 'sticky',
    });
    expect(host.params('git.continueUpdate')).toEqual([]);
    const shelves = host.params('git.shelves').length;
    last()?.actions[0]?.run();
    // What's being merged, this time.
    expect(await dialogText()).toContain('Merging branch');
    await press('Accept Yours');
    await expect.poll(() => host.params('git.shelves').length).toBeGreaterThan(shelves);
  });

  it('logs what fails resolving from the notification', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.conflicted = ['a.ts'];
    git.updated = { kind: 'conflicts', method: 'merge', saved: false, resume: {} };
    silently();
    commands.execute('vcs.update');
    await dialog();
    await press('Close');
    await expect.poll(() => last()?.title).toBe('Cannot complete update');
    // The host gone by then: listing the conflicts fails.
    useProjects([project('/r', new FakeHost({})), project('/s', undefined)]);
    last()?.actions[0]?.run();
    await expect.poll(() => error.mock.calls.length).toBe(1);
    expect(error.mock.calls[0]?.[0]).toBe('Resolving the conflicts failed');
    useProjects([project('/r', host), project('/s', undefined)]);
  });

  it('reads the Commit window’s lists again after', async () => {
    await updated({ kind: 'nothing' });
    await expect.poll(() => host.params('git.shelves')).toEqual([{ path: '/r' }]);
  });

  it('logs what fails outside the update', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A host that can't list the shelves: the lists read after fail.
    const failing = new FakeHost({ 'git.update': () => ({ kind: 'nothing' }) });
    useProjects([project('/r', host), project('/t', failing)]);
    workspace.openOrActivate({ id: '/t', name: 't', branch: 'main' });
    silently();
    commands.execute('vcs.update');
    await expect.poll(() => error.mock.calls.length).toBe(1);
    expect(error.mock.calls[0]?.[0]).toBe('Updating the project failed');
    useProjects([project('/r', host), project('/s', undefined)]);
  });
});
