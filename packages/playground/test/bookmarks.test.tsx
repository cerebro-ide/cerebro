import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  bookmarkMarks,
  bookmarkWith,
  bookmarksOf,
  BookmarksView,
  moveBookmarks,
  nextBookmark,
  rewriteAsked,
  showBookmarks,
  toggleBookmark,
  toggleMnemonic,
  type LineBookmark,
} from '../src/bookmarks.js';
import { workspace } from '../src/environments.js';
import { closeAll, dialog, dialogText, popupItems, press } from './fakes.js';

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
    expect(bookmarkMarks('/kept', '/kept/a').map((mark) => mark.line)).toEqual([2, 5]);
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

  it('take a mnemonic, theirs alone, as IntelliJ’s toggle with a type', async () => {
    const asked: LineBookmark[] = [];
    let rewrite = false;
    const toggle = (path: string, line: number, mnemonic: string) =>
      toggleMnemonic('/m', { path, line }, mnemonic, (taken) => {
        asked.push(taken);
        return Promise.resolve(rewrite);
      });
    toggleBookmark('/m', '/m/a', 0);
    toggleBookmark('/m', '/m/a', 3);
    // On a bookmark: it gets it, in its place; on a line with none, one's added with it.
    await toggle('/m/a', 0, '1');
    await toggle('/m/b', 2, 'K');
    expect(bookmarksOf('/m')).toEqual([
      { path: '/m/a', line: 0, mnemonic: '1' },
      { path: '/m/a', line: 3 },
      { path: '/m/b', line: 2, mnemonic: 'K' },
    ]);
    expect(bookmarkWith('/m', 'K')).toEqual({ path: '/m/b', line: 2, mnemonic: 'K' });
    expect(bookmarkMarks('/m', '/m/a')).toEqual([{ line: 0, mnemonic: '1' }, { line: 3 }]);
    // Another's: asked first; not rewritten, nothing changes.
    await toggle('/m/a', 3, '1');
    expect(asked).toEqual([{ path: '/m/a', line: 0, mnemonic: '1' }]);
    expect(bookmarksOf('/m')).toHaveLength(3);
    // Rewritten: the other bookmark's gone.
    rewrite = true;
    await toggle('/m/a', 3, '1');
    expect(bookmarksOf('/m')).toEqual([
      { path: '/m/a', line: 3, mnemonic: '1' },
      { path: '/m/b', line: 2, mnemonic: 'K' },
    ]);
    // Another on its line: in place of its own; its own again: it's taken away.
    await toggle('/m/b', 2, 'Z');
    expect(bookmarkWith('/m', 'K')).toBeUndefined();
    await toggle('/m/b', 2, 'Z');
    expect(bookmarksOf('/m')).toEqual([{ path: '/m/a', line: 3, mnemonic: '1' }]);
    expect(asked).toHaveLength(2);
    // Kept as they move.
    moveBookmarks('/m', '/m/a', [5]);
    expect(bookmarksOf('/m')).toEqual([{ path: '/m/a', line: 5, mnemonic: '1' }]);
  });

  it('ask before a mnemonic’s taken from another, unless told not to again', async () => {
    localStorage.removeItem('cerebro.bookmarks.rewrite');
    const taken = { path: '/q/src/a.ts', line: 4, mnemonic: '3' };
    const checkbox = async () =>
      userEvent.click((await dialog()).querySelector('input[type="checkbox"]') as HTMLElement);
    // Cancelled: not rewritten, and "Don't ask again" isn't kept.
    let asked = rewriteAsked(taken);
    expect(await dialogText()).toBe(
      '‘3’ mnemonic is already taken by ‘a.ts:5’. Do you want to rewrite it?Don’t ask again',
    );
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toBe('Rewrite Mnemonic');
    await checkbox();
    await press('Cancel');
    expect(await asked).toBe(false);
    // OK: rewritten; and with it ticked, not asked again.
    asked = rewriteAsked(taken);
    await checkbox();
    await press('OK');
    expect(await asked).toBe(true);
    expect(await rewriteAsked(taken)).toBe(true);
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    localStorage.removeItem('cerebro.bookmarks.rewrite');
    // OK without it: asked the next time.
    asked = rewriteAsked(taken);
    await press('OK');
    expect(await asked).toBe(true);
    asked = rewriteAsked(taken);
    await press('Cancel');
    expect(await asked).toBe(false);
  });

  it('are asked about each time when storage can’t be read or kept', async () => {
    const getItem = Storage.prototype.getItem.bind(localStorage);
    const setItem = Storage.prototype.setItem.bind(localStorage);
    localStorage.getItem = () => {
      throw new Error('SecurityError');
    };
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    try {
      const asked = rewriteAsked({ path: '/q/a', line: 0, mnemonic: 'A' });
      await userEvent.click(
        (await dialog()).querySelector('input[type="checkbox"]') as HTMLElement,
      );
      await press('OK');
      expect(await asked).toBe(true);
    } finally {
      localStorage.getItem = getItem;
      localStorage.setItem = setItem;
    }
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

describe('Show Bookmarks', () => {
  const worktree = { id: '/shown', name: 'shown' };
  const highlighted = () =>
    document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
      ?.textContent;

  it('lists the worktree’s bookmarks in the order added, under its list, and opens the one chosen', async () => {
    toggleBookmark('/shown', '/shown/src/a.ts', 4);
    toggleBookmark('/shown', '/shown/top.ts', 0);
    const shown = showBookmarks(worktree, (at) => void opened.push(at));
    expect(await popupItems()).toEqual(['a.ts :5', 'top.ts :1']);
    expect(document.querySelector('.cerebro-popup__header')?.textContent).toBe('Bookmarks');
    expect(document.querySelector('.cerebro-popup__group')?.textContent).toBe('shown');
    expect(
      [...document.querySelectorAll('.cerebro-popup-item')].map(
        (item) => item.querySelector('.cerebro-popup-item__detail')?.textContent,
      ),
    ).toEqual(['src', '']);
    // The first highlighted, its place previewed.
    expect(highlighted()).toBe('a.ts :5');
    expect(
      document.querySelector('.cerebro-popup__preview .playground-find__preview'),
    ).not.toBeNull();
    // Typed, as IntelliJ's speed search.
    await userEvent.keyboard('top');
    await expect.poll(highlighted).toBe('top.ts :1');
    await userEvent.keyboard('{Enter}');
    await shown;
    expect(opened).toEqual([{ path: '/shown/top.ts', line: 0, column: 0 }]);
  });

  it('says there are none, and opens nothing when closed', async () => {
    const shown = showBookmarks(
      { id: '/unmarked', name: 'unmarked' },
      (at) => void opened.push(at),
    );
    await popupItems();
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe(
      'No bookmarks added.',
    );
    await closeAll();
    await shown;
    expect(opened).toEqual([]);
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
    // One with a mnemonic: it in place of the icon.
    await toggleMnemonic('/r', { path: '/r/top.ts', line: 0 }, '7', () => Promise.resolve(true));
    await expect.poll(rows).toEqual(['rDefault', 'a.tssrc', '5:', '2:', 'top.ts', '71:']);
    expect(
      document.querySelector('.playground-bookmark-mnemonic')?.getAttribute('aria-label'),
    ).toBe('Bookmark 7');
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
