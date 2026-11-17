import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupCommitEditing } from '../src/commit-editing.js';
import { rebaseDialog } from '../src/interactive-rebase.js';
import { useProjects } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { setupReset } from '../src/reset.js';
import { dialog, FakeHost, project } from './fakes.js';

const commits = [
  { hash: 'aaaa1111', subject: 'One', message: 'One\n\nIts body' },
  { hash: 'bbbb2222', subject: 'Two', message: 'Two' },
  { hash: 'cccc3333', subject: 'fixup! One', message: 'fixup! One' },
];
const git = {
  check: { head: 'cccc3333' } as { head: string } | { refused: string },
  commits: commits as unknown[] | Error,
  result: 'done' as string | Error,
};
const host = new FakeHost({
  'git.editCheck': () => git.check,
  'git.rebaseCommits': () => {
    if (git.commits instanceof Error) throw git.commits;
    return git.commits;
  },
  'git.interactiveRebase': () => {
    if (git.result instanceof Error) throw git.result;
    return git.result;
  },
  'git.conflicts': () => ({ files: [], yours: 'main' }),
  'git.continue': () => 'done',
  'git.status': () => ({ files: [] }),
  'git.shelves': () => [],
  'git.stashes': () => [],
  'git.state': () => ({ conflicts: false }),
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
const commit = {
  hash: 'aaaa1111',
  parents: ['0000aaaa'],
  author: 'Ada',
  email: 'ada@example.com',
  time: 0,
  subject: 'One',
  body: 'Its body\n',
  refs: [],
};
const context = (changed: Partial<typeof commit> = {}) => ({
  commit: { ...commit, ...changed },
  worktree: '/r',
  host,
  head: 'cccc3333',
  refresh: () => Promise.resolve(),
  select: () => Promise.resolve(true),
});
const rebase = () => Promise.resolve(commands.get('log.interactiveRebase')?.run(context()));
/** The dialog on top: a question over the rebase's. */
const top = () => [...document.querySelectorAll<HTMLElement>('.cerebro-dialog')].at(-1);
/** Each row as `a:pick`: its commit's first letter and its action, from its class. */
const rows = () =>
  [...document.querySelectorAll<HTMLElement>('.playground-rebase__row')].map((row) => {
    const type = [...row.classList].find((c) => /__row--(?!head)/.test(c)) as string;
    return `${(row.dataset['hash'] as string).slice(0, 1)}:${type.split('--')[1] as string}`;
  });
const subjects = () =>
  [...document.querySelectorAll('.playground-rebase__subject')].map((td) => td.textContent);
const row = (hash: string) =>
  document.querySelector(`.playground-rebase__row[data-hash="${hash}"]`) as HTMLElement;
const button = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      '.playground-rebase__toolbar button, .cerebro-dialog__options li',
    ),
  ].find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLElement;
const table = () => document.querySelector('.playground-rebase__table') as HTMLElement;
/** Clicks a button of the dialog on top, by its label. */
const pressTop = async (label: string) => {
  const found = [...(top()?.querySelectorAll('.cerebro-dialog__button') ?? [])].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`No button ${label}`);
  await userEvent.click(found);
};
/** Opens the dialog; gives the rebase's end, wrapped so it isn't waited for. */
const opened = async () => {
  const done = rebase();
  await dialog();
  await expect.poll(() => rows().length).toBe(3);
  return [done] as const;
};
/** Cancels the dialog, discarding what's changed. */
const cancel = async () => {
  await pressTop('Cancel');
  if (top()?.textContent.includes('Discard changes')) await pressTop('Discard');
  await expect.poll(() => document.querySelector('.cerebro-dialog')).toBeNull();
};

beforeAll(() => {
  useProjects([project('/r', host)]);
  setupReset(services);
  setupCommitEditing(services);
});

beforeEach(() => {
  git.check = { head: 'cccc3333' };
  git.commits = commits;
  git.result = 'done';
  host.asked.length = 0;
});

afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('.cerebro-dialog'); i++) await cancel();
});

