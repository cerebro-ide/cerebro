// Bookmarks, as IntelliJ's line bookmarks (`ToggleBookmarkAction`, `BookmarksManagerImpl` and the
// Bookmarks tool window's nodes, read from its source): Toggle Bookmark (F11) adds one on the
// caret's line to the worktree's list, named after it as IntelliJ's default list is named after
// the project, or takes it away. The editor shows them in its gutter and moves them with their
// lines. The Bookmarks tool window lists them by file, in the order added, each line by its number
// (IntelliJ's "Group line bookmarks", on by default); a double click or Enter opens a file, or a
// line. Next and Previous Line Bookmark go through them, and Show Bookmarks lists them in a popup.
// A bookmark can have a mnemonic, a digit or a letter, that's its alone (IntelliJ's `BookmarkType`):
// Toggle Bookmark 0 to 9 (Ctrl+Shift+digit) adds or takes one away, Go to Bookmark 0 to 9
// (Ctrl+digit) goes to it. Each reads as its description: its line's text, or one given it. They're
// kept between runs, per worktree.

import { signal, ObservableMap } from '@cerebro-ide/reactive';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import type { BookmarkMark } from '@cerebro-ide/ui-editor';
import {
  fuzzyFilter,
  openPicker,
  type PickerItem,
  type PickerOptions,
} from '@cerebro-ide/ui-popup';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { documentFor, documentRead } from './documents.js';
import { active } from './environments.js';
import { Preview } from './find.js';
import { icon } from './icons.js';

/**
 * A bookmark on a file's line, zero-based; its mnemonic, if it has one; and its description, if
 * it's been given one (IntelliJ's custom description).
 */
export interface LineBookmark {
  path: string;
  line: number;
  mnemonic?: string;
  description?: string;
}

/** The mnemonics a bookmark can have, in IntelliJ's order (`BookmarkType`'s): 1 to 9, 0, A to Z. */
export const MNEMONICS: readonly string[] = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Each worktree's bookmarks, in the order added, by its path, once changed in this run. */
const lists = new ObservableMap<string, readonly LineBookmark[]>();

/**
 * Each worktree's bookmarks as an earlier run kept them, once read: not observable, as they're read
 * where nothing may be written (a popup's list).
 */
const stored = new Map<string, readonly LineBookmark[]>();

const key = (worktree: string) => `cerebro.bookmarks:${worktree}`;

/** A worktree's bookmarks: as kept by an earlier run, the first time; none when unreadable. */
export function bookmarksOf(worktree: string): readonly LineBookmark[] {
  const known = lists.get(worktree) ?? stored.get(worktree);
  if (known) return known;
  let kept: readonly LineBookmark[] = [];
  try {
    const read = JSON.parse(localStorage.getItem(key(worktree)) ?? '[]') as unknown;
    if (Array.isArray(read)) kept = read as LineBookmark[];
  } catch {
    // Unreadable: none.
  }
  stored.set(worktree, kept);
  return kept;
}

function keep(worktree: string, list: readonly LineBookmark[]): void {
  lists.set(worktree, list);
  try {
    localStorage.setItem(key(worktree), JSON.stringify(list));
  } catch {
    // Storage may be full or blocked: they just aren't kept.
  }
}

/** A file's bookmarks, as its editor shows them: their lines, zero-based, and mnemonics. */
export function bookmarkMarks(worktree: string, path: string): BookmarkMark[] {
  return bookmarksOf(worktree)
    .filter((bookmark) => bookmark.path === path)
    .map(({ line, mnemonic }) => ({ line, mnemonic }));
}

/** The bookmark with a mnemonic, if one has it. */
export function bookmarkWith(worktree: string, mnemonic: string): LineBookmark | undefined {
  return bookmarksOf(worktree).find((bookmark) => bookmark.mnemonic === mnemonic);
}

/**
 * A bookmark with a mnemonic on a file's line, as IntelliJ's `toggle(bookmark, type)`: one with it
 * there already is taken away; one without it there, or none, gets it. Another bookmark with it is
 * taken away, once `rewrite` says so (IntelliJ's question).
 */
