import { CommandRegistry, displayText, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupConflicts } from '../src/conflicts.js';
import { useProjects, workspace } from '../src/environments.js';
import { setupMergeRebase } from '../src/merge-rebase.js';
import { notifications } from '../src/notifications.js';
import { readState } from '../src/repository-state.js';
import { closeAll, dialog, dialogText, FakeHost, popupItems, press, project } from './fakes.js';

/** The repository as the host sees it, and how what's asked of it goes. */
const git = {
  state: { conflicts: false } as Record<string, unknown>,
  /** What each continue or skip gives, in turn: done, conflicts, or an error. */
  stops: [] as ('done' | 'conflicts' | Error)[],
  conflicted: [] as string[],
  fails: undefined as Error | undefined,
  /** The branch rebased: none for a detached HEAD. */
  yours: 'feature' as string | undefined,
  tracking: {
    branch: 'feature' as string | undefined,
    upstream: { remote: 'origin', branch: 'main' } as
      { remote: string; branch: string } | undefined,
  },
  unmerged: ['refs/heads/v2', 'refs/remotes/origin/main'] as string[] | Error,
  /** The branches, local and remote (with a slash). */
  refs: [] as string[],
  merged: { kind: 'merged', files: 2, commits: 1 } as { kind: string; [key: string]: unknown },
  tags: ['v1.0'],
  /** What git knows, as `git.validRevision` answers. */
  known: (revision: string) => revision !== 'nowhere',
  /** What a rebase gives: done, conflicts, or an error. */
  rebased: 'done' as 'done' | 'conflicts' | Error,
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
  'git.tracking': () => git.tracking,
  'git.branches': () =>
    git.refs.map((b) => ({
      ref: b.includes('/') ? `refs/remotes/${b}` : `refs/heads/${b}`,
    })),
  'git.unmerged': () => {
    if (git.unmerged instanceof Error) throw git.unmerged;
    return git.unmerged;
  },
  'git.merge': () => {
    if (git.fails) throw git.fails;
    if (git.merged.kind === 'conflicts') git.conflicted = ['a.ts'];
    return git.merged;
  },
  'git.tags': () => git.tags,
  'git.validRevision': (p: { revision: string }) => git.known(p.revision),
  'git.rebase': () => {
    if (git.rebased instanceof Error) throw git.rebased;
    if (git.rebased === 'conflicts') git.conflicted = ['a.ts'];
    return git.rebased;
  },
  'git.continueUpdate': () => ({ kind: 'updated', files: 4, commits: 3, restored: true }),
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
  git.tracking = { branch: 'feature', upstream: { remote: 'origin', branch: 'main' } };
  git.unmerged = ['refs/heads/v2', 'refs/remotes/origin/main'];
  git.merged = { kind: 'merged', files: 2, commits: 1 };
  git.tags = ['v1.0'];
  git.known = (revision) => revision !== 'nowhere';
  git.rebased = 'done';
  git.refs = ['feature', 'v10', 'main', 'v2', 'origin/HEAD', 'origin/main', 'origin/feature'];
  localStorage.clear();
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
    // Merge… but while a merge is under way; during a rebase, off.
    expect(await menu({ conflicts: false })).toEqual(['Merge…']);
    expect(commands.isEnabled('vcs.merge')).toBe(true);
    expect(await menu({ operation: 'merge', conflicts: true })).toEqual([
      'Abort Merge',
      'Resolve Conflicts…',
    ]);
    expect(await menu({ operation: 'merge', conflicts: false })).toEqual([
      'Commit Merge',
      'Abort Merge',
    ]);
    expect(await menu({ operation: 'rebase', conflicts: true })).toEqual([
      'Merge…',
      'Rebase',
      'Resolve Conflicts…',
      'Abort Rebase',
      'Continue Rebase',
      'Skip Commit',
    ]);
    expect(commands.isEnabled('vcs.merge')).toBe(false);
    // Without a host, Merge… alone, off.
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(visibleEntries(services, 'main/git').map((e) => 'command' in e && e.command)).toEqual([
      'vcs.merge',
    ]);
    expect(commands.isEnabled('vcs.merge')).toBe(false);
    expect(commands.get('vcs.merge')?.run(undefined)).toBeUndefined();
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

describe('Merge…', () => {
  /** Opens the dialog from the Git menu, out of any merge or rebase. */
  const open = async () => {
    await menu({ conflicts: false });
    const done = exec('vcs.merge');
    const shown = await dialog();
    const field = shown.querySelector('.playground-git-branch__field') as HTMLInputElement;
    return {
      done,
      shown,
      field,
      title: shown.querySelector('.cerebro-dialog__title')?.textContent,
      error: () => shown.querySelector('[role="alert"]')?.textContent,
      ok: () =>
        [...shown.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
          (b) => b.textContent === 'Merge',
        ) as HTMLButtonElement,
      /** Types a branch, replacing what's there. */
      type: async (text: string) => {
        await userEvent.clear(field);
        if (text !== '') await userEvent.type(field, text);
      },
      /** Chooses options in Add Merge Options, by their descriptions. */
      choose: async (...descriptions: string[]) => {
        await userEvent.click(
          [...shown.querySelectorAll('button')].find(
            (b) => b.textContent === 'Modify options',
          ) as HTMLElement,
        );
        await popupItems();
        for (const description of descriptions) {
          await userEvent.click(
            [...document.querySelectorAll<HTMLElement>('.cerebro-popup-item')].find(
              (r) => r.querySelector('.cerebro-popup-item__label')?.textContent === description,
            ) as HTMLElement,
          );
        }
        await userEvent.keyboard('{Escape}');
        await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
      },
    };
  };

  it('asks in IntelliJ’s dialog, from the upstream, and merges it', async () => {
    const { title, shown, field, done, type } = await open();
    expect(title).toBe('Merge into feature');
    expect(shown.querySelector('.playground-git-command__git')?.textContent).toBe('git merge');
    expect(field.value).toBe('origin/main');
    // Local branches, then remote ones, each in natural order; no remote HEAD.
    await type('');
    expect(
      [...document.querySelectorAll('.playground-git-branch__suggestion')].map(
        (s) => s.textContent,
      ),
    ).toEqual(['feature', 'main', 'v2', 'v10', 'origin/feature', 'origin/main']);
    await type('origin/main');
    await press('Merge');
    await done;
    expect(host.params('git.merge')).toEqual([
      { path: '/r/feature', branch: 'origin/main', options: [] },
    ]);
    expect(last()?.title).toBe('2 files updated in 1 commit');
  });

  it('starts at the branch merged last, kept for the repository', async () => {
    const first = await open();
    await first.type('v2');
    await press('Merge');
    await first.done;
    expect((await open()).field.value).toBe('v2');
  });

  it('says what’s wrong with the branch, one merged already once the host says', async () => {
    const { error, ok, type } = await open();
    await type('');
    expect(error()).toBe('The merge branch should be selected.');
    expect(ok().disabled).toBe(true);
    await type('nowhere');
    expect(error()).toBe('There is no matching branch.');
    await type('main');
    expect(error()).toBe("Branch 'main' is already merged");
    expect(ok().disabled).toBe(true);
    await type('v2');
    expect(error()).toBe('');
  });

  it('doesn’t say what’s merged when the host can’t, and logs why', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.unmerged = new Error('no');
    const { error, type } = await open();
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the branches not merged failed');
    await type('main');
    expect(error()).toBe('');
  });

  it('is Merge Changes when detached, from the first branch without an upstream', async () => {
    git.tracking = { branch: undefined, upstream: undefined };
    const { title, field } = await open();
    expect(title).toBe('Merge Changes');
    expect(field.value).toBe('feature');
    // No branch at all (a repository without commits): none.
    await closeAll();
    git.refs = [];
    expect((await open()).field.value).toBe('');
  });

  it('merges with the options chosen, and with -m, the message written', async () => {
    const { shown, choose, done } = await open();
    await choose(
      'Specify a message for the merge commit',
      'Create a merge commit even if it can be fast-forwarded',
    );
    const label = shown.querySelector('.playground-git-command__message') as HTMLElement;
    expect(label.textContent).toBe('Commit message:');
    await userEvent.type(label.querySelector('textarea') as HTMLElement, 'Merged it');
    await press('Merge');
    await done;
    expect(host.params('git.merge')).toEqual([
      { path: '/r/feature', branch: 'origin/main', options: ['--no-ff'], message: 'Merged it' },
    ]);
    // Kept for next time; -m's message isn't.
    const again = await open();
    expect(
      [...again.shown.querySelectorAll('.playground-git-options__option')].map(
        (o) => o.firstChild?.textContent,
      ),
    ).toEqual(['-m', '--no-ff']);
    expect(again.shown.querySelector('textarea')?.value).toBe('');
  });

  it('says why it failed, in IntelliJ’s words for Merge', async () => {
    git.fails = new Error(
      'error: Your local changes to the following files would be overwritten by merge:\n\ta.ts',
    );
    const first = await open();
    await press('Merge');
    await first.done;
    expect(last()).toMatchObject({
      title: 'Git Merge Failed',
      content:
        'Your local changes will be overwritten by merge.\nCommit, stash, or revert them to proceed.',
    });
    git.fails = new Error('merge: nope - not something we can merge');
    const second = await open();
    await press('Merge');
    await second.done;
    expect(last()).toMatchObject({ title: 'Git Merge failed', content: git.fails.message });
  });

  it('shows the Conflicts dialog at conflicts, then commits the merge, but with --no-commit', async () => {
    git.merged = { kind: 'conflicts', resume: { method: 'merge', before: 'abc', commits: 3 } };
    const first = await open();
    await press('Merge');
    await expect.poll(dialogText).toContain('a.ts');
    await press('Accept Yours');
    await first.done;
    expect(host.params('git.continueUpdate')).toEqual([
      { path: '/r/feature', resume: { method: 'merge', before: 'abc', commits: 3 } },
    ]);
    expect(last()?.title).toBe('4 files updated in 3 commits');
    const second = await open();
    await second.choose('Do not commit the merge result');
    await press('Merge');
    await expect.poll(dialogText).toContain('a.ts');
    await press('Accept Yours');
    await second.done;
    expect(host.params('git.continueUpdate')).toHaveLength(1);
  });

  it('does nothing when cancelled, and starts afresh when nothing can be kept', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const first = await open();
    await press('Cancel');
    await first.done;
    expect(host.params('git.merge')).toEqual([]);
    const second = await open();
    await second.type('v2');
    await press('Merge');
    await second.done;
    expect((await open()).field.value).toBe('origin/main');
  });

  it('logs what fails outside the merge', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useProjects([
      project('/r/feature', new FakeHost({ 'git.state': () => ({ conflicts: false }) })),
      project('/s', undefined),
    ]);
    await exec('vcs.merge');
    expect(logged.mock.calls[0]?.[0]).toBe('Merge failed');
    useProjects([project('/r/feature', host), project('/s', undefined)]);
  });
});
