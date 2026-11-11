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
    await expect.poll(() => resetting.get()).toBe(true);
    expect(commands.isEnabled('git.reset')).toBe(false);
    finish();
    await expect.poll(() => resetting.get()).toBe(false);
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