export async function toggleMnemonic(
  worktree: string,
  at: { path: string; line: number },
  mnemonic: string,
  rewrite: (taken: LineBookmark) => Promise<boolean>,
): Promise<void> {
  const here = (bookmark: LineBookmark) => bookmark.path === at.path && bookmark.line === at.line;
  const found = bookmarksOf(worktree).find(here);
  if (found?.mnemonic === mnemonic) {
    keep(
      worktree,
      bookmarksOf(worktree).filter((bookmark) => bookmark !== found),
    );
    return;
  }
  const taken = bookmarkWith(worktree, mnemonic);
  if (taken && !(await rewrite(taken))) return;
  const list = bookmarksOf(worktree).filter((bookmark) => bookmark.mnemonic !== mnemonic);
  const index = list.findIndex(here);
  keep(
    worktree,
    index < 0
      ? [...list, { path: at.path, line: at.line, mnemonic }]
      : list.with(index, { ...(list[index] as LineBookmark), mnemonic }),
  );
}

/** The bookmark on a file's line, if there's one. */
export function bookmarkAt(
  worktree: string,
  at: { path: string; line: number },
): LineBookmark | undefined {
  return bookmarksOf(worktree).find(
    (bookmark) => bookmark.path === at.path && bookmark.line === at.line,
  );
}

/** Gives the bookmark on a file's line `change`d fields, if there's one there. */
function change(
  worktree: string,
  at: { path: string; line: number },
  changed: (bookmark: LineBookmark) => LineBookmark,
): void {
  const found = bookmarkAt(worktree, at);
  if (!found) return;
  keep(
    worktree,
    bookmarksOf(worktree).map((bookmark) => (bookmark === found ? changed(found) : bookmark)),
  );
}

/** Remove Mnemonic, as IntelliJ's (`DeleteBookmarkTypeAction`): the line's bookmark, without it. */
export function removeMnemonic(worktree: string, at: { path: string; line: number }): void {
  change(worktree, at, (bookmark) => {
    const rest = { ...bookmark };
    delete rest.mnemonic;
    return rest;
  });
}

/**
 * A bookmark's description, as IntelliJ's: the one it was given; else its line's text, trimmed
 * (`createDescription`), once its file's read (asked for here). Read reactively.
 */
export function descriptionOf(bookmark: LineBookmark): string {
  if (bookmark.description !== undefined) return bookmark.description;
  const doc = documentRead(bookmark.path);
  if (!doc) {
    void documentFor(bookmark.path);
    return '';
  }
  const text = doc.text.get();
  return bookmark.line < text.lines ? text.line(bookmark.line + 1).text.trim() : '';
}

/** Gives the line's bookmark a description, if there's one there. */
export function describe(
  worktree: string,
  at: { path: string; line: number },
  description: string,
): void {
  change(worktree, at, (bookmark) => ({ ...bookmark, description }));
}

/**
 * Rename Bookmark, as IntelliJ's (`EditBookmarkAction`): asks for the line's bookmark's description,
 * its own to start with (BookmarkBundle's words).
 */
export async function renameBookmark(
  worktree: string,
  at: { path: string; line: number },
): Promise<void> {
  const found = bookmarkAt(worktree, at);
  if (!found) return;
  const description = await prompt({
    title: 'Bookmark Description',
    label: 'Enter a short bookmark description',
    value: descriptionOf(found),
  });
  if (description !== undefined) describe(worktree, at, description);
}

/** Where "Don't ask again" before a mnemonic's rewritten is kept (IntelliJ's `rewriteBookmarkType`). */
const REWRITE_ASKS = 'cerebro.bookmarks.rewrite';

/**
 * IntelliJ's question before a mnemonic another bookmark has is given to this one ("Rewrite
 * Mnemonic", BookmarkBundle's words), unless told not to ask again; whether to go on. "Don't ask
 * again" is kept only on OK, as IntelliJ's (`DoNotAskOption`, `shouldSaveOptionsOnCancel`).
 */
