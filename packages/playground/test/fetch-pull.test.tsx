import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { fetching, pullingFrom, setupFetchPull } from '../src/fetch-pull.js';
import { notifications } from '../src/notifications.js';
import { setupLog } from '../src/git-log.js';
import { setupUpdate } from '../src/update.js';
import { closeAll, dialog, FakeHost, popupItems, press, project } from './fakes.js';

/** What the host answers: each test sets what it needs. */
const git = {
  fetched: { pruned: [], failed: [] } as unknown,
  tracking: {
    branch: 'main',
    remotes: ['origin', 'upstream'],
    upstream: { remote: 'origin', branch: 'main' },
  } as unknown,
  branches: ['origin/main', 'origin/dev', 'origin/HEAD', 'upstream/main', 'upstream/feature'],
  pulled: { kind: 'merged', files: 2, commits: 1 } as unknown,
  /** Held until it resolves: a fetch or a pull under way. */
  hold: undefined as Promise<void> | undefined,
  conflicted: [] as string[],
};
const answers = {
  'git.state': () => ({ conflicts: false }),
  'git.fetch': async () => {
    await git.hold;
    if (git.fetched instanceof Error) throw git.fetched;
    return git.fetched;
  },
  'git.tracking': () => git.tracking,
  'git.branches': () => [
    { ref: 'refs/heads/main' },
    ...git.branches.map((b) => ({ ref: `refs/remotes/${b}` })),
  ],
  'git.pull': async () => {
    await git.hold;
    if (git.pulled instanceof Error) throw git.pulled;
    return git.pulled;
  },
  'git.update': () => ({ kind: 'nothing' }),
  'git.continueUpdate': () => ({ kind: 'updated', files: 3, commits: 2, restored: true }),
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
};
const host = new FakeHost(answers);

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupUpdate(services);
  setupFetchPull(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.fetched = { pruned: [], failed: [] };
  git.tracking = {
    branch: 'main',
    remotes: ['origin', 'upstream'],
    upstream: { remote: 'origin', branch: 'main' },
  };
  git.pulled = { kind: 'merged', files: 2, commits: 1 };
  git.hold = undefined;
  git.conflicted = [];
  localStorage.clear();
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const last = () => notifications.all.get(0);
/** Runs a command and waits for its notification. */
const notified = async (command: string) => {
  const before = notifications.all.length;
  commands.execute(command);
  await expect.poll(() => notifications.all.length).toBeGreaterThan(before);
};

describe('Fetch', () => {
  it('is in the Git menu after Pull, as IntelliJ’s', () => {
    const ids = JSON.stringify(menus.entries('main/git'));
    expect(ids.indexOf('vcs.update')).toBeLessThan(ids.indexOf('vcs.pull'));
    expect(ids.indexOf('vcs.pull')).toBeLessThan(ids.indexOf('vcs.fetch'));
    expect(commands.get('vcs.fetch')?.icon).toBe('fetch');
  });

  it('says it fetched, with what it pruned', async () => {
    git.fetched = { pruned: ['origin/gone', 'origin/old'], failed: [] };
    await notified('vcs.fetch');
    expect(last()).toMatchObject({
      title: 'Fetch successful',
      content: 'origin/gone\norigin/old',
      type: 'information',
    });
    expect(host.params('git.fetch')).toEqual([{ path: '/r' }]);
  });

  it('says it failed, in git’s words, naming the remotes when several failed', async () => {
    git.fetched = { pruned: [], failed: [{ remote: 'origin', error: 'fatal: no' }] };
    await notified('vcs.fetch');
    expect(last()).toMatchObject({
      title: 'Fetch failed',
      content: 'fatal: no',
      type: 'error',
      display: 'sticky',
    });
    git.fetched = {
      pruned: ['upstream/gone'],
      failed: [
        { remote: 'origin', error: 'fatal: no' },
        { remote: 'broken', error: 'fatal: missing' },
      ],
    };
    await notified('vcs.fetch');
    expect(last()?.content).toBe('origin: fatal: no\nbroken: fatal: missing\nupstream/gone');
    git.fetched = new Error('the host is gone');
    await notified('vcs.fetch');
    expect(last()).toMatchObject({ title: 'Fetch failed', content: 'the host is gone' });
  });

  it('is disabled while one runs, and outside a project with a host', async () => {
    let release!: () => void;
    git.hold = new Promise((resolve) => (release = resolve));
    commands.execute('vcs.fetch');
    await expect.poll(() => fetching.get()).toBe(true);
    expect(commands.isEnabled('vcs.fetch')).toBe(false);
    release();
    await expect.poll(() => fetching.get()).toBe(false);
    expect(commands.isEnabled('vcs.fetch')).toBe(true);
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('vcs.fetch')).toBe(false);
    expect(commands.isEnabled('vcs.pull')).toBe(false);
    // Run anyway (from elsewhere), it does nothing.
    expect(commands.get('vcs.fetch')?.run(undefined)).toBeUndefined();
  });

  it('logs what fails outside the fetch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // A host that can't list the shelves: the lists read after fail.
    const failing = new FakeHost({ 'git.fetch': () => ({ pruned: [], failed: [] }) });
    useProjects([project('/r', host), project('/t', failing)]);
    workspace.openOrActivate({ id: '/t', name: 't', branch: 'main' });
    commands.execute('vcs.fetch');
    await expect.poll(() => error.mock.calls.length).toBe(1);
    expect(error.mock.calls[0]?.[0]).toBe('Fetch failed');
    useProjects([project('/r', host), project('/s', undefined)]);
  });
});

