import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { DiffEditor, type EditorDocument } from '@cerebro-ide/ui-editor';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { setupBlame } from '../src/blame.js';
import {
  AgentChangesView,
  type Change,
  ChangesView,
  diffPath,
  diffRange,
  diffTab,
  fileTab,
  readOptions,
  REFRESH_MS,
  refreshChanges,
  setCommitMessage,
  setupChanges,
  toShelve,
  type Turn,
} from '../src/changes.js';
import { documentFor, unsavedFiles } from '../src/documents.js';
import { useProjects, workspace } from '../src/environments.js';
import { carets } from '../src/navigation.js';
import { readState } from '../src/repository-state.js';
import { notifications } from '../src/notifications.js';
import {
  closeAll,
  dialog,
  dialogText,
  FakeHost,
  menuItems,
  popupItems,
  press,
  project,
  savedBefore,
  unsavedEdit,
} from './fakes.js';
import { repositoryOf, setFavorite } from '../src/branch-favorites.js';

/** The worktree as git sees it, and what the host was asked to do to it. */
const git = {
  changes: [] as Change[],
  turns: [] as Turn[],
  ignored: [] as string[],
  /** Each turn's files, by its range. */
  turnFiles: {} as Record<string, Change[]>,
  lastMessage: 'The last commit',
  state: { conflicts: false } as Record<string, unknown>,
  failing: undefined as string | undefined,
  /** What the reflog says was checked out last. */
  checkouts: [] as string[],
  /** Held until it resolves: a commit under way. */
  hold: undefined as Promise<void> | undefined,
  /** The files on disk, by path. */
  disk: {} as Record<string, string>,
  /** The next read of the changes held until it resolves. */
  holdChanges: undefined as Promise<void> | undefined,
};
const fails = (method: string) => {
  if (git.failing === method) throw new Error(`${method} failed`);
};
const host = new FakeHost({
  'git.changes': async ({ from, to }: { from?: string; to?: string }) => {
    fails('git.changes');
    if (from !== undefined) return git.turnFiles[`${from}..${String(to)}`] ?? [];
    // As they were when asked, answered once released.
    const changes = git.changes;
    const hold = git.holdChanges;
    git.holdChanges = undefined;
    await hold;
    return changes;
  },
  'agent.turns': () => git.turns,
  'git.branches': () => [
    { ref: 'refs/heads/main', current: true },
    { ref: 'refs/heads/feature-10', current: false },
    { ref: 'refs/heads/feature-9', current: false },
    { ref: 'refs/remotes/origin/HEAD', current: false },
    { ref: 'refs/remotes/origin/main', current: false },
  ],
  'git.log': ({ filter }: { filter: { paths: string[] } }) => {
    fails('git.log');
    const commit = (hash: string, subject: string, body: string) => ({
      hash,
      parents: [],
      author: 'Ada',
      email: 'ada@x.org',
      time: 0,
      subject,
      body,
      refs: [],
    });
    return filter.paths[0] === 'src/main/app.ts'
      ? [commit('b'.repeat(40), 'Second', 'Why it changed'), commit('a'.repeat(40), 'First', '')]
      : [];
  },
  'git.tags': () => {
    fails('git.tags');
    return ['v1.0'];
  },
  'git.recentCheckouts': () => {
    fails('git.recentCheckouts');
    return git.checkouts;
  },
  'git.state': () => git.state,
  'git.ignored': () => git.ignored,
  'git.commit': async () => {
    fails('git.commit');
    await git.hold;
    return null;
  },
  'git.lastMessage': () => {
    fails('git.lastMessage');
    return git.lastMessage;
  },
  'git.rollback': () => {
    fails('git.rollback');
    return null;
  },
  'fs.exists': ({ path }: { path: string }) => !path.endsWith('gone.ts'),
  'fs.read': ({ path }: { path: string }) => ({ text: git.disk[path] ?? '' }),
  'fs.write': ({ path, text }: { path: string; text: string }) => {
    git.disk[path] = text;
    return null;
  },
  // What git tracks: anything but a file named so.
  'git.tracked': ({ files }: { files: string[] }) =>
    files.filter((file) => !file.includes('untracked')),
  'git.outgoing': () => {
    fails('git.outgoing');
    return {
      branch: 'main',
      remote: 'origin',
      target: 'main',
      isNew: false,
      commits: [],
      remotes: ['origin'],
      upstream: { remote: 'origin', target: 'main' },
    };
  },
});

const CHANGES: Change[] = [
  { path: 'src/main/app.ts', status: 'modified' },
  { path: 'src/main/new.ts', status: 'added' },
  { path: 'README.md', status: 'deleted' },
  { path: 'docs/guide.md', status: 'renamed', from: 'guide.md' },
  { path: 'notes.txt', status: 'untracked' },
];

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };
const opened: Tab[] = [];
/** The files each diff opened goes through. */
const chains: (readonly string[] | undefined)[] = [];
const placed: { path: string; line: number; column: number }[] = [];
/** The paths Show History asked the Log for. */
const histories: string[] = [];
/** The line each diff opened starts at, if one. */
const lines: (number | undefined)[] = [];
let shown = 0;
let activeTab: string | undefined;
let dispose: (() => void) | undefined;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  useProjects([
    project('/r', host),
    project('/s', undefined),
    { ...project('/n', host), git: false },
  ]);
  setupChanges(services, {
    open: (tab, chain, line) => {
      opened.push(tab);
      chains.push(chain);
      lines.push(line);
    },
    activeTab: () => activeTab,
    show: () => {
      shown++;
    },
    openAt: (at) => void placed.push(at),
    showHistory: (path) => void histories.push(path),
  });
});

/** Each test's own worktree, in the project: the window keeps each one's changes, as left. */
let wt = '/r';
let tests = 0;
beforeEach(() => {
  wt = `/r/t${String(++tests)}`;
  workspace.openOrActivate({ id: wt, name: 'r', branch: 'main' });
});

afterEach(async () => {
  await closeAll();
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  opened.length = 0;
  chains.length = 0;
  lines.length = 0;
  placed.length = 0;
  host.asked.length = 0;
  git.failing = undefined;
  git.checkouts = [];
  activeTab = undefined;
  workspace.close(wt);
  vi.restoreAllMocks();
});

function mount(view: (props: { services: MenuServices; open: (tab: Tab) => void }) => Node) {
  const box = document.createElement('div');
  box.style.height = '600px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  document.body.append(box);
  const handle = render(() => view({ services, open: (tab) => void opened.push(tab) }), box);
  dispose = () => {
    handle.dispose();
  };
}

const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((r) =>
    (r.querySelector('.cerebro-tree-row__content')?.textContent ?? '').trim(),
  );
/** A row by its key: compared, as a selector can't name a group's (it starts with a NUL). */
const row = (key: string) =>
  [...document.querySelectorAll('.cerebro-tree-row')].find(
    (r) => r.getAttribute('data-key') === key,
  ) as HTMLElement;
