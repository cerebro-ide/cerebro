import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CompareBranches,
  compareRefs,
  compareTab,
  compareWithCurrent,
  setupCompare,
} from '../src/compare-branches.js';
import { useProjects } from '../src/environments.js';
import type { LogCommit } from '../src/git-log.js';
import type { BranchesContext } from '../src/log-branches.js';
import { FakeHost, project } from './fakes.js';

const commit = (hash: string, subject: string): LogCommit => ({
  hash,
  parents: [],
  author: 'Ada',
  email: 'ada@x',
  time: new Date(2026, 0, 2, 10, 15).getTime(),
  subject,
  body: '',
  refs: [],
});

/** The commits each range has, as `git.log` is asked for them. */
const ranges: Record<string, LogCommit[]> = {
  'main..feature': [commit('f1', 'Feature work')],
  'feature..main': [],
};
const host = new FakeHost({
  'git.log': ({ branches, skip, max }: { branches?: string[]; skip: number; max: number }) => {
    const range = branches?.[0] ?? '';
    if (range.includes('gone')) throw new Error(`fatal: bad revision '${range}'`);
    return (ranges[range] ?? []).slice(skip, skip + max);
  },
  'git.changes': () => [{ path: 'a.ts', status: 'M' }],
});
const commands = new CommandRegistry();
const menus = new MenuRegistry();
const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
const opened: Tab[] = [];

let dispose: (() => void) | undefined;

beforeAll(() => {
  useProjects([project('/r', host), project('/s', undefined)]);
  setupCompare(services, (tab) => opened.push(tab));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  opened.length = 0;
});

