import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { resetting, setupReset } from '../src/reset.js';
import { closeAll, dialog, FakeHost, press, project } from './fakes.js';

/** What a reset waits on, and fails with, if it does. */
const git = {
  done: Promise.resolve(),
  failure: undefined as Error | undefined,
};
const host = new FakeHost({
  'git.validRevision': (params: { revision: string }) => params.revision === 'HEAD~1',
  'git.reset': async () => {
    await git.done;
    if (git.failure) throw git.failure;
    return null;
  },
  'git.status': () => ({ files: [] }),
  'git.shelves': () => [],
  'git.stashes': () => [],
  'git.state': () => ({ conflicts: false }),
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupReset(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.done = Promise.resolve();
  git.failure = undefined;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const last = () => notifications.all.get(0);
const commitField = (box: HTMLElement) =>
  [...box.querySelectorAll('.playground-form__row')]
    .find((row) => row.querySelector('span')?.textContent === 'To Commit:')
    ?.querySelector('input') as HTMLInputElement;
const button = (box: HTMLElement, label: string) =>
  [...box.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const opened = async () => {
  commands.execute('git.reset');
  return dialog();
};

describe('Git → Reset HEAD…', () => {
  it('sits in the Git menu, for a worktree with a host', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'git.reset' }]);
    expect(commands.get('git.reset')?.label).toBe('Reset HEAD');
    expect(commands.isEnabled('git.reset')).toBe(true);
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('git.reset')).toBe(false);
  });

  it('opens IntelliJ’s Reset Head dialog, Mixed to HEAD by default', async () => {
    const box = await opened();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Reset Head');
    expect(
      [...box.querySelectorAll('.playground-form__row > span:first-child')].map(
        (s) => s.textContent,
      ),
    ).toEqual(['Current Branch:', 'Reset Type:', 'To Commit:']);
    expect([...box.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Mixed',
      'Soft',
      'Hard',
    ]);
    await press('Reset');
    await expect.poll(() => host.params('git.reset')).toEqual([{ path: '/r', mode: 'mixed' }]);
  });

  it('resets to the commit with the type chosen, Resetting HEAD… while it runs', async () => {
    let finish!: () => void;
    git.done = new Promise((resolve) => {
      finish = resolve;
    });
    const box = await opened();
    await userEvent.selectOptions(box.querySelector('select') as HTMLSelectElement, 'Hard');
    await userEvent.type(commitField(box), ' HEAD~1 ');
    await press('Reset');
    await expect.poll(() => resetting.get()).toBe('Resetting HEAD…');
    expect(commands.isEnabled('git.reset')).toBe(false);
    finish();
    await expect.poll(() => resetting.get()).toBeUndefined();
    expect(host.params('git.reset')).toEqual([{ path: '/r', mode: 'hard', commit: 'HEAD~1' }]);
  });

  it('turns Reset off while the commit is the one that failed validation', async () => {
    const box = await opened();
    const error = () => box.querySelector('.playground-form__error')?.textContent;
    await userEvent.type(commitField(box), 'nope');
    await userEvent.click(button(box, 'Validate'));
    await expect.poll(error).toBe('The specified commit expression did not pass validation.');
    expect(button(box, 'Reset').disabled).toBe(true);
    await userEvent.type(commitField(box), 's');
    expect(error()).toBe('');
    expect(button(box, 'Reset').disabled).toBe(false);
  });

  it('says why a reset failed, in git’s words; nothing when cancelled', async () => {
    git.failure = new Error('fatal: ambiguous argument');
    await opened();
    await press('Reset');
    await expect.poll(() => last()?.title).toBe('Resetting HEAD…');
    expect(last()).toMatchObject({ content: 'fatal: ambiguous argument', type: 'error' });
    await opened();
    await press('Cancel');
    expect(host.params('git.reset')).toHaveLength(1);
  });

  it('logs what fails reading the lists again after', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shelves = host.answers['git.shelves'];
    host.answers['git.shelves'] = () => {
      throw new Error('gone');
    };
    await opened();
    await press('Reset');
    await expect
      .poll(() => logged.mock.calls.some(([text]) => text === 'Reading again after Reset HEAD'))
      .toBe(true);
    host.answers['git.shelves'] = shelves as NonNullable<typeof shelves>;
  });
});