const include = (key: string) =>
  row(key).querySelector('.playground-changes__include') as HTMLInputElement;
const empty = () => document.querySelector('.playground-project__empty')?.textContent;
const FROM_VIEW = { source: 'changes' };
const FROM_AGENT = { source: 'agent' };
const GROUP = '\u0000changes';
const UNVERSIONED = '\u0000unversioned';
const IGNORED = '\u0000ignored';

/** The Commit window over `changes`, its rows drawn. */
async function changesView(changes: Change[] = CHANGES): Promise<void> {
  git.changes = changes;
  mount(ChangesView);
  await expect.poll(() => rows().length + (empty() === undefined ? 0 : 1)).toBeGreaterThan(0);
}

describe('a diff tab', () => {
  it('names the file, and the commits it compares if two', () => {
    expect(diffTab('src/a.ts')).toEqual({ id: 'diff:src/a.ts', title: 'a.ts' });
    const tab = diffTab('src/a.ts', { from: 'abc', to: 'def' });
    expect(tab.id).toBe('diff@abc..def:src/a.ts');
    expect([diffPath(tab.id), diffRange(tab.id)]).toEqual(['src/a.ts', { from: 'abc', to: 'def' }]);
    expect([diffPath('src/a.ts'), diffRange('diff:a.ts')]).toEqual([undefined, undefined]);
    expect(fileTab('/r', 'src/a.ts')).toEqual({ id: '/r/src/a.ts', title: 'a.ts' });
  });
});

describe('the view options', () => {
  it('are kept, by directory and without ignored files by default', () => {
    expect(readOptions()).toEqual({ byDirectory: true, showIgnored: false });
    localStorage.setItem('cerebro.changes.view', '{"byDirectory":false,"showIgnored":true}');
    expect(readOptions()).toEqual({ byDirectory: false, showIgnored: true });
    localStorage.setItem('cerebro.changes.view', '{unreadable');
    expect(readOptions()).toEqual({ byDirectory: true, showIgnored: false });
    localStorage.clear();
  });
});

