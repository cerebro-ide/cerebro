import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { setupTag } from '../src/tag.js';
import { closeAll, dialog, FakeHost, press, project } from './fakes.js';

/** The repository as the host sees it. */
const git = {
  tags: ['v1'] as string[] | Error,
  valid: ['HEAD~1'],
  /** What making the tag fails with, if it does. */
  failure: undefined as Error | undefined,
};
const host = new FakeHost({
  'git.tags': () => {
    if (git.tags instanceof Error) throw git.tags;
    return git.tags;
  },
  'git.validRevision': (params: { revision: string }) => git.valid.includes(params.revision),
  'git.createTag': () => {
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
  setupTag(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  git.tags = ['v1'];
  git.failure = undefined;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const last = () => notifications.all.get(0);
/** The open dialog's field, by its label. */
const field = (box: HTMLElement, label: string) =>
  [...box.querySelectorAll('.playground-form__row')]
    .find((row) => row.querySelector('span')?.textContent === label)
    ?.querySelector('input, textarea') as HTMLInputElement;
const button = (box: HTMLElement, label: string) =>
  [...box.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
const opened = async () => {
  commands.execute('git.newTag');
  return dialog();
};

describe('Git → New Tag…', () => {
  it('sits after New Branch… in the Git menu, for a worktree with a host', () => {
    expect(menus.entries('main/git')).toEqual([{ command: 'git.newTag' }]);
    expect(commands.get('git.newTag')?.label).toBe('New Tag');
    expect(commands.isEnabled('git.newTag')).toBe(true);
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('git.newTag')).toBe(false);
  });

  it('opens IntelliJ’s Tag dialog, the name focused, and makes a lightweight tag of HEAD', async () => {
    const box = await opened();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Tag');
    expect(
      [...box.querySelectorAll('.playground-form__row > span:first-child')].map(
        (s) => s.textContent,
      ),
    ).toEqual(['Current Branch:', 'Tag Name:', 'Commit:', 'Message:']);
    expect(box.querySelector('.playground-form__row')?.textContent).toBe('Current Branch:main');
    const create = button(box, 'Create Tag');
    expect(create.disabled).toBe(true);
    await expect.poll(() => document.activeElement).toBe(field(box, 'Tag Name:'));
    await userEvent.keyboard('v2');
    expect(create.disabled).toBe(false);
    await press('Create Tag');
    await expect
      .poll(() => host.params('git.createTag'))
      .toEqual([{ path: '/r', name: 'v2', force: false }]);
    await expect.poll(() => last()?.title).toBe('v2');
    expect(last()?.content).toBe('Created tag v2 successfully.');
  });

  it('takes a tag that exists only with Force, which is off otherwise', async () => {
    const box = await opened();
    const force = box.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
    const error = () => box.querySelector('.playground-form__error')?.textContent;
    expect(force.disabled).toBe(true);
    await userEvent.type(field(box, 'Tag Name:'), 'v1');
    expect(error()).toBe('The tag with the same name exists.');
    expect(button(box, 'Create Tag').disabled).toBe(true);
    expect(force.disabled).toBe(false);
    await userEvent.click(force);
    expect(error()).toBe('');
    // Another name: Force goes off, as IntelliJ's.
    await userEvent.type(field(box, 'Tag Name:'), '0');
    expect(force.checked).toBe(false);
    await userEvent.keyboard('{Backspace}');
    expect(error()).toBe('The tag with the same name exists.');
    await userEvent.click(force);
    await press('Create Tag');
    await expect
      .poll(() => host.params('git.createTag'))
      .toEqual([{ path: '/r', name: 'v1', force: true }]);
  });

  it('validates the commit, and makes an annotated tag of it with the message', async () => {
    const box = await opened();
    const validate = button(box, 'Validate');
    const error = () => box.querySelector('.playground-form__error')?.textContent;
    expect(validate.disabled).toBe(true);
    await userEvent.type(field(box, 'Tag Name:'), 'v0');
    await userEvent.type(field(box, 'Commit:'), 'nope');
    await userEvent.click(validate);
    await expect.poll(error).toBe('The commit or object name is invalid.');
    expect(button(box, 'Create Tag').disabled).toBe(true);
    // Invalid only while it's the text validated.
    await userEvent.clear(field(box, 'Commit:'));
    await userEvent.type(field(box, 'Commit:'), ' HEAD~1 ');
    expect(error()).toBe('');
    await userEvent.click(validate);
    await expect
      .poll(() => host.params('git.validRevision').at(-1))
      .toEqual({
        path: '/r',
        revision: 'HEAD~1',
      });
    expect(error()).toBe('');
    await userEvent.type(field(box, 'Message:'), 'The first');
    await press('Create Tag');
    await expect
      .poll(() => host.params('git.createTag'))
      .toEqual([{ path: '/r', name: 'v0', commit: 'HEAD~1', message: 'The first', force: false }]);
  });

  it('makes a lightweight tag when the message is only spaces', async () => {
    const box = await opened();
    await userEvent.type(field(box, 'Tag Name:'), 'v3');
    await userEvent.type(field(box, 'Message:'), '   ');
    await press('Create Tag');
    await expect
      .poll(() => host.params('git.createTag'))
      .toEqual([{ path: '/r', name: 'v3', force: false }]);
  });

  it('says why a tag couldn’t be made, in git’s words', async () => {
    git.failure = new Error("fatal: 'a b' is not a valid tag name.");
    const box = await opened();
    await userEvent.type(field(box, 'Tag Name:'), 'a b');
    await press('Create Tag');
    await expect.poll(() => last()?.title).toBe('Could not create tag');
    expect(last()).toMatchObject({
      content: "fatal: 'a b' is not a valid tag name.",
      type: 'error',
    });
  });

  it('says when the tags couldn’t be read, and opens no dialog', async () => {
    git.tags = new Error('fatal: not a git repository');
    commands.execute('git.newTag');
    await expect.poll(() => last()?.title).toBe('Getting Existing Tags…');
    expect(last()?.content).toBe('fatal: not a git repository');
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('logs what fails reading the lists again after', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const shelves = host.answers['git.shelves'];
    host.answers['git.shelves'] = () => {
      throw new Error('gone');
    };
    const box = await opened();
    await userEvent.type(field(box, 'Tag Name:'), 'v4');
    await press('Create Tag');
    await expect
      .poll(() => logged.mock.calls.some(([text]) => text === 'Reading again after New Tag'))
      .toBe(true);
    host.answers['git.shelves'] = shelves as NonNullable<typeof shelves>;
  });

  it('shows no active branch when HEAD is detached; a failed validation is logged', async () => {
    useProjects([project('/r', host, [{ id: '/r', branch: undefined as unknown as string }])]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    host.answers['git.validRevision'] = () => {
      throw new Error('gone');
    };
    const box = await opened();
    expect(box.querySelector('.playground-form__row')?.textContent).toBe(
      'Current Branch:<no active branch>',
    );
    await userEvent.type(field(box, 'Commit:'), 'x');
    await userEvent.click(button(box, 'Validate'));
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Validating the commit to tag failed');
  });
});