/** The Pull dialog's parts. */
const parts = async () => {
  const shown = await dialog();
  return {
    shown,
    title: shown.querySelector('.cerebro-dialog__title')?.textContent,
    remote: shown.querySelector('.playground-git-command__remote') as HTMLSelectElement,
    field: shown.querySelector('.playground-git-branch__field') as HTMLInputElement,
    error: () => shown.querySelector('[role="alert"]')?.textContent,
    options: () =>
      [...shown.querySelectorAll('.playground-git-options__option')].map(
        (o) => o.firstChild?.textContent,
      ),
    ok: () =>
      [...shown.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
        (b) => b.textContent === 'Pull',
      ) as HTMLButtonElement,
  };
};
/** Types a branch into the dialog's field, replacing what's there. */
const typeBranch = async (text: string) => {
  const { field } = await parts();
  await userEvent.clear(field);
  if (text !== '') await userEvent.type(field, text);
};
/** Opens Add Pull Options and chooses the options described, in turn. */
const choose = async (...descriptions: string[]) => {
  await userEvent.click(
    [...(await dialog()).querySelectorAll('button')].find(
      (b) => b.textContent === 'Modify options',
    ) as HTMLElement,
  );
  await popupItems();
  for (const description of descriptions) {
    await userEvent.click(row(description));
  }
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
};
const row = (description: string) =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-popup-item')].find(
    (r) => r.querySelector('.cerebro-popup-item__label')?.textContent === description,
  ) as HTMLElement;