describe('the Commit window', () => {
  it('says why it shows nothing: no environment, a browser, or no git', () => {
    for (const [view, browser] of [
      [ChangesView, 'Changes show in the desktop app.'],
      [AgentChangesView, 'Agent changes show in the desktop app.'],
    ] as const) {
      workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
      mount(view);
      expect(empty()).toBe(browser);
      // Nothing to act on.
      for (const id of ['changes.refresh', 'changes.rollback', 'changes.amend']) {
        expect(commands.isEnabled(id, FROM_VIEW)).toBe(false);
      }
      expect(commands.get('changes.amend')?.checked?.(FROM_VIEW)).toBe(false);
      workspace.openOrActivate({ id: '/n', name: 'n', branch: 'main' });
      expect(empty()).toBe('Not a git repository');
      expect(commands.isEnabled('changes.refresh', FROM_VIEW)).toBe(false);
      for (const id of [wt, '/s', '/n']) workspace.close(id);
      expect(empty()).toBe('No environment open');
      dispose?.();
      workspace.openOrActivate({ id: wt, name: 'r', branch: 'main' });
    }
    expect(toShelve(undefined)).toBeUndefined();
  });

  it('lists the changes by directory, a folder of one folder as one row, then the untracked', async () => {
    await changesView();
    await expect
      .poll(rows)
      .toEqual([
        'Changes4 files',
        'docs1 file',
        'guide.md ← guide.md',
        'src/main2 files',
        'app.ts',
        'new.ts',
        'README.md',
        'Unversioned Files1 file',
        'notes.txt',
      ]);
    expect(
      row('\u0000changes:src/main/app.ts').querySelector('.playground-change--modified'),
    ).not.toBeNull();
    // Once, as it first shows.
    expect(host.params('git.changes')).toEqual([{ path: wt }]);
  });

  it('counts a folder’s files in its folders too', async () => {
    await changesView([
      { path: 'lib/x.ts', status: 'modified' },
      { path: 'lib/sub/y.ts', status: 'modified' },
    ]);
    await expect.poll(rows).toEqual(['Changes2 files', 'lib2 files', 'sub1 file', 'y.ts', 'x.ts']);
  });

  it('lists the files in conflict first, as Merge Conflicts, with Resolve, and not to commit', async () => {
    const resolved: unknown[] = [];
    const registered = commands.register({
      id: 'vcs.resolveConflicts',
      label: 'Resolve Conflicts',
      run: (context) => void resolved.push(context),
    });
    await changesView([
      { path: 'a.ts', status: 'conflict' },
      { path: 'b.ts', status: 'modified' },
    ]);
    await expect
      .poll(rows)
      .toEqual(['Merge Conflicts1 fileResolve', 'a.ts', 'Changes1 file', 'b.ts']);
    expect(
      row('\u0000conflicts:a.ts').querySelector('.playground-change--conflict'),
    ).not.toBeNull();
    expect(row('\u0000conflicts:a.ts').querySelector('.playground-changes__include')).toBeNull();
    await userEvent.click(row('\u0000conflicts').querySelector('.playground-link') as HTMLElement);
    expect(resolved).toHaveLength(1);
    registered.dispose();
  });

  it('says there are no changes', async () => {
    await changesView([]);
    await expect.poll(empty).toBe('No changes');
  });

  it('reads them again every few seconds and as the window gets the focus, redrawn only if changed', async () => {
    await changesView([CHANGES[0] as Change]);
    await expect.poll(rows).toHaveLength(3);
    const reads = () => host.params('git.changes').length;
    const first = row(GROUP);
    vi.advanceTimersByTime(REFRESH_MS);
    await expect.poll(reads).toBe(2);
    expect(row(GROUP)).toBe(first);
    git.changes = [CHANGES[0] as Change, CHANGES[2] as Change];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(rows).toContain('README.md');
    // Failing, it says so in the console, and tries again.
    git.failing = 'git.changes';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.advanceTimersByTime(REFRESH_MS);
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the changes failed');
    // Refresh says so in a dialog.
    commands.execute('changes.refresh', FROM_VIEW);
    expect(await dialogText()).toBe('git.changes failed');
    await press('Close');
    git.failing = undefined;
    // Not once it's gone.
    dispose?.();
    dispose = undefined;
    const now = reads();
    vi.advanceTimersByTime(REFRESH_MS);
    window.dispatchEvent(new Event('focus'));
    expect(reads()).toBe(now);
  });

  it('takes the latest read when reads overlap, not an earlier one answered after', async () => {
    await changesView([CHANGES[0] as Change]);
    await expect.poll(rows).toHaveLength(3);
    let release!: () => void;
    git.holdChanges = new Promise((resolve) => (release = resolve));
    git.changes = [CHANGES[0] as Change, CHANGES[2] as Change];
    commands.execute('changes.refresh', FROM_VIEW);
    await expect.poll(() => git.holdChanges).toBeUndefined();
    git.changes = [CHANGES[2] as Change];
    commands.execute('changes.refresh', FROM_VIEW);
    await expect.poll(rows).toEqual(['Changes1 file', 'README.md']);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toEqual(['Changes1 file', 'README.md']);
  });

  it('lists files by name with their folder after, when not by directory, and ignored ones when asked', async () => {
    git.ignored = ['dist/', 'debug.log'];
    await changesView(CHANGES.slice(0, 2));
    await expect.poll(rows).toHaveLength(4);
    commands.execute('changes.groupByDirectory', FROM_VIEW);
    expect(commands.get('changes.groupByDirectory')?.checked?.(FROM_VIEW)).toBe(false);
    await expect.poll(rows).toEqual(['Changes2 files', 'app.tssrc/main', 'new.tssrc/main']);
    commands.execute('changes.showIgnored', FROM_VIEW);
    // Its group starts closed: there may be many.
    await expect
      .poll(rows)
      .toEqual(['Changes2 files', 'app.tssrc/main', 'new.tssrc/main', 'Ignored Files2 files']);
    expect(JSON.parse(localStorage.getItem('cerebro.changes.view') as string)).toEqual({
      byDirectory: false,
      showIgnored: true,
    });
    // Every worktree's lists are read again, this one's among them.
    expect(host.params('git.ignored')).toContainEqual({ path: wt });
    await userEvent.dblClick(row(IGNORED));
    await expect.poll(rows).toContain('dist');
    // Nothing of them goes into a commit, nor opens.
    expect(row(`${IGNORED}:dist/`).querySelector('input')).toBeNull();
    await userEvent.dblClick(row(`${IGNORED}:dist/`));
    await userEvent.click(row(`${IGNORED}:debug.log`));
    expect(commands.isEnabled('changes.showDiff', FROM_VIEW)).toBe(false);
    expect(opened).toEqual([]);
    // Each worktree's lists read again: one that fails says so in the console.
    git.failing = 'git.changes';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    commands.execute('changes.groupByDirectory', FROM_VIEW);
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the changes failed');
    git.failing = undefined;
    commands.execute('changes.groupByDirectory', FROM_VIEW);
    // Kept even when storage won't take them.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    commands.execute('changes.showIgnored', FROM_VIEW);
    commands.execute('changes.groupByDirectory', FROM_VIEW);
    await expect.poll(rows).toEqual(['Changes2 files', 'src/main2 files', 'app.ts', 'new.ts']);
    git.ignored = [];
  });

  it('opens a file, not one deleted; Show Diff opens its diff', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.dblClick(row(`${GROUP}:src/main/app.ts`));
    await userEvent.dblClick(row(`${GROUP}:README.md`));
    expect(opened).toEqual([{ id: `${wt}/src/main/app.ts`, title: 'app.ts' }]);
    expect(commands.isEnabled('changes.showDiff', FROM_VIEW)).toBe(true);
    commands.execute('changes.showDiff', FROM_VIEW);
    expect(opened.at(-1)).toEqual({ id: 'diff:README.md', title: 'README.md' });
    // Through its group's files, in the tree's order, as IntelliJ's changelist.
    expect(chains.at(-1)).toEqual([
      'docs/guide.md',
      'src/main/app.ts',
      'src/main/new.ts',
      'README.md',
    ]);
    // F4: a deleted file has nothing to go to.
    expect(commands.isEnabled('changes.jumpToSource', FROM_VIEW)).toBe(false);
    await userEvent.click(row(`${GROUP}:src/main/new.ts`));
    commands.execute('changes.jumpToSource', FROM_VIEW);
    expect(opened.at(-1)).toEqual({ id: `${wt}/src/main/new.ts`, title: 'new.ts' });
    // An unversioned file's: the unversioned files.
    await userEvent.click(row(`${UNVERSIONED}:notes.txt`));
    commands.execute('changes.showDiff', FROM_VIEW);
    expect(chains.at(-1)).toEqual(['notes.txt']);
    // Only with the window's keyboard, or from it.
    (document.activeElement as HTMLElement).blur();
    expect(commands.isEnabled('changes.showDiff')).toBe(false);
  });

  it('opens the menu of a row, and the View Options', async () => {
    menus.contribute({ menu: 'changes/item', item: { command: 'changes.refresh' } });
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.click(row(GROUP), { button: 'right' });
    expect(await menuItems()).toEqual(
      expect.arrayContaining(['Show Diff', 'Rollback…', 'Refresh']),
    );
    await closeAll();
    await userEvent.click(document.querySelector('[aria-label="View Options"]') as Element);
    expect(await menuItems()).toEqual(expect.arrayContaining(['Directory', 'Ignored Files']));
  });

  it('shows the toolbar’s shortcuts, from the keymap, if it has one', async () => {
    await changesView();
    const tooltip = async (label: string) => {
      const button = [...document.querySelectorAll('.playground-changes__toolbar button')].find(
        (b) => b.getAttribute('aria-label')?.startsWith(label),
      ) as Element;
      await userEvent.hover(button);
      await expect.poll(() => document.querySelector('.cerebro-tooltip')).not.toBeNull();
      const text = document.querySelector('.cerebro-tooltip')?.textContent;
      await userEvent.unhover(button);
      await expect.poll(() => document.querySelector('.cerebro-tooltip')).toBeNull();
      return text;
    };
    expect(await tooltip('Rollback')).toBe('Rollback…Ctrl+Alt+Z');
    expect(await tooltip('Select Opened File')).toBe('Select Opened File');
    expect(await tooltip('View Options')).toBe('View Options');
    // Without a keymap, none.
    dispose?.();
    const handle = render(
      () => <ChangesView services={{ commands, menus }} open={() => undefined} />,
      document.body,
    );
    dispose = () => {
      handle.dispose();
    };
    expect(await tooltip('Rollback')).toBe('Rollback…');
  });
});

describe('Jump to Source from a diff', () => {
  function diff(path: string): HTMLElement {
    activeTab = `diff:${path}`;
    const container = render(
      () => <DiffEditor path={path} original={'one\ntwo\n'} text={'one\nthree\n'} />,
      document.body,
    );
    dispose = () => {
      container.dispose();
    };
    return document.querySelector('.cerebro-editor-diff') as HTMLElement;
  }

  it('opens the file where the diff’s caret is', async () => {
    const element = diff('src/a.ts');
    const content = element.shadowRoot?.querySelectorAll('.cm-content')[1] as HTMLElement;
    await userEvent.click(content);
    expect(commands.isEnabled('changes.jumpToSource')).toBe(true);
    commands.execute('changes.jumpToSource');
    await expect.poll(() => placed).toHaveLength(1);
    expect(placed[0]?.path).toBe(`${wt}/src/a.ts`);
  });

  it('opens nothing for a file deleted, or with no diff focused', async () => {
    const element = diff('src/gone.ts');
    await userEvent.click(element.shadowRoot?.querySelector('.cm-content') as HTMLElement);
    commands.execute('changes.jumpToSource');
    await expect.poll(() => host.params('fs.exists')).toHaveLength(1);
    expect(placed).toEqual([]);
    (document.activeElement as HTMLElement).blur();
    expect(commands.isEnabled('changes.jumpToSource')).toBe(false);
    activeTab = undefined;
    expect(commands.isEnabled('changes.jumpToSource')).toBe(false);
  });
});

