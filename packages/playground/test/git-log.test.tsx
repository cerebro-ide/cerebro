import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectOf, useProjects, workspace } from '../src/environments.js';
import type { Tab } from '@cerebro-ide/layout';
import { userEvent } from 'vitest/browser';
import { SHOW_DELAY } from '@cerebro-ide/ui-tooltip';
import type { Change } from '../src/changes.js';
import { formatCommitDate } from '../src/dates.js';
import {
  EMPTY_TREE,
  GitLogView,
  matchRanges,
  PAGE,
  rangeOf,
  refsOf,
  rememberText,
  setupLog,
  showHistory,
  showInLog,
  textHistory,
  viewCommits,
  type LogCommit,
  type LogCommitContext,
} from '../src/git-log.js';
import { branchTree, type Branch } from '../src/log-branches.js';
import { setupApplyChanges } from '../src/apply-changes.js';
import { answer, dialog, FakeHost, press, project } from './fakes.js';
import { notifications } from '../src/notifications.js';

/** A line of `count` commits, newest first, the first with `refs`. */
function history(count: number, refs: string[] = [], prefix = 'c'): LogCommit[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: `${prefix}${String(i)}`,
    parents: i + 1 < count ? [`${prefix}${String(i + 1)}`] : [],
    author: 'Ada',
    email: 'ada@example.com',
    time: new Date(2026, 0, 2, 10, 15).getTime(),
    subject: `Change ${String(i)}`,
    body: i === 0 ? 'Why it changed.' : '',
    refs: i === 0 ? refs : [],
  }));
}

/** The repository's log, as the host answers it; or why it can't. */
const git = {
  log: [] as LogCommit[],
  failing: undefined as string | undefined,
  /** A page held until it resolves. */
  hold: undefined as Promise<void> | undefined,
  /** A commit's changes, by its range. */
  changes: {} as Record<string, Change[]>,
  /** The log of a branch the Log is filtered by. */
  byBranch: {} as Record<string, LogCommit[]>,
  /** The log a text filter matches, by its text. */
  byText: {} as Record<string, LogCommit[]>,
  /** The log the User filter's authors have, by the authors between commas. */
  byAuthors: {} as Record<string, LogCommit[]>,
  /** The log the Paths filter's paths have, by the paths between commas, in order. */
  byPaths: {} as Record<string, LogCommit[]>,
  authors: {
    authors: [] as { name: string; email: string }[],
    me: undefined as undefined | { name: string; email: string },
  },
  branches: [] as Branch[],
  branchesFailing: undefined as string | undefined,
  tags: ['v1', 'v2'] as string[] | Error,
  /** The commit each revision names, as `git rev-parse` would. */
  revisions: {} as Record<string, string>,
};
const host = new FakeHost({
  'git.log': async ({
    skip,
    max,
    branches,
    filter,
  }: {
    skip: number;
    max: number;
    branches?: string[];
    filter?: { text?: { text: string }; authors?: string[]; after?: number; paths?: string[] };
  }) => {
    const log = filter?.paths
      ? (git.byPaths[[...filter.paths].sort().join(', ')] ?? [])
      : filter?.text
        ? (git.byText[filter.text.text] ?? [])
        : filter?.authors
          ? (git.byAuthors[filter.authors.join(', ')] ?? [])
          : filter
            ? git.log.slice(0, 1)
            : branches
              ? (git.byBranch[branches[0] as string] ?? [])
              : git.log;
    const hold = git.hold;
    git.hold = undefined;
    await hold;
    if (git.failing !== undefined) throw new Error(git.failing);
    return log.slice(skip, skip + max);
  },
  'git.changes': ({ from, to }: { from: string; to: string }) => {
    if (git.failing !== undefined) throw new Error(git.failing);
    return git.changes[`${from}..${to}`] ?? [];
  },
  'git.authors': () => git.authors,
  'git.cherryPick': () => 'picked',
  'git.state': () => ({ conflicts: false }),
  'git.status': () => ({ files: [] }),
  'git.shelves': () => [],
  'git.stashes': () => [],
  'git.tags': () => {
    if (git.tags instanceof Error) throw git.tags;
    return git.tags;
  },
  'git.resolveRevision': ({ revision }: { revision: string }) => git.revisions[revision] ?? null,
  'fs.list': ({ path }: { path: string }) =>
    path === '/r'
      ? [
          { path: '/r/src', name: 'src', kind: 'directory' },
          { path: '/r/a.txt', name: 'a.txt', kind: 'file' },
          { path: '/r/out', name: 'out', kind: 'directory', ignored: true },
        ]
      : [{ path: '/r/src/main.ts', name: 'main.ts', kind: 'file' }],
  'git.branches': () => {
    if (git.branchesFailing !== undefined) throw new Error(git.branchesFailing);
    return git.branches;
  },
});
const commands = new CommandRegistry();
const services: MenuServices = { commands, menus: new MenuRegistry(), keymap: new Keymap('other') };
const opened: Tab[] = [];
/** The files each diff opened goes through. */
const chains: (readonly string[] | undefined)[] = [];

let dispose: (() => void) | undefined;

/** How many times View Commits showed the Git tool window. */
let shownLog = 0;

beforeAll(() => {
  setupApplyChanges(services);
  setupLog(services, () => {
    shownLog++;
  });
  useProjects([
    project('/r', host),
    project('/s', undefined),
    { ...project('/n', host), git: false },
  ]);
});

beforeEach(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  host.asked.length = 0;
  opened.length = 0;
  chains.length = 0;
  git.failing = undefined;
  git.branchesFailing = undefined;
  git.branches = [];
  for (const id of ['/r', '/s', '/n']) workspace.close(id);
});

