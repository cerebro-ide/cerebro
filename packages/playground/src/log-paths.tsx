// The Log's Paths filter, as IntelliJ's (StructureFilterPopupComponent, VcsStructureChooser,
// SelectionManager, FileFilterModel, VcsLogBundle):
// - Select… (paths typed, a line each), Select in Tree… (the repository's files and folders, each
//   with a checkbox), then the recent choices;
// - a path is from the repository's top, with `/` between its parts; a folder's ends in `/`;
// - in the tree, a folder checked checks what's in it, which can't be unchecked alone; a folder
//   with something checked in it shows checked, and can't be checked itself; a hundred at most.
// Claims: paths show with `/` on Windows too (IntelliJ shows the system's separator); the tree
// leaves out ignored files, as IntelliJ's, but not unversioned ones, which IntelliJ leaves out too.

import type { Platform } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, type PickerItem } from '@cerebro-ide/ui-popup';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { openFilterPicker, recentChoices, rememberChoice, selectValues } from './log-filters.js';
import type { FileNode } from './project.js';

/** How many paths the tree takes, IntelliJ's VcsStructureChooser.MAX_FOLDERS. */
export const MAX_PATHS = 100;

/** A path in the tree, as IntelliJ's TreeNodeState: checked, or under or over one that is. */
export type PathState = 'selected' | 'clear' | 'above' | 'below';

const isFolder = (path: string) => path.endsWith('/');

/** Whether `folder` holds `path`, at any depth. */
const holds = (folder: string, path: string) =>
  isFolder(folder) && path !== folder && path.startsWith(folder);

/** A path's state among those checked. */
export function pathState(path: string, selected: ReadonlySet<string>): PathState {
  if (selected.has(path)) return 'selected';
  const checked = [...selected];
  if (checked.some((other) => holds(other, path))) return 'above';
  if (checked.some((other) => holds(path, other))) return 'below';
  return 'clear';
}

/** Checks a path, or unchecks it: not one under a checked folder, nor past the limit. */
export function togglePath(
  path: string,
  selected: ReadonlySet<string>,
  max = MAX_PATHS,
): ReadonlySet<string> {
  const state = pathState(path, selected);
  if (state === 'selected') return new Set([...selected].filter((other) => other !== path));
  if (state === 'clear' && selected.size < max) return new Set([...selected, path]);
  return selected;
}

/**
 * IntelliJ's StringUtil.shortenTextWithEllipsis: past `max` characters, its start, `...`, and its
 * last `end` characters, `max` in all (a commit's subject in its dialogs, at 40 and none).
 */