describe('Pull', () => {
  it('asks in IntelliJ’s dialog, from the upstream to start with', async () => {
    expect(JSON.stringify(menus.entries('main/git'))).toContain('vcs.pull');
    expect(commands.get('vcs.pull')?.dialog).toBe(true);
    commands.execute('vcs.pull');
    const { title, remote, field, shown } = await parts();
    expect(title).toBe('Pull to main');
    expect(shown.querySelector('.playground-git-command__git')?.textContent).toBe('git pull');
    expect([...remote.options].map((o) => o.value)).toEqual(['origin', 'upstream']);
    expect(remote.value).toBe('origin');
    expect(field.value).toBe('main');
    await press('Pull');
    await expect
      .poll(() => host.params('git.pull'))
      .toEqual([{ path: '/r', remote: 'origin', branch: 'main', options: [] }]);
    await expect.poll(() => last()?.title).toBe('2 files updated in 1 commit');
  });

  it('starts another remote at the branch of the same name, else empty', async () => {
    commands.execute('vcs.pull');
    const { remote, field } = await parts();
    await userEvent.selectOptions(remote, 'upstream');
    expect(field.value).toBe('main');
    git.tracking = { branch: 'dev', remotes: ['origin', 'upstream'], upstream: undefined };
    await closeAll();
    commands.execute('vcs.pull');
    const second = await parts();
    expect(second.title).toBe('Pull to dev');
    // No upstream: origin, and its branch of the same name.
    expect(second.remote.value).toBe('origin');
    expect(second.field.value).toBe('dev');
    await userEvent.selectOptions(second.remote, 'upstream');
    expect(second.field.value).toBe('');
    expect(second.error()).toBe('The branch to pull from should be selected.');
    expect(second.ok().disabled).toBe(true);
  });

  it('says what’s wrong with the branch, or that there’s no remote', async () => {
    commands.execute('vcs.pull');
    const { error, ok } = await parts();
    expect(error()).toBe('');
    await typeBranch('nowhere');
    expect(error()).toBe('There is no matching branch.');
    expect(ok().disabled).toBe(true);
    await typeBranch('');
    expect(error()).toBe('The branch to pull from should be selected.');
    // Detached, without remotes: Pull, and None.
    git.tracking = { branch: undefined, remotes: [], upstream: undefined };
    await closeAll();
    commands.execute('vcs.pull');
    const none = await parts();
    expect(none.title).toBe('Pull');
    expect(none.remote.disabled).toBe(true);
    expect([...none.remote.options].map((o) => o.textContent)).toEqual(['None']);
    expect(none.error()).toBe('Select the remote to pull from');
    // No remote's branches to suggest.
    await typeBranch('m');
    expect(document.querySelector('.playground-git-branch__suggestions')).toBeNull();
  });

  it('starts at the first remote when there’s no upstream or origin', async () => {
    git.tracking = { branch: 'main', remotes: ['upstream'], upstream: undefined };
    commands.execute('vcs.pull');
    const { remote, field } = await parts();
    expect(remote.value).toBe('upstream');
    expect(field.value).toBe('main');
  });

  it('suggests the remote’s branches as one is typed', async () => {
    commands.execute('vcs.pull');
    await parts();
    await typeBranch('e');
    const suggestions = () =>
      [...document.querySelectorAll('.playground-git-branch__suggestion')].map(
        (s) => s.textContent,
      );
    // origin's, but its HEAD.
    expect(suggestions()).toEqual(['dev']);
    await userEvent.selectOptions((await parts()).remote, 'upstream');
    // All of them, cleared: each shown, though they go past the dialog's edge.
    await typeBranch('');
    expect(suggestions()).toEqual(['feature', 'main']);
    for (const item of document.querySelectorAll('.playground-git-branch__suggestion')) {
      const at = item.getBoundingClientRect();
      expect(document.elementFromPoint(at.left + 4, at.bottom - 4)).toBe(item);
    }
    await typeBranch('ea');
    expect(suggestions()).toEqual(['feature']);
    await userEvent.click(
      document.querySelector('.playground-git-branch__suggestion') as HTMLElement,
    );
    expect((await parts()).field.value).toBe('feature');
    expect(suggestions()).toEqual([]);
    // Leaving the field hides them.
    await typeBranch('ma');
    expect(suggestions()).toEqual(['main']);
    await userEvent.click((await parts()).remote);
    expect(suggestions()).toEqual([]);
  });

  it('adds options in Add Pull Options, those that can’t go with them greyed', async () => {
    commands.execute('vcs.pull');
    await parts();
    await userEvent.click(
      [...(await dialog()).querySelectorAll('button')].find(
        (b) => b.textContent === 'Modify options',
      ) as HTMLElement,
    );
    expect(await popupItems()).toEqual([
      'Rebase the current branch on top of incoming changes',
      'Merge only if it can be fast-forwarded',
      'Create a merge commit even if it can be fast-forwarded',
      'Create a single commit for all pulled changes',
      'Merge, but do not commit the result',
      'Bypass the pre-merge and commit message hooks',
    ]);
    await userEvent.click(row('Merge only if it can be fast-forwarded'));
    // The popup stays open, the option checked, those it excludes greyed.
    const greyed = () =>
      [...document.querySelectorAll('.cerebro-popup-item--disabled')].map(
        (r) => r.querySelector('.cerebro-popup-item__label')?.textContent,
      );
    await expect
      .poll(greyed)
      .toEqual([
        'Rebase the current branch on top of incoming changes',
        'Create a merge commit even if it can be fast-forwarded',
        'Create a single commit for all pulled changes',
      ]);
    await userEvent.click(row('Bypass the pre-merge and commit message hooks'));
    await userEvent.keyboard('{Escape}');
    const { options, shown } = await parts();
    expect(options()).toEqual(['--ff-only', '--no-verify']);
    // Each removable.
    await userEvent.click(shown.querySelector('[aria-label="Remove --ff-only"]') as HTMLElement);
    expect(options()).toEqual(['--no-verify']);
    await press('Pull');
    await expect
      .poll(() => host.params('git.pull'))
      .toEqual([{ path: '/r', remote: 'origin', branch: 'main', options: ['--no-verify'] }]);
  });

  it('keeps the options chosen for the repository, as IntelliJ per project', async () => {
    commands.execute('vcs.pull');
    await choose('Create a single commit for all pulled changes');
    await press('Pull');
    await expect.poll(() => host.params('git.pull')).toHaveLength(1);
    await expect.poll(() => commands.isEnabled('vcs.pull')).toBe(true);
    commands.execute('vcs.pull');
    expect((await parts()).options()).toEqual(['--squash']);
    await press('Cancel');
    // What isn't an option, or isn't a list, is left out.
    localStorage.setItem('cerebro.pull.options:/r', '["--squash","--force"]');
    commands.execute('vcs.pull');
    expect((await parts()).options()).toEqual(['--squash']);
    await press('Cancel');
    for (const kept of ['"--squash"', '{']) {
      localStorage.setItem('cerebro.pull.options:/r', kept);
      commands.execute('vcs.pull');
      expect((await parts()).options()).toEqual([]);
      await press('Cancel');
    }
    expect(host.params('git.pull')).toHaveLength(1);
  });

  it('pulls without keeping the options when they can’t be kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    commands.execute('vcs.pull');
    await choose('Create a single commit for all pulled changes');
    await press('Pull');
    await expect.poll(() => host.params('git.pull')).toHaveLength(1);
    expect(localStorage.getItem('cerebro.pull.options:/r')).toBeNull();
  });

  it('rebases with --rebase, as Update Project does, from the branch chosen', async () => {
    commands.execute('vcs.pull');
    await userEvent.selectOptions((await parts()).remote, 'upstream');
    await typeBranch('feature');
    await choose('Rebase the current branch on top of incoming changes');
    await press('Pull');
    await expect.poll(() => host.params('git.update')).toHaveLength(1);
    expect(host.params('git.update')[0]).toMatchObject({
      path: '/r',
      method: 'rebase',
      from: { remote: 'upstream', branch: 'feature' },
    });
    expect(host.params('git.pull')).toEqual([]);
  });

  it('says how it went, in IntelliJ’s words, with View commits once committed', async () => {
    git.pulled = { kind: 'merged', files: 1, commits: 3, range: { start: 'a1', end: 'b2' } };
    commands.execute('vcs.pull');
    await press('Pull');
    await expect.poll(() => last()?.title).toBe('1 file updated in 3 commits');
    const view = last()?.actions[0];
    expect(view?.label).toBe('View commits');
    let shown = 0;
    setupLog({ commands: new CommandRegistry(), menus: new MenuRegistry() }, () => {
      shown++;
    });
    view?.run();
    expect(shown).toBe(1);
    // Squashed, or not committed: HEAD didn't move, so there's none to view.
    git.pulled = { kind: 'merged', files: 1, commits: 1 };
    await expect.poll(() => commands.isEnabled('vcs.pull')).toBe(true);
    commands.execute('vcs.pull');
    await press('Pull');
    await expect.poll(() => last()?.title).toBe('1 file updated in 1 commit');
    expect(last()?.actions).toEqual([]);
    git.pulled = { kind: 'merged', files: 0, commits: 0 };
    await expect.poll(() => commands.isEnabled('vcs.pull')).toBe(true);
    commands.execute('vcs.pull');
    await press('Pull');
    await expect.poll(() => last()?.title).toBe('All files are up to date');
  });

  it('says why it failed, in IntelliJ’s words where it has its own', async () => {
    const cases: [string, string, string][] = [
      [
        'error: Your local changes to the following files would be overwritten by merge:\n\ta.ts',
        'Git Pull Failed',
        'Your local changes will be overwritten by pull.\nCommit, stash, or revert them to proceed.',
      ],
      [
        'error: The following untracked working tree files would be overwritten by merge:\n\tb.ts',
        'Untracked Files Prevent Pull',
        'error: The following untracked working tree files would be overwritten by merge:\n\tb.ts',
      ],
      [
        'fatal: Not possible to fast-forward, aborting.',
        'Git Pull failed',
        'fatal: Not possible to fast-forward, aborting.',
      ],
    ];
    for (const [message, title, content] of cases) {
      git.pulled = new Error(message);
      await expect.poll(() => commands.isEnabled('vcs.pull')).toBe(true);
      commands.execute('vcs.pull');
      const before = notifications.all.length;
      await press('Pull');
      await expect.poll(() => notifications.all.length).toBeGreaterThan(before);
      expect(last()).toMatchObject({ title, content, type: 'error', display: 'sticky' });
    }
  });

  it('is disabled while one runs, pulling from the remote said', async () => {
    let release!: () => void;
    git.hold = new Promise((resolve) => (release = resolve));
    commands.execute('vcs.pull');
    await press('Pull');
    await expect.poll(() => pullingFrom.get()).toBe('origin');
    expect(commands.isEnabled('vcs.pull')).toBe(false);
    release();
    await expect.poll(() => pullingFrom.get()).toBeUndefined();
    expect(commands.isEnabled('vcs.pull')).toBe(true);
  });

  it('does nothing when the dialog is cancelled', async () => {
    commands.execute('vcs.pull');
    await press('Cancel');
    await expect.poll(() => commands.isEnabled('vcs.pull')).toBe(true);
    expect(host.params('git.pull')).toEqual([]);
  });

  it('shows the Conflicts dialog at conflicts, then commits the merge', async () => {
    const resume = { method: 'merge', before: 'abc', commits: 2 };
    git.conflicted = ['a.ts'];
    git.pulled = { kind: 'conflicts', resume };
    commands.execute('vcs.pull');
    await press('Pull');
    await expect
      .poll(() => document.querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Conflicts');
    await press('Accept Yours');
    await expect.poll(() => last()?.title).toBe('3 files updated in 2 commits');
    expect(host.params('git.continueUpdate')).toEqual([{ path: '/r', resume }]);
  });

  it('leaves the merge uncommitted with --no-commit', async () => {
    git.conflicted = ['a.ts'];
    git.pulled = { kind: 'conflicts', resume: {} };
    commands.execute('vcs.pull');
    await choose('Merge, but do not commit the result');
    await press('Pull');
    await expect
      .poll(() => document.querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Conflicts');
    await press('Accept Yours');
    await expect.poll(() => pullingFrom.get()).toBeUndefined();
    expect(host.params('git.continueUpdate')).toEqual([]);
  });

  it('says conflicts are left when the dialog is closed, and Resolve… shows it again', async () => {
    git.conflicted = ['a.ts'];
    git.pulled = { kind: 'conflicts', resume: {} };
    commands.execute('vcs.pull');
    await press('Pull');
    await expect
      .poll(() => document.querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Conflicts');
    await press('Close');
    await expect.poll(last).toMatchObject({
      content: 'There are pending unresolved conflicts.',
      type: 'warning',
      display: 'sticky',
    });
    expect(last()?.actions[0]?.label).toBe('Resolve…');
    expect(host.params('git.continueUpdate')).toEqual([]);
    const shelves = host.params('git.shelves').length;
    last()?.actions[0]?.run();
    await press('Accept Yours');
    await expect.poll(() => host.params('git.shelves').length).toBeGreaterThan(shelves);
  });
});