describe('Git → Current File → Show Diff', () => {
  it('shows the editor’s file against its last commit, as IntelliJ’s Compare with the Same Repository Version', () => {
    const visible = () => commands.get('git.file.showDiff')?.visible?.(undefined);
    expect(visible()).toBe(false);
    activeTab = '/elsewhere/a.ts';
    expect(visible()).toBe(false);
    activeTab = `${wt}/src/main/app.ts`;
    expect(visible()).toBe(true);
    // The Commit window hasn't read the changes: nothing says git hasn't committed it.
    expect(commands.isEnabled('git.file.showDiff')).toBe(true);
    commands.execute('git.file.showDiff');
    expect(opened.at(-1)?.id).toBe('diff:src/main/app.ts');
    // No caret known: the diff starts at its first change.
    expect(lines.at(-1)).toBeUndefined();
    expect(menus.entries('main/git/file')).toContainEqual({ command: 'git.file.showDiff' });
  });

  it('opens at the editor’s caret line, as IntelliJ’s SCROLL_TO_LINE', () => {
    activeTab = `${wt}/src/main/app.ts`;
    carets.set(activeTab, { line: 12, column: 3 });
    commands.execute('git.file.showDiff');
    carets.delete(activeTab);
    expect(lines.at(-1)).toBe(12);
  });

  it('is off for a file git hasn’t committed: untracked or added; Annotate hidden for it', async () => {
    setupBlame(services, {
      activeTab: () => activeTab,
      open: () => undefined,
      showInLog: () => undefined,
    });
    await changesView();
    for (const [path, on] of [
      ['src/main/app.ts', true],
      ['notes.txt', false],
      ['src/main/new.ts', false],
      ['unchanged.ts', true],
    ] as const) {
      activeTab = `${wt}/${path}`;
      expect(commands.isEnabled('git.file.showDiff')).toBe(on);
      // As IntelliJ's AnnotateToggleAction.
      expect(commands.get('vcs.annotate')?.visible?.(undefined)).toBe(on);
    }
  });
});