describe('the Log’s Reset Current Branch to Here…', () => {
  const commit = {
    hash: 'abc1234def5678',
    parents: [],
    author: 'Ada Lovelace',
    email: 'ada@example.com',
    time: 0,
    subject: 'A subject longer than forty characters, cut short',
    body: '',
    refs: [],
  };
  const read = vi.fn(() => Promise.resolve());
  const context = (head?: string) => ({
    commit,
    worktree: '/r',
    host,
    ...(head === undefined ? {} : { head }),
    refresh: read,
  });
  const modes = (box: HTMLElement) =>
    [...box.querySelectorAll('.playground-reset__mode')].map((mode) => ({
      name: mode.querySelector('label')?.textContent,
      checked: mode.querySelector('input')?.checked,
      comment: mode.querySelector('.playground-reset__comment')?.textContent,
    }));
  const choose = async (box: HTMLElement, name: string) => {
    const label = [...box.querySelectorAll('.playground-reset__mode label')].find(
      (l) => l.textContent === name,
    );
    await userEvent.click(label as HTMLElement);
  };

  beforeEach(() => {
    localStorage.clear();
    read.mockClear();
  });

  it('is first in the commit menu’s Git group, before New Tag…', () => {
    expect(menus.entries('log/commit')).toEqual([{ command: 'log.reset' }]);
    expect(commands.get('log.reset')).toMatchObject({
      label: 'Reset Current Branch to Here',
      dialog: true,
    });
  });

  it('opens IntelliJ’s Git Reset dialog: the branch, the commit, and its four modes, Mixed first chosen', async () => {
    commands.execute('log.reset', context());
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Git Reset');
    const [target, description] = [...box.querySelectorAll('.playground-reset > p')];
    expect(target?.textContent).toBe(
      'main -> abc1234d "A subject longer than forty characters,…" by Ada Lovelace',
    );
    expect(description?.textContent).toBe(
      'This will reset the current branch head to the selected commit,' +
        'and update the working tree and the index according to the selected mode:',
    );
    expect(modes(box)).toEqual([
      {
        name: 'Soft',
        checked: false,
        comment: "Files won't change, differences will be staged for commit.",
      },
      { name: 'Mixed', checked: true, comment: "Files won't change, differences won't be staged." },
      {
        name: 'Hard',
        checked: false,
        comment:
          'Files will be reverted to the state of the selected commit.' +
          'Warning: any local changes will be lost.',
      },
      {
        name: 'Keep',
        checked: false,
        comment:
          'Files will be reverted to the state of the selected commit,' +
          'but local changes will be kept intact.',
      },
    ]);
    await press('Cancel');
    expect(host.params('git.reset')).toEqual([]);
  });

  it('resets the branch to the commit, Git Reset while it runs, says so, and keeps the mode for next time', async () => {
    let finish!: () => void;
    git.done = new Promise((resolve) => {
      finish = resolve;
    });
    commands.execute('log.reset', context());
    const box = await dialog();
    await choose(box, 'Keep');
    await press('Reset');
    await expect.poll(() => resetting.get()).toBe('Git Reset');
    expect(commands.isEnabled('log.reset', context())).toBe(false);
    expect(commands.isEnabled('git.reset')).toBe(false);
    finish();
    await expect.poll(() => resetting.get()).toBeUndefined();
    expect(host.params('git.reset')).toEqual([
      { path: '/r', mode: 'keep', commit: 'abc1234def5678' },
    ]);
    await expect.poll(() => last()?.title).toBe('Reset successful');
    await expect.poll(() => read.mock.calls.length).toBe(1);
    // Kept: Keep chosen the next time.
    commands.execute('log.reset', context());
    expect(modes(await dialog()).find((m) => m.checked)?.name).toBe('Keep');
  });

  it('names HEAD with its hash when it’s detached, or alone when it isn’t loaded', async () => {
    useProjects([project('/r', host, [{ id: '/r', branch: 'detached' }])]);
    commands.execute('log.reset', context('fedcba9876543210'));
    const target = async () =>
      (await dialog()).querySelector('.playground-reset > p')?.textContent ?? '';
    expect(await target()).toMatch(/^HEAD \(fedcba98\) -> /);
    await press('Cancel');
    commands.execute('log.reset', context());
    expect(await target()).toMatch(/^HEAD -> /);
    await press('Cancel');
    useProjects([project('/r', host), project('/s', undefined)]);
  });

  it('says why a reset failed, in git’s words, and reads the Log again', async () => {
    git.failure = new Error("error: Entry 'a.txt' not uptodate. Cannot merge.");
    commands.execute('log.reset', context());
    await dialog();
    await press('Reset');
    await expect.poll(() => last()?.title).toBe('Reset failed');
    expect(last()).toMatchObject({
      content: "error: Entry 'a.txt' not uptodate. Cannot merge.",
      type: 'error',
    });
    await expect.poll(() => read.mock.calls.length).toBe(1);
  });

  it('logs what fails reading again after, and starts at Mixed when the storage fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    read.mockRejectedValueOnce(new Error('gone'));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('no storage');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('no storage');
    });
    commands.execute('log.reset', context());
    const box = await dialog();
    expect(modes(box).find((m) => m.checked)?.name).toBe('Mixed');
    await choose(box, 'Soft');
    await press('Reset');
    await expect
      .poll(() => logged.mock.calls.some(([text]) => text === 'Reading again after Git Reset'))
      .toBe(true);
    expect(host.params('git.reset')).toEqual([
      { path: '/r', mode: 'soft', commit: 'abc1234def5678' },
    ]);
  });
});
