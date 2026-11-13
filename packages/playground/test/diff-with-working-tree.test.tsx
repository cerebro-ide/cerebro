import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffTab } from '../src/changes.js';
import {
  DiffWithWorkingTree,
  setupDiffWithWorkingTree,
  showDiffWithWorkingTree,
} from '../src/diff-with-working-tree.js';
import { setupLog } from '../src/git-log.js';
import { closeAll, dialog, FakeHost, press } from './fakes.js';

/** The files each ref differs in from the working tree, as `git.changes` is asked for them. */
const differing: Record<string, unknown> = {
  feature: [
    { path: 'a.ts', status: 'modified' },
    { path: 'b.ts', status: 'added' },
    { path: 'c.ts', status: 'deleted' },
    { path: 'd.ts', status: 'renamed', from: 'old.ts' },
  ],
  same: [],
  gone: new Error("fatal: bad revision 'gone'"),
};
/** The working tree's own changes, as `git.changes` gives them without `from`. */
let local: { path: string; status: string }[] = [];
let getting: Error | undefined;
const host = new FakeHost({
  'git.changes': ({ from }: { from?: string }) => {
    if (from === undefined) return local;
    const answer = differing[from];
    if (answer instanceof Error) throw answer;
    return answer;
  },
  'git.getFrom': () => {
    if (getting) throw getting;
    return null;
  },
});
const reveal = vi.fn();
const services: MenuServices = {
  commands: new CommandRegistry(),
  menus: new MenuRegistry(),
  keymap: new Keymap('other'),
};
setupDiffWithWorkingTree(services, reveal);
setupLog(services, () => undefined);
const opened: [Tab, readonly string[] | undefined][] = [];

let dispose: (() => void) | undefined;
afterEach(async () => {
  await closeAll();
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
  host.asked.length = 0;
  local = [];
  getting = undefined;
});

