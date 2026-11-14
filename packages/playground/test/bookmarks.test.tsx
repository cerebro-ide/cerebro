import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  bookmarkMarks,
  bookmarkWith,
  bookmarkAt,
  bookmarksOf,
  BookmarksView,
  chooseMnemonic,
  describe as describeBookmark,
  descriptionOf,
  goToMnemonic,
  mnemonicChoice,
  moveBookmarks,
  nextBookmark,
  removeMnemonic,
  renameBookmark,
  rewriteAsked,
  showBookmarks,
  toggleBookmark,
  toggleMnemonic,
  type Bookmark,
} from '../src/bookmarks.js';
import { documentFor } from '../src/documents.js';
import { workspace } from '../src/environments.js';
import { answer, closeAll, dialog, dialogText, popupItems, press } from './fakes.js';

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
    () => <BookmarksView go={(bookmark) => void opened.push(bookmark)} />,
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
    toggleBookmark('/kept', { path: '/kept/b', line: 0 });
    toggleBookmark('/kept', { path: '/kept/a', line: 5 });
    expect(bookmarkMarks('/kept', '/kept/a').map((mark) => mark.line)).toEqual([2, 5]);
    expect(JSON.parse(localStorage.getItem('cerebro.bookmarks:/kept') as string)).toEqual([
      { path: '/kept/a', line: 2 },
      { path: '/kept/b', line: 0 },
      { path: '/kept/a', line: 5 },
    ]);
    // Toggled again: taken away.
    toggleBookmark('/kept', { path: '/kept/a', line: 2 });
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
    toggleBookmark('/moved', { path: '/moved/a', line: 7 });
    toggleBookmark('/moved', { path: '/moved/b', line: 1 });
    toggleBookmark('/moved', { path: '/moved/a', line: 3 });
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
    toggleBookmark('/next', { path: '/next/b', line: 3 });
    toggleBookmark('/next', { path: '/next/a', line: 9 });
    toggleBookmark('/next', { path: '/next/b', line: 1 });
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
    const asked: Bookmark[] = [];
    let rewrite = false;
    const toggle = (path: string, line: number, mnemonic: string) =>
      toggleMnemonic('/m', { path, line }, mnemonic, (taken) => {
        asked.push(taken);
        return Promise.resolve(rewrite);
      });
    toggleBookmark('/m', { path: '/m/a', line: 0 });
    toggleBookmark('/m', { path: '/m/a', line: 3 });
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
      toggleBookmark('/full', { path: '/full/a', line: 0 });
    } finally {
      localStorage.setItem = setItem;
    }
    expect(bookmarksOf('/full')).toEqual([{ path: '/full/a', line: 0 }]);
    expect(localStorage.getItem('cerebro.bookmarks:/full')).toBeNull();
  });
});

