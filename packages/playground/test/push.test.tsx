import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import { notifications } from '../src/notifications.js';
import { openPush, pushing, setupPush } from '../src/push.js';
import { closeAll, dialog, FakeHost, press, project } from './fakes.js';

const commit = (subject: string, parent?: string): LogCommit => ({
  hash: `${subject}-hash`,
  parents: parent === undefined ? [] : [parent],
  author: 'Ann',
  email: 'a@x',
  time: 0,
  subject,
  body: '',
  refs: [],
});

/** What the host says a push sends, and how it goes. */
const git = {
  outgoing: {} as Record<string, unknown>,
  /** Pushed: how many commits, else the error it fails with. */
  pushed: 0 as number | Error,
  /** Held until it resolves: a push under way. */
  hold: undefined as Promise<void> | undefined,
};
const host = new FakeHost({
  'git.outgoing': () => {
    if (git.outgoing instanceof Error) throw git.outgoing;
    return git.outgoing;
  },
  'git.push': async () => {
    await git.hold;
    if (git.pushed instanceof Error) throw git.pushed;
    const { remote, target, isNew } = git.outgoing;
    return { commits: git.pushed, remote, target, isNew };
  },
  'git.changes': ({ from, to }: { from: string; to: string }) => [
    { path: `${from}..${to}.ts`, status: 'modified' },
  ],
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupPush(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.outgoing = {
    branch: 'main',
    remote: 'origin',
    target: 'main',
    isNew: false,
    commits: [commit('Second', 'First-hash'), commit('First', 'base')],
  };
  git.pushed = 2;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const pushButton = async () =>
  [...(await dialog()).querySelectorAll('.cerebro-dialog__button')].find(
    (b) => b.textContent === 'Push',
  ) as HTMLButtonElement;
const texts = (selector: string) =>
  [...document.querySelectorAll(selector)].map((e) => e.textContent);
const last = () => notifications.all.get(0);

describe('Push', () => {
  it('shows where the branch goes and its commits, as IntelliJ’s, and pushes them', async () => {
    commands.execute('vcs.push');
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe('Push Commits to r');
    expect(texts('.playground-push__target')).toEqual(['main→origin : main']);
    expect(texts('.playground-push__commit')).toEqual(['Second', 'First']);
    await press('Push');
    await expect.poll(() => host.params('git.push')).toEqual([{ path: '/r' }]);
    await expect.poll(last).toMatchObject({
      title: 'Pushed 2 commits to origin/main',
      type: 'information',
      display: 'balloon',
    });
  });

  it('shows the selected row’s files beside: all the commits’, or one’s, as IntelliJ’s', async () => {
    const files = () => texts('.playground-push__files .playground-change');
    commands.execute('vcs.push');
    await expect.poll(files).toEqual(['base..Second-hash.ts']);
    const second = [...document.querySelectorAll<HTMLElement>('.playground-push__commit')][1];
    expect(second?.title).toMatch(/^First-ha {2}.+ {2}by Ann\n\nFirst$/);
    await userEvent.click(second as HTMLElement);
    await expect.poll(files).toEqual(['base..First-hash.ts']);
    // The first commit of all: from git's empty tree.
    git.outgoing = { ...git.outgoing, commits: [{ ...commit('Root'), body: 'Why' }] };
    await closeAll();
    commands.execute('vcs.push');
    await expect.poll(files).toEqual(['4b825dc642cb6eb9a060e54bf8d69288fbee4904..Root-hash.ts']);
    expect(document.querySelector<HTMLElement>('.playground-push__commit')?.title).toMatch(
      /\n\nRoot\n\nWhy$/,
    );
  });

  it('says there’s nothing selected for a new branch with no commits of its own', async () => {
    git.outgoing = { ...git.outgoing, isNew: true, commits: [] };
    commands.execute('vcs.push');
    await expect
      .poll(() => texts('.playground-push__files .playground-project__empty'))
      .toEqual(['No commits selected']);
  });

  it('shows Pushing… meanwhile, and pushes once at a time', async () => {
    let finish!: () => void;
    git.hold = new Promise((resolve) => (finish = resolve));
    commands.execute('vcs.push');
    await press('Push');
    await expect.poll(() => pushing.get()).toBe(true);
    expect(commands.isEnabled('vcs.push')).toBe(false);
    await openPush('/r');
    expect(host.params('git.outgoing')).toHaveLength(1);
    finish();
    git.hold = undefined;
    await expect.poll(() => pushing.get()).toBe(false);
    expect(commands.isEnabled('vcs.push')).toBe(true);
  });

  it('says one commit, and when there was nothing left to push', async () => {
    git.pushed = 1;
    commands.execute('vcs.push');
    await press('Push');
    await expect.poll(() => last()?.title).toBe('Pushed 1 commit to origin/main');
    git.pushed = 0;
    commands.execute('vcs.push');
    await press('Push');
    await expect.poll(() => last()?.title).toBe('Everything is up to date');
  });

  it('marks a new branch there, and pushes it with no commits of its own', async () => {
    git.outgoing = { ...git.outgoing, branch: 'feat', target: 'feat', isNew: true, commits: [] };
    git.pushed = 0;
    commands.execute('vcs.push');
    await dialog();
    expect(texts('.playground-push__new')).toEqual(['New']);
    expect((await pushButton()).disabled).toBe(false);
    await press('Push');
    await expect.poll(() => last()?.title).toBe('Pushed feat to new branch origin/feat');
  });

  it('can’t push with nothing to send, no branch, or no remote', async () => {
    git.outgoing = { ...git.outgoing, commits: [] };
    commands.execute('vcs.push');
    expect((await pushButton()).disabled).toBe(true);
    await closeAll();
    for (const [outgoing, why] of [
      [{ branch: undefined, remote: undefined }, 'No branch is checked out'],
      [{ branch: 'main', remote: undefined }, 'The repository has no remote'],
    ] as const) {
      git.outgoing = { ...git.outgoing, ...outgoing };
      commands.execute('vcs.push');
      expect((await pushButton()).disabled).toBe(true);
      expect(texts('.playground-push__target')).toEqual([why]);
      await closeAll();
    }
    expect(host.params('git.push')).toEqual([]);
  });

  it('pushes nothing when cancelled', async () => {
    commands.execute('vcs.push');
    await press('Cancel');
    expect(host.params('git.push')).toEqual([]);
  });

  it('says it was rejected, or failed, as IntelliJ’s, in a notification that stays', async () => {
    git.pushed = new Error(' ! [rejected]        HEAD -> main (fetch first)');
    commands.execute('vcs.push');
    await press('Push');
    await expect.poll(last).toMatchObject({
      title: 'Push rejected',
      content: 'Push to origin/main was rejected',
      type: 'warning',
      display: 'sticky',
    });
    git.pushed = new Error('Could not read from remote repository.');
    commands.execute('vcs.push');
    await press('Push');
    await expect.poll(last).toMatchObject({
      title: 'Push failed',
      content: 'Could not read from remote repository.',
      type: 'error',
      display: 'sticky',
    });
  });

  it('logs why it couldn’t read what to push', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.outgoing = new Error('git.outgoing failed') as never;
    commands.execute('vcs.push');
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith('Reading what to push failed', expect.any(Error));
    });
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('needs a git project in the desktop app', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('vcs.push')).toBe(false);
    // A worktree without a host: nothing to ask.
    await openPush('/s');
    expect(host.asked).toEqual([]);
    workspace.close('/s');
  });

  it('is in the Git menu, after Commit…, with IntelliJ’s Ctrl+Shift+K', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'vcs.push' }]);
    expect(keymap.shortcutsFor('vcs.push')).toEqual(['Ctrl+Shift+K']);
  });
});

it('binds no shortcuts without a keymap', () => {
  const alone = new CommandRegistry();
  setupPush({ commands: alone, menus: new MenuRegistry() });
  expect(alone.get('vcs.push')).toBeDefined();
});
