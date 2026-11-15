// The Project tool window: the active environment's files as a tree, under its worktree's folder,
// its name in bold and its path after, as IntelliJ's content root. In the desktop app they come
// from the host, folder by folder as they're opened, those git ignores in the ignored colour, as
// IntelliJ shows them; in a browser, from the sample paths. Each
// environment keeps its own tree, so switching back finds its folders as they were. While it shows,
// its folders are read again as the window gets the focus and every so often while it has it, as
// open files are, so files added or removed on disk show. A file with errors, and the folders it's
// in, have their names underlined with the error's wave, as IntelliJ marks problem files.

import { onCleanup } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { TreeModel, TreeView, type TreeSource } from '@cerebro-ide/ui-tree';
import { RELOAD_EVERY } from './documents.js';
import { target } from './edit.js';
import { active, currentHost, hostFor, type Host } from './environments.js';
import { icon } from './icons.js';
import { hasErrors, hasErrorsBeneath } from './problems.js';

export interface FileNode {
  path: string;
  name: string;
  /**
   * A group is the tree's, not a file or folder to act on: Scratches and Consoles, and Scratches in
   * it, whose path is the scratch files' folder.
   */
  kind: 'file' | 'directory' | 'group';
  /** Git ignores it: its name shows in the ignored colour, as in the Commit tool window. */
  ignored?: boolean;
}

/**
 * The sample paths as a tree, under the environment's folder: `src/main.ts` gives the folder `src`
 * with the file in it.
 */
function sampleSource(root: FileNode, paths: readonly string[]): TreeSource<FileNode> {
  return {
    children: (node) => {
      if (!node) return [root];
      const prefix = node === root ? '' : `${node.path}/`;
      const seen = new Map<string, FileNode>();
      for (const path of paths) {
        if (!path.startsWith(prefix)) continue;
        const [name, ...rest] = path.slice(prefix.length).split('/');
        if (!name || seen.has(name)) continue;
        seen.set(name, {
          path: prefix + name,
          name,
          kind: rest.length > 0 ? 'directory' : 'file',
        });
      }
      return [...seen.values()].sort(
        (a, b) =>
          Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name),
      );
    },
    key: (node) => node.path,
    isLeaf: (node) => node.kind === 'file',
  };
}

/**
 * What Cut or Copy kept from the view, in its worktree, for Paste (file-clipboard.tsx). What's cut
 * shows greyed until it's pasted, or Escape in the view lets it go, as IntelliJ's.
 */
export const kept = signal<{ node: FileNode; worktree: string; cut: boolean } | undefined>(
  undefined,
);

const models = new Map<string, TreeModel<FileNode>>();

/** Scratches and Consoles, after the worktree's folder in the app, as IntelliJ's. */
const SCRATCHES_AND_CONSOLES: FileNode = {
  path: 'scratches-and-consoles',
  name: 'Scratches and Consoles',
  kind: 'group',
};

/**
 * A worktree's tree through its host: its folder, then Scratches and Consoles, with Scratches in it
 * once the app's folder of them has one, as IntelliJ shows it.
 */
function hostSource(host: Host, root: FileNode): TreeSource<FileNode> {
  const list = async (path: string) => (await host.request('fs.list', { path })) as FileNode[];
  return {
    children: async (node) => {
      if (!node) return [root, SCRATCHES_AND_CONSOLES];
      if (node !== SCRATCHES_AND_CONSOLES) return list(node.path);
      const folder = (await host.request('scratches.folder')) as string | null;
      if (folder === null || (await list(folder)).length === 0) return [];
      return [{ path: folder, name: 'Scratches', kind: 'group' }];
    },
    key: (node) => node.path,
    isLeaf: (node) => node.kind === 'file',
  };
}

/**
 * An environment's tree: its worktree's folder, as IntelliJ's Project view shows a project's content
 * root, opened; its files through the host, else the samples.
 */
function modelFor(
  env: { id: string; name: string },
  samples: readonly string[],
): TreeModel<FileNode> {
  let model = models.get(env.id);
  if (!model) {
    const host = hostFor(env.id);
    const root: FileNode = { path: env.id, name: env.name, kind: 'directory' };
    const source: TreeSource<FileNode> = host
      ? hostSource(host, root)
      : sampleSource(root, samples);
    model = new TreeModel(source);
    model.expand(root);
    models.set(env.id, model);
  }
  return model;
}