describe('file and folder bookmarks', () => {
  const yes = () => Promise.resolve(true);

  it('are kept with lines’ but apart from them: not in the gutter, not gone through, not moved', async () => {
    toggleBookmark('/ff', { path: '/ff/a.ts', line: 1 });
    toggleBookmark('/ff', { path: '/ff/a.ts' });
    toggleBookmark('/ff', { path: '/ff/src', folder: true });
    // Kept with no fields that aren't theirs.
    expect(JSON.parse(localStorage.getItem('cerebro.bookmarks:/ff') as string)).toStrictEqual([
      { path: '/ff/a.ts', line: 1 },
      { path: '/ff/a.ts' },
      { path: '/ff/src', folder: true },
    ]);
    expect(bookmarkAt('/ff', { path: '/ff/a.ts' })).toEqual({ path: '/ff/a.ts' });
    expect(bookmarkMarks('/ff', '/ff/a.ts')).toEqual([{ line: 1, mnemonic: undefined }]);
    expect(nextBookmark('/ff', undefined, true)).toEqual({ path: '/ff/a.ts', line: 1 });
    expect(nextBookmark('/ff', { path: '/ff/a.ts', line: 1 }, true)).toBeUndefined();
    moveBookmarks('/ff', '/ff/a.ts', [3]);
    expect(bookmarksOf('/ff')).toEqual([
      { path: '/ff/a.ts', line: 3 },
      { path: '/ff/a.ts' },
      { path: '/ff/src', folder: true },
    ]);
    // No description of their own, as IntelliJ's.
    expect(descriptionOf({ path: '/ff/a.ts' })).toBe('');
    // A mnemonic: its own, the line's left.
    await toggleMnemonic('/ff', { path: '/ff/src', folder: true }, 'F', yes);
    expect(bookmarkWith('/ff', 'F')).toEqual({ path: '/ff/src', folder: true, mnemonic: 'F' });
    expect(mnemonicChoice('/ff', { path: '/ff/a.ts' })).toBe('Assign Mnemonic');
    await toggleMnemonic('/ff', { path: '/ff/b.ts' }, 'B', yes);
    expect(bookmarkAt('/ff', { path: '/ff/b.ts' })).toEqual({ path: '/ff/b.ts', mnemonic: 'B' });
    // Taken away, the line's left.
    toggleBookmark('/ff', { path: '/ff/a.ts' });
    expect(bookmarkAt('/ff', { path: '/ff/a.ts', line: 3 })).toBeDefined();
    expect(bookmarkAt('/ff', { path: '/ff/a.ts' })).toBeUndefined();
  });

  it('are named by their file’s or folder’s name when a mnemonic’s taken from them', async () => {
    localStorage.removeItem('cerebro.bookmarks.rewrite');
    const asked = rewriteAsked({ path: '/q/src', folder: true, mnemonic: '4' });
    expect(await dialogText()).toBe(
      '‘4’ mnemonic is already taken by ‘src’. Do you want to rewrite it?Don’t ask again',
    );
    await press('Cancel');
    expect(await asked).toBe(false);
  });

  it('show in the window as their files and folders, with their lines under them', async () => {
    workspace.openOrActivate({ id: '/fw', name: 'fw', branch: 'main' });
    mount();
    toggleBookmark('/fw', { path: '/fw/src/a.ts', line: 0 });
    toggleBookmark('/fw', { path: '/fw/src/a.ts' });
    toggleBookmark('/fw', { path: '/fw/lib', folder: true });
    toggleBookmark('/fw', { path: '/fw/b.ts' });
    // Each in the place of its first bookmark: a file's lines under it.
    await expect.poll(rows).toEqual(['fwDefault', 'a.tssrc', '1:', 'lib', 'b.ts']);
    // Only a file with lines opens.
    expect(row('/fw/src/a.ts').getAttribute('aria-expanded')).toBe('true');
    expect(row('/fw/lib').hasAttribute('aria-expanded')).toBe(false);
    expect(row('/fw/b.ts').hasAttribute('aria-expanded')).toBe(false);
    // With a mnemonic: it, then the file's own icon; with a description: it first, the folder in
    // brackets.
    await toggleMnemonic('/fw', { path: '/fw/src/a.ts' }, 'A', yes);
    describeBookmark('/fw', { path: '/fw/src/a.ts' }, 'main');
    await expect.poll(rows).toEqual(['fwDefault', 'Amaina.ts(src)', '1:', 'lib', 'b.ts']);
    const mark = row('/fw/src/a.ts').querySelector('.playground-bookmark-mnemonic');
    expect(mark?.nextElementSibling?.tagName).toBe('svg');
    describeBookmark('/fw', { path: '/fw/b.ts' }, 'top');
    await expect.poll(rows).toEqual(['fwDefault', 'Amaina.ts(src)', '1:', 'lib', 'topb.ts']);
    // Gone to as they are.
    await userEvent.dblClick(row('/fw/lib'));
    await userEvent.dblClick(row('/fw/src/a.ts'));
    expect(opened).toEqual([
      { path: '/fw/lib', folder: true },
      { path: '/fw/src/a.ts', mnemonic: 'A', description: 'main' },
    ]);
    workspace.close('/fw');
  });

  it('are listed in the popups by their names, previewed from a file’s start, and gone to', async () => {
    const worktree = { id: '/fp', name: 'fp' };
    toggleBookmark('/fp', { path: '/fp/src/a.ts' });
    toggleBookmark('/fp', { path: '/fp/lib', folder: true });
    describeBookmark('/fp', { path: '/fp/lib', folder: true }, 'libs');
    const shown = showBookmarks(worktree, (bookmark) => void opened.push(bookmark));
    expect(await popupItems()).toEqual(['a.ts', 'libs']);
    expect(
      [...document.querySelectorAll('.cerebro-popup-item')].map(
        (item) => item.querySelector('.cerebro-popup-item__detail')?.textContent,
      ),
    ).toEqual(['src', 'lib']);
    const preview = () =>
      document.querySelector('.cerebro-popup__preview .playground-find__preview');
    expect(preview()).not.toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    await expect.poll(preview).toBeNull();
    await userEvent.keyboard('{Enter}');
    await shown;
    expect(opened).toEqual([{ path: '/fp/lib', folder: true, description: 'libs' }]);
  });
});