describe('the Log’s Interactively Rebase from Here…, as IntelliJ’s', () => {
  it('is after Drop Commit in the commit menu, for any commit of the branch, a merge too', () => {
    expect(commands.get('log.interactiveRebase')).toMatchObject({
      label: 'Interactively Rebase from Here',
      dialog: true,
    });
    expect(menus.entries('log/commit').at(-1)).toEqual({ command: 'log.interactiveRebase' });
    expect(commands.isEnabled('log.interactiveRebase', context({ parents: ['a', 'b'] }))).toBe(
      true,
    );
    expect(commands.isEnabled('log.interactiveRebase')).toBe(false);
  });

  it('says why it can’t start, in IntelliJ’s words', async () => {
    git.check = { refused: 'Cannot rebase during rebase' };
    const done = rebase();
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Cannot Start Rebase');
    await pressTop('OK');
    await done;
    expect(host.params('git.rebaseCommits')).toEqual([]);
    // The commits not read: a notification.
    git.check = { head: 'cccc3333' };
    git.commits = new Error('bad object');
    await rebase();
    expect(notifications.all.get(0)).toMatchObject({
      title: 'Cannot Start Rebase',
      content: 'bad object',
    });
  });

  it('lists the commits oldest first, picked, the first selected; IntelliJ’s title and OK', async () => {
    const [done] = await opened();
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Rebasing Commits');
    expect(subjects()).toEqual(['One', 'Two', 'fixup! One']);
    expect(rows()).toEqual(['a:pick', 'b:pick', 'c:pick']);
    expect(row('aaaa1111').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.playground-rebase__row--head')).toBe(row('cccc3333'));
    expect(document.querySelector('.playground-rebase__reset')).toBeNull();
    expect(host.params('git.rebaseCommits')).toEqual([{ path: '/r', hash: 'aaaa1111' }]);
    await cancel();
    await done;
    // Unchanged, cancelled without asking: nothing done.
    expect(host.params('git.interactiveRebase')).toEqual([]);
  });

  it('picks, stops to edit and drops the rows selected, by its buttons and Alt keys', async () => {
    const [done] = await opened();
    await userEvent.click(button('Stop to Edit'));
    expect(rows()).toEqual(['a:edit', 'b:pick', 'c:pick']);
    expect(row('aaaa1111').querySelector('.playground-rebase__node--edit')).not.toBeNull();
    await userEvent.keyboard('{Control>}');
    await userEvent.click(row('bbbb2222'));
    await userEvent.keyboard('{/Control}');
    expect(row('bbbb2222').getAttribute('aria-selected')).toBe('true');
    table().focus();
    await userEvent.keyboard('{Alt>}d{/Alt}');
    expect(rows()).toEqual(['a:drop', 'b:drop', 'c:pick']);
    expect((button('Drop') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Alt>}p{/Alt}');
    expect(rows()).toEqual(['a:pick', 'b:pick', 'c:pick']);
    // Shift and the arrows select; Delete drops.
    await userEvent.click(row('cccc3333'));
    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await userEvent.keyboard('{ArrowDown}{Delete}');
    expect(rows()).toEqual(['a:pick', 'b:pick', 'c:drop']);
    expect(document.querySelector('.playground-rebase__reset')).not.toBeNull();
    await cancel();
    await done;
  });

  it('moves the rows selected up and down, by its buttons and Alt with the arrows', async () => {
    const [done] = await opened();
    expect((button('Move Up') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button('Move Down'));
    expect(subjects()).toEqual(['Two', 'One', 'fixup! One']);
    table().focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(subjects()).toEqual(['Two', 'fixup! One', 'One']);
    expect((button('Move Down') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(subjects()).toEqual(['Two', 'One', 'fixup! One']);
    expect(row('aaaa1111').getAttribute('aria-selected')).toBe('true');
    // Reset: as it was, the link gone.
    await userEvent.click(document.querySelector('.playground-rebase__reset') as HTMLElement);
    expect(subjects()).toEqual(['One', 'Two', 'fixup! One']);
    expect(document.querySelector('.playground-rebase__reset')).toBeNull();
    await cancel();
    await done;
  });

  it('asks before the list’s changes are lost: Continue Rebasing keeps it open', async () => {
    const [done] = await opened();
    await userEvent.click(button('Stop to Edit'));
    await pressTop('Cancel');
    await expect
      .poll(() => top()?.querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Cancel Rebase');
    expect(top()?.textContent).toContain('Discard changes and cancel rebase?');
    await pressTop('Continue Rebasing');
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog').length).toBe(1);
    expect(rows()).toEqual(['a:edit', 'b:pick', 'c:pick']);
    await cancel();
    await done;
  });

  it('rewords a row in place: Ctrl+Enter applies, OK off meanwhile; its own message picks it', async () => {
    const [done] = await opened();
    await userEvent.click(row('bbbb2222'));
    await userEvent.click(button('Reword'));
    const field = row('bbbb2222').querySelector('textarea') as HTMLTextAreaElement;
    await expect.poll(() => document.activeElement).toBe(field);
    expect(field.value).toBe('Two');
    expect(row('bbbb2222').textContent).toContain('Press Ctrl+Enter to apply changes');
    const start = [...document.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
      (b) => b.textContent === 'Start Rebasing',
    ) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await userEvent.keyboard('{Control>}{End}{/Control} better{Enter}why');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(rows()).toEqual(['a:pick', 'b:reword', 'c:pick']);
    expect(subjects()).toEqual(['One', 'Two better', 'fixup! One']);
    expect(start.disabled).toBe(false);
    // Back to its own message: picked.
    table().focus();
    await userEvent.keyboard('{Alt>}r{/Alt}');
    const again = row('bbbb2222').querySelector('textarea') as HTMLTextAreaElement;
    expect(again.value).toBe('Two better\nwhy');
    await userEvent.clear(again);
    await userEvent.type(again, 'Two');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(rows()).toEqual(['a:pick', 'b:pick', 'c:pick']);
    await cancel();
    await done;
  });

  it('asks before a message typed is lost: Escape, then Keep Editing or Cancel Reword', async () => {
    const [done] = await opened();
    await userEvent.keyboard('{Alt>}r{/Alt}');
    const field = row('aaaa1111').querySelector('textarea') as HTMLTextAreaElement;
    await expect.poll(() => document.activeElement).toBe(field);
    // Unchanged: no question.
    await userEvent.keyboard('{Escape}');
    expect(row('aaaa1111').querySelector('textarea')).toBeNull();
    expect(document.querySelectorAll('.cerebro-dialog')).toHaveLength(1);
    table().focus();
    await userEvent.keyboard('{Alt>}r{/Alt}');
    await userEvent.type(row('aaaa1111').querySelector('textarea') as HTMLElement, 'X');
    await userEvent.keyboard('{Escape}');
    await expect
      .poll(() => top()?.querySelector('.cerebro-dialog__title')?.textContent)
      .toBe('Cancel Reword');
    expect(top()?.textContent).toContain('Entered commit message will be lost');
    await pressTop('Keep Editing');
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog').length).toBe(1);
    expect(row('aaaa1111').querySelector('textarea')).not.toBeNull();
    (row('aaaa1111').querySelector('textarea') as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => top()?.textContent).toContain('Entered commit message');
    await pressTop('Cancel Reword');
    await expect.poll(() => row('aaaa1111').querySelector('textarea')).toBeNull();
    expect(rows()).toEqual(['a:pick', 'b:pick', 'c:pick']);
    // A press on another row applies an edit.
    table().focus();
    await userEvent.keyboard('{Alt>}r{/Alt}');
    await userEvent.type(row('aaaa1111').querySelector('textarea') as HTMLElement, 'X');
    await userEvent.click(row('cccc3333'));
    expect(rows()).toEqual(['a:reword', 'b:pick', 'c:pick']);
    await cancel();
    await done;
  });

  it('squashes the rows selected, editing the messages put together; fixes up from its arrow', async () => {
    const [done] = await opened();
    await userEvent.keyboard('{Control>}');
    await userEvent.click(row('cccc3333'));
    await userEvent.keyboard('{/Control}');
    await userEvent.click(button('Squash'));
    expect(rows()).toEqual(['a:reword', 'c:fixup', 'b:pick']);
    const field = row('aaaa1111').querySelector('textarea') as HTMLTextAreaElement;
    // The fixup! subject taken off: its commit's among them.
    expect(field.value).toBe('One\n\nIts body');
    expect(row('aaaa1111').querySelector('.playground-rebase__node--double')).not.toBeNull();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    // Two onto the group, by the arrow's Fixup: the root's message as it is.
    await userEvent.click(row('bbbb2222'));
    await userEvent.click(
      document.querySelector('.playground-rebase__toolbar .cerebro-dialog__arrow') as HTMLElement,
    );
    await userEvent.click(button('Fixup'));
    expect(rows()).toEqual(['a:pick', 'c:fixup', 'b:fixup']);
    // Squash one row onto the kept row above: Two moved out, then squashed back.
    await userEvent.click(row('bbbb2222'));
    await userEvent.keyboard('{Alt>}p{/Alt}');
    expect(rows()).toEqual(['a:pick', 'c:fixup', 'b:pick']);
    await userEvent.keyboard('{Alt>}s{/Alt}');
    const squashed = row('aaaa1111').querySelector('textarea') as HTMLTextAreaElement;
    expect(squashed.value).toBe('One\n\nIts body\n\n\nTwo');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(rows()).toEqual(['a:reword', 'c:fixup', 'b:fixup']);
    await cancel();
    await done;
  });

  it('starts the rebase with the list, as git’s to take; says it’s done', async () => {
    const [done] = await opened();
    await userEvent.click(row('bbbb2222'));
    await userEvent.click(button('Drop'));
    await pressTop('Start Rebasing');
    await done;
    expect(host.params('git.interactiveRebase')).toEqual([
      {
        path: '/r',
        hash: 'aaaa1111',
        expected: ['aaaa1111', 'bbbb2222', 'cccc3333'],
        entries: [
          { action: 'pick', hash: 'aaaa1111' },
          { action: 'drop', hash: 'bbbb2222' },
          { action: 'pick', hash: 'cccc3333' },
        ],
      },
    ]);
    expect(notifications.all.get(0)).toMatchObject({ title: 'Rebase successful' });
  });

  it('goes on at conflicts as any rebase; stopped to edit, says so with Continue and Abort', async () => {
    git.result = 'conflicts';
    let [done] = await opened();
    await pressTop('Start Rebasing');
    await done;
    // No conflicts left: continued, as Continue Rebase.
    expect(host.params('git.continue')).toEqual([{ path: '/r' }]);
    expect(notifications.all.get(0)).toMatchObject({
      title: 'Rebase successful',
      content: 'Rebased main',
    });
    git.result = 'editing';
    [done] = await opened();
    await pressTop('Start Rebasing');
    await done;
    const stopped = notifications.all.get(0);
    expect(stopped).toMatchObject({ title: 'Rebase stopped for editing', type: 'warning' });
    expect(stopped?.actions.map((a) => a.label)).toEqual(['Continue', 'Abort']);
    git.result = new Error('could not apply');
    [done] = await opened();
    await pressTop('Start Rebasing');
    await done;
    expect(notifications.all.get(0)).toMatchObject({
      title: 'Rebase failed',
      content: 'could not apply',
    });
  });

  it('names each tool and its key, as IntelliJ’s toolbar', async () => {
    const [done] = await opened();
    const tip = () => document.querySelector('.cerebro-tooltip')?.textContent;
    await userEvent.click(row('bbbb2222'));
    for (const [label, text] of [
      ['Move Up', 'Move UpAlt+Up'],
      ['Drop', 'DropAlt+D'],
    ] as const) {
      await userEvent.hover(button(label));
      await expect.poll(tip).toBe(text);
      await userEvent.unhover(button(label));
    }
    await cancel();
    await done;
  });

  it('selects as a table: Ctrl takes a row out, Shift a range from the first selected', async () => {
    const [done] = await opened();
    await userEvent.keyboard('{Control>}');
    await userEvent.click(row('aaaa1111'));
    await userEvent.keyboard('{/Control}');
    const chosen = () =>
      ['aaaa1111', 'bbbb2222', 'cccc3333'].filter(
        (h) => row(h).getAttribute('aria-selected') === 'true',
      );
    expect(chosen()).toEqual([]);
    // None selected: Shift selects the row alone, then the range from it.
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(row('cccc3333'));
    expect(chosen()).toEqual(['cccc3333']);
    await userEvent.click(row('aaaa1111'));
    await userEvent.keyboard('{/Shift}');
    expect(chosen()).toEqual(['aaaa1111', 'bbbb2222', 'cccc3333']);
    await cancel();
    await done;
  });

  it('says it’s rebased without a branch’s name when detached; Continue and Abort go on', async () => {
    useProjects([project('/r', host, [{ id: '/r', branch: 'detached' }])]);
    try {
      let [done] = await opened();
      await pressTop('Start Rebasing');
      await done;
      expect(notifications.all.get(0)).toMatchObject({ content: 'Rebased' });
      git.result = 'editing';
      [done] = await opened();
      await pressTop('Start Rebasing');
      await done;
      const [go, stop] = notifications.all.get(0)?.actions ?? [];
      go?.run();
      await expect.poll(() => host.params('git.continue').length).toBe(1);
      host.answers['git.abort'] = () => undefined;
      stop?.run();
      await dialog();
      await pressTop('Abort');
      await expect
        .poll(() => host.params('git.abort'))
        .toEqual([{ path: '/r', operation: 'rebase' }]);
    } finally {
      useProjects([project('/r', host)]);
    }
  });
});

describe('the Interactive Rebase dialog on macOS', () => {
  it('names Cmd+Enter to apply a message', async () => {
    const result = rebaseDialog(commits, 'mac');
    await dialog();
    await userEvent.keyboard('{Alt>}r{/Alt}');
    await expect.poll(() => row('aaaa1111').textContent).toContain('Press ⌘↩ to apply changes');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await cancel();
    expect(await result).toBeUndefined();
  });
});
