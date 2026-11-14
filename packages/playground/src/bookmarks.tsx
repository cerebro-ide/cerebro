// Bookmarks, as IntelliJ's line bookmarks (`ToggleBookmarkAction`, `BookmarksManagerImpl` and the
// Bookmarks tool window's nodes, read from its source): Toggle Bookmark (F11) adds one on the
// caret's line to the worktree's list, named after it as IntelliJ's default list is named after
// the project, or takes it away. The editor shows them in its gutter and moves them with their
// lines. The Bookmarks tool window lists them by file, in the order added, each line by its number
// (IntelliJ's "Group line bookmarks", on by default); a double click or Enter opens a file, or a
// line. They're kept between runs, per worktree.

import { ObservableMap } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active } from './environments.js';
import { icon } from './icons.js';

/** A bookmark on a file's line, zero-based. */
export interface LineBookmark {
  path: string;
  line: number;
}

/** Each worktree's bookmarks, in the order added, by its path. */
const lists = new ObservableMap<string, readonly LineBookmark[]>();

const key = (worktree: string) => `cerebro.bookmarks:${worktree}`;

/** A worktree's bookmarks: as kept by an earlier run, the first time; none when unreadable. */
export function bookmarksOf(worktree: string): readonly LineBookmark[] {
  const known = lists.get(worktree);
  if (known) return known;
  let kept: readonly LineBookmark[] = [];
  try {
    const read = JSON.parse(localStorage.getItem(key(worktree)) ?? '[]') as unknown;
    if (Array.isArray(read)) kept = read as LineBookmark[];
  } catch {
    // Unreadable: none.
  }
  lists.set(worktree, kept);
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

/** The bookmarked lines of a file, zero-based. */
export function bookmarkedLines(worktree: string, path: string): number[] {
  return bookmarksOf(worktree)
    .filter((bookmark) => bookmark.path === path)
    .map((bookmark) => bookmark.line);
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
      return line === undefined ? [] : [{ path, line }];
    }),
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
        return (
          <span class="playground-occurrences__count">{`${String(node.bookmark.line + 1)}:`}</span>
        );
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
