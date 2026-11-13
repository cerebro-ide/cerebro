import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { resetting, setupReset } from '../src/reset.js';
import { setupReword } from '../src/reword.js';
import { closeAll, dialog, FakeHost, press, project } from './fakes.js';

/** What the host answers: its check, and what rewording waits on and fails with. */
const git = {
  check: { head: 'abc1234def5678' } as { head: string } | { refused: string },
  done: Promise.resolve(),
  failure: undefined as Error | undefined,
};
const host = new FakeHost({
  'git.rewordCheck': () => git.check,
  'git.reword': async () => {
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
const context = (changed: Partial<typeof commit> = {}, head: string | null = commit.hash) => ({
  commit: { ...commit, ...changed },
  worktree: '/r',
  host,
  ...(head === null ? {} : { head }),
  refresh: read,
});
const reword = (changed: Partial<typeof commit> = {}) =>
  Promise.resolve(commands.get('log.reword')?.run(context(changed)));
const last = () => notifications.all.get(0);
const field = (box: HTMLElement) => box.querySelector('textarea') as HTMLTextAreaElement;
const ok = (box: HTMLElement) =>
  [...box.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'OK',
  ) as HTMLButtonElement;

beforeAll(() => {
  useProjects([project('/r', host)]);
  setupReset(services);
  setupReword(services);
});

beforeEach(() => {
  git.check = { head: commit.hash };
  git.done = Promise.resolve();
  git.failure = undefined;
  read.mockClear();
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
    expect(host.params('git.rewordCheck')).toEqual([
      { path: '/r', hash: commit.hash, protected: ['main', 'master'] },
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
    host.answers['git.rewordCheck'] = () => {
      throw new Error('fatal: bad object');
    };
    const failed = reword();
    expect((await dialog()).textContent).toContain('fatal: bad object');
    await press('OK');
    await failed;
    host.answers['git.rewordCheck'] = () => git.check;
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
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    read.mockRejectedValueOnce(new Error('gone'));
    const done = reword();
    await dialog();
    await press('OK');
    await done;
    expect(last()).toMatchObject({
      title: 'Failed to reword',
      content: 'HEAD moved during the commit editing operation',
      type: 'error',
    });
    expect(logged).toHaveBeenCalledWith(
      'Reading again after Edit Commit Message',
      new Error('gone'),
    );
  });
});
