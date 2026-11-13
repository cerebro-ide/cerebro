import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { setupLog, type LogCommit } from '../src/git-log.js';
import { notifications } from '../src/notifications.js';
import {
  cleanUpBranchName,
  fetchingRemote,
  isBranchName,
  openPush,
  pushing,
  setupPush,
} from '../src/push.js';
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
  /** The tags a push made there. */
  tags: [] as string[],
  /** Held until it resolves: checking a remote's URL. */
  checking: undefined as Promise<void> | undefined,
  /** Why a push will be rejected: from where the remote's branch was fetched, and as it says. */
  local: null as unknown,
  remote: null as unknown,
  /** Held until it resolves: checking for a diverged remote. */
  diverging: undefined as Promise<void> | undefined,
  /** Held until it resolves: the Push dialog's Fetch; its error, if it fails. */
  fetching: undefined as Promise<void> | undefined,
  fetchFails: undefined as Error | undefined,
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
  'git.push': async ({ force }: { force?: boolean }) => {
    await git.hold;
    if (git.pushed instanceof Error) throw git.pushed;
    const { remote, target, isNew } = git.outgoing;
    return { commits: git.pushed, remote, target, isNew, forced: force === true, tags: git.tags };
  },
  'git.divergence': async ({ checkRemote }: { checkRemote: boolean }) => {
    await git.diverging;
    const divergence = checkRemote ? git.remote : git.local;
    if (divergence instanceof Error) throw divergence;
    return divergence;
  },
  'git.fetchTarget': async () => {
    await git.fetching;
    if (git.fetchFails) throw git.fetchFails;
    // Fetched: counted.
    git.local = git.remote = { kind: 'diverged', remoteCommits: 1, lease: 'theirs' };
  },
  'git.checkRemote': async ({ url }: { url: string }) => {
    await git.checking;
    if (url === 'bad') throw new Error('fatal: bad does not appear to be a git repository');
  },
  'git.addRemote': ({ name }: { name: string }) => {
    if (name === 'broken') throw new Error('error: could not lock config file');
    // There now: where the push goes by default.
    git.outgoing = { ...git.outgoing, remote: name, target: 'main', remotes: [name] };
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
  // The commits' files' toolbar acts through the Log's commands.
  setupLog(services, () => undefined);
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
  git.checking = undefined;
  git.tags = [];
  git.local = git.remote = null;
  git.diverging = git.fetching = git.fetchFails = undefined;
  localStorage.removeItem('cerebro.push.tags:/r');
  localStorage.removeItem('cerebro.push.silent:/r');
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
/** The newest dialog: Define Remote over Push. */
const newest = () =>
  [...document.querySelectorAll<HTMLElement>('.cerebro-dialog')].at(-1) as HTMLElement;
/** Define Remote's fields: the name and the URL. */
const fields = () => [
  ...document.querySelectorAll<HTMLInputElement>('.playground-form .cerebro-dialog-field__input'),
];
const errors = () => texts('.playground-form .cerebro-dialog-field__error');
const ok = () => newest().querySelector('.cerebro-dialog__button--primary') as HTMLButtonElement;
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
  [...document.querySelectorAll<HTMLElement>('.playground-link')].find(
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
    // A diff opens in the editor, and the Log in its window, behind the dialog: both are off here.
    const file = document.querySelector('.playground-push__files .cerebro-tree-row') as HTMLElement;
    await userEvent.click(file);
    for (const label of ['Show Diff', 'History Up to Here']) {
      expect(
        document.querySelector<HTMLButtonElement>(
          `.playground-push__files [aria-label^="${label}"]`,
        )?.disabled,
      ).toBe(true);
    }
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

  it('can’t push with nothing to send, or no branch', async () => {
    git.outgoing = { ...git.outgoing, commits: [] };
    commands.execute('vcs.push');
    expect((await pushButton()).disabled).toBe(true);
    await closeAll();
    for (const [outgoing, why] of [
      [{ branch: undefined, remote: undefined }, 'No branch is checked out'],
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
    await expect
      .poll(() => texts('.cerebro-popup-item__label'))
      .toEqual(['origin', 'second', 'Define remote']);
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

  it('defines a remote when there’s none, as IntelliJ’s, checking its URL first', async () => {
    git.outgoing = {
      ...git.outgoing,
      remote: undefined,
      target: undefined,
      commits: [],
      remotes: [],
      upstream: undefined,
    };
    commands.execute('vcs.push');
    await dialog();
    expect(where()).toEqual(['main→Define remote']);
    expect((await pushButton()).disabled).toBe(true);
    await userEvent.click(link('Define remote'));
    await expect
      .poll(() => newest().querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Define Remote');
    const [name, url] = fields();
    expect(name?.value).toBe('origin');
    // The URL first, as IntelliJ's; OK once there's one.
    await expect.poll(() => document.activeElement).toBe(url);
    expect(ok().disabled).toBe(true);
    await userEvent.fill(name as HTMLInputElement, 'a b');
    await userEvent.fill(url as HTMLInputElement, 'bad');
    expect(errors()).toEqual(['Remote name contains illegal characters', '']);
    expect(ok().disabled).toBe(true);
    // Blank: nothing to say, but no OK.
    await userEvent.fill(name as HTMLInputElement, ' ');
    expect(errors()).toEqual(['', '']);
    expect(ok().disabled).toBe(true);
    await userEvent.fill(name as HTMLInputElement, ' upstream ');
    expect(ok().disabled).toBe(false);
    // Checked on OK: git's words under the URL, and the dialog stays, with the URL focused.
    let answer!: () => void;
    git.checking = new Promise((resolve) => {
      answer = resolve;
    });
    await userEvent.click(ok());
    await expect.poll(() => url?.disabled).toBe(true);
    expect(name?.disabled).toBe(true);
    answer();
    await expect.poll(errors).toEqual(['', 'fatal: bad does not appear to be a git repository']);
    expect(url?.disabled).toBe(false);
    expect(document.activeElement).toBe(url);
    expect(host.params('git.checkRemote')).toEqual([{ path: '/r', url: 'bad' }]);
    expect(host.params('git.addRemote')).toEqual([]);
    // Typing again clears it.
    await userEvent.fill(url as HTMLInputElement, ' https://example.com/r.git ');
    expect(errors()).toEqual(['', '']);
    await userEvent.click(newest().querySelector('.playground-form__check input') as Element);
    await userEvent.click(ok());
    await expect.poll(() => where()).toEqual(['main→upstream:main']);
    expect(host.params('git.addRemote')).toEqual([
      { path: '/r', name: 'upstream', url: 'https://example.com/r.git', fetch: false },
    ]);
    // Asked again where it goes by default, and the branches there.
    expect(host.params('git.outgoing').at(-1)).toEqual({ path: '/r' });
    expect(host.params('git.branches')).toHaveLength(2);
    expect(document.querySelectorAll('.cerebro-dialog')).toHaveLength(1);
    // Back on the link: the dialog's keys work.
    expect(document.activeElement).toBe(link('upstream'));
  });

  it('defines a remote from the list of them, with a name not used, and says when it fails', async () => {
    git.outgoing = { ...git.outgoing, remotes: ['origin', 'second'] };
    commands.execute('vcs.push');
    await dialog();
    await userEvent.click(link('origin'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect.poll(() => fields()).toHaveLength(2);
    const [name, url] = fields();
    expect(errors()).toEqual(["Remote name 'origin' is already used", '']);
    await userEvent.fill(url as HTMLInputElement, 'u');
    expect(ok().disabled).toBe(true);
    // Cancelled: nothing added.
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => fields()).toHaveLength(0);
    await userEvent.click(link('origin'));
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect.poll(() => fields()).toHaveLength(2);
    await userEvent.fill(fields()[0] as HTMLInputElement, 'broken');
    await userEvent.fill(fields()[1] as HTMLInputElement, 'u');
    await userEvent.click(ok());
    // IntelliJ's words, with git's.
    await expect
      .poll(() => newest().textContent)
      .toContain('Could not add remote: error: could not lock config file');
    expect(newest().querySelector('.cerebro-dialog__title')?.textContent).toBe('Add Remote');
    expect(host.params('git.addRemote')).toEqual([
      { path: '/r', name: 'broken', url: 'u', fetch: true },
    ]);
    expect(name?.isConnected).toBe(false);
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

  it('pushes tags when asked, all or the branch’s, as IntelliJ’s, kept for next time', async () => {
    git.outgoing = { ...git.outgoing, commits: [] };
    git.pushed = 0;
    git.tags = ['v1'];
    commands.execute('vcs.push');
    await dialog();
    const box = () => document.querySelector('.playground-push__tags input') as HTMLInputElement;
    const mode = () => document.querySelector('.playground-push__tag-mode') as HTMLSelectElement;
    // Beside the buttons; off, and All to choose from.
    expect(document.querySelector('.cerebro-dialog__footer')?.textContent).toContain('Push tags:');
    expect(box().checked).toBe(false);
    expect(mode().disabled).toBe(true);
    expect(mode().value).toBe('all');
    expect((await pushButton()).disabled).toBe(true);
    // Tags alone can go.
    await userEvent.click(box());
    expect(mode().disabled).toBe(false);
    expect((await pushButton()).disabled).toBe(false);
    await userEvent.selectOptions(mode(), 'Current Branch');
    await press('Push');
    await expect.poll(() => last()?.title).toBe('Pushed tag v1 to origin');
    expect(host.params('git.push')).toEqual([
      { path: '/r', remote: 'origin', target: 'main', setUpstream: false, tags: 'follow' },
    ]);
    // As it was pushed with, next time; off again, nor sent.
    git.tags = [];
    git.outgoing = { ...git.outgoing, commits: [commit('One')] };
    commands.execute('vcs.push');
    await dialog();
    expect(box().checked).toBe(true);
    expect(mode().value).toBe('follow');
    await userEvent.click(box());
    await press('Push');
    await expect.poll(() => host.params('git.push')).toHaveLength(2);
    expect(host.params('git.push')[1]).toEqual({
      path: '/r',
      remote: 'origin',
      target: 'main',
      setUpstream: false,
    });
    expect(localStorage.getItem('cerebro.push.tags:/r')).toBeNull();
  });

  it('says the tags it pushed with the rest, in IntelliJ’s words', async () => {
    for (const [pushed, tags, isNew, title] of [
      [2, ['v1'], false, 'Pushed 2 commits to origin/main, and tag v1 to origin'],
      [1, ['v1', 'v2'], false, 'Pushed 1 commit to origin/main, and 2 tags to origin'],
      [0, ['v1', 'v2'], false, 'Pushed 2 tags to origin'],
      [1, ['v1'], true, 'Pushed main to new branch origin/main, and tag v1 to origin'],
    ] as const) {
      git.pushed = pushed;
      git.tags = [...tags];
      git.outgoing = { ...git.outgoing, isNew };
      commands.execute('vcs.push');
      await dialog();
      await press('Push');
      await expect.poll(() => last()?.title).toBe(title);
    }
  });

  it('starts with Push tags off when its storage can’t be read, and pushes when it can’t keep it', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    commands.execute('vcs.push');
    await dialog();
    const box = document.querySelector('.playground-push__tags input') as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await press('Push');
    await expect.poll(() => host.params('git.push')).toHaveLength(1);
  });

  describe('when the remote has diverged, as IntelliJ’s', () => {
    const banner = () =>
      document.querySelector('.playground-push__banner-text > span')?.textContent ?? '';
    const main = () =>
      document.querySelector<HTMLButtonElement>(
        '.cerebro-dialog__option-button > .cerebro-dialog__button--primary',
      ) as HTMLButtonElement;
    const arrow = () => document.querySelector('.cerebro-dialog__arrow') as HTMLButtonElement;
    /** OK's options, as its arrow lists them: label, disabled, and tooltip. */
    const options = async () => {
      await userEvent.click(arrow());
      const listed = [...document.querySelectorAll<HTMLElement>('.cerebro-dialog__option')].map(
        (o) => [o.textContent, o.getAttribute('aria-disabled'), o.title],
      );
      await userEvent.keyboard('{Escape}');
      return listed;
    };
    const forcePush = async () => {
      await userEvent.click(arrow());
      const option = [...document.querySelectorAll<HTMLElement>('.cerebro-dialog__option')].find(
        (o) => o.textContent === 'Force Push',
      ) as HTMLElement;
      await userEvent.click(option);
    };
    const toFeature = () => {
      git.outgoing = {
        ...git.outgoing,
        target: 'fix',
        upstream: { remote: 'origin', target: 'fix' },
      };
    };

    it('closes, to update the project, with the banner’s Update project…', async () => {
      git.remote = { kind: 'diverged', remoteCommits: 2, lease: 'theirs' };
      commands.execute('vcs.push');
      await expect.poll(banner).not.toBe('');
      await userEvent.click(link('Update project…'));
      // The Update Project dialog, in the Push dialog's place.
      await expect.poll(() => texts('.cerebro-dialog__title')).toEqual(['Update Project']);
      expect(host.params('git.push')).toEqual([]);
    });

    it('says so, and force pushes after asking, expecting the remote’s branch where it was seen', async () => {
      toFeature();
      git.remote = { kind: 'diverged', remoteCommits: 2, lease: 'theirs' };
      commands.execute('vcs.push');
      await expect
        .poll(banner)
        .toBe(
          "Push will be rejected, branch 'main' has diverged from the remote: 2 remote commits are not in your local branch. To keep them, update the project first. To replace them, use Force Push.",
        );
      // Where it was fetched first, then the remote, asked.
      expect(host.params('git.divergence')).toEqual([
        { path: '/r', remote: 'origin', target: 'fix', checkRemote: false },
        { path: '/r', remote: 'origin', target: 'fix', checkRemote: true },
      ]);
      // Push is the button's: Force Push is never.
      expect(main().textContent).toBe('Push');
      expect(await options()).toEqual([['Force Push', 'false', '']]);
      await forcePush();
      await expect
        .poll(() => newest().querySelector('.cerebro-dialog__title')?.textContent)
        .toBe('Force Push');
      expect(newest().querySelector('.playground-force p')?.textContent).toBe(
        "You're going to force push to 'fix'. It replaces 2 commits on the remote. Are you sure you want to proceed?",
      );
      // Cancelled: nothing pushed, and the Push dialog stays.
      await userEvent.keyboard('{Escape}');
      expect(document.querySelectorAll('.cerebro-dialog')).toHaveLength(1);
      expect(host.params('git.push')).toEqual([]);
      await forcePush();
      await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(2);
      await userEvent.click(newest().querySelector('.playground-force input') as HTMLElement);
      await userEvent.click(
        [...newest().querySelectorAll('.cerebro-dialog__button')].find(
          (b) => b.textContent === 'Force Push',
        ) as HTMLElement,
      );
      await expect
        .poll(() => host.params('git.push'))
        .toEqual([
          {
            path: '/r',
            remote: 'origin',
            target: 'fix',
            setUpstream: false,
            force: true,
            lease: 'theirs',
          },
        ]);
      await expect.poll(() => last()?.title).toBe('Force pushed main to origin/fix');
      // Not warned about that target again; and without a divergence, no lease: where it was
      // fetched, the host's.
      git.remote = null;
      commands.execute('vcs.push');
      await dialog();
      await forcePush();
      await expect.poll(() => host.params('git.push')).toHaveLength(2);
      expect(host.params('git.push')[1]).toEqual({
        path: '/r',
        remote: 'origin',
        target: 'fix',
        setUpstream: false,
        force: true,
      });
      expect(document.querySelector('.playground-force')).toBeNull();
    });

    it('says one commit, and asks without a count when there’s none', async () => {
      toFeature();
      git.remote = { kind: 'diverged', remoteCommits: 1, lease: 'theirs' };
      commands.execute('vcs.push');
      await expect
        .poll(banner)
        .toBe(
          "Push will be rejected, branch 'main' has diverged from the remote: 1 remote commit is not in your local branch. To keep it, update the project first. To replace it, use Force Push.",
        );
      await forcePush();
      await expect
        .poll(() => newest().querySelector('.playground-force p')?.textContent)
        .toBe(
          "You're going to force push to 'fix'. It replaces 1 commit on the remote. Are you sure you want to proceed?",
        );
      git.remote = null;
      await closeAll();
      // Stored wrong, the targets not to warn about are none.
      localStorage.setItem('cerebro.push.silent:/r', '{}');
      commands.execute('vcs.push');
      await dialog();
      await forcePush();
      await expect
        .poll(() => newest().querySelector('.playground-force p')?.textContent)
        .toBe(
          "You're going to force push to 'fix'. It may overwrite commits at the remote. Are you sure you want to proceed?",
        );
    });

    it('doesn’t force push to a protected branch', async () => {
      git.remote = { kind: 'diverged', remoteCommits: 2, lease: 'theirs' };
      commands.execute('vcs.push');
      await expect
        .poll(banner)
        .toMatch(
          /not in your local branch\. The target branch is protected, so update the project first\.$/,
        );
      expect(await options()).toEqual([
        ['Force Push', 'true', 'Force push to origin/main is prohibited'],
      ]);
    });

    it('fetches first when the remote’s commits aren’t fetched, and says when that fails', async () => {
      toFeature();
      git.remote = { kind: 'fetchRequired', lease: 'fetched' };
      commands.execute('vcs.push');
      await expect
        .poll(banner)
        .toBe(
          "Push will be rejected, branch 'main' has diverged from the remote, and there are unfetched remote commits. Fetch them to review them before a force push.",
        );
      // Fetch is the button's, and Push and Force Push wait for it.
      expect(main().textContent).toBe('Fetch');
      expect(main().title).toBe('Fetch the remote commits to review them before a push');
      const first = 'Fetch first. The remote has commits that are not fetched.';
      expect(await options()).toEqual([
        ['Push', 'true', first],
        ['Force Push', 'true', first],
      ]);
      let finish!: () => void;
      git.fetching = new Promise((resolve) => (finish = resolve));
      git.fetchFails = new Error('fatal: unable to access the remote');
      await userEvent.click(main());
      await expect.poll(() => fetchingRemote.get()).toBe(true);
      expect(main().disabled).toBe(true);
      finish();
      await expect.poll(() => fetchingRemote.get()).toBe(false);
      expect(host.params('git.fetchTarget')).toEqual([
        { path: '/r', remote: 'origin', target: 'fix' },
      ]);
      // Failed: the remote decides, as IntelliJ's.
      await expect
        .poll(banner)
        .toBe(
          "Push may be rejected, branch 'main' has diverged from the remote, and the fetch of the remote commits failed.",
        );
      expect(texts('.playground-push__fetch-error')).toEqual([
        'Fetch failed: fatal: unable to access the remote Retry',
      ]);
      expect(main().textContent).toBe('Push');
      expect(main().disabled).toBe(false);
      // Again, fetched: counted, and what's pushed read again.
      git.fetchFails = undefined;
      git.fetching = undefined;
      const reads = host.params('git.outgoing').length;
      await userEvent.click(link('Retry'));
      await expect.poll(banner).toMatch(/: 1 remote commit is not in your local branch\./);
      expect(host.params('git.outgoing')).toHaveLength(reads + 1);
      expect(texts('.playground-push__fetch-error')).toEqual([]);
    });

    it('says when a force push was rejected because the remote’s branch moved', async () => {
      toFeature();
      git.pushed = new Error('!\tHEAD:refs/heads/fix\t[rejected] (stale info)');
      commands.execute('vcs.push');
      await dialog();
      await forcePush();
      await userEvent.click(
        [...newest().querySelectorAll('.cerebro-dialog__button')].find(
          (b) => b.textContent === 'Force Push',
        ) as HTMLElement,
      );
      await expect.poll(last).toMatchObject({
        title: 'Push rejected',
        content: 'Force-with-lease push main to origin/fix was rejected',
        type: 'warning',
      });
    });

    it('doesn’t check a branch the push makes, and drops what was checked for another target', async () => {
      git.outgoing = { ...git.outgoing, isNew: true };
      commands.execute('vcs.push');
      await dialog();
      expect(host.params('git.divergence')).toEqual([]);
      await closeAll();
      git.outgoing = { ...git.outgoing, isNew: false };
      // Its answer comes after another target was chosen: not for that one.
      let finish!: () => void;
      git.diverging = new Promise((resolve) => (finish = resolve));
      git.local = { kind: 'diverged', remoteCommits: 2, lease: 'theirs' };
      commands.execute('vcs.push');
      await dialog();
      await userEvent.click(link('main'));
      await userEvent.keyboard('feature-x{Enter}');
      await expect.poll(() => where()).toEqual(['main→origin:feature-x']);
      git.local = null;
      finish();
      await expect.poll(() => host.params('git.divergence').length).toBeGreaterThanOrEqual(3);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(banner()).toBe('');
    });

    it('logs why it couldn’t check, and keeps no target when its storage can’t be written', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      git.local = new Error('git.divergence failed');
      commands.execute('vcs.push');
      await vi.waitFor(() => {
        expect(logged).toHaveBeenCalledWith('Checking the remote failed', expect.any(Error));
      });
      await closeAll();
      git.local = null;
      toFeature();
      // Not JSON: no targets not to warn about.
      localStorage.setItem('cerebro.push.silent:/r', '{');
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('full');
      });
      commands.execute('vcs.push');
      await dialog();
      await forcePush();
      await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(2);
      await userEvent.click(newest().querySelector('.playground-force input') as HTMLElement);
      await userEvent.click(
        [...newest().querySelectorAll('.cerebro-dialog__button')].find(
          (b) => b.textContent === 'Force Push',
        ) as HTMLElement,
      );
      await expect.poll(() => last()?.title).toBe('Force pushed main to origin/fix');
      expect(localStorage.getItem('cerebro.push.silent:/r')).toBe('{');
    });
  });

  it('is in the Git menu, after Commit…, with IntelliJ’s Ctrl+Shift+K', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'vcs.push' }]);
    expect(keymap.shortcutsFor('vcs.push')).toEqual(['Ctrl+Shift+K']);
  });
});