function mount(withServices: MenuServices = services) {
  const box = document.createElement('div');
  // Wide enough for the whole toolbar, past the test page's own width.
  box.style.width = '1400px';
  box.style.height = '600px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  document.body.append(box);
  const handle = render(
    () => (
      <GitLogView
        services={withServices}
        open={(tab, chain) => {
          opened.push(tab);
          chains.push(chain);
        }}
      />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
  return box;
}

const rows = () => [
  ...document.querySelectorAll<HTMLElement>('.playground-log__commits .cerebro-tree-row'),
];
const fileRows = () => [
  ...document.querySelectorAll<HTMLElement>('.playground-log__files .cerebro-tree-row'),
];
const files = () => fileRows().map((row) => row.textContent.trim());
const details = () =>
  [...document.querySelectorAll('.playground-log__details p')].map((p) => p.textContent);
const pane = () => document.querySelector('.playground-log__pane') as HTMLElement;
const subjects = () =>
  rows().map((row) => row.querySelector('.playground-log__message')?.textContent);
/** Why the Log shows no commits. */
const note = () =>
  document.querySelector(
    '.playground-log > .playground-project__empty, .playground-log__list > .playground-project__empty',
  )?.textContent;
const tree = () => document.querySelector('.playground-log__commits .cerebro-tree') as HTMLElement;
const skips = () => host.params('git.log').map((p) => (p as { skip: number }).skip);

describe('a commit’s refs', () => {
  it('are labelled by kind, the checked-out branch first, a remote’s HEAD left out', () => {
    expect(
      refsOf([
        'tag: refs/tags/v1',
        'refs/remotes/origin/main',
        'refs/remotes/origin/HEAD',
        'HEAD -> refs/heads/main',
        'refs/heads/side',
        'refs/stash',
      ]),
    ).toEqual([
      { name: 'main', kind: 'head' },
      { name: 'side', kind: 'local' },
      { name: 'origin/main', kind: 'remote' },
      { name: 'v1', kind: 'tag' },
    ]);
    expect(refsOf(['HEAD'])).toEqual([{ name: 'HEAD', kind: 'head' }]);
  });
});

describe('a commit’s date', () => {
  it('names today and yesterday, with the time; others are a date and time', () => {
    const now = new Date(2026, 10, 4, 18, 0).getTime();
    const clock = (time: number) =>
      new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const today = new Date(2026, 10, 4, 9, 5).getTime();
    const yesterday = new Date(2026, 10, 3, 23, 59).getTime();
    const before = new Date(2026, 10, 2, 12, 0).getTime();
    expect(formatCommitDate(today, now)).toBe(`Today ${clock(today)}`);
    expect(formatCommitDate(yesterday, now)).toBe(`Yesterday ${clock(yesterday)}`);
    expect(formatCommitDate(before, now)).toBe(
      new Date(before).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    );
    // Across a new year.
    const newYear = new Date(2027, 0, 1, 8, 0).getTime();
    const lastYear = new Date(2026, 11, 31, 8, 0).getTime();
    expect(formatCommitDate(lastYear, newYear)).toBe(`Yesterday ${clock(lastYear)}`);
  });
});

describe('the Log', () => {
  it('says why it shows nothing: no environment, a browser, or no git', () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    mount();
    expect(note()).toBe('The log shows in the desktop app.');
    workspace.openOrActivate({ id: '/n', name: 'n', branch: 'main' });
    expect(note()).toBe('Not a git repository');
    for (const id of ['/r', '/s', '/n']) workspace.close(id);
    expect(note()).toBe('No environment open');
  });

  it('lists the commits, each with its graph, subject, refs, author and date', async () => {
    git.log = history(3, [
      'HEAD -> refs/heads/main',
      'refs/remotes/origin/main',
      'tag: refs/tags/v1',
    ]);
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1', 'Change 2']);
    expect(host.params('git.log')).toEqual([{ worktree: '/r', skip: 0, max: PAGE }]);
    const first = rows()[0] as HTMLElement;
    expect(
      [...first.querySelectorAll('.playground-log__ref')].map((ref) => [
        ref.className,
        ref.textContent,
      ]),
    ).toEqual([
      ['playground-log__ref playground-log__ref--head', 'main'],
      ['playground-log__ref playground-log__ref--remote', 'origin/main'],
      ['playground-log__ref playground-log__ref--tag', 'v1'],
    ]);
    const author = first.querySelector('.playground-log__author') as HTMLElement;
    expect([author.textContent, author.title]).toEqual(['Ada', 'ada@example.com']);
    expect(first.querySelector('.playground-log__date')?.textContent).toBe(
      formatCommitDate((git.log[0] as LogCommit).time),
    );
    // The dot in the first lane, in the branch's colour; a line down to its parent, none above.
    const graph = first.querySelector('.playground-log__graph') as SVGSVGElement;
    expect(graph.getAttribute('width')).toBe('14');
    const dot = graph.querySelector('circle') as SVGCircleElement;
    expect([dot.getAttribute('cx'), dot.getAttribute('class')]).toEqual([
      '7',
      'playground-log__dot playground-log__color-0',
    ]);
    expect(
      [...graph.querySelectorAll('line')].map((line) =>
        ['x1', 'y1', 'x2', 'y2'].map((a) => line.getAttribute(a)),
      ),
    ).toEqual([['7', '12', '7', '24']]);
  });

  it('says when there are no commits, or why it couldn’t read them', async () => {
    git.log = [];
    mount();
    await expect.poll(note).toBe('No commits');
    dispose?.();
    git.failing = 'fatal: not a git repository';
    mount();
    await expect.poll(note).toBe('fatal: not a git repository');
    // Read again as the window gets the focus, it shows them.
    git.failing = undefined;
    git.log = history(1);
    window.dispatchEvent(new Event('focus'));
    await expect.poll(subjects).toEqual(['Change 0']);
  });

  it('loads the next page as the list scrolls near its end, until there are no more', async () => {
    git.log = history(PAGE + 5);
    mount();
    await expect.poll(() => rows().length).toBeGreaterThan(0);
    expect(skips()).toEqual([0]);
    tree().scrollTop = tree().scrollHeight;
    await expect.poll(skips).toEqual([0, PAGE]);
    await expect.poll(() => subjects().at(-1)).toBe(`Change ${String(PAGE + 4)}`);
    // All loaded: no more is asked for.
    tree().scrollTop = 0;
    tree().scrollTop = tree().scrollHeight;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(skips()).toEqual([0, PAGE]);
  });

  it('reads the list again with the focus back, and keeps it if it’s the same', async () => {
    git.log = history(2);
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    const before = rows()[0];
    window.dispatchEvent(new Event('focus'));
    await expect.poll(skips).toEqual([0, 0]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The same rows, not drawn again.
    expect(rows()[0]).toBe(before);
    git.log = history(3, [], 'd');
    window.dispatchEvent(new Event('focus'));
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1', 'Change 2']);
    expect(rows()[0]?.getAttribute('data-key')).toBe('d0');
    // Gone with the window: the focus reads nothing.
    dispose?.();
    dispose = undefined;
    window.dispatchEvent(new Event('focus'));
    expect(skips()).toHaveLength(3);
  });

  it('drops a page that comes after the list was read again, and says why one couldn’t load', async () => {
    git.log = history(PAGE + 5);
    mount();
    await expect.poll(() => rows().length).toBeGreaterThan(0);
    // The next page is held while the list is read again, changed.
    let release: () => void = () => undefined;
    git.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    tree().scrollTop = tree().scrollHeight;
    await expect.poll(skips).toEqual([0, PAGE]);
    git.log = history(3, [], 'd');
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('d0');
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subjects()).toEqual(['Change 0', 'Change 1', 'Change 2']);
    // A page that fails says why.
    dispose?.();
    git.log = history(PAGE + 5);
    mount();
    await expect.poll(() => rows().length).toBeGreaterThan(0);
    git.failing = 'git log failed';
    tree().scrollTop = tree().scrollHeight;
    await expect.poll(note).toBe('git log failed');
  });
});

describe('the Log, after a checkout', () => {
  it('is the same Log, its selection kept, when the worktrees are read again', async () => {
    git.log = history(2);
    mount();
    await expect.poll(subjects).toHaveLength(2);
    await userEvent.click(rows()[1] as HTMLElement);
    const commits = document.querySelector('.playground-log__commits');
    // As after a checkout: the worktrees read again, the same, in a new list.
    const worktrees = projectOf('/r')?.worktrees;
    worktrees?.set([...worktrees.peek()]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('.playground-log__commits')).toBe(commits);
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('a commit’s pane', () => {
  it('compares a commit with its first parent, or a root commit with the empty tree', () => {
    const root = history(1)[0] as LogCommit;
    expect(rangeOf({ ...root, hash: 'm', parents: ['a', 'b'] })).toEqual({ from: 'a', to: 'm' });
    expect(rangeOf(root)).toEqual({ from: EMPTY_TREE, to: 'c0' });
  });

  it('shows the selected commit’s files and details, and opens a file’s diff or the file', async () => {
    git.log = history(2);
    git.changes['c1..c0'] = [
      { path: 'src/a.ts', status: 'modified' },
      { path: 'gone.ts', status: 'deleted' },
    ];
    git.changes[`${EMPTY_TREE}..c1`] = [{ path: 'first.ts', status: 'added' }];
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    expect(pane().querySelector('.playground-project__empty')?.textContent).toBe(
      'No commits selected',
    );
    await userEvent.click(rows()[0] as HTMLElement);
    // The file's folder after its name, as a flat list has it.
    await expect.poll(files).toEqual(['a.tssrc', 'gone.ts']);
    expect(host.params('git.changes')).toEqual([{ path: '/r', from: 'c1', to: 'c0' }]);
    const commit = git.log[0] as LogCommit;
    const when = new Date(commit.time).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(details()).toEqual([
      'Change 0',
      'Why it changed.',
      `c0 Ada <ada@example.com> on ${when}`,
    ]);
    // A double click opens the file's diff, between the two commits.
    const file = (name: string) =>
      fileRows().find((row) => row.textContent.includes(name)) as HTMLElement;
    await userEvent.dblClick(file('a.ts'));
    expect(opened).toEqual([{ id: 'diff@c1..c0:src/a.ts', title: 'a.ts' }]);
    // Through the commit's files, as IntelliJ's.
    expect(chains).toEqual([['src/a.ts', 'gone.ts']]);
    // F4 opens the file itself; not one that's deleted, nor on other keys.
    await userEvent.keyboard('{F4}');
    expect(opened.at(-1)).toEqual({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.keyboard('x');
    await userEvent.click(file('gone.ts'));
    await userEvent.keyboard('{F4}');
    expect(opened).toHaveLength(2);
    // The root commit, compared with the empty tree; with no body, no paragraph for it.
    await userEvent.click(rows()[1] as HTMLElement);
    await expect.poll(files).toEqual(['first.ts']);
    expect(details()).toHaveLength(2);
  });

  it('says why a commit’s files couldn’t be read', async () => {
    git.log = history(1);
    mount();
    await expect.poll(subjects).toEqual(['Change 0']);
    git.failing = 'bad object';
    await userEvent.click(rows()[0] as HTMLElement);
    await expect
      .poll(() => pane().querySelector('.playground-project__empty')?.textContent)
      .toBe('bad object');
  });

  it('is as wide as the splitter is dragged, never less than nothing', async () => {
    git.log = history(1);
    mount();
    await expect.poll(subjects).toEqual(['Change 0']);
    expect(pane().style.width).toBe('400px');
    const splitter = document.querySelectorAll(
      '.playground-log .cerebro-splitter',
    )[1] as HTMLElement;
    const box = splitter.getBoundingClientRect();
    const drag = (by: number) => {
      const at = (x: number) => ({ clientX: x, clientY: box.top + 10, bubbles: true, button: 0 });
      splitter.dispatchEvent(new PointerEvent('pointerdown', at(box.left)));
      window.dispatchEvent(new PointerEvent('pointermove', at(box.left + by)));
      window.dispatchEvent(new PointerEvent('pointerup', at(box.left + by)));
    };
    drag(-100);
    expect(pane().style.width).toBe('500px');
    drag(10_000);
    expect(pane().style.width).toBe('0px');
  });
});

const branch = (ref: string, current = false): Branch => ({ ref, hash: 'h', current });

describe('showing a commit, as from an annotation', () => {
  const selected = () =>
    document
      .querySelector('.playground-log__commits .cerebro-tree-row[aria-selected="true"]')
      ?.getAttribute('data-key');
  const selectedFile = () =>
    document
      .querySelector('.playground-log__files .cerebro-tree-row[aria-selected="true"]')
      ?.textContent.trim();

  it('selects it, loading pages until it’s there, and its file among its changes', async () => {
    git.log = history(PAGE + 5);
    const hash = `c${String(PAGE + 2)}`;
    git.changes[`c${String(PAGE + 3)}..${hash}`] = [
      { path: 'a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'modified' },
    ];
    // Asked before the Log shows: taken once it has.
    showInLog(hash, 'src/b.ts');
    mount();
    await expect.poll(selected).toBe(hash);
    expect(skips()).toEqual([0, PAGE]);
    await expect.poll(selectedFile).toBe('b.tssrc');
    // Another commit chosen: no file selected among its changes.
    const other = rows().find((row) => row.getAttribute('data-key') !== hash) as HTMLElement;
    await userEvent.click(other);
    await expect.poll(selected).toBe(other.getAttribute('data-key'));
    expect(selectedFile()).toBeUndefined();
  });

  it('clears the filters when they leave it out, and says so when it isn’t there at all', async () => {
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const field = document.querySelector('.playground-log__search-field') as HTMLInputElement;
    await userEvent.click(field);
    await userEvent.keyboard('fix{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    showInLog('c2', 'a.ts');
    await expect.poll(selected).toBe('c2');
    expect(field.value).toBe('');
    // Not in the log, filtered or not.
    showInLog('gone', 'a.ts');
    await expect.poll(() => notifications.all.get(0)?.title).toBe('Commit gone isn’t in the log');
    expect(selected()).toBe('c2');
  });
});

describe('View Commits, after an update', () => {
  it('shows the Git window, its Log the commits between, the other filters but Paths cleared', async () => {
    const start = `${'a'.repeat(8)}${'1'.repeat(32)}`;
    const end = `${'b'.repeat(8)}${'2'.repeat(32)}`;
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    git.byBranch[`${start}..${end}`] = history(2, [], 'u');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const field = document.querySelector('.playground-log__search-field') as HTMLInputElement;
    await userEvent.click(field);
    await userEvent.keyboard('fix{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    const before = shownLog;
    viewCommits({ start, end });
    expect(shownLog).toBe(before + 1);
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('u0');
    expect(field.value).toBe('');
    // git's range, its ends shortened in the Branch filter.
    expect(host.params('git.log').at(-1)).toEqual({
      worktree: '/r',
      skip: 0,
      max: PAGE,
      branches: [`${start}..${end}`],
    });
    expect(
      document.querySelector('.playground-log__toolbar .cerebro-toolbar-dropdown__text')
        ?.textContent,
    ).toBe('Branch: aaaaaaaa..bbbbbbbb');
    // In full in its tooltip.
    await userEvent.hover(
      document.querySelector('.playground-log__toolbar .cerebro-toolbar-dropdown') as HTMLElement,
    );
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe(`${start}..${end}`);
  });
});

describe('Show History, from Git → Current File', () => {
  it('shows the Git window, its Log the commits of HEAD that change the file, other filters cleared', async () => {
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    git.byPaths['src/a.ts'] = history(2, [], 'h');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const field = document.querySelector('.playground-log__search-field') as HTMLInputElement;
    await userEvent.click(field);
    await userEvent.keyboard('fix{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    const before = shownLog;
    showHistory('src/a.ts');
    expect(shownLog).toBe(before + 1);
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('h0');
    expect(field.value).toBe('');
    expect(host.params('git.log').at(-1)).toEqual({
      worktree: '/r',
      skip: 0,
      max: PAGE,
      branches: ['HEAD'],
      filter: { paths: ['src/a.ts'] },
    });
    const texts = [
      ...document.querySelectorAll('.playground-log__toolbar .cerebro-toolbar-dropdown__text'),
    ].map((text) => text.textContent);
    expect(texts).toContain('Branch: HEAD');
    expect(texts).toContain('Paths: src/a.ts');
    // View Commits after it keeps the Paths filter, as IntelliJ's tab for it has the Log's paths.
    git.byPaths['src/a.ts'] = history(1, [], 'u');
    viewCommits({ start: 'a1', end: 'b2' });
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('u0');
    expect(host.params('git.log').at(-1)).toMatchObject({
      branches: ['a1..b2'],
      filter: { paths: ['src/a.ts'] },
    });
  });
});

describe('the branches', () => {
  it('are HEAD, then the local ones and the remote ones, by directory, as IntelliJ orders them', () => {
    const names = (nodes: ReturnType<typeof branchTree>): unknown[] =>
      nodes.map((node) =>
        node.kind === 'head'
          ? 'HEAD'
          : node.kind === 'branch'
            ? node.name
            : { [node.name]: names(node.children) },
      );
    expect(
      names(
        branchTree([
          branch('refs/heads/main'),
          branch('refs/heads/feat/b10'),
          branch('refs/heads/feat/b9'),
          branch('refs/heads/Zed', true),
          branch('refs/heads/alpha'),
          branch('refs/remotes/origin/main'),
          branch('refs/remotes/origin/fix/x'),
          branch('refs/remotes/up/main'),
        ]),
      ),
    ).toEqual([
      'HEAD',
      { Local: ['Zed', { feat: ['b9', 'b10'] }, 'alpha', 'main'] },
      { Remote: [{ origin: [{ fix: ['x'] }, 'main'] }, { up: ['main'] }] },
    ]);
    // No branches yet: HEAD alone.
    expect(names(branchTree([]))).toEqual(['HEAD']);
  });

  const branchRows = () => [
    ...document.querySelectorAll<HTMLElement>('.playground-log__branches .cerebro-tree-row'),
  ];
  const branchNames = () => branchRows().map((row) => row.textContent.trim());
  const filterText = () =>
    document.querySelector('.playground-log__toolbar .cerebro-toolbar-dropdown__text')?.textContent;
  const popupItems = () =>
    [...document.querySelectorAll('.cerebro-popup-item__label')].map((label) => label.textContent);

  it('show in a pane, and filter the Log by the one double-clicked, or chosen in the toolbar', async () => {
    git.log = history(3);
    git.byBranch['refs/heads/feat/x'] = history(2, [], 'f');
    git.byBranch.HEAD = history(1, [], 'h');
    git.branches = [
      branch('refs/heads/main', true),
      branch('refs/heads/feat/x'),
      branch('refs/remotes/origin/main'),
    ];
    mount();
    await expect
      .poll(branchNames)
      .toEqual(['HEAD (Current Branch)', 'Local', 'main', 'feat', 'Remote', 'origin']);
    expect(filterText()).toBe('Branch');
    // The branch checked out, marked.
    expect(document.querySelector('.playground-branches__name--current')?.textContent).toBe('main');
    await userEvent.click(branchRows()[3] as HTMLElement);
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(branchNames).toContain('x');
    await userEvent.dblClick(
      branchRows().find((row) => row.textContent.trim() === 'x') as HTMLElement,
    );
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    expect(rows()[0]?.getAttribute('data-key')).toBe('f0');
    expect(host.params('git.log').at(-1)).toEqual({
      worktree: '/r',
      skip: 0,
      max: PAGE,
      branches: ['refs/heads/feat/x'],
    });
    expect(filterText()).toBe('Branch: feat/x');
    // A branch with none listed (the host's answer, here): none.
    await userEvent.dblClick(
      branchRows().find((row) => row.textContent.trim() === 'origin') as HTMLElement,
    );
    await expect.poll(branchNames).toContain('main');
    await userEvent.dblClick(branchRows().at(-1) as HTMLElement);
    await expect.poll(note).toBe('No commits');
    // HEAD, by Enter.
    await userEvent.click(branchRows()[0] as HTMLElement);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('h0');
    expect(filterText()).toBe('Branch: HEAD');
    // All again, from the toolbar's Branch filter: the one in use is checked.
    const dropdown = document.querySelector(
      '.playground-log__toolbar .cerebro-toolbar-dropdown',
    ) as HTMLElement;
    await userEvent.click(dropdown);
    await expect
      .poll(popupItems)
      .toEqual(['All', 'HEAD (Current Branch)', 'main', 'feat/x', 'origin/main']);
    expect(
      [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent),
    ).toEqual(['Local', 'Remote']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1', 'Change 2']);
    expect(filterText()).toBe('Branch');
    expect(host.params('git.log').at(-1)).toEqual({ worktree: '/r', skip: 0, max: PAGE });
    // Closed without a choice, the filter stays.
    await userEvent.click(dropdown);
    await expect.poll(popupItems).toHaveLength(5);
    await userEvent.keyboard('{Escape}');
    expect(filterText()).toBe('Branch');
  });

  it('drop a list read before the filter changed', async () => {
    git.log = history(3);
    git.byBranch['refs/heads/main'] = history(1, [], 'm');
    git.branches = [branch('refs/heads/main', true)];
    mount();
    await expect.poll(subjects).toHaveLength(3);
    let release: () => void = () => undefined;
    git.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.dispatchEvent(new Event('focus'));
    await expect.poll(skips).toEqual([0, 0]);
    await userEvent.dblClick(
      branchRows().find((row) => row.textContent.trim() === 'main') as HTMLElement,
    );
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('m0');
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows().map((row) => row.getAttribute('data-key'))).toEqual(['m0']);
  });

  it('say why they couldn’t be read', async () => {
    git.log = history(1);
    git.branchesFailing = 'no refs';
    mount();
    await expect
      .poll(
        () =>
          document.querySelector('.playground-branches .playground-project__empty')?.textContent,
      )
      .toBe('no refs');
  });

  it('are as wide as their splitter is dragged, never less than nothing', () => {
    git.log = history(1);
    mount();
    const side = document.querySelector('.playground-log__branches') as HTMLElement;
    expect(side.style.width).toBe('200px');
    const splitter = document.querySelector('.playground-log .cerebro-splitter') as HTMLElement;
    const box = splitter.getBoundingClientRect();
    const drag = (by: number) => {
      const at = (x: number) => ({ clientX: x, clientY: box.top + 10, bubbles: true, button: 0 });
      splitter.dispatchEvent(new PointerEvent('pointerdown', at(box.left)));
      window.dispatchEvent(new PointerEvent('pointermove', at(box.left + by)));
      window.dispatchEvent(new PointerEvent('pointerup', at(box.left + by)));
    };
    drag(50);
    expect(side.style.width).toBe('250px');
    drag(-10_000);
    expect(side.style.width).toBe('0px');
  });
});

describe('the branches’ toolbar', () => {
  const branchRows = () => [
    ...document.querySelectorAll<HTMLElement>('.playground-log__branches .cerebro-tree-row'),
  ];
  const branchNames = () => branchRows().map((row) => row.textContent.trim());
  const named = (name: string) =>
    branchRows().find((row) => row.textContent.trim() === name) as HTMLElement;
  const toolbar = () => document.querySelector('.playground-log__branches-toolbar') as HTMLElement;
  const button = (id: string) =>
    toolbar().querySelector(`[data-command="${id}"]`) as HTMLButtonElement;
  const selected = () =>
    document
      .querySelector('.playground-log__commits .cerebro-tree-row[aria-selected="true"]')
      ?.getAttribute('data-key');

  it('runs down their side, in IntelliJ’s order: what of it is here', () => {
    git.log = history(1);
    mount();
    expect(toolbar().getAttribute('aria-orientation')).toBe('vertical');
    expect(
      [...toolbar().querySelectorAll('[data-command]')].map((b) => b.getAttribute('data-command')),
    ).toEqual([
      'log.branches.newBranch',
      'log.branches.delete',
      'vcs.fetch',
      'log.branches.navigate',
      'log.branches.expandAll',
      'log.branches.collapseAll',
    ]);
  });

  it('navigates the Log to the head of HEAD or the branch selected; expands and collapses all', async () => {
    git.log = history(3);
    git.branches = [
      branch('refs/heads/main', true),
      branch('refs/heads/feat/x'),
      branch('refs/remotes/origin/main'),
    ];
    git.revisions = { HEAD: 'c0', 'refs/heads/feat/x': 'c2' };
    mount();
    await expect
      .poll(branchNames)
      .toEqual(['HEAD (Current Branch)', 'Local', 'main', 'feat', 'Remote', 'origin']);
    const navigate = button('log.branches.navigate');
    expect(navigate.getAttribute('aria-label')).toBe('Navigate Log to Selected Branch Head');
    // Nothing selected, or a directory: nowhere to go.
    expect(navigate.disabled).toBe(true);
    await userEvent.click(named('Local'));
    expect(navigate.disabled).toBe(true);
    await userEvent.click(button('log.branches.expandAll'));
    await expect
      .poll(branchNames)
      .toEqual(['HEAD (Current Branch)', 'Local', 'main', 'feat', 'x', 'Remote', 'origin', 'main']);
    await userEvent.click(named('x'));
    await userEvent.click(navigate);
    await expect.poll(selected).toBe('c2');
    expect(host.params('git.resolveRevision').at(-1)).toEqual({
      path: '/r',
      revision: 'refs/heads/feat/x',
    });
    await userEvent.click(branchRows()[0] as HTMLElement);
    await userEvent.click(navigate);
    await expect.poll(selected).toBe('c0');
    // One git can't find, by its name.
    await userEvent.click(branchRows().at(-1) as HTMLElement);
    await userEvent.click(navigate);
    await expect.poll(() => notifications.all.get(0)?.title).toBe('origin/main not found');
    await userEvent.click(button('log.branches.collapseAll'));
    await expect.poll(branchNames).toEqual(['HEAD (Current Branch)', 'Local', 'Remote']);
    git.revisions = {};
  });

  it('gives its actions what’s selected, with the branch checked out, and a way to read the Log again', async () => {
    const given: unknown[] = [];
    commands.register({
      id: 'log.branches.newBranch',
      label: 'New Branch',
      run: (context) => given.push(context),
    });
    git.log = history(2);
    git.branches = [branch('refs/heads/main', true), branch('refs/heads/side')];
    mount();
    await expect.poll(branchNames).toContain('side');
    await userEvent.click(branchRows()[0] as HTMLElement);
    await userEvent.click(button('log.branches.newBranch'));
    await userEvent.click(named('side'));
    await userEvent.click(button('log.branches.newBranch'));
    expect(given).toMatchObject([
      { source: 'log', selection: { kind: 'head', branch: 'main' } },
      { source: 'log', selection: { kind: 'branch', ref: 'refs/heads/side', current: false } },
    ]);
    const reads = skips().length;
    await (given[1] as { refresh: () => Promise<void> }).refresh();
    expect(skips().length).toBe(reads + 1);
    // HEAD detached: no branch to suggest.
    git.branches = [branch('refs/heads/side')];
    window.dispatchEvent(new Event('focus'));
    await expect
      .poll(() => document.querySelector('.playground-branches__name--current'))
      .toBeNull();
    await userEvent.click(branchRows()[0] as HTMLElement);
    await userEvent.click(button('log.branches.newBranch'));
    expect((given[2] as { selection: unknown }).selection).toEqual({
      kind: 'head',
      branch: undefined,
    });
  });
});

describe('Refresh', () => {
  it('reads the Log and its branches again: from the toolbar, or while the Log has the keyboard', async () => {
    git.log = history(1);
    expect(commands.isEnabled('log.refresh', { source: 'log' })).toBe(false);
    mount();
    await expect.poll(subjects).toEqual(['Change 0']);
    const asked = () => [host.params('git.log').length, host.params('git.branches').length];
    expect(asked()).toEqual([1, 1]);
    const button = document.querySelector(
      '.playground-log__toolbar [data-command="log.refresh"]',
    ) as HTMLElement;
    expect(button.getAttribute('aria-label')).toBe('Refresh');
    // Its tooltip names its shortcut.
    await userEvent.hover(button);
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('RefreshCtrl+F5');
    await userEvent.click(button);
    await expect.poll(asked).toEqual([2, 2]);
    // From the keyboard only while the Log has the focus.
    expect(services.keymap?.shortcutsFor('log.refresh')).toEqual(['Ctrl+F5']);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(commands.isEnabled('log.refresh')).toBe(false);
    await userEvent.click(rows()[0] as HTMLElement);
    expect(commands.isEnabled('log.refresh')).toBe(true);
    commands.execute('log.refresh');
    await expect.poll(asked).toEqual([3, 3]);
    // Gone with the window.
    dispose?.();
    dispose = undefined;
    expect(commands.isEnabled('log.refresh', { source: 'log' })).toBe(false);
  });

  it('shows a ref added at a commit already listed, as a tag made since', async () => {
    git.log = history(2);
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    const refs = () =>
      rows().map((row) =>
        [...row.querySelectorAll('.playground-log__ref')].map((ref) => ref.textContent),
      );
    expect(refs()).toEqual([[], []]);
    git.log = history(2).map((commit, i) =>
      i === 1 ? { ...commit, refs: ['tag: refs/tags/v2'] } : commit,
    );
    commands.execute('log.refresh', { source: 'log' });
    await expect.poll(refs).toEqual([[], ['v2']]);
  });

  it('hides behind a » with the Branch filter when the Log is narrow, as IntelliJ’s toolbar', async () => {
    git.log = history(1);
    const box = mount();
    box.style.width = '800px';
    await expect.poll(subjects).toEqual(['Change 0']);
    const toolbar = document.querySelector('.playground-log__toolbar') as HTMLElement;
    const more = toolbar.querySelector('.cerebro-toolbar-row__more') as HTMLElement;
    await expect.poll(() => more.hidden).toBe(false);
    // Nothing past the toolbar's edge, over what's beside it.
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    more.click();
    const popup = document.querySelector('.cerebro-toolbar-row__popup') as HTMLElement;
    popup.querySelector<HTMLElement>('[data-command="log.refresh"]')?.click();
    await expect.poll(() => host.params('git.log').length).toBe(2);
    await userEvent.click(popup.querySelector('.cerebro-toolbar-dropdown') as HTMLElement);
    await expect.poll(() => document.querySelector('.cerebro-popup')).not.toBeNull();
  });

  it('names no shortcut with no keymap', async () => {
    git.log = history(1);
    mount({ commands, menus: new MenuRegistry() });
    await userEvent.hover(
      document.querySelector(
        '.playground-log__toolbar [data-command="log.refresh"]',
      ) as HTMLElement,
    );
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Refresh');
  });

  it('is IntelliJ’s Cmd+R on macOS', () => {
    const keymap = new Keymap('mac');
    setupLog(
      { commands: new CommandRegistry(), menus: new MenuRegistry(), keymap },
      () => undefined,
    );
    expect(keymap.shortcutsFor('log.refresh')).toEqual(['Meta+R']);
  });
});

describe('Cherry-Pick, from the toolbar', () => {
  it('picks the commit selected, as IntelliJ’s, off with none selected', async () => {
    git.log = history(2);
    mount();
    await expect.poll(subjects).toHaveLength(2);
    const button = document.querySelector(
      '.playground-log__toolbar [data-command="log.cherryPick"]',
    ) as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Cherry-Pick');
    expect(commands.isEnabled('log.cherryPick', { source: 'log' })).toBe(false);
    await userEvent.click(rows()[1] as HTMLElement);
    await expect.poll(() => button.disabled).toBe(false);
    await userEvent.click(button);
    await expect
      .poll(() => host.params('git.cherryPick'))
      .toEqual([{ path: '/r', hash: 'c1', protected: ['main', 'master'] }]);
    await expect.poll(() => notifications.all.get(0)?.title).toBe('Cherry-pick successful');
    // The Log read again after.
    await expect.poll(() => host.params('git.log').length).toBeGreaterThan(1);
  });
});

describe('Go To Hash/Branch/Tag', () => {
  const selected = () =>
    document
      .querySelector('.playground-log__commits .cerebro-tree-row[aria-selected="true"]')
      ?.getAttribute('data-key');
  const suggestions = () =>
    [...document.querySelectorAll('.playground-git-branch__suggestion')].map((s) => s.textContent);
  const button = () =>
    document.querySelector('.playground-log__toolbar [data-command="log.goToRef"]') as HTMLElement;

  it('selects the commit a hash, branch or tag names, the branches and tags suggested', async () => {
    git.log = history(3);
    git.branches = [
      { ref: 'refs/heads/main', hash: 'c0', current: true },
      { ref: 'refs/heads/side', hash: 'c1', current: false },
    ];
    git.revisions = { side: 'c1', v2: 'c2' };
    expect(commands.isEnabled('log.goToRef', { source: 'log' })).toBe(false);
    mount();
    await expect.poll(subjects).toHaveLength(3);
    expect(button().getAttribute('aria-label')).toBe('Go To Hash/Branch/Tag');
    await userEvent.hover(button());
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Go To Hash/Branch/TagCtrl+F');
    await userEvent.click(button());
    const shown = await dialog();
    expect(shown.querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Go To Hash/Branch/Tag',
    );
    expect(shown.querySelector('.cerebro-dialog-field__label')?.textContent.trim()).toBe(
      'Enter hash or branch/tag name:',
    );
    const ok = [...shown.querySelectorAll<HTMLButtonElement>('.cerebro-dialog__button')].find(
      (b) => b.textContent === 'OK',
    ) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    await answer('si');
    expect(suggestions()).toEqual(['side']);
    await answer('v');
    expect(suggestions()).toEqual(['v1', 'v2']);
    await answer(' v2 ');
    await press('OK');
    await expect.poll(selected).toBe('c2');
    expect(host.params('git.resolveRevision')).toEqual([{ path: '/r', revision: 'v2' }]);
    // From the keyboard, while the Log has the focus.
    expect(services.keymap?.shortcutsFor('log.goToRef')).toEqual(['Ctrl+F']);
    await userEvent.click(rows()[0] as HTMLElement);
    commands.execute('log.goToRef');
    await answer('side');
    await press('OK');
    await expect.poll(selected).toBe('c1');
  });

  it('says what it can’t find; does nothing when cancelled; does without the tags if unread', async () => {
    git.log = history(2);
    git.revisions = { far: 'gone' };
    mount();
    await expect.poll(subjects).toHaveLength(2);
    await userEvent.click(button());
    await answer('nope');
    await press('OK');
    await expect.poll(() => notifications.all.get(0)?.title).toBe('nope not found');
    expect(notifications.all.get(0)?.type).toBe('warning');
    // A commit git knows, but not in the Log.
    await userEvent.click(button());
    await answer('far');
    await press('OK');
    await expect.poll(() => notifications.all.get(0)?.title).toBe('far not found');
    await userEvent.click(button());
    await answer('c1');
    await press('Cancel');
    expect(host.params('git.resolveRevision')).toHaveLength(2);
    git.tags = new Error('no tags');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await userEvent.click(button());
    await answer('v');
    expect(suggestions()).toEqual([]);
    expect(logged).toHaveBeenCalledWith('Reading the tags failed', git.tags);
    await press('Cancel');
    logged.mockRestore();
    git.tags = ['v1', 'v2'];
  });

  it('is IntelliJ’s Cmd+F on macOS', () => {
    const keymap = new Keymap('mac');
    setupLog(
      { commands: new CommandRegistry(), menus: new MenuRegistry(), keymap },
      () => undefined,
    );
    expect(keymap.shortcutsFor('log.goToRef')).toEqual(['Meta+F']);
  });
});

describe('a commit’s menu', () => {
  it('opens on a commit, selecting it, and copies its full hash, as IntelliJ’s first item', async () => {
    git.log = history(2);
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    (rows()[1] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    expect(rows()[1]?.getAttribute('aria-selected')).toBe('true');
    const items = () => [...document.querySelectorAll<HTMLElement>('.cerebro-menu-item')];
    // Cherry-Pick after it, as IntelliJ's.
    expect(items().map((item) => item.textContent)).toEqual([
      'Copy Revision Number',
      'Cherry-Pick',
      'Revert Commit',
      'Go to Child CommitLeft',
      'Go to Parent CommitRight',
    ]);
    await userEvent.click(items()[0] as HTMLElement);
    expect(write).toHaveBeenCalledWith('c1');
  });

  it('gives its commands the commit, its worktree and host, HEAD’s, and a way to read the Log again', async () => {
    git.log = history(2, ['HEAD -> refs/heads/main']);
    mount();
    await expect.poll(subjects).toEqual(['Change 0', 'Change 1']);
    let given: LogCommitContext | undefined;
    services.commands.register<LogCommitContext>({
      id: 'test.logCommit',
      label: 'Test',
      run: (context) => {
        given = context;
      },
    });
    services.menus.contribute({ menu: 'log/commit', item: { command: 'test.logCommit' } });
    (rows()[1] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    );
    const item = [...document.querySelectorAll<HTMLElement>('.cerebro-menu-item')].find(
      (i) => i.textContent === 'Test',
    );
    await userEvent.click(item as HTMLElement);
    expect(given).toMatchObject({ commit: { hash: 'c1' }, worktree: '/r', host, head: 'c0' });
    await given?.refresh();
    expect(host.params('git.log')).toHaveLength(2);
  });
});

describe('Go to Parent and Child Commit', () => {
  /** A merge `m` of `a` and `b`, both from `base`, as `--date-order` lists them. */
  const merged = (subject = 'Change b'): LogCommit[] => {
    const [m, a, b, base] = history(4);
    return [
      { ...(m as LogCommit), hash: 'm', parents: ['a', 'b'] },
      { ...(a as LogCommit), hash: 'a', parents: ['base'] },
      { ...(b as LogCommit), hash: 'b', parents: ['base'], subject },
      { ...(base as LogCommit), hash: 'base', parents: [] },
    ];
  };
  const selected = () =>
    document.querySelector('.playground-log__commits .cerebro-tree-row--selected')?.textContent;
  const items = () => [...document.querySelectorAll<HTMLElement>('.cerebro-menu-item')];
  const heading = () => document.querySelector('.cerebro-menu-heading')?.textContent;
  const when = (time: number) => {
    const date = new Date(time);
    return `on ${date.toLocaleDateString()} at ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  };

  it('go to the one there is with Right and Left while the commits have the keyboard, as IntelliJ’s', async () => {
    git.log = merged();
    mount();
    await expect.poll(subjects).toHaveLength(4);
    expect(services.keymap?.shortcutsFor('log.goToParent')).toEqual(['ArrowRight']);
    expect(services.keymap?.shortcutsFor('log.goToChild')).toEqual(['ArrowLeft']);
    await userEvent.click(rows()[1] as HTMLElement);
    commands.execute('log.goToParent');
    await expect.poll(selected).toContain('Change 3');
    await userEvent.click(rows()[2] as HTMLElement);
    commands.execute('log.goToChild');
    await expect.poll(selected).toContain('Change 0');
    expect(document.activeElement).toBe(tree());
    // Not with the keyboard elsewhere.
    tree().blur();
    expect(commands.isEnabled('log.goToChild')).toBe(false);
  });

  it('choose among several in a numbered popup at the row, as IntelliJ’s', async () => {
    git.log = merged('A & B, a subject longer than forty characters');
    mount();
    await expect.poll(subjects).toHaveLength(4);
    await userEvent.click(rows()[0] as HTMLElement);
    commands.execute('log.goToParent');
    expect(heading()).toBe('Select Parent to Navigate');
    const time = (git.log[0] as LogCommit).time;
    expect(items().map((item) => item.textContent)).toEqual([
      `1. a "Change 1" by Ada ${when(time)}`,
      `2. b "A & B, a subject longer than forty ch..." by Ada ${when(time)}`,
    ]);
    // Its items only from it, not from Find Action.
    expect(commands.isEnabled('log.adjacent.0')).toBe(false);
    await userEvent.keyboard('2');
    await expect.poll(selected).toContain('A & B');
    await userEvent.click(rows()[3] as HTMLElement);
    commands.execute('log.goToChild');
    expect(heading()).toBe('Select Child to Navigate');
    await userEvent.keyboard('{Escape}');
    expect(selected()).toContain('Change 3');
  });

  it('sit last in a commit’s menu, off with none to go to', async () => {
    git.log = merged();
    mount();
    await expect.poll(subjects).toHaveLength(4);
    (rows()[3] as HTMLElement).dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
    const labels = items().map(
      (item) => item.querySelector('.cerebro-menu-item__label')?.textContent,
    );
    expect(labels.slice(-2)).toEqual(['Go to Child Commit', 'Go to Parent Commit']);
    expect(items().at(-1)?.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(items().at(-2) as HTMLElement);
    expect(heading()).toBe('Select Child to Navigate');
    await userEvent.keyboard('{Escape}');
  });

  it('load pages until the parent is there; do nothing if it never is', async () => {
    git.log = history(PAGE + 1);
    (git.log[1] as LogCommit).parents = ['gone'];
    mount();
    await expect.poll(() => rows().length).toBeGreaterThan(0);
    const from = (i: number) => ({ commit: git.log[i] });
    commands.execute('log.goToParent', from(PAGE - 1));
    await expect.poll(selected).toContain(`Change ${String(PAGE)}`);
    expect(skips()).toEqual([0, PAGE]);
    // Not there once all are loaded: nothing.
    commands.execute('log.goToParent', from(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(selected()).toContain(`Change ${String(PAGE)}`);
    expect(skips()).toEqual([0, PAGE]);
  });

  it('list a parent not loaded yet last, by its hash, and load it once chosen', async () => {
    git.log = history(PAGE + 1);
    (git.log[0] as LogCommit).parents = ['c1', `c${String(PAGE)}`];
    mount();
    await expect.poll(() => rows().length).toBeGreaterThan(0);
    // From a commit not drawn: the popup at the window's corner.
    commands.execute('log.goToParent', { commit: git.log[0] });
    expect(items().map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^1\. c1 "Change 1"/),
      `2. c${String(PAGE)}`,
    ]);
    await userEvent.keyboard('2');
    await expect.poll(selected).toContain(`Change ${String(PAGE)}`);
  });
});

describe('matchRanges', () => {
  it('finds the text in any case unless Match Case, or the expression’s matches', () => {
    const plain = { text: 'a.b', regex: false, matchCase: false };
    expect(matchRanges('A.B axb a.b', plain)).toEqual([
      [0, 3],
      [8, 11],
    ]);
    expect(matchRanges('A.B a.b', { ...plain, matchCase: true })).toEqual([[4, 7]]);
    expect(matchRanges('A.B axb', { ...plain, regex: true })).toEqual([
      [0, 3],
      [4, 7],
    ]);
    // Empty matches mark nothing; an expression JavaScript can't read, nothing.
    expect(matchRanges('abc', { text: 'x*', regex: true, matchCase: false })).toEqual([]);
    expect(matchRanges('a(b', { text: '(', regex: true, matchCase: false })).toEqual([]);
  });
});

describe('the text filter’s history', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps five, the latest first, trimmed, the same in another case moved first', () => {
    expect(textHistory()).toEqual([]);
    rememberText('  ');
    expect(textHistory()).toEqual([]);
    for (const text of ['a', ' b ', 'c', 'd', 'e', 'f']) rememberText(text);
    expect(textHistory()).toEqual(['f', 'e', 'd', 'c', 'b']);
    rememberText('C');
    expect(textHistory()).toEqual(['C', 'f', 'e', 'd', 'b']);
    // First already, in any case: left as it was.
    rememberText('c');
    expect(textHistory()).toEqual(['C', 'f', 'e', 'd', 'b']);
  });

  it('reads none from what isn’t a list of texts, and goes on when it can’t be kept', () => {
    localStorage.setItem('cerebro.log.textHistory', 'not JSON');
    expect(textHistory()).toEqual([]);
    localStorage.setItem('cerebro.log.textHistory', '{"a":1}');
    expect(textHistory()).toEqual([]);
    localStorage.setItem('cerebro.log.textHistory', '["a",1]');
    expect(textHistory()).toEqual(['a']);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    rememberText('b');
    setItem.mockRestore();
    expect(textHistory()).toEqual(['a']);
  });
});

describe('the text filter', () => {
  const field = () => document.querySelector('.playground-log__search-field') as HTMLInputElement;
  const filters = () =>
    host.params('git.log').map((p) => (p as { filter?: { text?: unknown } }).filter?.text);
  const option = (label: string) =>
    document.querySelector(`.playground-log__search [aria-label="${label}"]`) as HTMLElement;

  it('shows the commits its text matches once Enter applies it, with Regex and Match Case', async () => {
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    expect(field().placeholder).toBe('Text or hash');
    expect(field().getAttribute('aria-label')).toBe('r log text or hash filter');
    await userEvent.click(field());
    await userEvent.keyboard('fix');
    // Not as it's typed, as IntelliJ's.
    expect(filters()).toEqual([undefined]);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    expect(filters()).toEqual([undefined, { text: 'fix', regex: false, matchCase: false }]);
    // An option applies the text again with it.
    await userEvent.click(option('Regex'));
    expect(option('Regex').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(option('Match Case'));
    await expect
      .poll(() => filters().at(-1))
      .toEqual({ text: 'fix', regex: true, matchCase: true });
    expect(document.activeElement).toBe(field());
    // Emptied, it's off.
    await userEvent.clear(field());
    await userEvent.keyboard('{Enter}');
    await expect.poll(subjects).toHaveLength(3);
    expect(filters().at(-1)).toBeUndefined();
    // Then an option alone reads nothing again.
    const asked = filters().length;
    await userEvent.click(option('Regex'));
    expect(filters()).toHaveLength(asked);
  });

  it('marks its matches in the commits’ subjects, as IntelliJ’s Log does', async () => {
    git.log = history(3);
    git.byText.fix = [
      { ...(history(1, [], 'f')[0] as LogCommit), subject: 'Fix the FIX, a prefix' },
    ];
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const marked = () =>
      [...document.querySelectorAll('.playground-log__message .playground-log__match')].map(
        (match) => match.textContent,
      );
    expect(marked()).toEqual([]);
    await userEvent.click(field());
    await userEvent.keyboard('fix{Enter}');
    await expect.poll(marked).toEqual(['Fix', 'FIX', 'fix']);
    expect(document.querySelector('.playground-log__message')?.textContent).toBe(
      'Fix the FIX, a prefix',
    );
    // Match Case: only the text as typed.
    await userEvent.click(option('Match Case'));
    await expect.poll(marked).toEqual(['fix']);
  });

  it('remembers what Enter applied, shown on Alt+Down or the magnifier, Alt+Up going round', async () => {
    localStorage.clear();
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    git.byText.docs = history(1, [], 'd');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const magnifier = document.querySelector('.playground-log__search-history') as HTMLElement;
    const popup = () => document.querySelector('.cerebro-popup');
    const items = () =>
      [...document.querySelectorAll('.cerebro-popup-item__label')].map(
        (label) => label.textContent,
      );
    // No history yet: the magnifier shows nothing.
    await userEvent.click(magnifier);
    expect(popup()).toBeNull();
    await userEvent.click(field());
    // Nor Alt+Down or Alt+Up.
    await userEvent.keyboard('{Alt>}{ArrowDown}{ArrowUp}{/Alt}');
    expect(popup()).toBeNull();
    expect(field().value).toBe('');
    await userEvent.keyboard('fix{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    await userEvent.clear(field());
    await userEvent.keyboard('docs{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('d0');
    // Leaving the field applies, but isn't remembered, as IntelliJ's.
    await userEvent.clear(field());
    await userEvent.keyboard('other');
    await userEvent.click(rows()[0] as HTMLElement);
    expect(textHistory()).toEqual(['docs', 'fix']);
    await userEvent.click(field());
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(popup()?.querySelector('[role="listbox"]')).not.toBeNull();
    expect(popup()?.getAttribute('aria-label')).toBe('Search History');
    // Opening it remembers the text in the field, as IntelliJ's.
    expect(items()).toEqual(['other', 'docs', 'fix']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(popup()).toBeNull();
    // Put in the field, to apply with Enter.
    expect(field().value).toBe('fix');
    expect(rows()[0]?.getAttribute('data-key')).not.toBe('f0');
    expect(textHistory()).toEqual(['fix', 'other', 'docs']);
    await userEvent.click(magnifier);
    expect(items()).toEqual(['fix', 'other', 'docs']);
    await userEvent.keyboard('{Escape}');
    // Alt+Up: from the last, round.
    await userEvent.click(field());
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(field().value).toBe('docs');
    await userEvent.keyboard('{Alt>}{ArrowUp}{ArrowUp}{ArrowUp}{/Alt}');
    expect(field().value).toBe('docs');
    // Text not in it is added first.
    await userEvent.clear(field());
    await userEvent.keyboard('new{Alt>}{ArrowUp}{/Alt}');
    expect(textHistory()).toEqual(['new', 'fix', 'other', 'docs']);
    expect(field().value).toBe('fix');
  });

  it('applies as it loses the focus, if changed; its button clears it', async () => {
    git.log = history(3);
    git.byText.fix = history(1, [], 'f');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    await userEvent.click(field());
    await userEvent.keyboard('fix');
    await userEvent.click(rows()[0] as HTMLElement);
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('f0');
    // The same text, or blank for none: nothing to apply.
    const asked = filters().length;
    await userEvent.click(field());
    await userEvent.click(rows()[0] as HTMLElement);
    expect(filters()).toHaveLength(asked);
    const clear = document.querySelector('.playground-log__search-clear') as HTMLElement;
    await userEvent.click(clear);
    await expect.poll(subjects).toHaveLength(3);
    expect(field().value).toBe('');
    expect(document.querySelector('.playground-log__search-clear')).toBeNull();
    await userEvent.click(field());
    await userEvent.keyboard('  ');
    await userEvent.click(rows()[0] as HTMLElement);
    expect(filters()).toHaveLength(asked + 1);
  });

  it('is focused with Ctrl+L while the Log has the keyboard, and gives it back to the list', async () => {
    git.log = history(1);
    mount();
    await expect.poll(subjects).toHaveLength(1);
    expect(services.keymap?.shortcutsFor('log.focusTextFilter')).toEqual(['Ctrl+L']);
    await userEvent.hover(field());
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Filter by Commit Message or HashesCtrl+L');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(commands.isEnabled('log.focusTextFilter')).toBe(false);
    await userEvent.click(rows()[0] as HTMLElement);
    commands.execute('log.focusTextFilter');
    expect(document.activeElement).toBe(field());
    commands.execute('log.focusTextFilter');
    expect(document.activeElement).toBe(tree());
  });

  it('is focused with Cmd+L on macOS, as IntelliJ’s keymaps take Ctrl there', () => {
    const keymap = new Keymap('mac');
    setupLog(
      { commands: new CommandRegistry(), menus: new MenuRegistry(), keymap },
      () => undefined,
    );
    expect(keymap.shortcutsFor('log.focusTextFilter')).toEqual(['Meta+L']);
  });
});

describe('the User, Date and Paths filters', () => {
  const dropdown = (label: string) =>
    document.querySelector(
      `.playground-log__toolbar .cerebro-toolbar-dropdown[aria-label^="${label}"]`,
    ) as HTMLElement;
  const text = (label: string) =>
    dropdown(label).querySelector('.cerebro-toolbar-dropdown__text')?.textContent;
  const clear = (label: string) =>
    document.querySelector<HTMLElement>(`[aria-label="Clear ${label}"]`);
  const items = () =>
    [...document.querySelectorAll('.cerebro-popup-item__label')].map((label) => label.textContent);
  const asked = () =>
    host.params('git.log').at(-1) as {
      filter?: { authors?: string[]; after?: number; before?: number; paths?: string[] };
    };

  beforeEach(() => {
    localStorage.clear();
    git.authors = {
      authors: [
        { name: 'ada lovelace', email: 'ada@x' },
        { name: 'Ada Lovelace', email: 'ada@work' },
        { name: '', email: 'bob@x' },
      ],
      me: { name: 'Bob', email: 'bob@x' },
    };
  });

  it('User: chosen from the authors, "me", or names typed; remembered; cleared with its X', async () => {
    git.log = history(3);
    git.byAuthors['ada lovelace <ada@x>, Ada Lovelace <ada@work>'] = history(1, [], 'a');
    git.byAuthors['bob@x'] = history(1, [], 'b');
    git.byAuthors['bob@x, ada lovelace <ada@x>, Ada Lovelace <ada@work>'] = history(2, [], 'm');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    expect(text('User')).toBe('User');
    expect(clear('User')).toBeNull();
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me']);
    // Typing searches "me" and each author, by short name, first and last capitalized.
    await userEvent.keyboard('o');
    await expect.poll(items).toEqual(['bob', 'Ada Lovelace']);
    await userEvent.keyboard('{Backspace}a');
    await expect.poll(items).toEqual(['Ada Lovelace']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('a0');
    // Every author by that name, exactly.
    expect(asked().filter?.authors).toEqual(['ada lovelace <ada@x>', 'Ada Lovelace <ada@work>']);
    expect(text('User')).toBe('User: Ada Lovelace');
    // "me", and the last choice under Recent.
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me', 'Ada Lovelace']);
    expect(
      [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent),
    ).toEqual(['Recent']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('b0');
    expect(text('User')).toBe('User: me');
    // Names typed, between bars.
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me', 'me', 'Ada Lovelace']);
    await userEvent.keyboard('{Enter}');
    const field = await vi.waitUntil(() =>
      document.querySelector<HTMLTextAreaElement>('.playground-values__field'),
    );
    expect(field.value).toBe('me');
    await vi.waitUntil(() => document.activeElement === field);
    // Enter starts a line; Ctrl+Enter takes them.
    await userEvent.keyboard('{End}{Enter}ada lovelace{Control>}{Enter}{/Control}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('m0');
    expect(text('User')).toBe('User: me|ada lovelace');
    // Cleared with its X, or Delete on it.
    await userEvent.click(clear('User') as HTMLElement);
    await expect.poll(subjects).toHaveLength(3);
    expect(asked().filter).toBeUndefined();
    expect(text('User')).toBe('User');
  });

  it('User: none for a name no author has, and none for "me" when git has no user', async () => {
    git.log = history(3);
    git.authors = { authors: [{ name: 'Ada', email: 'ada@x' }], me: undefined };
    mount();
    await expect.poll(subjects).toHaveLength(3);
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…']);
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.activeElement?.matches('.playground-values__field'));
    await userEvent.keyboard('me|nobody{Control>}{Enter}{/Control}');
    await expect.poll(() => asked().filter?.authors).toEqual([]);
    // Cancelled, it stays.
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me|nobody']);
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.activeElement?.matches('.playground-values__field'));
    await userEvent.keyboard('{Escape}');
    expect(text('User')).toBe('User: me|nobody');
    // Emptied, the filter goes.
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me|nobody']);
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.activeElement?.matches('.playground-values__field'));
    await userEvent.keyboard('{Control>}a{/Control}{Backspace}{Control>}{Enter}{/Control}');
    await expect.poll(() => text('User')).toBe('User');
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me|nobody']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('User')).toBe('User: me|nobody');
    dropdown('User').focus();
    await userEvent.keyboard('{Delete}');
    await expect.poll(() => text('User')).toBe('User');
  });

  it('Date: the last 24 hours, the last 7 days, or a period; cleared with its X', async () => {
    git.log = history(3);
    mount();
    await expect.poll(subjects).toHaveLength(3);
    expect(text('Date')).toBe('Date');
    const day = (time: number) =>
      new Date(time).toLocaleDateString(undefined, { dateStyle: 'short' });
    await userEvent.click(dropdown('Date'));
    await expect.poll(items).toEqual(['Select…', 'Last 24 hours', 'Last 7 days']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect.poll(() => asked().filter?.after).toBeDefined();
    const week = Date.now() - 7 * 24 * 3_600_000;
    expect(Math.abs((asked().filter?.after as number) - week)).toBeLessThan(2 * 3_600_000);
    expect(text('Date')).toBe(`Date: Since ${day(week)}`);
    await userEvent.click(dropdown('Date'));
    await expect.poll(items).toHaveLength(3);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('Date')).toBe(`Date: Since ${day(Date.now() - 24 * 3_600_000)}`);
    // A period: After and Before, each on when checked; the dialog starts with the filter's.
    await userEvent.click(dropdown('Date'));
    await expect.poll(items).toHaveLength(3);
    await userEvent.keyboard('{Enter}');
    const sides = await vi.waitUntil(() => {
      const found = document.querySelectorAll<HTMLInputElement>('.playground-period input');
      return found.length === 4 ? [...found] : undefined;
    });
    const [afterOn, after, beforeOn, before] = sides as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    expect(afterOn.checked).toBe(true);
    expect(before.disabled).toBe(true);
    await userEvent.click(beforeOn);
    expect(before.disabled).toBe(false);
    await userEvent.fill(after, '2026-01-02');
    await userEvent.fill(before, '2026-01-05');
    await userEvent.click(
      document.querySelector('.cerebro-dialog__button--primary') as HTMLElement,
    );
    await expect
      .poll(() => asked().filter)
      .toEqual({
        after: new Date(2026, 0, 2).getTime(),
        before: new Date(2026, 0, 5).getTime(),
      });
    expect(text('Date')).toBe(
      `Date: ${day(new Date(2026, 0, 2).getTime())}-${day(new Date(2026, 0, 5).getTime())}`,
    );
    // Before alone; then neither, which leaves it as it was.
    for (const off of [true, false]) {
      await userEvent.click(dropdown('Date'));
      await expect.poll(items).toHaveLength(3);
      await userEvent.keyboard('{Enter}');
      const checks = await vi.waitUntil(() => {
        const found = document.querySelectorAll<HTMLInputElement>(
          '.playground-period input[type="checkbox"]',
        );
        return found.length === 2 ? [...found] : undefined;
      });
      if (checks[0]?.checked) await userEvent.click(checks[0]);
      if (!off) await userEvent.click(checks[1] as HTMLElement);
      await userEvent.click(
        document.querySelector('.cerebro-dialog__button--primary') as HTMLElement,
      );
      if (off) {
        await expect
          .poll(() => text('Date'))
          .toBe(`Date: Until ${day(new Date(2026, 0, 5).getTime())}`);
      }
    }
    expect(text('Date')).toBe(`Date: Until ${day(new Date(2026, 0, 5).getTime())}`);
    // Closed without a choice: as it was.
    await userEvent.click(dropdown('Date'));
    await expect.poll(items).toHaveLength(3);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(clear('Date') as HTMLElement);
    await expect.poll(() => text('Date')).toBe('Date');
    expect(asked().filter).toBeUndefined();
  });

  it('Paths: typed, a line each, or checked in the tree; remembered; cleared with its X', async () => {
    git.log = history(3);
    git.byPaths['a.txt, src/'] = history(1, [], 'p');
    git.byPaths['src/main.ts'] = history(1, [], 'q');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    expect(text('Paths')).toBe('Paths');
    await userEvent.click(dropdown('Paths'));
    await expect.poll(items).toEqual(['Select…', 'Select in Tree…']);
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.activeElement?.matches('.playground-values__field'));
    // Given in full, from the repository's top.
    await userEvent.keyboard('src/{Enter}/r/a.txt{Control>}{Enter}{/Control}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('p0');
    expect(asked().filter?.paths).toEqual(['src/', 'a.txt']);
    expect(text('Paths')).toBe('Paths: a.txt + 1');
    // In the tree: the repository's files and folders, the ignored left out.
    await userEvent.click(dropdown('Paths'));
    await expect.poll(items).toEqual(['Select…', 'Select in Tree…', 'a.txt + 1']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    const box = (name: string) =>
      document.querySelector<HTMLInputElement>(`.playground-paths input[aria-label="${name}"]`);
    await vi.waitUntil(() => box('src'));
    expect(
      [...document.querySelectorAll('.playground-paths .cerebro-tree-row')].map(
        (r) => r.textContent,
      ),
    ).toEqual(['src', 'a.txt']);
    expect(box('src')?.checked).toBe(true);
    await userEvent.click(box('src') as HTMLElement);
    await userEvent.click(box('a.txt') as HTMLElement);
    expect(
      document.querySelector<HTMLButtonElement>('.cerebro-dialog__button--primary')?.disabled,
    ).toBe(true);
    await userEvent.dblClick(
      document.querySelector('.playground-paths .cerebro-tree-row') as HTMLElement,
    );
    await vi.waitUntil(() => box('main.ts'));
    await userEvent.click(box('main.ts') as HTMLElement);
    await userEvent.click(
      document.querySelector('.cerebro-dialog__button--primary') as HTMLElement,
    );
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('q0');
    expect(asked().filter?.paths).toEqual(['src/main.ts']);
    expect(text('Paths')).toBe('Paths: src/main.ts');
    expect(host.params('fs.list')).toEqual([{ path: '/r' }, { path: '/r/src' }]);
    // Its tooltip lists the paths, as IntelliJ's.
    const tip = () => document.querySelector('.cerebro-tooltip')?.textContent;
    await userEvent.hover(dropdown('Paths'));
    await expect.poll(tip).toBe('Paths:\nsrc/main.ts');
    await userEvent.unhover(dropdown('Paths'));
    // A recent choice, then cleared with its X.
    await userEvent.click(dropdown('Paths'));
    await expect.poll(items).toEqual(['Select…', 'Select in Tree…', 'src/main.ts', 'a.txt + 1']);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    await expect.poll(() => text('Paths')).toBe('Paths: a.txt + 1');
    await userEvent.click(clear('Paths') as HTMLElement);
    await expect.poll(() => text('Paths')).toBe('Paths');
    expect(asked().filter).toBeUndefined();
  });

  it('Branch: cleared with its X', async () => {
    git.log = history(3);
    git.byBranch['refs/heads/main'] = history(1, [], 'm');
    git.branches = [branch('refs/heads/main', true)];
    mount();
    await expect.poll(subjects).toHaveLength(3);
    await userEvent.dblClick(
      await vi.waitUntil(() =>
        [...document.querySelectorAll<HTMLElement>('.playground-branches .cerebro-tree-row')].find(
          (row) => row.textContent.trim() === 'main',
        ),
      ),
    );
    await expect.poll(() => text('Branch')).toBe('Branch: main');
    await userEvent.click(clear('Branch') as HTMLElement);
    await expect.poll(subjects).toHaveLength(3);
    expect(text('Branch')).toBe('Branch');
  });

  it('say in their popups that Delete clears the filter, and Delete does, closing the popup', async () => {
    git.log = history(3);
    git.byBranch['refs/heads/main'] = history(1, [], 'm');
    git.byAuthors['bob@x'] = history(1, [], 'b');
    git.branches = [branch('refs/heads/main', true)];
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const ad = () => document.querySelector('.cerebro-popup__ad')?.textContent;
    const deleted = async (label: string) => {
      await userEvent.click(dropdown(label));
      await expect.poll(ad).toBe('Press Delete to clear the filter');
      await userEvent.keyboard('{Delete}');
      expect(document.querySelector('.cerebro-popup')).toBeNull();
      await expect.poll(() => text(label)).toBe(label);
    };
    // On: Delete clears it.
    await userEvent.dblClick(
      await vi.waitUntil(() =>
        [...document.querySelectorAll<HTMLElement>('.playground-branches .cerebro-tree-row')].find(
          (row) => row.textContent.trim() === 'main',
        ),
      ),
    );
    await expect.poll(() => text('Branch')).toBe('Branch: main');
    await deleted('Branch');
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('User')).toBe('User: me');
    await deleted('User');
    await userEvent.click(dropdown('Date'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('Date')).not.toBe('Date');
    await deleted('Date');
    // Off, as IntelliJ's: it stays off, and the popup closes.
    await deleted('Paths');
    await expect.poll(subjects).toHaveLength(3);
    expect(asked().filter).toBeUndefined();
  });

  it('have tooltips while on, as IntelliJ’s: Branch’s and User’s values, none for Date', async () => {
    git.log = history(3);
    git.byBranch['refs/heads/main'] = history(1, [], 'm');
    git.byAuthors['bob@x'] = history(1, [], 'b');
    git.branches = [branch('refs/heads/main', true)];
    mount();
    await expect.poll(subjects).toHaveLength(3);
    const tip = async (label: string) => {
      // Off it first: after a click the pointer is over it already, and hovering wouldn't enter it.
      await userEvent.unhover(dropdown(label));
      await userEvent.hover(dropdown(label));
      // The pause before a tooltip shows, and a little more.
      await new Promise((resolve) => setTimeout(resolve, SHOW_DELAY + 100));
      const text = document.querySelector('.cerebro-tooltip')?.textContent;
      await userEvent.unhover(dropdown(label));
      return text;
    };
    // Off: none.
    for (const label of ['Branch', 'User', 'Date', 'Paths'])
      expect(await tip(label)).toBeUndefined();
    await userEvent.dblClick(
      await vi.waitUntil(() =>
        [...document.querySelectorAll<HTMLElement>('.playground-branches .cerebro-tree-row')].find(
          (row) => row.textContent.trim() === 'main',
        ),
      ),
    );
    await expect.poll(() => text('Branch')).toBe('Branch: main');
    expect(await tip('Branch')).toBe('main');
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('User')).toBe('User: me');
    expect(await tip('User')).toBe('me');
    await userEvent.click(dropdown('Date'));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => text('Date')).not.toBe('Date');
    expect(await tip('Date')).toBeUndefined();
    // Its X: Clear, and the key that clears it too.
    await userEvent.hover(clear('Date') as HTMLElement);
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('ClearDelete');
  });

  it('read the authors again after the Log is', async () => {
    git.log = history(3);
    git.byAuthors['bob@x'] = history(1, [], 'b');
    mount();
    await expect.poll(subjects).toHaveLength(3);
    await userEvent.click(dropdown('User'));
    await expect.poll(items).toEqual(['Select…', 'me']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(() => rows()[0]?.getAttribute('data-key')).toBe('b0');
    const read = host.params('git.authors').length;
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => host.params('git.authors').length).toBe(read + 1);
  });
});
