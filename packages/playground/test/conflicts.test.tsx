import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  describe as described,
  leftText,
  paneTitles,
  resolveConflicts,
  resolving,
  setupConflicts,
  unprocessedText,
  type Conflicts,
} from '../src/conflicts.js';
import { useProjects, workspace } from '../src/environments.js';
import { closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

describe('the Conflicts dialog’s words', () => {
  const files = [{ path: 'a.ts', yours: 'modified', theirs: 'modified' }] as Conflicts['files'];

  it('says what’s being merged, as IntelliJ’s', () => {
    expect(described({ operation: 'merge', files, yours: 'main', theirs: 'origin/main' })).toBe(
      'Merging branch origin/main into branch main',
    );
    expect(described({ operation: 'merge', files, theirs: 'feature' })).toBe(
      'Merging branch feature',
    );
    expect(
      described({
        operation: 'rebase',
        files,
        yours: 'feature',
        theirs: 'main',
        onto: 'abc1234',
        commit: { hash: 'def5678', author: 'Ido', message: 'Mine' },
      }),
    ).toBe(
      'Rebasing branch feature onto branch main, revision abc1234. Current commit def5678 made by Ido:\nMine',
    );
    expect(described({ operation: 'rebase', files, theirs: 'main' })).toBe(
      'Rebasing onto branch main',
    );
    expect(described({ operation: 'rebase', files, onto: 'abc1234' })).toBe(
      'Rebasing onto abc1234',
    );
    expect(described({ operation: 'rebase', files })).toBe('Rebasing onto ');
    expect(described({ files })).toBe('The following file has conflicts:');
    expect(described({ files: [...files, ...files] })).toBe('The following files have conflicts:');
  });

  it('titles the merge window’s sides, as IntelliJ’s', () => {
    expect(paneTitles({ operation: 'merge', files, yours: 'main', theirs: 'origin/main' })).toEqual(
      ['Changes from main', 'Changes from origin/main'],
    );
    expect(paneTitles({ operation: 'merge', files })).toEqual([
      'Changes from HEAD',
      'Changes from ',
    ]);
    expect(
      paneTitles({
        operation: 'rebase',
        files,
        yours: 'feature',
        theirs: 'main',
        commit: { hash: 'def5678', author: 'Ido', message: 'Mine' },
      }),
    ).toEqual(['Rebasing def5678 from feature', 'Already rebased commits and commits from main']);
    expect(paneTitles({ operation: 'rebase', files })).toEqual([
      'Rebasing  from HEAD',
      'Already rebased commits',
    ]);
    expect(paneTitles({ files })).toEqual(['Your version', 'Changes from server']);
  });

  it('counts what’s left, and asks about it, as IntelliJ’s', () => {
    expect(leftText({ changes: 0, conflicts: 1 })).toBe('No changes, 1 conflict');
    expect(leftText({ changes: 2, conflicts: 0 })).toBe('2 changes, No conflicts');
    expect(unprocessedText({ changes: 0, conflicts: 1 })).toBe(
      'There is one conflict left unprocessed.',
    );
    expect(unprocessedText({ changes: 0, conflicts: 2 })).toBe(
      'There are 2 conflicts left unprocessed.',
    );
    expect(unprocessedText({ changes: 1, conflicts: 2 })).toBe(
      'There is one change and 2 conflicts left unprocessed.',
    );
    expect(unprocessedText({ changes: 3, conflicts: 0 })).toBe(
      'There are 3 changes left unprocessed.',
    );
  });
});

/** The files in conflict, as the host lists them: those resolved are taken out. */
const state = {
  files: [] as Conflicts['files'],
  revisions: {} as unknown,
  fail: undefined as Error | undefined,
};
const resolve = (paths: readonly string[]) => {
  state.files = state.files.filter((f) => !paths.includes(f.path));
};
const host = new FakeHost({
  'git.conflicts': () => ({
    operation: 'merge',
    yours: 'main',
    theirs: 'origin/main',
    files: state.files,
  }),
  'git.acceptSide': (p: { files: string[] }) => {
    if (state.fail) throw state.fail;
    resolve(p.files);
    return null;
  },
  'git.resolve': (p: { file: string }) => {
    resolve([p.file]);
    return null;
  },
  'git.mergeRevisions': () => state.revisions,
});
const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupConflicts(services);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  state.files = [
    { path: 'a.ts', yours: 'modified', theirs: 'modified' },
    { path: 'src/b.ts', yours: 'deleted', theirs: 'modified' },
    { path: 'src/c.ts', yours: 'modified', theirs: 'deleted' },
  ];
  // Changes a line apart: two, neither in conflict.
  state.revisions = { binary: false, base: 'a\nb\nc\n', yours: 'A\nb\nc\n', theirs: 'a\nb\nC\n' };
  state.fail = undefined;
});

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  vi.restoreAllMocks();
});

const rows = async () =>
  [...(await dialog()).querySelectorAll('.playground-conflicts__row')].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => cell.textContent),
  );
const row = async (name: string) =>
  [...(await dialog()).querySelectorAll<HTMLElement>('.playground-conflicts__row')].find((r) =>
    r.textContent.includes(name),
  ) as HTMLElement;
