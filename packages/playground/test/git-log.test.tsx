import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useProjects, workspace } from '../src/environments.js';
import { formatCommitDate, GitLogView, PAGE, refsOf, type LogCommit } from '../src/git-log.js';
import { FakeHost, project } from './fakes.js';

/** A line of `count` commits, newest first, the first with `refs`. */
function history(count: number, refs: string[] = [], prefix = 'c'): LogCommit[] {
  return Array.from({ length: count }, (_, i) => ({
    hash: `${prefix}${String(i)}`,
    parents: i + 1 < count ? [`${prefix}${String(i + 1)}`] : [],
    author: 'Ada',
    email: 'ada@example.com',
    time: new Date(2026, 0, 2, 10, 15).getTime(),
    subject: `Change ${String(i)}`,
    refs: i === 0 ? refs : [],
  }));
}

/** The repository's log, as the host answers it; or why it can't. */
const git = {
  log: [] as LogCommit[],
  failing: undefined as string | undefined,
  /** A page held until it resolves. */
  hold: undefined as Promise<void> | undefined,
};
const host = new FakeHost({
  'git.log': async ({ skip, max }: { skip: number; max: number }) => {
    const log = git.log;
    const hold = git.hold;
    git.hold = undefined;
    await hold;
    if (git.failing !== undefined) throw new Error(git.failing);
    return log.slice(skip, skip + max);
  },
});

let dispose: (() => void) | undefined;

beforeAll(() => {
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
  git.failing = undefined;
  for (const id of ['/r', '/s', '/n']) workspace.close(id);
});

function mount() {
  const box = document.createElement('div');
  box.style.height = '600px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';
  document.body.append(box);
  const handle = render(() => <GitLogView />, box);
  dispose = () => {
    handle.dispose();
  };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.cerebro-tree-row')];
const subjects = () =>
  rows().map((row) => row.querySelector('.playground-log__message')?.textContent);
const note = () => document.querySelector('.playground-project__empty')?.textContent;
const tree = () => document.querySelector('.cerebro-tree') as HTMLElement;
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
