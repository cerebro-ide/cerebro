// The Find tool window, as IntelliJ's: what Find in Files found, opened there ("Open in Find
// Window"), as a tree of folders, files and lines, each with how many matches it holds. A double
// click or Enter on a line opens its file there. It shows the active worktree's last search; a new
// one replaces it. The window is registered the first time it's used, as IntelliJ's appears.

import { signal, untracked } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active } from './environments.js';
import type { TextMatch } from './find.js';

/** A search's lines, as the Find window shows them. */
export interface Occurrences {
  /** The worktree searched. */
  worktree: string;
  /** What was searched for, and where: "Occurrences of 'shape' in Project". */
  title: string;
  matches: readonly TextMatch[];
  /** Whether the search stopped at its limit, with more to find. */
  limited: boolean;
}

type Item =
  | { kind: 'folder'; key: string; name: string; count: number; children: Item[] }
  | { kind: 'file'; key: string; name: string; count: number; children: Item[] }
  | { kind: 'line'; key: string; match: TextMatch };

/** The last search shown, by worktree. */
const shown = signal<ReadonlyMap<string, Occurrences>>(new Map());

/** Shows a search's lines in the Find window, in place of the worktree's last ones. */
export function showOccurrences(occurrences: Occurrences): void {
  shown.set(new Map([...shown.peek(), [occurrences.worktree, occurrences]]));
}

const matchesIn = (lines: readonly TextMatch[]) =>
  lines.reduce((sum, line) => sum + line.ranges.length, 0);

/** "3 matches", as IntelliJ counts a node's. */
const count = (n: number) => `${String(n)} ${n === 1 ? 'match' : 'matches'}`;

/**
 * The lines as a tree: a node per folder (its path within the worktree, as IntelliJ's flattened
 * folders), then per file, then per line, in the order found (by path, then line).
 */
export function occurrencesTree(worktree: string, matches: readonly TextMatch[]): Item[] {
  const relative = (path: string) =>
    path.startsWith(`${worktree}/`) ? path.slice(worktree.length + 1) : path;
  const folders = new Map<string, Map<string, TextMatch[]>>();
  for (const match of matches) {
    const path = relative(match.path);
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const files = folders.get(folder) ?? new Map<string, TextMatch[]>();
    files.set(match.path, [...(files.get(match.path) ?? []), match]);
    folders.set(folder, files);
  }
  const fileItems = (files: Map<string, TextMatch[]>): Item[] =>
    [...files].map(([path, lines]) => ({
      kind: 'file',
      key: `file:${path}`,
      name: path.split('/').at(-1) as string,
      count: matchesIn(lines),
      children: lines.map((match) => ({
        kind: 'line',
        key: `line:${path}:${String(match.line)}`,
        match,
      })),
    }));
  // The worktree's own files at the top, as IntelliJ lists them after its folders: not nested.
  return [...folders].flatMap(([folder, files]): Item[] =>
    folder === ''
      ? fileItems(files)
      : [
          {
            kind: 'folder',
            key: `folder:${folder}`,
            name: folder,
            count: matchesIn([...files.values()].flat()),
            children: fileItems(files),
          },
        ],
  );
}

/** A line found: its number, then its text with the matches bold. */
function Line(props: { match: TextMatch }) {
  const { text, ranges } = props.match;
  const indent = text.length - text.trimStart().length;
  const parts: (string | Node)[] = [];
  let at = indent;
  for (const [from, to] of ranges) {
    if (from < at) continue;
    parts.push(
      text.slice(at, from),
      <b class="playground-occurrences__match">{text.slice(from, to)}</b>,
    );
    at = to;
  }
  parts.push(text.slice(at));
  return [
    <span class="playground-occurrences__number">{String(props.match.line + 1)}</span>,
    <span class="playground-occurrences__text">{parts}</span>,
  ];
}

/** The active worktree's last search, as a tree; `open` opens a line's file there. */
export function FindView(props: {
  open: (at: { path: string; line: number; column: number }) => void;
}) {
  return (
    <div class="playground-occurrences">
      {() => {
        const env = active();
        const occurrences = env && shown.get().get(env.id);
        if (!occurrences) return <p class="playground-project__empty">Nothing searched</p>;
        // Made without tracking: the tree's model reads and writes its own state as it's made.
        return untracked(() => <Results occurrences={occurrences} open={props.open} />);
      }}
    </div>
  );
}

/** A search's lines, as a tree, under its title and count. */
function Results(props: {
  occurrences: Occurrences;
  open: (at: { path: string; line: number; column: number }) => void;
}) {
  const { occurrences } = props;
  const roots = occurrencesTree(occurrences.worktree, occurrences.matches);
  const model = new TreeModel<Item>({
    children: (item) => (item === undefined ? roots : 'children' in item ? item.children : []),
    key: (item) => item.key,
    isLeaf: (item) => item.kind === 'line',
  });
  // Every folder and file open, as IntelliJ's results are.
  const expand = (items: Item[]) => {
    for (const item of items) {
      if (item.kind === 'line') continue;
      model.expand(item);
      expand(item.children);
    }
  };
  expand(roots);
  const files = new Set(occurrences.matches.map((m) => m.path)).size;
  const plus = occurrences.limited ? '+' : '';
  return [
    <div class="playground-occurrences__title">
      {occurrences.title}
      <span class="playground-occurrences__count">
        {`${count(matchesIn(occurrences.matches))}${plus} in ${String(files)}${plus} file${files === 1 ? '' : 's'}`}
      </span>
    </div>,
    <TreeView
      model={model}
      label={occurrences.title}
      row={(item) =>
        item.kind === 'line' ? (
          <Line match={item.match} />
        ) : (
          [
            <span class="playground-occurrences__name">{item.name}</span>,
            <span class="playground-occurrences__count">{count(item.count)}</span>,
          ]
        )
      }
      onOpen={(item) => {
        const { match } = item as Extract<Item, { kind: 'line' }>;
        props.open({ path: match.path, line: match.line, column: match.ranges[0]?.[0] ?? 0 });
      }}
    />,
  ];
}