/**
 * Selects a file in the active environment's tree, opening the folders down to it, as IntelliJ's
 * Select Opened File. `path` is a tab's: the file's full path in the app, a sample's own.
 */
export function selectInTree(path: string, samples: readonly string[]): Promise<boolean> {
  const env = active();
  if (!env) return Promise.resolve(false);
  const app = currentHost() !== undefined;
  const root = app ? `${env.id}/` : '';
  if (!path.startsWith(root)) return Promise.resolve(false);
  const parts = path.slice(root.length).split('/');
  const keys = parts.map((_, i) => root + parts.slice(0, i + 1).join('/'));
  return modelFor(env, samples).reveal([env.id, ...keys]);
}

/** Reads a worktree's tree again, as after a file's made or deleted in it. */
export async function refreshTree(worktree: string): Promise<void> {
  await models.get(worktree)?.refresh();
}

/** Selects what was just made in a worktree, its tree read again first to have it. */
export async function selectNew(worktree: string, path: string): Promise<boolean> {
  await refreshTree(worktree);
  return selectInTree(path, []);
}

/**
 * The Project view's selected file, its full path, while the view has the focus (or had it before
 * a menu took it), as IntelliJ's actions take the files of the view with the focus: null when
 * what's selected there isn't a file; undefined when the view hasn't the focus.
 */
export function projectFile(): string | null | undefined {
  const node = projectNode();
  return node === undefined ? undefined : node?.kind === 'file' ? node.path : null;
}

/**
 * The Project view's selection, for a command that acts on it while the view has the focus, as
 * IntelliJ's actions take the focused view's: none (undefined) when its context is a tab's menu,
 * whose tab it acts on; else as `projectNode`.
 */
export function projectTarget(context?: { tabMenu?: true }): FileNode | null | undefined {
  return context?.tabMenu ? undefined : projectNode();
}

/**
 * What's selected in the Project tool window, a file or a folder, while it has the focus: null when
 * nothing is; undefined when it hasn't the focus.
 */
export function projectNode(): FileNode | null | undefined {
  const env = active();
  if (!env || !target()?.closest('.playground-project')) return undefined;
  const model = models.get(env.id) as TreeModel<FileNode>;
  const node = model.rows.find((row) => row.key === model.selected)?.node;
  // A group is nothing to act on.
  return node === undefined || node.kind === 'group' ? null : node;
}

export function ProjectTree(props: {
  samples: readonly string[];
  /** Opens a file in the active environment's editor. */
  open: (tab: Tab) => void;
  /** Opens the view's menu on the row it's asked on, selected (`projectNode`). */
  menu: (event: MouseEvent) => void;
}): Node {
  return (
    <div
      class="playground-project"
      on:keydown={(event) => {
        // Escape lets go of what's cut, and does nothing else then (PsiCopyPasteManager's
        // EscapeHandler).
        const mods = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
        if (event.key !== 'Escape' || mods || kept.get()?.cut !== true) return;
        kept.set(undefined);
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        const model = modelFor(env, props.samples);
        // A folder that can't be read shows why in the tree.
        const refresh = () => void model.refresh();
        const timer = setInterval(() => {
          if (document.hasFocus()) refresh();
        }, RELOAD_EVERY);
        window.addEventListener('focus', refresh);
        onCleanup(() => {
          clearInterval(timer);
          window.removeEventListener('focus', refresh);
        });
        return (
          <TreeView
            model={model}
            label={`${env.name} files`}
            row={(node) => [
              icon(node.kind === 'directory' ? 'folder' : node.kind === 'group' ? 'note' : 'file'),
              <span
                class={() =>
                  [
                    node.path === env.id && 'playground-project__root',
                    kept.get()?.cut === true &&
                      kept.get()?.node.path === node.path &&
                      'playground-project--cut',
                    node.ignored && 'playground-change--ignored',
                    (node.kind === 'directory'
                      ? hasErrorsBeneath(node.path)
                      : hasErrors(node.path)) && 'playground-problem-file',
                  ]
                    .filter(Boolean)
                    .join(' ')
                }
              >
                {node.name}
              </span>,
              // The worktree's folder: its name in bold, then where it is, as IntelliJ's.
              node.path === env.id && hostFor(env.id) && (
                <span class="playground-project__location">{node.path}</span>
              ),
            ]}
            onOpen={(node) => {
              props.open({ id: node.path, title: node.name });
            }}
            onContextMenu={(event) => {
              props.menu(event);
            }}
          />
        );
      }}
    </div>
  );
}