describe('Git → Current File → Compare with Revision…', () => {
  it('shows the file as it is against one of its commits, chosen in File Revisions', async () => {
    const id = 'git.file.compareWithRevision';
    expect(commands.get(id)?.visible?.(undefined)).toBe(false);
    activeTab = `${wt}/src/main/app.ts`;
    expect(commands.isEnabled(id)).toBe(true);
    commands.execute(id);
    expect(await popupItems()).toEqual(['b'.repeat(40), 'a'.repeat(40)]);
    expect(document.querySelector('.playground-popup__title')?.textContent).toBe('File Revisions');
    // The highlighted one's message below.
    const message = () => document.querySelector('.playground-revisions__text')?.textContent;
    await expect.poll(message).toBe('Second\n\nWhy it changed');
    // Searched by its author too.
    await userEvent.keyboard('Ada');
    await expect.poll(popupItems).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(message).toBe('First');
    await userEvent.keyboard('{Enter}');
    expect(opened.at(-1)).toEqual(diffTab('src/main/app.ts', { from: 'a'.repeat(40) }));
    // None to list (no commit has it yet): no message, and Escape opens nothing.
    activeTab = `${wt}/unchanged.ts`;
    commands.execute(id);
    expect(await popupItems()).toEqual([]);
    expect(document.querySelector('.playground-revisions__message')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
    expect(opened).toHaveLength(1);
    // IntelliJ's order (`Git.FileActions`), Annotate aside.
    const items = menus
      .entries('main/git/file')
      .flatMap((e) => ('command' in e && e.command.startsWith('git.file.') ? [e.command] : []));
    expect(items).toEqual([
      'git.file.showDiff',
      'git.file.compareWithRevision',
      'git.file.compareWithBranch',
      'git.file.showHistory',
    ]);
  });

  it('is off when Show Diff is: for a file git hasn’t committed', async () => {
    await changesView();
    activeTab = `${wt}/notes.txt`;
    await expect.poll(() => commands.isEnabled('git.file.compareWithRevision')).toBe(false);
  });

  it('says on the console when the revisions can’t be read', async () => {
    activeTab = `${wt}/src/main/app.ts`;
    git.failing = 'git.log';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    commands.execute('git.file.compareWithRevision');
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the file’s revisions failed');
    logged.mockRestore();
  });
});

describe('Git → Current File → Show History', () => {
  it('shows the file’s history in the Log; off when Show Diff is', async () => {
    const id = 'git.file.showHistory';
    expect(commands.get(id)?.visible?.(undefined)).toBe(false);
    activeTab = `${wt}/src/main/app.ts`;
    expect(commands.get(id)?.visible?.(undefined)).toBe(true);
    commands.execute(id);
    expect(histories.at(-1)).toBe('src/main/app.ts');
    // A file git hasn't committed has no history, as IntelliJ's.
    await changesView();
    activeTab = `${wt}/notes.txt`;
    await expect.poll(() => commands.isEnabled(id)).toBe(false);
  });
});

describe('Git → Current File → Compare with Branch or Tag…', () => {
  const groups = () =>
    [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent);

  it('shows the file as it is against a branch or tag chosen, as IntelliJ’s', async () => {
    const visible = () => commands.get('git.file.compareWithBranch')?.visible?.(undefined);
    expect(visible()).toBe(false);
    // Any file, git's or not: the diff says if it isn't in the branch.
    activeTab = `${wt}/notes.txt`;
    expect(visible()).toBe(true);
    commands.execute('git.file.compareWithBranch');
    // The current branch left out, and origin/HEAD; in IntelliJ's order.
    expect(await popupItems()).toEqual(['feature-9', 'feature-10', 'origin/main', 'v1.0']);
    expect(groups()).toEqual(['Local', 'Remote', 'Tags']);
    expect(document.querySelector('.playground-popup__title')?.textContent).toBe(
      'Select Branch to Compare',
    );
    await userEvent.keyboard('v1{Enter}');
    expect(opened.at(-1)).toEqual(diffTab('notes.txt', { from: 'refs/tags/v1.0' }));
    expect(opened.at(-1)?.id).toBe('diff@refs/tags/v1.0..:notes.txt');
    expect(diffRange('diff@refs/tags/v1.0..:notes.txt')).toEqual({ from: 'refs/tags/v1.0' });
    expect(diffPath('diff@refs/tags/v1.0..:notes.txt')).toBe('notes.txt');
    // Escape: nothing opened.
    commands.execute('git.file.compareWithBranch');
    await popupItems();
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
    expect(opened).toHaveLength(1);
    expect(menus.entries('main/git/file')).toContainEqual({
      command: 'git.file.compareWithBranch',
    });
  });

  it('lists the recent branches first, but the current one, and favorites first, as IntelliJ’s', async () => {
    activeTab = `${wt}/notes.txt`;
    // The latest first; the current branch and a detached HEAD's passed over.
    git.checkouts = ['main', 'feature-10', 'HEAD'];
    setFavorite(repositoryOf(wt), 'refs/tags/v1.0', true);
    commands.execute('git.file.compareWithBranch');
    expect(await popupItems()).toEqual(['feature-10', 'feature-9', 'origin/main', 'v1.0']);
    expect(groups()).toEqual(['Recent', 'Local', 'Remote', 'Tags']);
    await closeAll();
    // Favorites first, with their star (origin/main is one, as IntelliJ's main is).
    git.checkouts = [];
    setFavorite(repositoryOf(wt), 'refs/heads/feature-10', true);
    commands.execute('git.file.compareWithBranch');
    expect(await popupItems()).toEqual(['feature-10', 'feature-9', 'origin/main', 'v1.0']);
    const starred = [...document.querySelectorAll('.cerebro-popup-item')]
      .filter((item) => item.querySelector('.cerebro-popup-item__icon svg'))
      .map((item) => item.querySelector('.cerebro-popup-item__label')?.textContent);
    expect(starred).toEqual(['feature-10', 'origin/main', 'v1.0']);
    await closeAll();
    setFavorite(repositoryOf(wt), 'refs/heads/feature-10', false);
    setFavorite(repositoryOf(wt), 'refs/tags/v1.0', false);
    // Where the recent can't be read (no commit yet), none is recent.
    git.failing = 'git.recentCheckouts';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    commands.execute('git.file.compareWithBranch');
    expect(await popupItems()).toEqual(['feature-9', 'feature-10', 'origin/main', 'v1.0']);
    expect(logged.mock.calls[0]?.[0]).toBe('Reading the recent branches failed');
  });

  it('says on the console when the branches can’t be read', async () => {
    activeTab = `${wt}/notes.txt`;
    git.failing = 'git.tags';
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    commands.execute('git.file.compareWithBranch');
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the branches failed');
    logged.mockRestore();
    expect(document.querySelector('.cerebro-popup')).toBeNull();
  });
});

describe('Rollback', () => {
  it('rolls back the selection’s tracked files, after asking, deleting added ones if told', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.click(row(`${GROUP}:src/main/`));
    expect(commands.isEnabled('changes.rollback', FROM_VIEW)).toBe(true);
    commands.execute('changes.rollback', FROM_VIEW);
    expect(await dialogText()).toContain('These 2 files will be rolled back:');
    expect(await dialogText()).toContain('src/main/app.ts');
    await userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as Element);
    await press('Rollback');
    await expect
      .poll(() => host.params('git.rollback'))
      .toEqual([{ path: wt, files: ['src/main/app.ts', 'src/main/new.ts'], deleteAdded: true }]);
  });

  it('saves the documents first, as IntelliJ’s `RollbackDialogAction`: what’s rolled back is on disk', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await unsavedEdit(host, `${wt}/src/main/app.ts`);
    await userEvent.click(row(`${GROUP}:src/main/`));
    commands.execute('changes.rollback', FROM_VIEW);
    await press('Rollback');
    await expect.poll(() => host.params('git.rollback')).toHaveLength(1);
    expect(savedBefore(host, `${wt}/src/main/app.ts`, 'git.rollback')).toBe(true);
  });

  it('asks about one file, rolls back nothing if cancelled, and says why it couldn’t', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.click(row(`${GROUP}:README.md`));
    commands.execute('changes.rollback', FROM_VIEW);
    expect(await dialogText()).toBe('This file will be rolled back:README.md');
    await press('Cancel');
    git.failing = 'git.rollback';
    commands.execute('changes.rollback', FROM_VIEW);
    await press('Rollback');
    expect(await dialogText()).toBe('git.rollback failed');
    expect(host.params('git.rollback')).toHaveLength(1);
    // Nothing to roll back in an untracked file, or the untracked group.
    await press('Close');
    await userEvent.click(row(`${UNVERSIONED}:notes.txt`));
    expect(commands.isEnabled('changes.rollback', FROM_VIEW)).toBe(false);
    await userEvent.click(row(UNVERSIONED));
    expect(commands.isEnabled('changes.rollback', FROM_VIEW)).toBe(false);
    // The whole group of changes, every tracked file.
    await userEvent.click(row(GROUP));
    expect(commands.isEnabled('changes.rollback', FROM_VIEW)).toBe(true);
  });
});

describe('Rollback, the environment closed meanwhile', () => {
  it('rolls back nothing', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.click(row(`${GROUP}:README.md`));
    commands.execute('changes.rollback', FROM_VIEW);
    await dialog();
    workspace.close(wt);
    await press('Rollback');
    expect(host.params('git.rollback')).toEqual([]);
  });
});

describe('a file edited, not saved yet', () => {
  const edit = async (path: string) => {
    const doc = (await documentFor(path)) as EditorDocument;
    doc.edit([{ from: 0, to: 0, insert: 'x' }]);
    return doc;
  };

  it('shows as modified at its first edit, as IntelliJ’s, if git tracks it', async () => {
    await changesView([]);
    expect(empty()).toBe('No changes');
    const reads = () => host.params('git.changes').length;
    const before = reads();
    await edit(`${wt}/src/a.ts`);
    await expect.poll(rows).toEqual(['Changes1 file', 'src1 file', 'a.ts']);
    expect(
      row('\u0000changes:src/a.ts').querySelector('.playground-change--modified'),
    ).not.toBeNull();
    expect(host.params('git.tracked')).toEqual([{ path: wt, files: ['src/a.ts'] }]);
    // Typing on doesn't read the lists again: it's listed.
    await edit(`${wt}/src/a.ts`);
    expect(reads()).toBe(before + 1);
    // One git doesn't track is asked about once, until it's saved; one elsewhere, not at all.
    await edit(`${wt}/untracked.ts`);
    await expect.poll(reads).toBe(before + 2);
    await edit(`${wt}/untracked.ts`);
    await edit('/elsewhere/b.ts');
    expect(reads()).toBe(before + 2);
    expect(rows()).toEqual(['Changes1 file', 'src1 file', 'a.ts']);
    // Listed by git as well (once saved, say): once.
    git.changes = [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'c.ts', status: 'modified' },
    ];
    await refreshChanges(wt);
    expect(rows()).toEqual(['Changes2 files', 'src1 file', 'a.ts', 'c.ts']);
    // A file listed already isn't asked about.
    await edit(`${wt}/c.ts`);
    expect(reads()).toBe(before + 3);
    // A read that fails is logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.failing = 'git.changes';
    await edit(`${wt}/d.ts`);
    await expect
      .poll(() => logged.mock.calls[0])
      .toEqual(['Reading the changes failed', new Error('git.changes failed')]);
  });

  it('is saved as it’s committed, so the commit has the edit', async () => {
    await changesView([]);
    git.disk[`${wt}/b.ts`] = 'b';
    const doc = await edit(`${wt}/b.ts`);
    await expect.poll(rows).toEqual(['Changes1 file', 'b.ts']);
    const message = document.querySelector('.playground-commit__message') as HTMLTextAreaElement;
    await userEvent.type(message, 'Edit b');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect.poll(() => host.params('git.commit')).toHaveLength(1);
    expect(git.disk[`${wt}/b.ts`]).toBe('xb');
    expect(doc.modified.peek()).toBe(false);
    expect(unsavedFiles()).not.toContain(`${wt}/b.ts`);
  });
});

