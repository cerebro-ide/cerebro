import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { resetting, setupReset } from '../src/reset.js';
import { setupCommitEditing } from '../src/commit-editing.js';
import { closeAll, dialog, FakeHost, press, project } from './fakes.js';

/** What the host answers: its check, and what rewording waits on and fails with. */
const git = {
  check: { head: 'abc1234def5678' } as { head: string } | { refused: string },
  done: Promise.resolve(),
  failure: undefined as Error | undefined,
  /** Undo's answer: done, refused, or failed. */
  undo: null as { refused: string } | null | Error,
  /** HEAD's commit, as the Log reads it for Edit again. */
  head: [] as unknown[] | Error,
};
const host = new FakeHost({
  'git.editCheck': () => git.check,
  'git.reword': async () => {
    await git.done;
    if (git.failure) throw git.failure;
    return { commit: 'fedcba9876', head: 'aaaa1111' };
  },
  'git.drop': async () => {
    await git.done;
    if (git.failure) throw git.failure;
    return 'bbbb2222';
  },
  'git.log': () => {
    if (git.head instanceof Error) throw git.head;
    return git.head;
  },
  'git.undoEdit': async () => {
    await git.done;
    if (git.undo instanceof Error) throw git.undo;
    return git.undo;
  },
  'git.status': () => ({ files: [] }),
  'git.shelves': () => [],
  'git.stashes': () => [],
  'git.state': () => ({ conflicts: false }),
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

const commit = {
  hash: 'abc1234def5678',
  parents: ['0123456789abcd'],
  author: 'Ada',
  email: 'ada@example.com',
  time: 0,
  subject: 'Fix the thing',
  body: 'Why it was broken.\n',
  refs: [],
};
const read = vi.fn(() => Promise.resolve());
const select = vi.fn(() => Promise.resolve(true));
const context = (changed: Partial<typeof commit> = {}, head: string | null = commit.hash) => ({
  commit: { ...commit, ...changed },
  worktree: '/r',
  host,
  ...(head === null ? {} : { head }),
  refresh: read,
  select,
});
const reword = (changed: Partial<typeof commit> = {}) =>
  Promise.resolve(commands.get('log.reword')?.run(context(changed)));
const drop = (changed: Partial<typeof commit> = {}) =>
  Promise.resolve(commands.get('log.drop')?.run(context(changed)));
const last = () => notifications.all.get(0);
const field = (box: HTMLElement) => box.querySelector('textarea') as HTMLTextAreaElement;
const ok = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'OK',
  ) as HTMLButtonElement;

beforeAll(() => {
  useProjects([project('/r', host)]);
  setupReset(services);
  setupCommitEditing(services);
});

beforeEach(() => {
  git.check = { head: commit.hash };
  git.done = Promise.resolve();
  git.failure = undefined;
  git.undo = null;
  git.head = [];
  read.mockClear();
  select.mockClear();
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

describe('the Log’s Edit Commit Message…', () => {
  it('is after Undo Commit in the commit menu; a merge’s only at HEAD, as IntelliJ’s', () => {
    expect(commands.get('log.reword')).toMatchObject({
      label: 'Edit Commit Message',
      dialog: true,
    });
    expect(menus.entries('log/commit')).toEqual([
      { command: 'log.reset' },
      { command: 'log.undoCommit' },
      { command: 'log.reword' },
      { command: 'log.drop' },
    ]);
    expect(commands.isEnabled('log.reword', context())).toBe(true);
    expect(commands.isEnabled('log.reword', context({}, 'other'))).toBe(true);
    expect(commands.isEnabled('log.reword', context({ parents: [] }))).toBe(true);
    expect(commands.isEnabled('log.reword', context({ parents: ['a', 'b'] }))).toBe(true);
    expect(commands.isEnabled('log.reword', context({ parents: ['a', 'b'] }, 'other'))).toBe(false);
    expect(commands.isEnabled('log.reword')).toBe(false);
  });

  it('opens IntelliJ’s dialog, the message to edit, OK off while it’s blank', async () => {
    const done = reword();
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Edit Commit Message');
    expect(box.textContent).toContain('Edit message for commit abc1234d by Ada');
    expect(field(box).value).toBe('Fix the thing\n\nWhy it was broken.');
    expect(field(box).selectionStart).toBe(0);
    expect(document.activeElement).toBe(field(box));
    await userEvent.clear(field(box));
    await userEvent.type(field(box), '  ');
    expect(ok(box).disabled).toBe(true);
    await press('Cancel');
    await done;
    expect(host.params('git.reword')).toEqual([]);
    expect(host.params('git.editCheck')).toEqual([
      { path: '/r', hash: commit.hash, editing: 'reword', protected: ['main', 'master'] },
    ]);
  });

  it('gives the commit the message, Rewording… while it runs, and says so', async () => {
    let release: () => void = () => undefined;
    git.done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = reword({ body: '' });
    const box = await dialog();
    expect(field(box).value).toBe('Fix the thing');
    await userEvent.clear(field(box));
    await userEvent.type(field(box), 'Fix it{Enter}{Enter}Because.');
    await press('OK');
    await expect.poll(() => resetting.get()).toBe('Rewording…');
    expect(commands.isEnabled('log.reword', context())).toBe(false);
    release();
    await done;
    expect(resetting.get()).toBeUndefined();
    expect(host.params('git.reword')).toEqual([
      { path: '/r', hash: commit.hash, message: 'Fix it\n\nBecause.', head: commit.hash },
    ]);
    expect(last()?.title).toBe('Commit message changed');
    expect(read).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith('fedcba9876');
  });

  it('says why it can’t first, in an error dialog, doing nothing', async () => {
    git.check = { refused: 'The commit is not in the current branch' };
    const done = reword();
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Could not Edit Commit Message',
    );
    expect(box.textContent).toContain('The commit is not in the current branch');
    await press('OK');
    await done;
    host.answers['git.editCheck'] = () => {
      throw new Error('fatal: bad object');
    };
    const failed = reword();
    expect((await dialog()).textContent).toContain('fatal: bad object');
    await press('OK');
    await failed;
    host.answers['git.editCheck'] = () => git.check;
    expect(host.params('git.reword')).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  it('asks before the first commit, as IntelliJ', async () => {
    const done = reword({ parents: [] });
    let box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Editing Initial Commit');
    expect(box.textContent).toContain('Are you sure you want to edit the initial commit?');
    await press('Cancel');
    await done;
    const going = reword({ parents: [] });
    await dialog();
    await press('Continue');
    box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Edit Commit Message');
    await press('OK');
    await going;
    expect(host.params('git.reword')).toHaveLength(1);
  });

  it('says why it failed, and logs what fails reading again after', async () => {
    git.failure = new Error('HEAD moved during the commit editing operation');
    const done = reword();
    await dialog();
    await press('OK');
    await done;
    expect(last()).toMatchObject({
      title: 'Failed to reword',
      content: 'HEAD moved during the commit editing operation',
      type: 'error',
    });
    // Read again, nothing to select.
    expect(read).toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    read.mockRejectedValueOnce(new Error('gone'));
    const again = reword();
    await dialog();
    await press('OK');
    await again;
    expect(logged).toHaveBeenCalledWith(
      'Reading again after Edit Commit Message',
      new Error('gone'),
    );
  });
});

describe('the Log’s Drop Commit', () => {
  beforeEach(() => {
    localStorage.removeItem('cerebro.drop.ask');
  });

  it('is after Edit Commit Message, not for a merge, as IntelliJ’s', () => {
    expect(commands.get('log.drop')?.label).toBe('Drop Commit');
    expect(commands.isEnabled('log.drop', context())).toBe(true);
    expect(commands.isEnabled('log.drop', context({ parents: [] }))).toBe(true);
    expect(commands.isEnabled('log.drop', context({ parents: ['a', 'b'] }))).toBe(false);
    expect(commands.isEnabled('log.drop')).toBe(false);
  });

  it('asks first, in IntelliJ’s words, and drops it, Dropping commit… while it runs', async () => {
    let release: () => void = () => undefined;
    git.done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = drop({ subject: 'A subject longer than forty characters, to be cut' });
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Drop Commit');
    expect(box.querySelector('p')?.innerHTML).toBe(
      'Do you want to drop 1 commit from the <b>main</b> branch?',
    );
    await press('OK');
    await expect.poll(() => resetting.get()).toBe('Dropping commit…');
    expect(commands.isEnabled('log.drop', context())).toBe(false);
    release();
    await done;
    expect(resetting.get()).toBeUndefined();
    expect(host.params('git.editCheck').at(-1)).toMatchObject({ editing: 'drop' });
    expect(host.params('git.drop')).toEqual([{ path: '/r', hash: commit.hash, head: commit.hash }]);
    expect(last()).toMatchObject({
      title: 'Dropped 1 commit',
      content: '"A subject longer than forty character..."',
    });
    expect(read).toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it('does nothing when cancelled, and asks no more once told not to', async () => {
    const cancelled = drop();
    await dialog();
    await press('Cancel');
    await cancelled;
    expect(host.params('git.drop')).toEqual([]);
    const told = drop();
    const box = () => document.querySelector('.cerebro-dialog input[type=checkbox]');
    await expect.poll(box).not.toBeNull();
    await userEvent.click(box() as Element);
    await press('Cancel');
    await told;
    expect(host.params('git.drop')).toEqual([]);
    // Not asked.
    await drop();
    expect(host.params('git.drop')).toHaveLength(1);
  });

  it('names a detached HEAD, and asks when the storage fails', async () => {
    useProjects([project('/r', host, [{ id: '/r', branch: 'detached' }])]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const done = drop();
    const box = await dialog();
    expect(box.querySelector('p')?.textContent).toBe(
      'The repository is in the detached HEAD state. Do you want to drop 1 commit?',
    );
    await userEvent.click(box.querySelector('input[type=checkbox]') as Element);
    await press('OK');
    await done;
    expect(host.params('git.drop')).toHaveLength(1);
    useProjects([project('/r', host)]);
  });

  it('says why it can’t first, or why it failed, in git’s words', async () => {
    git.check = { refused: 'Cannot drop during merge' };
    const refused = drop();
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Could not Drop Commits');
    await press('OK');
    await refused;
    git.check = { head: commit.hash };
    git.failure = new Error('CONFLICT (content): Merge conflict in a.ts');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    read.mockRejectedValueOnce(new Error('gone'));
    const failed = drop();
    await dialog();
    await press('OK');
    await failed;
    expect(last()).toMatchObject({
      title: 'Could not Drop Commits',
      content: 'CONFLICT (content): Merge conflict in a.ts',
      type: 'error',
    });
    expect(logged).toHaveBeenCalledWith('Reading again after Drop Commit', new Error('gone'));
  });
});

describe('Undo, in the notification, as IntelliJ’s', () => {
  // Dropped without the question.
  beforeEach(() => {
    localStorage.setItem('cerebro.drop.ask', 'false');
  });
  const undo = (notification = last()) => {
    const action = notification?.actions.find((a) => a.label === 'Undo');
    action?.run();
  };

  it('puts HEAD back after a message edit, and the notification goes', async () => {
    const done = reword();
    await dialog();
    await press('OK');
    await done;
    const said = last();
    expect(said?.actions.map((a) => a.label)).toEqual(['Undo', 'Edit again']);
    read.mockClear();
    let release: () => void = () => undefined;
    git.done = new Promise<void>((resolve) => {
      release = resolve;
    });
    undo();
    await expect.poll(() => resetting.get()).toBe('Undoing reword…');
    release();
    await expect.poll(() => resetting.get()).toBeUndefined();
    expect(host.params('git.undoEdit').at(-1)).toEqual({
      path: '/r',
      before: commit.hash,
      after: 'aaaa1111',
      protected: expect.any(Array) as unknown,
    });
    expect(notifications.all.toArray()).not.toContain(said);
    await expect.poll(() => read.mock.calls.length).toBe(1);
  });

  it('says why it can’t, in IntelliJ’s words, and the notification goes', async () => {
    await drop();
    const said = last();
    git.undo = { refused: 'Repository has already been changed' };
    undo(said);
    await expect.poll(() => last()?.title).toBe('Cannot undo drop');
    expect(last()).toMatchObject({
      content: 'Repository has already been changed',
      type: 'error',
    });
    expect(host.params('git.undoEdit').at(-1)).toMatchObject({
      before: commit.hash,
      after: 'bbbb2222',
    });
    expect(notifications.all.toArray()).not.toContain(said);
  });

  it('says why it failed, in git’s words, and Undo stays', async () => {
    await drop();
    const said = last();
    git.undo = new Error('error: Entry two.txt not uptodate. Cannot merge.');
    undo(said);
    await expect.poll(() => last()?.title).toBe('Undo drop failed');
    expect(last()?.content).toBe('error: Entry two.txt not uptodate. Cannot merge.');
    expect(notifications.all.toArray()).toContain(said);
  });

  it('has Edit again for HEAD’s commit, which rewords HEAD’s commit as it is then', async () => {
    const done = reword();
    await dialog();
    await press('OK');
    await done;
    const said = last();
    expect(said?.actions.map((a) => a.label)).toEqual(['Undo', 'Edit again']);
    git.head = [{ ...commit, hash: 'aaaa1111', subject: 'Fixed', body: '' }];
    said?.actions[1]?.run();
    expect(notifications.all.toArray()).not.toContain(said);
    const box = await dialog();
    expect(box.textContent).toContain('Edit message for commit aaaa1111 by Ada');
    expect(field(box).value).toBe('Fixed');
    await press('OK');
    await expect.poll(() => host.params('git.reword').at(-1)).toMatchObject({ hash: 'aaaa1111' });
    expect(host.params('git.log').at(-1)).toEqual({
      worktree: '/r',
      skip: 0,
      max: 1,
      branches: ['HEAD'],
    });
  });

  it('has no Edit again for an older commit, and does nothing without HEAD’s commit', async () => {
    git.check = { head: 'ffff0000' };
    const done = reword();
    await dialog();
    await press('OK');
    await done;
    expect(last()?.actions.map((a) => a.label)).toEqual(['Undo']);
    // HEAD's commit, reworded; then none read, or the reading fails.
    git.check = { head: commit.hash };
    const again = reword();
    await dialog();
    await press('OK');
    await again;
    const said = last();
    const asked = host.params('git.reword').length;
    said?.actions[1]?.run();
    await expect.poll(() => host.params('git.log').length).toBeGreaterThan(0);
    const failed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.head = new Error('no HEAD');
    const next = reword();
    await dialog();
    await press('OK');
    await next;
    last()?.actions[1]?.run();
    await expect.poll(() => failed.mock.calls.length).toBe(1);
    expect(host.params('git.reword')).toHaveLength(asked + 1);
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });
});
