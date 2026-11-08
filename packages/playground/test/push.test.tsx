import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import { notifications } from '../src/notifications.js';
import { cleanUpBranchName, isBranchName, openPush, pushing, setupPush } from '../src/push.js';
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
  branchesFail: false,
};
/** The remotes' branches there are. */
const BRANCHES = ['origin/HEAD', 'origin/main', 'origin/feature-x', 'origin/fix', 'second/main'];
const host = new FakeHost({
  'git.outgoing': ({ remote, target }: { remote?: string; target?: string }) => {
    if (git.outgoing instanceof Error) throw git.outgoing;
    if (remote === undefined || target === undefined) return git.outgoing;
    if (remote === 'gone') throw new Error('There’s no remote named gone');
    // Another target: new unless it's there.
    return {
      ...git.outgoing,
      remote,
      target,
      isNew: !BRANCHES.includes(`${remote}/${target}`),
    };
  },
  'git.branches': () => {
    if (git.branchesFail) throw new Error('git.branches failed');
    return [
      { ref: 'refs/heads/main', hash: 'a', current: true },
      ...BRANCHES.map((b) => ({ ref: `refs/remotes/${b}`, hash: 'b', current: false })),
    ];
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
    remotes: ['origin'],
    upstream: { remote: 'origin', target: 'main' },
  };
  git.pushed = 2;
  git.branchesFail = false;
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
/** Where the push goes, as the repository's row says it, without its label. */
const where = () =>
  [...document.querySelectorAll('.playground-push__target')].map((target) =>
    [...target.childNodes]
      .filter((node) => !(node instanceof Element && node.matches('.playground-push__label')))
      .map((node) => node.textContent)
      .join(''),
  );
/** The target's link with this text: the remote, or the branch there. */
const link = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.playground-push__link')].find(
    (l) => l.textContent === text,
  ) as HTMLElement;
/** The branch being typed, once it shows. */
const editor = async () => {
  await expect.poll(() => document.querySelector('.playground-push__field')).not.toBeNull();
  return document.querySelector('.playground-push__field') as HTMLInputElement;
};

describe('Push', () => {
  it('shows where the branch goes and its commits, as IntelliJ’s, and pushes them', async () => {
    commands.execute('vcs.push');
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe('Push Commits to r');
    expect(where()).toEqual(['main→origin:main']);
    expect(texts('.playground-push__commit')).toEqual(['Second', 'First']);
    await press('Push');
    await expect
      .poll(() => host.params('git.push'))
      .toEqual([{ path: '/r', remote: 'origin', target: 'main', setUpstream: false }]);
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
    expect(texts('.playground-push__label')).toEqual(['New']);
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
      expect(where()).toEqual([why]);
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

  it('pushes to another remote, chosen from the list of them', async () => {
    git.outgoing = { ...git.outgoing, remotes: ['origin', 'second'] };
    commands.execute('vcs.push');
    await dialog();
    await userEvent.click(link('origin'));
    await expect.poll(() => texts('.cerebro-popup-item__label')).toEqual(['origin', 'second']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => where()).toEqual(['main→second:main']);
    expect(host.params('git.outgoing').at(-1)).toEqual({
      path: '/r',
      remote: 'second',
      target: 'main',
    });
    // The same one again: nothing to ask.
    await userEvent.click(link('second'));
    await userEvent.keyboard('{Enter}');
    await press('Push');
    await expect
      .poll(() => host.params('git.push'))
      .toEqual([{ path: '/r', remote: 'second', target: 'main', setUpstream: false }]);
    expect(host.params('git.outgoing')).toHaveLength(2);
  });

  it('pushes to another branch there, typed with the remote’s branches suggested', async () => {
    commands.execute('vcs.push');
    await dialog();
    await userEvent.click(link('main'));
    const field = await editor();
    await expect.poll(() => document.activeElement).toBe(field);
    // What git refuses goes as it's typed; a space becomes IntelliJ's -.
    await userEvent.keyboard('{Control>}a{/Control}f~e');
    expect(field.value).toBe('fe');
    expect(texts('.playground-push__suggestion')).toEqual(['feature-x']);
    // Around the suggestions, back to none, and to the last from none.
    await userEvent.keyboard('{ArrowDown}');
    expect(texts('.playground-push__suggestion--highlighted')).toEqual(['feature-x']);
    await userEvent.keyboard('{ArrowDown}');
    expect(texts('.playground-push__suggestion--highlighted')).toEqual([]);
    await userEvent.keyboard('{ArrowUp}');
    expect(texts('.playground-push__suggestion--highlighted')).toEqual(['feature-x']);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(texts('.playground-push__suggestion--highlighted')).toEqual(['feature-x']);
    // The dialog's Enter doesn't push meanwhile.
    expect((await pushButton()).disabled).toBe(true);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => where()).toEqual(['main→origin:feature-x']);
    expect(texts('.playground-push__label')).toEqual([]);
    expect(host.params('git.push')).toEqual([]);
    // Typed, and taken on leaving the field: new there.
    await userEvent.click(link('feature-x'));
    await userEvent.keyboard('{Control>}a{/Control}my work');
    expect((await editor()).value).toBe('my-work');
    await userEvent.click(document.querySelector('.playground-push__commit') as HTMLElement);
    await expect.poll(() => where()).toEqual(['main→origin:my-work']);
    expect(texts('.playground-push__label')).toEqual(['New']);
  });

  it('chooses a suggestion with the pointer, and puts back what was there on Escape', async () => {
    commands.execute('vcs.push');
    await dialog();
    await userEvent.click(link('main'));
    await editor();
    await userEvent.keyboard('{Control>}a{/Control}f');
    await userEvent.click(
      [...document.querySelectorAll<HTMLElement>('.playground-push__suggestion')].find(
        (s) => s.textContent === 'fix',
      ) as HTMLElement,
    );
    await expect.poll(() => where()).toEqual(['main→origin:fix']);
    await userEvent.click(link('fix'));
    await editor();
    await userEvent.keyboard('{Control>}a{/Control}other{Escape}');
    expect(document.querySelector('.playground-push__field')).toBeNull();
    expect(where()).toEqual(['main→origin:fix']);
    // The dialog stays, with the focus back in its tree.
    expect(document.activeElement?.getAttribute('role')).toBe('tree');
    expect(document.querySelector('.cerebro-dialog')).not.toBeNull();
    // Not a branch name, or the same: nothing to ask.
    const asked = host.params('git.outgoing').length;
    for (const typed of ['fix.', 'fix']) {
      await userEvent.click(link('fix'));
      await editor();
      await userEvent.keyboard(`{Control>}a{/Control}${typed}{Enter}`);
    }
    expect(host.params('git.outgoing')).toHaveLength(asked);
  });

  it('sets the upstream when asked, as IntelliJ’s, with its label', async () => {
    git.outgoing = { ...git.outgoing, commits: [] };
    commands.execute('vcs.push');
    await dialog();
    expect((await pushButton()).disabled).toBe(true);
    await userEvent.click(link('main'));
    await editor();
    // Its own upstream: nothing to set.
    expect(document.querySelector('.playground-push__upstream')).toBeNull();
    await userEvent.keyboard('{Control>}a{/Control}fix');
    await userEvent.click(document.querySelector('.playground-push__upstream input') as Element);
    expect(document.activeElement).toBe(await editor());
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => texts('.playground-push__label')).toEqual(['Upstream']);
    // Nothing to send, but the upstream to set.
    expect((await pushButton()).disabled).toBe(false);
    await userEvent.click(link('fix'));
    await editor();
    await userEvent.keyboard('{Control>}a{/Control}brand-new{Enter}');
    await expect.poll(() => texts('.playground-push__label')).toEqual(['New & Upstream']);
    await press('Push');
    await expect
      .poll(() => host.params('git.push'))
      .toEqual([{ path: '/r', remote: 'origin', target: 'brand-new', setUpstream: true }]);
  });

  it('logs why it couldn’t read the branches, or what another target sends', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.branchesFail = true;
    git.outgoing = { ...git.outgoing, remotes: ['origin', 'gone'] };
    commands.execute('vcs.push');
    await dialog();
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith('Reading the branches failed', expect.any(Error));
    });
    await userEvent.click(link('origin'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith('Reading what to push failed', expect.any(Error));
    });
    expect(where()).toEqual(['main→origin:main']);
  });

  it('is in the Git menu, after Commit…, with IntelliJ’s Ctrl+Shift+K', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'vcs.push' }]);
    expect(keymap.shortcutsFor('vcs.push')).toEqual(['Ctrl+Shift+K']);
  });
});

describe('branch names, as IntelliJ’s GitRefNameValidator', () => {
  it('drops what git refuses as they’re typed, and makes spaces -', () => {
    expect(cleanUpBranchName('.a~b:c^d?e*f"g[h\\i@{j//k..l./m/.n o\u0001p')).toBe(
      'abcdefghij/k.l/m/n-o-p',
    );
  });

  it('takes a name git takes', () => {
    expect(isBranchName('feature/x')).toBe(true);
    for (const name of ['', 'a b', 'a.', 'a/', 'a.lock']) expect(isBranchName(name)).toBe(false);
  });
});

it('binds no shortcuts without a keymap', () => {
  const alone = new CommandRegistry();
  setupPush({ commands: alone, menus: new MenuRegistry() });
  expect(alone.get('vcs.push')).toBeDefined();
});