describe('what goes into the commit', () => {
  it('is every tracked file, untracked ones once put in, flipped by a checkbox or Space', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    expect([include(GROUP).checked, include(UNVERSIONED).checked]).toEqual([true, false]);
    await userEvent.click(include(`${GROUP}:src/main/app.ts`));
    expect([include(GROUP).checked, include(GROUP).indeterminate]).toEqual([false, true]);
    expect(include(`${GROUP}:src/main/`).indeterminate).toBe(true);
    await userEvent.click(include(GROUP));
    expect(include(`${GROUP}:src/main/app.ts`).checked).toBe(true);
    await userEvent.click(include(GROUP));
    expect(include(`${GROUP}:README.md`).checked).toBe(false);
    await userEvent.click(row(UNVERSIONED));
    await userEvent.keyboard(' ');
    expect(include(`${UNVERSIONED}:notes.txt`).checked).toBe(true);
    await userEvent.keyboard(' ');
    expect(include(`${UNVERSIONED}:notes.txt`).checked).toBe(false);
    // Double clicking the checkbox doesn't open the file.
    await userEvent.dblClick(include(`${GROUP}:src/main/app.ts`));
    expect(opened).toEqual([]);
    // Shelve Changes starts from the selection (the row double clicked), from the window's menu;
    // else from what goes in.
    expect(toShelve(FROM_VIEW)?.chosen.map((c) => c.path)).toEqual(['src/main/app.ts']);
    await userEvent.click(include(GROUP));
    expect(toShelve(undefined)?.chosen).toHaveLength(4);
    // From another window, not the selection.
    expect(toShelve({ source: 'shelf' })?.chosen).toHaveLength(4);
    expect(toShelve(undefined)?.files).toHaveLength(5);
  });

  it('isn’t flipped by Space outside the tree, or with nothing selected', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    const field = document.querySelector('.playground-commit__message') as HTMLElement;
    await userEvent.click(field);
    await userEvent.keyboard(' ');
    expect(include(GROUP).checked).toBe(true);
    // The selected file gone since, as after a commit.
    await userEvent.click(row(`${UNVERSIONED}:notes.txt`));
    git.changes = CHANGES.slice(0, 4);
    commands.execute('changes.refresh', FROM_VIEW);
    await expect.poll(rows).toHaveLength(7);
    await userEvent.keyboard(' ');
    expect(include(GROUP).checked).toBe(true);
  });
});

describe('Commit', () => {
  const message = () =>
    document.querySelector('.playground-commit__message') as HTMLTextAreaElement;
  const error = () => document.querySelector('.playground-commit__error')?.textContent;
  const commitButton = () =>
    [...document.querySelectorAll('.playground-commit button')].find(
      (b) => b.textContent === 'Commit',
    ) as HTMLButtonElement;

  it('says what’s missing first', async () => {
    await changesView([CHANGES[4] as Change]);
    await expect.poll(rows).toHaveLength(3);
    await userEvent.click(commitButton());
    expect(error()).toBe('Select files to commit and specify commit message');
    expect(message().classList).toContain('playground-commit__message--invalid');
    await userEvent.type(message(), 'Add notes');
    expect(error()).toBeUndefined();
    await userEvent.click(commitButton());
    expect(error()).toBe('Select files to commit');
    await userEvent.click(include(UNVERSIONED));
    await userEvent.clear(message());
    await userEvent.click(commitButton());
    expect(error()).toBe('Specify commit message');
    expect(host.params('git.commit')).toEqual([]);
  });

  it('commits the files put in, with the message, by the button or Ctrl+Enter', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.click(include(`${GROUP}:README.md`));
    await userEvent.type(message(), 'Change things');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect
      .poll(() => host.params('git.commit'))
      .toEqual([
        {
          path: wt,
          files: ['src/main/app.ts', 'src/main/new.ts', 'docs/guide.md'],
          message: 'Change things',
          amend: false,
        },
      ]);
    await expect.poll(() => message().value).toBe('');
    // As IntelliJ's notification.
    expect(notifications.all.get(0)).toMatchObject({
      title: '3 files committed',
      content: 'Change things',
      type: 'information',
      display: 'sticky',
    });
    // Enter alone is a new line.
    await userEvent.type(message(), 'a{Enter}b');
    expect(message().value).toBe('a\nb');
    await userEvent.click(commitButton());
    await expect.poll(() => host.params('git.commit')).toHaveLength(2);
  });

  it('commits once at a time, and says why it couldn’t', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.type(message(), 'm');
    git.failing = 'git.commit';
    commitButton().click();
    commitButton().click();
    await expect
      .poll(() => notifications.all.get(0))
      .toMatchObject({
        title: 'Commit failed with error',
        content: 'git.commit failed',
        type: 'error',
      });
    expect(host.params('git.commit')).toHaveLength(1);
    expect(message().value).toBe('m');
  });

  it('commits once while a commit is under way', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.type(message(), 'm');
    let finish!: () => void;
    git.hold = new Promise((resolve) => (finish = resolve));
    await userEvent.keyboard('{Control>}{Enter}{Enter}{/Control}');
    expect(commitButton().disabled).toBe(true);
    finish();
    git.hold = undefined;
    await expect.poll(() => commitButton().disabled).toBe(false);
    expect(host.params('git.commit')).toHaveLength(1);
  });

  it('says one file was committed, as IntelliJ’s', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    for (const key of [GROUP, UNVERSIONED]) {
      if (include(key).checked) await userEvent.click(include(key));
    }
    await userEvent.click(include(`${GROUP}:src/main/app.ts`));
    await userEvent.type(message(), 'One');
    await userEvent.click(commitButton());
    await expect.poll(() => notifications.all.get(0)?.title).toBe('1 file committed');
  });

  it('commits, then opens the Push dialog, with Commit and Push…, as IntelliJ’s', async () => {
    const pushButton = () =>
      [...document.querySelectorAll('.playground-commit button')].find((b) =>
        b.textContent.endsWith('Commit and Push…'),
      ) as HTMLButtonElement;
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    expect(pushButton().textContent).toBe('Commit and Push…');
    await userEvent.click(document.querySelector('.playground-commit__amend input') as Element);
    await expect.poll(() => pushButton().textContent).toBe('Amend Commit and Push…');
    await userEvent.click(document.querySelector('.playground-commit__amend input') as Element);
    // No message: no commit, no push.
    await userEvent.click(pushButton());
    expect(error()).toBe('Specify commit message');
    await userEvent.type(message(), 'Push it');
    await userEvent.click(pushButton());
    expect((await dialog()).querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Push Commits to r',
    );
    expect(host.params('git.commit')).toHaveLength(1);
    expect(host.params('git.outgoing')).toEqual([{ path: wt }]);
    await press('Cancel');
    // What to push couldn't be read.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    git.failing = 'git.outgoing';
    await userEvent.type(message(), 'Again');
    await userEvent.click(pushButton());
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith('Reading what to push failed', expect.any(Error));
    });
  });

  it('is Ctrl+K’s: the window shown, its message focused', async () => {
    await changesView();
    commands.execute('changes.commit');
    expect(shown).toBeGreaterThan(0);
    await expect.poll(() => document.activeElement).toBe(message());
    // The window not shown yet: nothing to focus.
    dispose?.();
    dispose = undefined;
    commands.execute('changes.commit');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Not without git.
    workspace.openOrActivate({ id: '/n', name: 'n', branch: 'main' });
    expect(commands.isEnabled('changes.commit')).toBe(false);
    workspace.close('/n');
  });
});

