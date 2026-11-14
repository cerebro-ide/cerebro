import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  bookmarkedLines,
  bookmarksOf,
  BookmarksView,
  moveBookmarks,
  nextBookmark,
  toggleBookmark,
} from '../src/bookmarks.js';
import { workspace } from '../src/environments.js';

const opened: unknown[] = [];
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
  const handle = render(
    () => (
      <BookmarksView open={(tab) => void opened.push(tab)} openAt={(at) => void opened.push(at)} />
    ),
    document.body,
  );
  dispose = () => {
    handle.dispose();
  };
}

const rows = () =>
  [...document.querySelectorAll('.cerebro-tree-row')].map((row) => row.textContent);
const row = (key: string) => document.querySelector(`[data-key="${key}"]`) as HTMLElement;

describe('bookmarks', () => {
  it('are toggled on a line, kept in the order added, per worktree, between runs', () => {
    localStorage.setItem('cerebro.bookmarks:/kept', JSON.stringify([{ path: '/kept/a', line: 2 }]));
    expect(bookmarksOf('/kept')).toEqual([{ path: '/kept/a', line: 2 }]);
    toggleBookmark('/kept', '/kept/b', 0);
    toggleBookmark('/kept', '/kept/a', 5);
    expect(bookmarkedLines('/kept', '/kept/a')).toEqual([2, 5]);
    expect(JSON.parse(localStorage.getItem('cerebro.bookmarks:/kept') as string)).toEqual([
      { path: '/kept/a', line: 2 },
      { path: '/kept/b', line: 0 },
      { path: '/kept/a', line: 5 },
    ]);
    // Toggled again: taken away.
    toggleBookmark('/kept', '/kept/a', 2);
    expect(bookmarksOf('/kept')).toEqual([
      { path: '/kept/b', line: 0 },
      { path: '/kept/a', line: 5 },
    ]);
    // None for a worktree with none kept, or what's kept unreadable, or not a list.
    expect(bookmarksOf('/none')).toEqual([]);
    localStorage.setItem('cerebro.bookmarks:/broken', '{');
    expect(bookmarksOf('/broken')).toEqual([]);
    localStorage.setItem('cerebro.bookmarks:/object', '{}');
    expect(bookmarksOf('/object')).toEqual([]);
  });

  it('move where an edit takes them, in their order; those it joins go', () => {
    toggleBookmark('/moved', '/moved/a', 7);
    toggleBookmark('/moved', '/moved/b', 1);
    toggleBookmark('/moved', '/moved/a', 3);
    moveBookmarks('/moved', '/moved/a', [4, 8]);
    expect(bookmarksOf('/moved')).toEqual([
      { path: '/moved/a', line: 8 },
      { path: '/moved/b', line: 1 },
      { path: '/moved/a', line: 4 },
    ]);
    moveBookmarks('/moved', '/moved/a', [4]);
    expect(bookmarksOf('/moved')).toEqual([
      { path: '/moved/b', line: 1 },
      { path: '/moved/a', line: 4 },
    ]);
  });

  it('are gone through by path, then line, with no going round', () => {
    toggleBookmark('/next', '/next/b', 3);
    toggleBookmark('/next', '/next/a', 9);
    toggleBookmark('/next', '/next/b', 1);
    const next = (path: string, line: number, forward: boolean) =>
      nextBookmark('/next', { path, line }, forward);
    expect(next('/next/a', 0, true)).toEqual({ path: '/next/a', line: 9 });
    expect(next('/next/a', 9, true)).toEqual({ path: '/next/b', line: 1 });
    expect(next('/next/b', 2, true)).toEqual({ path: '/next/b', line: 3 });
    expect(next('/next/b', 3, true)).toBeUndefined();
    expect(next('/next/b', 1, false)).toEqual({ path: '/next/a', line: 9 });
    expect(next('/next/c', 0, false)).toEqual({ path: '/next/b', line: 3 });
    expect(next('/next/a', 9, false)).toBeUndefined();
    // From no file: the first, or the last.
    expect(nextBookmark('/next', undefined, true)).toEqual({ path: '/next/a', line: 9 });
    expect(nextBookmark('/next', undefined, false)).toEqual({ path: '/next/b', line: 3 });
    expect(nextBookmark('/none', undefined, true)).toBeUndefined();
  });

  it('aren’t kept when storage is full, but stay for the run', () => {
    const setItem = Storage.prototype.setItem.bind(localStorage);
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      toggleBookmark('/full', '/full/a', 0);
    } finally {
      localStorage.setItem = setItem;
    }
    expect(bookmarksOf('/full')).toEqual([{ path: '/full/a', line: 0 }]);
    expect(localStorage.getItem('cerebro.bookmarks:/full')).toBeNull();
  });
});

describe('the Bookmarks tool window', () => {
  it('says how to add one before there’s one', () => {
    mount();
    expect(document.querySelector('.playground-project__empty')?.textContent).toBe(
      'No bookmarks added.Add Bookmark (F11) to code lines.',
    );
  });

  it('lists them by file, under the worktree’s list, and opens a file or a line', async () => {
    mount();
    toggleBookmark('/r', '/r/src/a.ts', 4);
    toggleBookmark('/r', '/r/top.ts', 0);
    toggleBookmark('/r', '/r/src/a.ts', 1);
    // In the order added; each with its icon: the list's and its lines' a bookmark's, the files' a
    // file's.
    await expect.poll(rows).toEqual(['rDefault', 'a.tssrc', '5:', '2:', 'top.ts', '1:']);
    const icons = [
      ...document.querySelectorAll('.cerebro-tree-row svg[viewBox="1.5 1.5 13 13"] path'),
    ].map((path) => path.getAttribute('d'));
    const [bookmark, file] = icons;
    expect(icons).toEqual([bookmark, file, bookmark, bookmark, file, bookmark]);
    expect(bookmark).not.toBe(file);
    await userEvent.dblClick(row('/r/src/a.ts'));
    expect(opened).toEqual([{ id: '/r/src/a.ts', title: 'a.ts' }]);
    await userEvent.click(row('/r/src/a.ts:1'));
    await userEvent.keyboard('{Enter}');
    expect(opened.at(-1)).toEqual({ path: '/r/src/a.ts', line: 1, column: 0 });
    // The list itself opens nothing.
    await userEvent.dblClick(row('list'));
    expect(opened).toHaveLength(2);
    // Taken away, gone from the list.
    toggleBookmark('/r', '/r/top.ts', 0);
    await expect.poll(rows).toEqual(['rDefault', 'a.tssrc', '5:', '2:']);
  });

  it('shows nothing with no worktree open', () => {
    workspace.close('/r');
    mount();
    expect(document.querySelector('.playground-occurrences')?.textContent).toBe('');
  });
});