const selectedRows = () =>
  [...document.querySelectorAll('.playground-conflicts__row[aria-selected="true"]')].map(
    (r) => r.querySelector('td')?.textContent,
  );
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
    (b) => b.textContent === label,
  ) as HTMLButtonElement;
/** Clicks a button of the dialog given, by its label. */
const pressIn = async (dialog: Element, label: string) => {
  await userEvent.click(
    [...dialog.querySelectorAll<HTMLElement>('.cerebro-dialog__button')].find(
      (b) => b.textContent === label,
    ) as HTMLElement,
  );
};
/** The merge window, over the Conflicts dialog. */
const mergeWindow = async () => {
  await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(2);
  await expect.poll(() => document.querySelector('.cerebro-editor-merge')).not.toBeNull();
  return document.querySelectorAll('.cerebro-dialog')[1] as HTMLElement;
};

describe('the Conflicts dialog', () => {
  it('lists the files and what each side did, under what’s being merged', async () => {
    const done = resolveConflicts('/r');
    expect(await dialogText()).toContain('Merging branch origin/main into branch main');
    const heads = [...(await dialog()).querySelectorAll('th')].map((th) => th.textContent);
    expect(heads).toEqual(['Name', 'Yours (main)', 'Theirs (origin/main)']);
    expect(await rows()).toEqual([
      ['a.ts', 'Modified', 'Modified'],
      ['b.tssrc', 'Deleted', 'Modified'],
      ['c.tssrc', 'Modified', 'Deleted'],
    ]);
    expect(selectedRows()).toEqual(['a.ts']);
    expect(resolving.get()).toBe(true);
    await press('Close');
    expect(await done).toBe(false);
    expect(resolving.get()).toBe(false);
  });

  it('says what it’s told to over the list instead', async () => {
    void resolveConflicts('/r', 'Merge conflicts detected. Resolve them before continuing update.');
    expect(await dialogText()).toContain(
      'Merge conflicts detected. Resolve them before continuing update.',
    );
  });

  it('accepts a side for the files selected, and closes once none is left', async () => {
    const done = resolveConflicts('/r');
    await userEvent.click(await row('a.ts'));
    await userEvent.click(await row('c.ts'), { modifiers: ['Control'] } as never);
    await expect.poll(selectedRows).toEqual(['a.ts', 'c.tssrc']);
    await userEvent.click(button('Accept Theirs'));
    await expect.poll(rows).toEqual([['b.tssrc', 'Deleted', 'Modified']]);
    expect(host.params('git.acceptSide')).toEqual([
      { path: '/r', files: ['a.ts', 'src/c.ts'], side: 'theirs' },
    ]);
    // What's still there is selected.
    expect(selectedRows()).toEqual(['b.tssrc']);
    await userEvent.click(button('Accept Yours'));
    expect(await done).toBe(true);
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('selects with Shift, Control again, and the arrow keys', async () => {
    void resolveConflicts('/r');
    await userEvent.click(await row('a.ts'));
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(await row('c.ts'));
    await userEvent.keyboard('{/Shift}');
    expect(selectedRows()).toEqual(['a.ts', 'b.tssrc', 'c.tssrc']);
    await userEvent.keyboard('{Control>}');
    await userEvent.click(await row('b.ts'));
    await userEvent.keyboard('{/Control}');
    expect(selectedRows()).toEqual(['a.ts', 'c.tssrc']);
    await userEvent.keyboard('{ArrowUp}');
    expect(selectedRows()).toEqual(['b.tssrc']);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(selectedRows()).toEqual(['a.ts']);
    await userEvent.keyboard('{ArrowDown}');
    expect(selectedRows()).toEqual(['b.tssrc']);
    await userEvent.keyboard('x');
    expect(selectedRows()).toEqual(['b.tssrc']);
    // Nothing selected, nothing to act on.
    await userEvent.keyboard('{Control>}');
    await userEvent.click(await row('b.ts'));
    await userEvent.keyboard('{/Control}');
    expect(button('Merge…').disabled).toBe(true);
    await userEvent.keyboard('{ArrowDown}');
    expect(selectedRows()).toEqual(['a.ts']);
  });

  it('says why a side couldn’t be accepted', async () => {
    state.fail = new Error('index locked');
    void resolveConflicts('/r');
    await dialog();
    await userEvent.click(button('Accept Yours'));
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(2);
    expect(document.querySelectorAll('.cerebro-dialog')[1]?.textContent).toContain(
      'Cannot Resolve Conflict',
    );
    expect(document.querySelectorAll('.cerebro-dialog')[1]?.textContent).toContain('index locked');
  });

  it('merges a file in IntelliJ’s merge window, its result applied', async () => {
    void resolveConflicts('/r');
    await userEvent.dblClick(await row('a.ts'));
    const window = await mergeWindow();
    expect(window.querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Merge Revisions for /r/a.ts',
    );
    expect(
      [...window.querySelectorAll('.playground-merge__titles span')].map((t) => t.textContent),
    ).toEqual(['Changes from main', 'Result', 'Changes from origin/main']);
    expect(window.querySelector('.playground-merge__left')?.textContent).toBe(
      '2 changes, No conflicts',
    );
    // With changes left, Apply asks first; Continue Merge goes back to it.
    await pressIn(window, 'Apply');
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(3);
    const question = document.querySelectorAll('.cerebro-dialog')[2] as HTMLElement;
    expect(question.textContent).toContain(
      'There are 2 changes left unprocessed.Save changes and mark the conflict resolved anyway?',
    );
    await pressIn(question, 'Continue Merge');
    // Both taken, it's all processed, and Apply applies.
    const all = [...window.querySelectorAll<HTMLElement>('.playground-merge__toolbar button')];
    expect(all.map((b) => b.textContent)).toEqual(['Left', 'All', 'Right']);
    await userEvent.click(all[1] as HTMLElement);
    expect(window.querySelector('.playground-merge__left')?.textContent).toBe(
      'All changes have been processed',
    );
    await pressIn(window, 'Apply');
    await expect
      .poll(() => host.params('git.resolve'))
      .toEqual([{ path: '/r', file: 'a.ts', text: 'A\nb\nC\n' }]);
    await expect.poll(rows).toHaveLength(2);
  });

  it('applies with changes left once told to, and takes a side with Accept Left or Right', async () => {
    void resolveConflicts('/r');
    await dialog();
    await userEvent.click(button('Merge…'));
    let window = await mergeWindow();
    await userEvent.click(
      [
        ...window.querySelectorAll<HTMLElement>('.playground-merge__toolbar button'),
      ][0] as HTMLElement,
    );
    await pressIn(window, 'Apply');
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(3);
    await pressIn(document.querySelectorAll('.cerebro-dialog')[2] as HTMLElement, 'Apply Changes');
    await expect
      .poll(() => host.params('git.resolve'))
      .toEqual([{ path: '/r', file: 'a.ts', text: 'A\nb\nc\n' }]);
    await expect.poll(rows).toHaveLength(2);
    // Accept Left: yours, as Accept Yours. Here yours deleted it, and theirs too: no text.
    state.revisions = { binary: false, base: 'a\n' };
    await userEvent.click(await row('b.ts'));
    await userEvent.click(button('Merge…'));
    window = await mergeWindow();
    await pressIn(window, 'Accept Left');
    await expect
      .poll(() => host.params('git.acceptSide'))
      .toEqual([{ path: '/r', files: ['src/b.ts'], side: 'yours' }]);
    await userEvent.click(button('Merge…'));
    window = await mergeWindow();
    await pressIn(window, 'Accept Right');
    await expect.poll(() => document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('stops merging the files selected at the first cancelled', async () => {
    void resolveConflicts('/r');
    await userEvent.click(await row('a.ts'));
    await userEvent.click(await row('c.ts'), { modifiers: ['Shift'] } as never);
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(await row('c.ts'));
    await userEvent.keyboard('{/Shift}');
    await userEvent.click(button('Merge…'));
    const window = await mergeWindow();
    await pressIn(window, 'Cancel');
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(1);
    expect(host.params('git.mergeRevisions')).toHaveLength(1);
    expect(await rows()).toHaveLength(3);
  });

  it('says a binary file can’t be merged here', async () => {
    state.revisions = { binary: true };
    void resolveConflicts('/r');
    await dialog();
    await userEvent.click(button('Merge…'));
    await expect.poll(() => document.querySelectorAll('.cerebro-dialog')).toHaveLength(2);
    expect(document.querySelectorAll('.cerebro-dialog')[1]?.textContent).toContain(
      'a.ts is binary: accept yours or theirs for it.',
    );
  });

  it('shows nothing when no file is in conflict, nor without a host, nor while one shows', async () => {
    state.files = [];
    expect(await resolveConflicts('/r')).toBe(true);
    expect(await resolveConflicts('/s')).toBe(false);
    state.files = [{ path: 'a.ts', yours: 'modified', theirs: 'modified' }];
    void resolveConflicts('/r');
    await dialog();
    expect(await resolveConflicts('/r')).toBe(false);
    expect(document.querySelectorAll('.cerebro-dialog')).toHaveLength(1);
  });
});

describe('Resolve Conflicts…', () => {
  it('is in the Git menu, and shows the dialog for the active worktree', async () => {
    expect(JSON.stringify(menus.entries('main/git'))).toContain('vcs.resolveConflicts');
    expect(commands.isEnabled('vcs.resolveConflicts')).toBe(true);
    commands.execute('vcs.resolveConflicts');
    await dialog();
    expect(commands.isEnabled('vcs.resolveConflicts')).toBe(false);
    await press('Close');
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(commands.isEnabled('vcs.resolveConflicts')).toBe(false);
  });

  it('says why it couldn’t list them', async () => {
    const failing = new FakeHost({});
    useProjects([project('/r', host), project('/t', failing)]);
    workspace.openOrActivate({ id: '/t', name: 't', branch: 'main' });
    commands.execute('vcs.resolveConflicts');
    expect(await dialogText()).toContain('No answer for git.conflicts');
    useProjects([project('/r', host), project('/s', undefined)]);
  });
});