export function shortenText(text: string, max = 40, end = 0): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - end - 3)}...${text.slice(text.length - end)}`;
}

/** IntelliJ's StringUtil.shortenPathWithEllipsis: its start and its end, `...` between. */
export function shortenPath(path: string, max = 30): string {
  return shortenText(path, max, Math.floor(max * 0.7));
}

/** The Paths filter's text, as IntelliJ's: the first path, shortened, and how many more. */
export function pathsText(paths: readonly string[]): string {
  const [first] = [...paths].sort();
  const text = shortenPath(first as string);
  return paths.length === 1 ? text : `${text} + ${String(paths.length - 1)}`;
}

/** The Paths filter's tooltip while it's on, as IntelliJ's: the first ten paths, a line each. */
export function pathsTooltip(paths: readonly string[]): string {
  const shown = [...paths].sort().slice(0, 10);
  return ['Paths:', ...shown, ...(paths.length > 10 ? ['...'] : [])].join('\n');
}

const slashes = (path: string) => path.replaceAll('\\', '/');

/** Paths as typed, from the repository's top: one in it given in full is made so, as IntelliJ's. */
export function readPaths(typed: readonly string[], worktree: string): string[] {
  const top = `${slashes(worktree).replace(/\/+$/, '')}/`;
  return typed.map((path) => {
    const written = slashes(path);
    return written.startsWith(top) ? written.slice(top.length) : written;
  });
}

/** What the Paths popup needs: the repository, its files, and what to do with a choice. */
export interface PathSource {
  worktree: string;
  /** For the shortcut that finishes Select…. */
  platform: Platform;
  /** A folder's files and folders (the repository's top for `undefined`): the host's `fs.list`. */
  list: (folder: string | undefined) => Promise<FileNode[]>;
  current: () => readonly string[] | undefined;
  /** The paths chosen, or undefined to show every commit. */
  choose: (paths: readonly string[] | undefined) => void;
}

const remember = (source: PathSource, paths: readonly string[]) => {
  source.choose(paths);
  rememberChoice(source.worktree, 'Paths', paths);
};

/** IntelliJ's Select Paths to Filter by: the repository's tree, a checkbox on each. */
async function selectInTree(source: PathSource): Promise<void> {
  const top = slashes(source.worktree).replace(/\/+$/, '');
  const relative = (node: FileNode) =>
    node.path.slice(top.length + 1) + (node.kind === 'directory' ? '/' : '');
  const selected = signal<ReadonlySet<string>>(new Set(source.current() ?? []));
  const model = new TreeModel<FileNode>({
    children: async (node) =>
      (await source.list(node?.path)).filter((child) => child.ignored !== true),
    key: (node) => node.path,
    isLeaf: (node) => node.kind === 'file',
  });
  const toggle = (node: FileNode) => {
    selected.set(togglePath(relative(node), selected.peek()));
  };
  const row = (node: FileNode) => {
    const state = () => pathState(relative(node), selected.get());
    return (
      <span class="playground-paths__row">
        <input
          type="checkbox"
          aria-label={node.name}
          checked={() => state() !== 'clear'}
          disabled={() => state() === 'above' || state() === 'below'}
          on:change={(event) => {
            toggle(node);
            // Past the limit, it stays as it was.
            (event.currentTarget as HTMLInputElement).checked = state() !== 'clear';
          }}
        />
        <span>{node.name}</span>
      </span>
    );
  };
  const paths = await openDialog<readonly string[]>({
    title: 'Select Paths to Filter by',
    width: 400,
    ok: { enabled: () => selected.get().size > 0, accept: () => [...selected.peek()] },
    content: () => (
      <div class="playground-paths">
        <div
          class="playground-paths__tree"
          on:keydown={(event) => {
            const key = model.selected;
            const node = model.rows.find((r) => r.key === key)?.node;
            if (event.key !== ' ' || !node) return;
            event.preventDefault();
            toggle(node);
          }}
        >
          <TreeView model={model} label="Paths" row={row} />
        </div>
        <p class="playground-paths__limit">
          {() =>
            selected.get().size < MAX_PATHS
              ? ''
              : `Selected: (You have added ${String(MAX_PATHS)} elements. No more is allowed.)`
          }
        </p>
      </div>
    ),
  }).result;
  if (paths) remember(source, paths);
}

/** Asks for paths, a line each, starting with those chosen; none shows every commit. */
async function typePaths(button: HTMLElement, source: PathSource): Promise<void> {
  const typed = await selectValues({
    below: button,
    label: 'Paths',
    value: [...(source.current() ?? [])].sort().join('\n'),
    separators: ['\n'],
    platform: source.platform,
  });
  if (typed === undefined) return;
  if (typed.length === 0) source.choose(undefined);
  else remember(source, readPaths(typed, source.worktree));
}

type PathChoice = PickerItem & { run: () => void };

/** The Paths filter's popup, below its button. */
export function pickPaths(button: HTMLElement, source: PathSource) {
  const items = (): PathChoice[] => [
    { label: 'Select…', run: () => void typePaths(button, source) },
    { label: 'Select in Tree…', run: () => void selectInTree(source) },
    ...recentChoices(source.worktree, 'Paths').map((paths) => ({
      label: pathsText(paths),
      group: 'Recent',
      run: () => {
        remember(source, paths);
      },
    })),
  ];
  const handle = openFilterPicker<PathChoice>(
    {
      label: 'Paths',
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      items: (query) => fuzzyFilter(items(), query),
    },
    source.platform,
    () => {
      source.choose(undefined);
    },
  );
  void handle.result.then((choice) => {
    choice?.run();
  });
  return handle;
}