describe('Show Bookmarks', () => {
  const worktree = { id: '/shown', name: 'shown' };
  const highlighted = () =>
    document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
      ?.textContent;

  it('lists the worktree’s bookmarks in the order added, under its list, and opens the one chosen', async () => {
    toggleBookmark('/shown', { path: '/shown/src/a.ts', line: 4 });
    toggleBookmark('/shown', { path: '/shown/top.ts', line: 0 });
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
    expect(opened).toEqual([{ path: '/shown/top.ts', line: 0 }]);
  });

  it('goes to one whose mnemonic is typed before anything’s searched for, as IntelliJ’s', async () => {
    const yes = () => Promise.resolve(true);
    await toggleMnemonic('/shown', { path: '/shown/top.ts', line: 0 }, 'T', yes);
    await toggleMnemonic('/shown', { path: '/shown/src/a.ts', line: 4 }, 'S', yes);
    let shown = showBookmarks(worktree, (at) => void opened.push(at));
    await popupItems();
    await userEvent.keyboard('t');
    await shown;
    expect(opened).toEqual([{ path: '/shown/top.ts', line: 0, mnemonic: 'T' }]);
    // Once searching: searched for.
    shown = showBookmarks(worktree, (at) => void opened.push(at));
    await popupItems();
    await userEvent.keyboard('a.');
    await userEvent.keyboard('t');
    await expect.poll(popupItems).toEqual(['a.ts :5']);
    await userEvent.keyboard('{Enter}');
    await shown;
    expect(opened.at(-1)).toEqual({ path: '/shown/src/a.ts', line: 4, mnemonic: 'S' });
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

describe('the mnemonic chooser', () => {
  const at = { path: '/c/a.ts', line: 2 };
  const never = () => Promise.resolve(false);
  const button = (mnemonic: string) =>
    [...document.querySelectorAll<HTMLElement>('.playground-mnemonic')].find(
      (element) => element.textContent === mnemonic,
    ) as HTMLElement;
  const marked = (kind: string) =>
    [...document.querySelectorAll(`.playground-mnemonic--${kind}`)].map((b) => b.textContent);
  const title = () => document.querySelector('.cerebro-dialog__title span')?.textContent;
  const closed = () => expect.poll(() => document.querySelector('.cerebro-dialog')).toBeNull();

  it('is titled for what it does on the line, as IntelliJ’s', async () => {
    expect(mnemonicChoice('/c', at)).toBe('Add Mnemonic Bookmark');
    toggleBookmark('/c', { path: at.path, line: at.line });
    expect(mnemonicChoice('/c', at)).toBe('Assign Mnemonic');
    await toggleMnemonic('/c', at, 'B', never);
    expect(mnemonicChoice('/c', at)).toBe('Change Mnemonic');
    toggleBookmark('/c', { path: at.path, line: at.line });
  });

  it('shows the mnemonics in two grids, those used and the line’s coloured', async () => {
    await toggleMnemonic('/c', at, '7', never);
    await toggleMnemonic('/c', { path: '/c/b.ts', line: 0 }, 'K', never);
    const chosen = chooseMnemonic('/c', at, never);
    const shown = await dialog();
    expect(title()).toBe('Change Mnemonic');
    expect(
      [...shown.querySelectorAll('.playground-mnemonics__digits button')].map((b) => b.textContent),
    ).toEqual('1234567890'.split(''));
    expect(
      [...shown.querySelectorAll('.playground-mnemonics__letters button')]
        .map((b) => b.textContent)
        .join(''),
    ).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(marked('current')).toEqual(['7']);
    expect(marked('used')).toEqual(['K']);
    expect(shown.querySelector('.playground-mnemonics__comment')?.textContent).toBe(
      'Quickly set: type or double-click mnemonicProvide note: select mnemonic, add description, and press Enter',
    );
    expect(shown.querySelector('.playground-mnemonics__legend')?.textContent).toBe(
      'Already usedCurrent',
    );
    // A click selects; the line's own is then one used.
    await userEvent.click(button('3'));
    expect(marked('current')).toEqual(['3']);
    expect(marked('used')).toEqual(['7', 'K']);
    // Clicked again: chosen.
    await userEvent.click(button('3'));
    await chosen;
    expect(bookmarkWith('/c', '3')).toEqual({ ...at, mnemonic: '3' });
    expect(bookmarkWith('/c', '7')).toBeUndefined();
    toggleBookmark('/c', { path: at.path, line: at.line });
    toggleBookmark('/c', { path: '/c/b.ts', line: 0 });
  });

  it('chooses one typed, adding a bookmark with it', async () => {
    const chosen = chooseMnemonic('/c', at, never);
    await dialog();
    expect(title()).toBe('Add Mnemonic Bookmark');
    // Not with a modifier, nor a key that's no mnemonic.
    await userEvent.keyboard('{Shift>}q{/Shift}-');
    expect(document.querySelector('.cerebro-dialog')).not.toBeNull();
    await userEvent.keyboard('q');
    await chosen;
    expect(bookmarksOf('/c')).toEqual([{ ...at, mnemonic: 'Q' }]);
    toggleBookmark('/c', { path: at.path, line: at.line });
  });

  it('moves between its buttons with the arrows, round the grids and past their gaps', async () => {
    const chosen = chooseMnemonic('/c', at, never);
    await dialog();
    const focused = () => document.activeElement?.textContent;
    expect(focused()).toBe('1');
    const moves: [string, string][] = [
      ['{ArrowUp}', '0'],
      ['{ArrowLeft}', 'Z'],
      ['{ArrowRight}', '0'],
      ['{ArrowRight}', 'V'],
      ['{ArrowDown}', 'A'],
      ['{ArrowLeft}', '3'],
      ['{ArrowLeft}', '2'],
      ['{ArrowUp}', '8'],
      ['{ArrowDown}', '2'],
      ['{ArrowLeft}', '1'],
      ['{ArrowLeft}', 'G'],
    ];
    for (const [key, then] of moves) {
      await userEvent.keyboard(key);
      expect(focused()).toBe(then);
    }
    // Tab goes on from it to the description, not to the next button; Shift+Tab back to it.
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement?.className).toContain('playground-mnemonics__description');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(focused()).toBe('G');
    // Enter chooses the one with the focus.
    await userEvent.keyboard('{Enter}');
    await chosen;
    expect(bookmarkWith('/c', 'G')).toEqual({ ...at, mnemonic: 'G' });
    toggleBookmark('/c', { path: at.path, line: at.line });
  });

  it('chooses the one selected on OK, leaves the line’s own, and asks before taking another’s', async () => {
    toggleBookmark('/c', { path: at.path, line: at.line });
    let chosen = chooseMnemonic('/c', at, never);
    await dialog();
    expect(title()).toBe('Assign Mnemonic');
    const ok = () =>
      document.querySelector('.cerebro-dialog__button--primary') as HTMLButtonElement;
    // None selected: no OK.
    expect(ok().disabled).toBe(true);
    await userEvent.click(button('C'));
    await press('OK');
    await chosen;
    expect(bookmarksOf('/c')).toEqual([{ ...at, mnemonic: 'C' }]);
    // Its own chosen: kept, not taken away as a toggle would.
    chosen = chooseMnemonic('/c', at, never);
    await press('OK');
    await chosen;
    expect(bookmarksOf('/c')).toEqual([{ ...at, mnemonic: 'C' }]);
    // Cancelled: nothing.
    chosen = chooseMnemonic('/c', at, never);
    await press('Cancel');
    await chosen;
    expect(bookmarksOf('/c')).toEqual([{ ...at, mnemonic: 'C' }]);
    // Another's: asked, and left when told no.
    const other = { path: '/c/b.ts', line: 1 };
    const asked: Bookmark[] = [];
    chosen = chooseMnemonic('/c', other, (taken) => {
      asked.push(taken);
      return Promise.resolve(false);
    });
    await dialog();
    await userEvent.keyboard('c');
    await chosen;
    expect(asked).toEqual([{ ...at, mnemonic: 'C' }]);
    expect(bookmarksOf('/c')).toEqual([{ ...at, mnemonic: 'C' }]);
    toggleBookmark('/c', { path: at.path, line: at.line });
    await closed();
  });
});

describe('descriptions', () => {
  const yes = () => Promise.resolve(true);
  const at = { path: '/d/src/a.ts', line: 1 };

  it('are the line’s text, trimmed, once its file’s read, until one’s given', async () => {
    toggleBookmark('/d', { path: at.path, line: at.line });
    const bookmark = bookmarkAt('/d', at) as Bookmark;
    // Its file not read yet.
    const read = documentFor(at.path, () => 'first\n  second line  \n');
    expect(descriptionOf(bookmark)).toBe('');
    await read;
    expect(descriptionOf(bookmark)).toBe('second line');
    // Past the text's end: none.
    expect(descriptionOf({ ...bookmark, line: 9 })).toBe('');
    describeBookmark('/d', at, 'mine');
    expect(descriptionOf(bookmarkAt('/d', at) as Bookmark)).toBe('mine');
    // Kept as its mnemonic changes, and when it's removed.
    await toggleMnemonic('/d', at, '4', yes);
    expect(bookmarkAt('/d', at)).toEqual({ ...at, mnemonic: '4', description: 'mine' });
    removeMnemonic('/d', at);
    expect(bookmarkAt('/d', at)).toEqual({ ...at, description: 'mine' });
    // None there: nothing given or removed.
    describeBookmark('/d', { path: at.path, line: 7 }, 'x');
    removeMnemonic('/d', { path: at.path, line: 7 });
    expect(bookmarksOf('/d')).toHaveLength(1);
    toggleBookmark('/d', { path: at.path, line: at.line });
  });

  it('show in the popups, first, with the place muted after them', async () => {
    toggleBookmark('/d', { path: at.path, line: at.line });
    describeBookmark('/d', at, 'the area');
    toggleBookmark('/d', { path: '/d/top.ts', line: 0 });
    describeBookmark('/d', { path: '/d/top.ts', line: 0 }, 'top');
    const shown = showBookmarks({ id: '/d', name: 'd' }, () => undefined);
    expect(await popupItems()).toEqual(['the area', 'top']);
    expect(
      [...document.querySelectorAll('.cerebro-popup-item__detail')].map((d) => d.textContent),
    ).toEqual(['a.ts :2  (src)', 'top.ts :1']);
    // Found by the place too.
    await userEvent.keyboard('top.ts');
    await expect.poll(popupItems).toEqual(['top']);
    await closeAll();
    await shown;
    toggleBookmark('/d', { path: at.path, line: at.line });
    toggleBookmark('/d', { path: '/d/top.ts', line: 0 });
  });

  it('are given by Rename Bookmark, the description to start with', async () => {
    await renameBookmark('/d', at);
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    toggleBookmark('/d', { path: at.path, line: at.line });
    let renamed = renameBookmark('/d', at);
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'Bookmark Description',
    );
    expect(await dialogText()).toBe('Enter a short bookmark description');
    expect((await answer('')).value).toBe('');
    await answer('renamed');
    await press('OK');
    await renamed;
    expect(bookmarkAt('/d', at)?.description).toBe('renamed');
    renamed = renameBookmark('/d', at);
    expect(((await dialog()).querySelector('input') as HTMLInputElement).value).toBe('renamed');
    await press('Cancel');
    await renamed;
    expect(bookmarkAt('/d', at)?.description).toBe('renamed');
    toggleBookmark('/d', { path: at.path, line: at.line });
  });

  it('are given in the mnemonic chooser, its own to start with, none for a new one', async () => {
    let chosen = chooseMnemonic('/d', at, yes);
    const field = async () =>
      (await dialog()).querySelector<HTMLInputElement>(
        '.playground-mnemonics__description',
      ) as HTMLInputElement;
    expect((await field()).value).toBe('');
    expect((await field()).placeholder).toBe('Description (Optional)');
    // None given: none kept.
    await userEvent.keyboard('e');
    await chosen;
    expect(bookmarkAt('/d', at)).toEqual({ ...at, mnemonic: 'E' });
    describeBookmark('/d', at, 'old');
    chosen = chooseMnemonic('/d', at, yes);
    expect((await field()).value).toBe('old');
    // A mnemonic selected, a description typed, and Enter.
    await userEvent.click(
      [...document.querySelectorAll('.playground-mnemonic')].find(
        (b) => b.textContent === 'F',
      ) as HTMLElement,
    );
    await userEvent.clear(await field());
    await userEvent.type(await field(), 'new{Enter}');
    await chosen;
    expect(bookmarkAt('/d', at)).toEqual({ ...at, mnemonic: 'F', description: 'new' });
    toggleBookmark('/d', { path: at.path, line: at.line });
  });
});

describe('Go to Mnemonic', () => {
  const worktree = { id: '/go', name: 'go' };
  const yes = () => Promise.resolve(true);

  it('lists the bookmarks with mnemonics in their order, and goes to one typed', async () => {
    await toggleMnemonic('/go', { path: '/go/b.ts', line: 3 }, 'K', yes);
    toggleBookmark('/go', { path: '/go/plain.ts', line: 0 });
    await toggleMnemonic('/go', { path: '/go/src/a.ts', line: 1 }, '2', yes);
    const gone = goToMnemonic(worktree, (at) => void opened.push(at));
    expect(await popupItems()).toEqual(['a.ts :2', 'b.ts :4']);
    expect(document.querySelector('.cerebro-popup__header')?.textContent).toBe('Go to Mnemonic');
    expect(
      [...document.querySelectorAll('.cerebro-popup-item .playground-bookmark-mnemonic')].map(
        (icon) => icon.textContent,
      ),
    ).toEqual(['2', 'K']);
    // With a modifier, or one no bookmark has: searched for, as in any list.
    await userEvent.keyboard('{Control>}k{/Control}b');
    await expect.poll(popupItems).toEqual(['b.ts :4']);
    await userEvent.keyboard('{Backspace}k');
    await gone;
    expect(opened).toEqual([{ path: '/go/b.ts', line: 3, mnemonic: 'K' }]);
  });

  it('goes to the one chosen, and nowhere when closed', async () => {
    let gone = goToMnemonic(worktree, (at) => void opened.push(at));
    await popupItems();
    await userEvent.keyboard('{Enter}');
    await gone;
    expect(opened).toEqual([{ path: '/go/src/a.ts', line: 1, mnemonic: '2' }]);
    gone = goToMnemonic(worktree, (at) => void opened.push(at));
    await popupItems();
    await closeAll();
    await gone;
    expect(opened).toHaveLength(1);
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
    toggleBookmark('/r', { path: '/r/src/a.ts', line: 4 });
    toggleBookmark('/r', { path: '/r/top.ts', line: 0 });
    toggleBookmark('/r', { path: '/r/src/a.ts', line: 1 });
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
    expect(opened).toEqual([{ path: '/r/src/a.ts' }]);
    await userEvent.click(row('/r/src/a.ts:1'));
    await userEvent.keyboard('{Enter}');
    expect(opened.at(-1)).toEqual({ path: '/r/src/a.ts', line: 1 });
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
    toggleBookmark('/r', { path: '/r/top.ts', line: 0 });
    await expect.poll(rows).toEqual(['rDefault', 'a.tssrc', '5:', '2:']);
  });

  it('shows nothing with no worktree open', () => {
    workspace.close('/r');
    mount();
    expect(document.querySelector('.playground-occurrences')?.textContent).toBe('');
  });
});