function mount(worktree = '/r', branch = 'feature') {
  const box = document.createElement('div');
  box.style.width = '1200px';
  box.style.height = '600px';
  document.body.append(box);
  const handle = render(
    () => (
      <CompareBranches
        worktree={worktree}
        current="main"
        branch={branch}
        services={services}
        open={(tab) => opened.push(tab)}
      />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
}

const halves = () => [...document.querySelectorAll<HTMLElement>('.playground-compare__half')];

describe('Compare with Current', () => {
  it('is a tab, named as IntelliJ’s, that says what it compares', () => {
    const tab = compareTab('main', 'feature/x');
    expect(tab).toEqual({ id: 'compare:main..feature/x', title: 'Compare: feature/x and main' });
    expect(compareRefs(tab.id)).toEqual({ current: 'main', branch: 'feature/x' });
    expect(compareRefs('/r/a.ts')).toBeUndefined();
    compareWithCurrent('main', 'side');
    expect(opened).toEqual([compareTab('main', 'side')]);
  });

  it('lists what the branch has over what the current one has, each saying so, as IntelliJ’s', async () => {
    mount();
    expect(
      halves().map((h) => h.querySelector('.playground-compare__explanation')?.textContent),
    ).toEqual([
      "Commits that exist in feature but don't exist in main",
      "Commits that exist in main but don't exist in feature",
    ]);
    // Each a Log of its range.
    await expect
      .poll(() => halves()[0]?.querySelector('.cerebro-tree-row')?.textContent)
      .toContain('Feature work');
    expect(host.params('git.log').map((p) => (p as { branches: string[] }).branches)).toEqual([
      ['main..feature'],
      ['feature..main'],
    ]);
    // None: the other has them all.
    await expect
      .poll(() => halves()[1]?.querySelector('.playground-project__empty')?.textContent)
      .toBe('feature contains all commits from main');
    // A commit's changes and details beside it.
    await userEvent.click(halves()[0]?.querySelector('.cerebro-tree-row') as HTMLElement);
    await expect
      .poll(() => halves()[0]?.querySelector('.playground-log__details-subject')?.textContent)
      .toBe('Feature work');
  });

  it('opens the commit menu on a commit, read again after what it does', async () => {
    menus.contribute({ menu: 'log/commit', item: { command: 'test.refresh' } });
    let context: { refresh: () => Promise<void> } | undefined;
    commands.register<{ refresh: () => Promise<void> }>({
      id: 'test.refresh',
      label: 'Refresh It',
      run: (c) => {
        context = c;
      },
    });
    mount();
    const row = await expect
      .poll(() => halves()[0]?.querySelector<HTMLElement>('.cerebro-tree-row'))
      .toBeTruthy()
      .then(() => halves()[0]?.querySelector('.cerebro-tree-row') as HTMLElement);
    await userEvent.click(row, { button: 'right' });
    await userEvent.click(document.querySelector('.cerebro-menu-item') as HTMLElement);
    const asked = host.params('git.log').length;
    await context?.refresh();
    expect(host.params('git.log').length).toBe(asked + 1);
  });

  it('takes the height and width its splitters are dragged to, never less than nothing', () => {
    mount();
    const drag = (splitter: HTMLElement, by: number, vertical: boolean) => {
      const box = splitter.getBoundingClientRect();
      const at = (d: number) => ({
        clientX: box.left + (vertical ? d : 10),
        clientY: box.top + (vertical ? 10 : d),
        bubbles: true,
        button: 0,
      });
      splitter.dispatchEvent(new PointerEvent('pointerdown', at(0)));
      window.dispatchEvent(new PointerEvent('pointermove', at(by)));
      window.dispatchEvent(new PointerEvent('pointerup', at(by)));
    };
    const [top] = halves() as [HTMLElement];
    const between = document.querySelector(
      '.playground-compare > .cerebro-splitter',
    ) as HTMLElement;
    const height = top.offsetHeight;
    drag(between, -50, false);
    expect(top.style.flex).toBe(`0 0 ${String(height - 50)}px`);
    drag(between, -10_000, false);
    expect(top.style.flex).toBe('0 0 0px');
    const pane = top.querySelector('.playground-log__pane') as HTMLElement;
    expect(pane.style.width).toBe('400px');
    drag(top.querySelector('.playground-log > .cerebro-splitter') as HTMLElement, -100, true);
    expect(pane.style.width).toBe('500px');
    drag(top.querySelector('.playground-log > .cerebro-splitter') as HTMLElement, 10_000, true);
    expect(pane.style.width).toBe('0px');
  });

  it('says why a side can’t be read, in git’s words', async () => {
    mount('/r', 'gone');
    await expect
      .poll(() => halves().map((h) => h.querySelector('.playground-project__empty')?.textContent))
      .toEqual(["fatal: bad revision 'main..gone'", "fatal: bad revision 'gone..main'"]);
  });

  it('shows in the desktop app', () => {
    mount('/s');
    expect(document.body.textContent).toBe('The comparison shows in the desktop app.');
  });

  it('runs from the Log’s branches pane, for a branch that isn’t the current one', () => {
    const at = (selection: BranchesContext['selection'], current?: string): BranchesContext => ({
      source: 'log',
      selection,
      refresh: () => Promise.resolve(),
      ...(current === undefined ? {} : { current }),
    });
    const branch = (ref: string, current = false) => at({ kind: 'branch', ref, current }, 'main');
    expect(commands.get('log.branches.compare')).toMatchObject({
      label: 'Compare with Current',
      icon: 'diff',
    });
    const on = (c: BranchesContext | undefined) => commands.isEnabled('log.branches.compare', c);
    expect(on(undefined)).toBe(false);
    expect(on(at({ kind: 'head', branch: 'main' }))).toBe(false);
    expect(on(branch('refs/heads/main', true))).toBe(false);
    expect(on(branch('refs/tags/v1'))).toBe(false);
    expect(on(branch('refs/remotes/origin/main'))).toBe(true);
    commands.execute('log.branches.compare', branch('refs/remotes/origin/main'));
    // HEAD detached: compared with HEAD.
    commands.execute(
      'log.branches.compare',
      at({ kind: 'branch', ref: 'refs/heads/x', current: false }),
    );
    expect(opened).toEqual([compareTab('main', 'origin/main'), compareTab('HEAD', 'x')]);
  });

  it('takes Show Diff’s keys, as IntelliJ’s: Ctrl+D, Cmd+D on macOS', () => {
    expect(services.keymap?.shortcutsFor('log.branches.compare')).toEqual(['Ctrl+D']);
    const keymap = new Keymap('mac');
    setupCompare({ commands: new CommandRegistry(), menus: new MenuRegistry(), keymap }, (tab) =>
      opened.push(tab),
    );
    expect(keymap.shortcutsFor('log.branches.compare')).toEqual(['Meta+D']);
  });
});