describe('a merge’s message', () => {
  const message = () =>
    document.querySelector('.playground-commit__message') as HTMLTextAreaElement;
  /** The state read, then the changes: as the window reads them every few seconds. */
  const merge = async (state: Record<string, unknown>) => {
    git.state = state;
    await readState(wt);
    await refreshChanges(wt);
  };
  const MERGING = { operation: 'merge', conflicts: false, message: "Merge branch 'f'\n" };

  afterEach(() => {
    git.state = { conflicts: false };
  });

  it('is given once, to an empty message, as IntelliJ’s, and taken out unedited when it’s over', async () => {
    await changesView();
    await merge(MERGING);
    expect(message().value).toBe("Merge branch 'f'\n");
    // Over, unedited: taken out.
    await merge({ conflicts: false });
    expect(message().value).toBe('');
    // Cleared, it stays so.
    await merge(MERGING);
    await userEvent.clear(message());
    await merge(MERGING);
    expect(message().value).toBe('');
    // Edited, it stays when the merge is over.
    await userEvent.type(message(), 'Mine');
    await merge({ conflicts: false });
    expect(message().value).toBe('Mine');
    // A message being written isn't replaced.
    await merge(MERGING);
    expect(message().value).toBe('Mine');
  });

  it('is replaced, unedited, by the next merge’s, when no read came between them', async () => {
    // On Windows in CI, Update Project's merge was committed and the next merge started before
    // the window read its changes again: the first merge's message stayed.
    await changesView();
    await merge(MERGING);
    await merge({ ...MERGING, message: "Merge branch 'g'\n" });
    expect(message().value).toBe("Merge branch 'g'\n");
  });
});

describe('a message put in from elsewhere', () => {
  it('shows in the Commit window: Undo Commit’s, to commit again', async () => {
    await changesView();
    setCommitMessage(wt, 'Fix it\n\nWhy');
    const box = document.querySelector('.playground-commit__message') as HTMLTextAreaElement;
    await expect.poll(() => box.value).toBe('Fix it\n\nWhy');
    setCommitMessage(wt, '');
  });
});

describe('Amend', () => {
  const message = () =>
    document.querySelector('.playground-commit__message') as HTMLTextAreaElement;
  const amend = () => document.querySelector('.playground-commit__amend input') as HTMLInputElement;

  it('puts the last commit’s message in, and back what was there when turned off', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.type(message(), 'mine');
    await userEvent.click(amend());
    await expect.poll(() => message().value).toBe('The last commit');
    expect(commands.get('changes.amend')?.checked?.(FROM_VIEW)).toBe(true);
    await userEvent.click(amend());
    expect(message().value).toBe('mine');
    // Edited since: kept.
    await userEvent.click(amend());
    await expect.poll(() => message().value).toBe('The last commit');
    await userEvent.type(message(), '!');
    commands.execute('changes.amend', FROM_VIEW);
    expect(message().value).toBe('The last commit!');
    // Amending needs no files.
    await userEvent.click(amend());
    for (const key of [GROUP, UNVERSIONED]) {
      if (include(key).checked) await userEvent.click(include(key));
    }
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect
      .poll(() => host.params('git.commit').at(-1))
      .toMatchObject({
        files: [],
        amend: true,
      });
    await expect.poll(() => notifications.all.get(0)?.title).toBe('No files committed');
  });

  it('keeps the message when the last one is empty or the same, or Amend is turned off meanwhile', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    git.lastMessage = '';
    await userEvent.type(message(), 'mine');
    await userEvent.click(amend());
    await expect.poll(() => host.params('git.lastMessage')).toHaveLength(1);
    expect(message().value).toBe('mine');
    await userEvent.click(amend());
    git.lastMessage = ' mi ne ';
    await userEvent.click(amend());
    await expect.poll(() => host.params('git.lastMessage')).toHaveLength(2);
    expect(message().value).toBe('mine');
    await userEvent.click(amend());
    git.lastMessage = 'The last commit';
    commands.execute('changes.amend', FROM_VIEW);
    commands.execute('changes.amend', FROM_VIEW);
    await expect.poll(() => host.params('git.lastMessage')).toHaveLength(3);
    expect(message().value).toBe('mine');
  });

  it('says why it couldn’t read the last commit', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    git.failing = 'git.lastMessage';
    commands.execute('changes.amend', FROM_VIEW);
    expect(await dialogText()).toBe('git.lastMessage failed');
    await press('Close');
    commands.execute('changes.amend', FROM_VIEW);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await userEvent.click(amend());
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the last commit failed');
  });

  it('commits by Cmd+Enter on macOS too', async () => {
    const mac = new Keymap('mac');
    git.changes = CHANGES;
    const box = document.createElement('div');
    document.body.append(box);
    const handle = render(
      () => <ChangesView services={{ commands, menus, keymap: mac }} open={() => undefined} />,
      box,
    );
    dispose = () => {
      handle.dispose();
    };
    await expect.poll(rows).toHaveLength(9);
    await userEvent.type(message(), 'From a Mac');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await expect
      .poll(() => host.params('git.commit').at(-1))
      .toMatchObject({
        message: 'From a Mac',
      });
  });
});

