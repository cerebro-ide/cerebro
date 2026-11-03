import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { workspace } from '../src/environments.js';
import { FindView, occurrencesTree, showOccurrences } from '../src/find-window.js';
import type { TextMatch } from '../src/find.js';

const match = (path: string, line: number, text: string, ranges: [number, number][]) => ({
  path,
  line,
  text,
  ranges,
});
const MATCHES: TextMatch[] = [
  match('/r/README.md', 0, 'shape of things', [[0, 5]]),
  match('/r/src/a.ts', 3, '  const shape = shape;', [
    [8, 13],
    [16, 21],
  ]),
  match('/r/src/a.ts', 9, 'shape', []),
  match('/r/src/b.ts', 1, 'shapes', [
    [0, 5],
    [2, 4],
  ]),
  match('/r/lib/x/c.ts', 0, 'Shape', [[0, 5]]),
];

const opened: { path: string; line: number; column: number }[] = [];
let dispose: (() => void) | undefined;

beforeAll(() => {
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  opened.length = 0;
});

function mount(): void {
  const handle = render(() => <FindView open={(at) => void opened.push(at)} />, document.body);
  dispose = () => {
    handle.dispose();
  };
}

const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((row) => row.textContent);
const row = (key: string) => document.querySelector(`[data-key="${key}"]`) as HTMLElement;

describe('the lines found, as a tree', () => {
  it('are under their folder, flattened, then their file; the worktree’s own files at the top', () => {
    const tree = occurrencesTree('/r', MATCHES);
    const shape = (items: ReturnType<typeof occurrencesTree>): unknown[] =>
      items.map((item) =>
        item.kind === 'line'
          ? item.key
          : [`${item.name} ${String(item.count)}`, shape(item.children)],
      );
    expect(shape(tree)).toEqual([
      ['README.md 1', ['line:/r/README.md:0']],
      [
        'src 4',
        [
          ['a.ts 2', ['line:/r/src/a.ts:3', 'line:/r/src/a.ts:9']],
          ['b.ts 2', ['line:/r/src/b.ts:1']],
        ],
      ],
      ['lib/x 1', [['c.ts 1', ['line:/r/lib/x/c.ts:0']]]],
    ]);
    // A path outside the worktree is a folder of its own.
    expect(occurrencesTree('/w', [match('/r/a.ts', 0, 'a', [[0, 1]])])[0]).toMatchObject({
      kind: 'folder',
      name: '/r',
    });
  });
});

describe('the Find window', () => {
  it('says nothing was searched, until something is', () => {
    mount();
    expect(document.body.textContent).toBe('Nothing searched');
  });

  it('shows the active worktree’s last search, every folder open, each line’s matches bold', async () => {
    showOccurrences({ worktree: '/r', title: 'first', matches: [], limited: false });
    mount();
    expect(document.querySelector('.playground-occurrences__title')?.textContent).toBe(
      'first0 matches in 0 files',
    );
    showOccurrences({
      worktree: '/r',
      title: "Occurrences of 'shape' in Project",
      matches: MATCHES,
      limited: true,
    });
    await expect
      .poll(() => document.querySelector('.playground-occurrences__title')?.textContent)
      .toBe("Occurrences of 'shape' in Project6 matches+ in 4+ files");
    expect(rows()).toEqual([
      'README.md1 match',
      '1shape of things',
      'src4 matches',
      'a.ts2 matches',
      '4const shape = shape;',
      '10shape',
      'b.ts2 matches',
      '2shapes',
      'lib/x1 match',
      'c.ts1 match',
      '1Shape',
    ]);
    const bold = (key: string) =>
      [...row(key).querySelectorAll('.playground-occurrences__match')].map((b) => b.textContent);
    expect(bold('line:/r/src/a.ts:3')).toEqual(['shape', 'shape']);
    // A match inside the one before isn't bold again.
    expect(bold('line:/r/src/b.ts:1')).toEqual(['shape']);
    // Another worktree's search isn't this one's.
    showOccurrences({ worktree: '/other', title: 'other', matches: [], limited: false });
    expect(document.querySelector('.playground-occurrences__title')?.textContent).toContain(
      "Occurrences of 'shape'",
    );
    showOccurrences({
      worktree: '/r',
      title: 'one',
      matches: [match('/r/a.ts', 0, 'a', [[0, 1]])],
      limited: false,
    });
    await expect
      .poll(() => document.querySelector('.playground-occurrences__count')?.textContent)
      .toBe('1 match in 1 file');
  });

  it('opens a line’s file at its first match, by double click or Enter', async () => {
    showOccurrences({ worktree: '/r', title: 't', matches: MATCHES, limited: false });
    mount();
    await expect.poll(() => row('line:/r/src/a.ts:3')).not.toBeNull();
    await userEvent.dblClick(row('line:/r/src/a.ts:3'));
    await userEvent.click(row('line:/r/src/a.ts:9'));
    await userEvent.keyboard('{Enter}');
    expect(opened).toEqual([
      { path: '/r/src/a.ts', line: 3, column: 8 },
      { path: '/r/src/a.ts', line: 9, column: 0 },
    ]);
  });
});