function mount() {
  const box = document.createElement('div');
  box.style.height = '400px';
  document.body.append(box);
  const handle = render(
    () => (
      <DiffWithWorkingTree services={services} open={(tab, chain) => opened.push([tab, chain])} />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
}

const show = (ref: string) => {
  showDiffWithWorkingTree({ host, worktree: '/r', ref, current: 'main' });
};
const text = (selector: string) => document.querySelector(selector)?.textContent;

describe('Show Diff with Working Tree’s window', () => {
  it('says nothing is compared before anything is', () => {
    mount();
    expect(text('.playground-project__empty')).toBe('Nothing compared');
  });

  it('lists the files that differ, in IntelliJ’s words, each opening its diff', async () => {
    mount();
    show('feature');
    expect(reveal).toHaveBeenCalled();
    expect(text('.playground-compare__explanation')).toBe(
      'Difference between current working tree on main and files in feature:',
    );
    await expect
      .poll(() => [...document.querySelectorAll('.cerebro-tree-row')].map((r) => r.textContent))
      .toEqual([
        expect.stringContaining('a.ts'),
        expect.stringContaining('b.ts'),
        expect.stringContaining('c.ts'),
        expect.stringContaining('d.ts'),
      ]);
    expect(host.params('git.changes').at(-1)).toEqual({ path: '/r', from: 'feature' });
    await userEvent.dblClick(document.querySelector('.cerebro-tree-row') as HTMLElement);
    expect(opened).toEqual([
      [diffTab('a.ts', { from: 'feature' }), ['a.ts', 'b.ts', 'c.ts', 'd.ts']],
    ]); // Against the working tree: no commit to show the file's history up to.
    expect(
      (document.querySelector('[aria-label="History Up to Here"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('says when none differ, or why they can’t be read; each comparison in place of the last', async () => {
    mount();
    show('same');
    await expect
      .poll(() => text('.playground-working-tree-diff .playground-project__empty'))
      .toBe('No differences');
    show('gone');
    await expect
      .poll(() => text('.playground-working-tree-diff .playground-project__empty'))
      .toBe("fatal: bad revision 'gone'");
    expect(document.querySelectorAll('.playground-working-tree-diff')).toHaveLength(1);
    // The same again: read again.
    const asked = host.params('git.changes').length;
    show('gone');
    await expect.poll(() => host.params('git.changes').length).toBe(asked + 1);
  });

  /** The row of `path`, once the list shows it. */
  const fileRow = async (path: string) => {
    await expect
      .poll(() => document.querySelector(`.cerebro-tree-row[data-key="${path}"]`))
      .not.toBeNull();
    return document.querySelector(`.cerebro-tree-row[data-key="${path}"]`) as HTMLElement;
  };
  const getButton = () =>
    document.querySelector('[aria-label="Get from Branch"]') as HTMLButtonElement;
  const asked = () => host.params('git.getFrom');

  it('gets the selected file as the branch has it, from the toolbar or its menu, as IntelliJ’s', async () => {
    mount();
    show('feature');
    const reads = () => host.params('git.changes').filter((p) => (p as { from?: string }).from);
    await userEvent.click(await fileRow('a.ts'));
    const before = reads().length;
    await userEvent.click(getButton());
    await expect
      .poll(asked)
      .toEqual([{ path: '/r', ref: 'feature', checkout: ['a.ts'], remove: [] }]);
    // Read again after.
    await expect.poll(() => reads().length).toBe(before + 1);
    // Not in the branch: removed. Deleted here: back. Renamed: the branch's name back.
    for (const path of ['b.ts', 'c.ts', 'd.ts']) {
      await userEvent.click(await fileRow(path), { button: 'right' });
      await userEvent.click(document.querySelector('.cerebro-menu-item__label') as HTMLElement);
      await expect.poll(() => asked().length).toBe(['b.ts', 'c.ts', 'd.ts'].indexOf(path) + 2);
    }
    expect(asked().slice(1)).toEqual([
      { path: '/r', ref: 'feature', checkout: [], remove: ['b.ts'] },
      { path: '/r', ref: 'feature', checkout: ['c.ts'], remove: [] },
      { path: '/r', ref: 'feature', checkout: ['old.ts'], remove: ['d.ts'] },
    ]);
  });

  it('has no menu on a folder’s row, only on a file’s', async () => {
    differing.inFolders = [{ path: 'src/a.ts', status: 'modified' }];
    mount();
    show('inFolders');
    await userEvent.click(await fileRow('folder:src/'), { button: 'right' });
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    expect(asked()).toEqual([]);
  });

  it('is off with no file selected', async () => {
    mount();
    show('feature');
    await fileRow('a.ts');
    expect(getButton().disabled).toBe(true);
    await services.commands.get('vcsChanges.getFromBranch')?.run(undefined);
    expect(asked()).toEqual([]);
  });

  it('asks first when the file has local changes, which would be lost', async () => {
    local = [{ path: 'a.ts', status: 'modified' }];
    mount();
    show('feature');
    await userEvent.click(await fileRow('a.ts'));
    await userEvent.click(getButton());
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe(
      "Get from Branch 'feature'",
    );
    expect(box.querySelector('p')?.textContent).toBe('File a.ts has been locally modified.');
    await press('Cancel');
    expect(asked()).toEqual([]);
    await userEvent.click(getButton());
    await dialog();
    await press('Overwrite Modified File');
    await expect.poll(() => asked().length).toBe(1);
  });

  it('says why it couldn’t, in IntelliJ’s error dialog', async () => {
    getting = new Error('fatal: could not write a.ts');
    mount();
    show('feature');
    await userEvent.click(await fileRow('a.ts'));
    await userEvent.click(getButton());
    const box = await dialog();
    expect(box.querySelector('.cerebro-dialog__title')?.textContent).toBe('Cannot Copy Changes');
    expect(box.querySelector('p')?.textContent).toBe('fatal: could not write a.ts');
    await press('OK');
  });
});