describe('Select Opened File, Expand All and Collapse All', () => {
  it('select the active tab’s file, opening what holds it', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    await userEvent.dblClick(row(`${GROUP}:src/main/`));
    await userEvent.dblClick(row(GROUP));
    await expect.poll(rows).toEqual(['Changes4 files', 'Unversioned Files1 file', 'notes.txt']);
    expect(commands.isEnabled('changes.selectOpened', FROM_VIEW)).toBe(false);
    activeTab = `${wt}/src/main/new.ts`;
    commands.execute('changes.selectOpened', FROM_VIEW);
    await expect
      .poll(() =>
        (row(`${GROUP}:src/main/new.ts`) as HTMLElement | undefined)?.getAttribute('aria-selected'),
      )
      .toBe('true');
    activeTab = 'diff:notes.txt';
    commands.execute('changes.selectOpened', FROM_VIEW);
    await expect
      .poll(() => row(`${UNVERSIONED}:notes.txt`).getAttribute('aria-selected'))
      .toBe('true');
    // A comparison of branches: no file to select.
    activeTab = 'compare:main..feature';
    expect(commands.isEnabled('changes.selectOpened', FROM_VIEW)).toBe(false);
    // Not a changed file: nothing selected anew.
    activeTab = 'elsewhere.ts';
    commands.execute('changes.selectOpened', FROM_VIEW);
    expect(row(`${UNVERSIONED}:notes.txt`).getAttribute('aria-selected')).toBe('true');
  });

  it('expand or collapse every row', async () => {
    await changesView();
    await expect.poll(rows).toHaveLength(9);
    commands.execute('changes.collapseAll', FROM_VIEW);
    await expect.poll(rows).toEqual(['Changes4 files', 'Unversioned Files1 file']);
    commands.execute('changes.expandAll', FROM_VIEW);
    await expect.poll(rows).toHaveLength(9);
    expect(commands.isEnabled('changes.expandAll')).toBe(false);
  });
});

describe('the Agent Changes window', () => {
  const TURNS: Turn[] = [
    {
      id: 't2',
      start: 'b',
      end: 'c',
      prompt: 'Fix the tests\nand more',
      time: Date.UTC(2026, 9, 3, 9),
    },
    { id: 't1', start: 'a', end: 'b', prompt: '', time: Date.UTC(2026, 9, 3, 8) },
  ];
  const time = (t: number) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  it('says there are no turns yet', async () => {
    git.turns = [];
    mount(AgentChangesView);
    await expect.poll(empty).toBe('No turns yet');
  });

  it('lists each turn, the latest first, with the files it changed, read once', async () => {
    git.turns = TURNS;
    git.turnFiles = {
      'b..c': [
        { path: 'src/a.ts', status: 'modified' },
        { path: 'gone.ts', status: 'deleted' },
      ],
    };
    mount(AgentChangesView);
    await expect
      .poll(rows)
      .toEqual([
        `${time(TURNS[0]?.time as number)} Fix the tests`,
        `Turn at ${time(TURNS[1]?.time as number)}`,
      ]);
    expect(row('turn:t2').querySelector('[title]')?.getAttribute('title')).toBe(
      'Fix the tests\nand more',
    );
    await userEvent.dblClick(row('turn:t2'));
    await expect.poll(rows).toHaveLength(5);
    // Folders first.
    expect(rows().slice(1, 4)).toEqual(['src1 file', 'a.ts', 'gone.ts']);
    await userEvent.dblClick(row('turn:t2:src/a.ts'));
    await userEvent.dblClick(row('turn:t2:gone.ts'));
    expect(opened).toEqual([{ id: `${wt}/src/a.ts`, title: 'a.ts' }]);
    commands.execute('changes.showDiff', FROM_AGENT);
    expect(opened.at(-1)).toEqual({ id: 'diff@b..c:gone.ts', title: 'gone.ts' });
    // Through its turn's files.
    expect(chains.at(-1)).toEqual(['src/a.ts', 'gone.ts']);
    expect(commands.isEnabled('changes.rollback', FROM_AGENT)).toBe(false);
    commands.execute('changes.collapseAll', FROM_AGENT);
    commands.execute('changes.expandAll', FROM_AGENT);
    // The earlier turn changed nothing; the later's files were read once.
    await expect.poll(rows).toHaveLength(5);
    await expect.poll(() => rows().at(-1)).toBe(rows()[4]);
    expect(
      host.params('git.changes').filter((p) => (p as { from?: string }).from !== undefined),
    ).toHaveLength(2);
    // Read again, a turn's files are as they were: not asked for again.
    git.changes = [CHANGES[0] as Change];
    commands.execute('changes.refresh', FROM_AGENT);
    await expect.poll(() => host.params('agent.turns').length).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      host.params('git.changes').filter((p) => (p as { from?: string }).from !== undefined),
    ).toHaveLength(2);
    await userEvent.click(row('turn:t2'), { button: 'right' });
    expect(await menuItems()).toEqual(expect.arrayContaining(['Show Diff', 'Refresh']));
  });

  it('reads a turn’s files again if they couldn’t be', async () => {
    git.turns = [TURNS[0] as Turn];
    git.turnFiles = {};
    git.failing = 'git.changes';
    // The worktree's own changes fail too, said in the console, and are read again.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount(AgentChangesView);
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the changes failed');
    git.failing = undefined;
    vi.advanceTimersByTime(REFRESH_MS);
    await expect.poll(rows).toHaveLength(1);
    git.failing = 'git.changes';
    await userEvent.dblClick(row('turn:t2'));
    await expect.poll(() => host.params('git.changes').length).toBeGreaterThan(1);
    git.failing = undefined;
    commands.execute('changes.collapseAll', FROM_AGENT);
    git.turnFiles = { 'b..c': [{ path: 'x.ts', status: 'added' }] };
    commands.execute('changes.expandAll', FROM_AGENT);
    await expect.poll(rows).toEqual([expect.any(String), 'x.ts']);
    // Read again for a while, until it's gone.
    window.dispatchEvent(new Event('focus'));
    dispose?.();
    dispose = undefined;
    const now = host.asked.length;
    vi.advanceTimersByTime(REFRESH_MS);
    window.dispatchEvent(new Event('focus'));
    expect(host.asked.length).toBe(now);
  });
});

describe('the changes read again', () => {
  it('after something changed them, where the window has shown them', async () => {
    await refreshChanges('/elsewhere');
    await changesView();
    const reads = host.params('git.changes').length;
    await refreshChanges(wt);
    expect(host.params('git.changes').length).toBe(reads + 1);
  });
});