export async function rewriteAsked(taken: LineBookmark): Promise<boolean> {
  try {
    if (localStorage.getItem(REWRITE_ASKS) === 'false') return true;
  } catch {
    // Not read: asked.
  }
  const again = signal(false);
  const name = taken.path.slice(taken.path.lastIndexOf('/') + 1);
  const answer = await openDialog<true>({
    title: 'Rewrite Mnemonic',
    ok: { label: 'OK', accept: () => true },
    content: () => (
      <div class="playground-question">
        <p>{`‘${taken.mnemonic as string}’ mnemonic is already taken by ‘${name}:${String(taken.line + 1)}’. Do you want to rewrite it?`}</p>
        <label class="playground-checkbox">
          <input
            type="checkbox"
            checked={() => again.get()}
            on:change={(event) => {
              again.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Don’t ask again
        </label>
      </div>
    ),
  }).result;
  if (answer !== true) return false;
  if (again.peek()) {
    try {
      localStorage.setItem(REWRITE_ASKS, 'false');
    } catch {
      // Not kept: asked next time.
    }
  }
  return true;
}

/**
 * What IntelliJ's Toggle Bookmark Mnemonic does on a line (`ChooseBookmarkTypeAction`): adds a
 * bookmark with one where there's none, assigns one to a bookmark without, changes a bookmark's.
 */
export function mnemonicChoice(worktree: string, at: { path: string; line: number }): string {
  const found = bookmarksOf(worktree).find(
    (bookmark) => bookmark.path === at.path && bookmark.line === at.line,
  );
  if (!found) return 'Add Mnemonic Bookmark';
  return found.mnemonic === undefined ? 'Assign Mnemonic' : 'Change Mnemonic';
}

/** The chooser's buttons by row, as IntelliJ's two grids of four rows: the digits, then the letters. */
const GRID = [0, 1, 2, 3].map((row) => [
  ...[0, 1, 2].map((column) => MNEMONICS.slice(0, 10)[row * 3 + column]),
  ...[0, 1, 2, 3, 4, 5, 6].map((column) => MNEMONICS.slice(10)[row * 7 + column]),
]);

/** The button after `from` in a direction, past the grid's gaps, round to the other side. */
function nextInGrid(from: string, dx: number, dy: number): string {
  const row = GRID.findIndex((cells) => cells.includes(from));
  let [x, y] = [GRID[row]?.indexOf(from) as number, row];
  for (;;) {
    x = (x + dx + 10) % 10;
    y = (y + dy + 4) % 4;
    const cell = GRID[y]?.[x];
    if (cell !== undefined) return cell;
  }
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Toggle Bookmark Mnemonic, as IntelliJ's chooser (`BookmarkTypeChooser`, Ctrl+F11): the mnemonics
 * in a grid, those in use and the line's own coloured, as its legend says. Typing one chooses it;
 * a click selects one, and a click on the selected one, Enter or OK chooses it. The line's bookmark
 * then gets it, as IntelliJ's `setType` (choosing its own leaves it), or a bookmark with it is added.
 */
export async function chooseMnemonic(
  worktree: string,
  at: { path: string; line: number },
  rewrite: (taken: LineBookmark) => Promise<boolean>,
): Promise<void> {
  const title = mnemonicChoice(worktree, at);
  const list = bookmarksOf(worktree);
  const found = bookmarkAt(worktree, at);
  const current = found?.mnemonic;
  const used = new Set(list.map((bookmark) => bookmark.mnemonic));
  const selected = signal(current);
  // The bookmark's description to start with, as IntelliJ's; none for a new one.
  const description = signal(found ? descriptionOf(found) : '');
  const result = (mnemonic: string) => ({ mnemonic, description: description.peek() });
  const chosen = await openDialog<{ mnemonic: string; description: string }>({
    title,
    ok: {
      enabled: () => selected.get() !== undefined,
      accept: () => result(selected.peek() as string),
    },
    content: (dialog) => {
      const buttons = new Map<string, HTMLButtonElement>();
      // One button in Tab's order, as IntelliJ's first alone (its focus traversal policy): the one
      // the arrows last moved to, so Tab goes on to the description.
      const tabStop = signal(MNEMONICS[0]);
      const button = (mnemonic: string) => {
        const element = (
          <button
            type="button"
            tabIndex={() => (tabStop.get() === mnemonic ? 0 : -1)}
            on:focus={() => {
              tabStop.set(mnemonic);
            }}
            class={() =>
              `playground-mnemonic${selected.get() === mnemonic ? ' playground-mnemonic--current' : used.has(mnemonic) ? ' playground-mnemonic--used' : ''}`
            }
            on:click={() => {
              if (selected.peek() === mnemonic) dialog.close(result(mnemonic));
              else selected.set(mnemonic);
            }}
          >
            {mnemonic}
          </button>
        ) as HTMLButtonElement;
        buttons.set(mnemonic, element);
        return element;
      };
      return (
        <div class="playground-mnemonics">
          <ul class="playground-mnemonics__comment">
            <li>Quickly set: type or double-click mnemonic</li>
            <li>Provide note: select mnemonic, add description, and press Enter</li>
          </ul>
          <div
            class="playground-mnemonics__grid"
            on:keydown={(event) => {
              const focused = (event.target as HTMLElement).textContent;
              if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
              const arrow = ARROWS[event.key];
              const typed = event.key.toUpperCase();
              if (arrow) {
                buttons.get(nextInGrid(focused, ...arrow))?.focus();
              } else if (event.key === 'Enter') {
                dialog.close(result(focused));
              } else if (typed.length === 1 && MNEMONICS.includes(typed)) {
                dialog.close(result(typed));
              } else {
                return;
              }
              event.preventDefault();
            }}
          >
            <div class="playground-mnemonics__digits">{MNEMONICS.slice(0, 10).map(button)}</div>
            <div class="playground-mnemonics__letters">{MNEMONICS.slice(10).map(button)}</div>
          </div>
          <input
            class="cerebro-dialog-field__input playground-mnemonics__description"
            type="text"
            placeholder="Description (Optional)"
            aria-label="Description"
            spellcheck={false}
            value={description.peek()}
            on:input={(event) => {
              description.set((event.currentTarget as HTMLInputElement).value);
            }}
          />
          <div class="playground-mnemonics__legend">
            <span class="playground-mnemonics__key playground-mnemonics__key--used">
              Already used
            </span>
            <span class="playground-mnemonics__key playground-mnemonics__key--current">
              Current
            </span>
          </div>
        </div>
      );
    },
  }).result;
  if (chosen === undefined) return;
  if (chosen.mnemonic !== current) await toggleMnemonic(worktree, at, chosen.mnemonic, rewrite);
  // As IntelliJ's: given only when there's one.
  if (chosen.description !== '') describe(worktree, at, chosen.description);
}

/** A bookmark on a file's line, added last; or, there already, taken away. */
export function toggleBookmark(worktree: string, path: string, line: number): void {
  const list = bookmarksOf(worktree);
  const others = list.filter((b) => b.path !== path || b.line !== line);
  keep(worktree, others.length < list.length ? others : [...list, { path, line }]);
}

/**
 * A file's bookmarks where an edit has moved them, in their order: as many as before, unless the
 * edit took some away (the last ones' places then go).
 */
export function moveBookmarks(worktree: string, path: string, lines: readonly number[]): void {
  const list = bookmarksOf(worktree);
  const order = list
    .map((bookmark, index) => ({ bookmark, index }))
    .filter(({ bookmark }) => bookmark.path === path)
    .sort((a, b) => a.bookmark.line - b.bookmark.line);
  const moved = new Map(order.map(({ index }, i) => [index, lines[i]]));
  keep(
    worktree,
    list.flatMap((bookmark, index) => {
      if (!moved.has(index)) return [bookmark];
      const line = moved.get(index);
      return line === undefined ? [] : [{ ...bookmark, line }];
    }),
  );
}

/** Bookmarks in IntelliJ's order for going through them: by path, then line. */
const byPlace = (a: LineBookmark, b: LineBookmark) =>
  a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1;

/**
 * The bookmark after a place, or before it, among all the worktree's, as IntelliJ's Next and
 * Previous Line Bookmark (`NextBookmarkService`): by path, then line, with no going round (its
 * registry's `ide.bookmark.occurrence.cyclic.iteration.allowed`, off by default). From nowhere, the
 * first, or the last.
 */
export function nextBookmark(
  worktree: string,
  from: LineBookmark | undefined,
  forward: boolean,
): LineBookmark | undefined {
  const sorted = [...bookmarksOf(worktree)].sort(byPlace);
  if (!from) return forward ? sorted[0] : sorted.at(-1);
  return forward
    ? sorted.find((bookmark) => byPlace(bookmark, from) > 0)
    : sorted.findLast((bookmark) => byPlace(bookmark, from) < 0);
}

/**
 * Show Bookmarks, as IntelliJ's (`ShowLineBookmarksAction`, Shift+F11): a popup titled
 * "Bookmarks" with the worktree's list, its lines not grouped by file (as IntelliJ's popup, where
 * "Group line bookmarks" is off), in the order added, each as its file's name, ":" and its line,
 * then its folder; the first highlighted, its place previewed. Choosing one opens it.
 */
export async function showBookmarks(
  worktree: { id: string; name: string },
  openAt: Opening['openAt'],
): Promise<void> {
  // Read as the list's drawn: descriptions come as their files are read.
  const items = () =>
    bookmarksOf(worktree.id).map((bookmark) => ({
      ...choiceOf(worktree.id, bookmark),
      group: worktree.name,
    }));
  await pickBookmark(worktree.id, openAt, {
    label: 'Bookmarks',
    position: 'top',
    header: () => <span class="playground-popup__title">Bookmarks</span>,
    empty: 'No bookmarks added.',
    items: (query) => fuzzyFilter(items(), query),
    preview: (item) => (item ? <Preview at={{ ...item.bookmark, column: 0 }} /> : null),
  });
}

type BookmarkChoice = PickerItem & { bookmark: LineBookmark };

/**
 * A popup of bookmarks, as IntelliJ's: the one chosen is opened, or the one whose mnemonic is typed
 * while nothing's been searched for yet, as its Go to Bookmark actions in these popups
 * (`GotoBookmarkTypeAction`'s `checkSpeedSearch`).
 */
async function pickBookmark(
  worktree: string,
  openAt: Opening['openAt'],
  options: PickerOptions<BookmarkChoice>,
): Promise<void> {
  let typed: LineBookmark | undefined;
  const picker = openPicker({
    ...options,
    onKey: (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      if ((event.target as HTMLInputElement).value !== '') return false;
      typed = bookmarkWith(worktree, event.key.toUpperCase());
      if (typed) picker.close();
      return typed !== undefined;
    },
  });
  // Read once it's closed: a mnemonic typed closes it with nothing chosen.
  const result = await picker.result;
  const chosen = typed ?? result?.bookmark;
  if (chosen) openAt({ ...chosen, column: 0 });
}

/**
 * A bookmark as IntelliJ's popups list it, as a line node not under its file (`addTextTo`): its
 * file's name, " :" and its line, then its folder; with a description, it first, then the rest
 * muted, the folder in brackets. With its icon.
 */
function choiceOf(worktree: string, bookmark: LineBookmark): BookmarkChoice {
  const name = bookmark.path.slice(worktree.length + 1);
  const slash = name.lastIndexOf('/');
  const place = `${name.slice(slash + 1)} :${String(bookmark.line + 1)}`;
  const folder = slash < 0 ? undefined : name.slice(0, slash);
  const description = descriptionOf(bookmark);
  return {
    // Its description first, its place after it, muted; the folder in brackets, as IntelliJ's.
    ...(description === ''
      ? { label: place, ...(folder === undefined ? {} : { detail: folder }) }
      : { label: description, detail: folder === undefined ? place : `${place}  (${folder})` }),
    icon: () => bookmarkIcon(bookmark),
    bookmark,
  };
}

/**
 * Go to Mnemonic, as IntelliJ's (`ShowTypeBookmarksAction`, Ctrl+Shift+F11): a popup of the
 * bookmarks with mnemonics, in their mnemonics' order, the first highlighted. Typing one's mnemonic
 * goes to it, as Enter or a click on one does.
 */
export async function goToMnemonic(
  worktree: { id: string; name: string },
  openAt: Opening['openAt'],
): Promise<void> {
  const items = () =>
    MNEMONICS.flatMap((mnemonic) => {
      const bookmark = bookmarkWith(worktree.id, mnemonic);
      return bookmark ? [choiceOf(worktree.id, bookmark)] : [];
    });
  await pickBookmark(worktree.id, openAt, {
    label: 'Go to Mnemonic',
    position: 'top',
    header: () => <span class="playground-popup__title">Go to Mnemonic</span>,
    items: (query) => fuzzyFilter(items(), query),
  });
}

/** A bookmark's icon, as IntelliJ's type's: its mnemonic, if it has one, on a square. */
function bookmarkIcon(bookmark: LineBookmark) {
  if (bookmark.mnemonic === undefined) return icon('bookmark');
  return (
    <span class="playground-bookmark-mnemonic" aria-label={`Bookmark ${bookmark.mnemonic}`}>
      {bookmark.mnemonic}
    </span>
  );
}

type Node =
  | { kind: 'list'; key: string; name: string }
  | { kind: 'file'; key: string; path: string }
  | { kind: 'line'; key: string; bookmark: LineBookmark };

/** How the tree opens a file, and a place in one. */
interface Opening {
  open: (tab: { id: string; title: string }) => void;
  openAt: (at: { path: string; line: number; column: number }) => void;
}

/** The active worktree's bookmarks, as a tree. */
export function BookmarksView(props: Opening) {
  return (
    <div class="playground-occurrences">
      {() => {
        const env = active();
        if (!env) return null;
        const list = bookmarksOf(env.id);
        if (list.length === 0) {
          // IntelliJ's status text (BookmarkBundle).
          return (
            <div class="playground-project__empty">
              <p>No bookmarks added.</p>
              <p>Add Bookmark (F11) to code lines.</p>
            </div>
          );
        }
        return <Tree env={env} list={list} open={props.open} openAt={props.openAt} />;
      }}
    </div>
  );
}

function Tree(
  props: Opening & { env: { id: string; name: string }; list: readonly LineBookmark[] },
) {
  const { env, list } = props;
  const files = [...new Set(list.map((b) => b.path))];
  const top: Node = { kind: 'list', key: 'list', name: env.name };
  const model = new TreeModel<Node>({
    children: (node) => {
      if (node === undefined) return [top];
      if (node.kind === 'list') {
        return files.map((path) => ({ kind: 'file' as const, key: path, path }));
      }
      return list
        .filter((b) => node.kind === 'file' && b.path === node.path)
        .map((bookmark) => ({
          kind: 'line' as const,
          key: `${bookmark.path}:${String(bookmark.line)}`,
          bookmark,
        }));
    },
    key: (node) => node.key,
    isLeaf: (node) => node.kind === 'line',
  });
  // Open, as IntelliJ's.
  model.expand(top);
  for (const path of files) model.expand({ kind: 'file', key: path, path });
  const relative = (path: string) => path.slice(env.id.length + 1);
  return (
    <TreeView
      model={model}
      label="Bookmarks"
      openParents
      row={(node) => {
        if (node.kind === 'list') {
          return [
            // IntelliJ's is its bookmark group icon (a claim: the bookmark's drawn in its place).
            icon('bookmark'),
            <b class="playground-occurrences__name">{node.name}</b>,
            <span class="playground-occurrences__count">Default</span>,
          ];
        }
        if (node.kind === 'file') {
          const name = relative(node.path);
          const slash = name.lastIndexOf('/');
          return [
            icon('file'),
            <span class="playground-occurrences__name">{name.slice(slash + 1)}</span>,
            slash < 0 ? null : (
              <span class="playground-occurrences__count">{name.slice(0, slash)}</span>
            ),
          ];
        }
        // With the bookmark's icon, as IntelliJ's line nodes (`wrapIcon(null)`: its type's).
        return [
          bookmarkIcon(node.bookmark),
          <span class="playground-occurrences__count">{`${String(node.bookmark.line + 1)}:`}</span>,
          <span class="playground-occurrences__text">{() => descriptionOf(node.bookmark)}</span>,
        ];
      }}
      onOpen={(node) => {
        if (node.kind === 'file') {
          props.open({ id: node.path, title: node.path.slice(node.path.lastIndexOf('/') + 1) });
        }
        if (node.kind === 'line') props.openAt({ ...node.bookmark, column: 0 });
      }}
    />
  );
}