describe('Push All up to Here…, from the Log', () => {
  const upTo = commit('First', 'base');
  const context = { commit: upTo, worktree: '/r', host, refresh: () => Promise.resolve() };

  it('sits in the commit menu, as IntelliJ’s, for the commit right-clicked or selected', () => {
    expect(menus.entries('log/commit')).toContainEqual({ command: 'log.pushUpTo' });
    expect(commands.get('log.pushUpTo')).toMatchObject({
      label: 'Push All up to Here',
      dialog: true,
    });
    // No commit selected, with no Log shown.
    expect(commands.isEnabled('log.pushUpTo', { source: 'log' })).toBe(false);
    expect(commands.isEnabled('log.pushUpTo', context)).toBe(true);
    pushing.set(true);
    expect(commands.isEnabled('log.pushUpTo', context)).toBe(false);
    pushing.set(false);
  });

  it('opens the Push dialog for that commit and those before it, and pushes up to it', async () => {
    git.outgoing = { ...git.outgoing, commits: [upTo] };
    commands.execute('log.pushUpTo', context);
    await dialog();
    expect(texts('.playground-push__commit')).toEqual(['First']);
    expect(host.params('git.outgoing')).toEqual([{ path: '/r', upTo: upTo.hash }]);
    await press('Push');
    await expect
      .poll(() => host.params('git.push'))
      .toEqual([
        { path: '/r', remote: 'origin', target: 'main', setUpstream: false, upTo: upTo.hash },
      ]);
  });

  it('says why it can’t start, in IntelliJ’s words', async () => {
    git.outgoing = new Error('The commit is not in the current branch') as never;
    commands.execute('log.pushUpTo', context);
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe('Push Failed to Start');
    expect(shown.textContent).toContain('The commit is not in the current branch');
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
