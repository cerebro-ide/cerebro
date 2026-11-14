// The Project tool window: the active environment's files as a tree. In the desktop app they come
// from the host, folder by folder as they're opened, those git ignores in the ignored colour, as
// IntelliJ shows them; in a browser, from the sample paths. Each
// environment keeps its own tree, so switching back finds its folders as they were. While it shows,
// its folders are read again as the window gets the focus and every so often while it has it, as
// open files are, so files added or removed on disk show. A file with errors, and the folders it's
// in, have their names underlined with the error's wave, as IntelliJ marks problem files.

import { onCleanup } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { TreeModel, TreeView, type TreeSource } from '@cerebro-ide/ui-tree';
import { RELOAD_EVERY } from './documents.js';
import { target } from './edit.js';
import { active, currentHost, hostFor } from './environments.js';
import { icon } from './icons.js';
import { hasErrors, hasErrorsBeneath } from './problems.js';

export interface FileNode {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  /** Git ignores it: its name shows in the ignored colour, as in the Commit tool window. */
  ignored?: boolean;
}

/** The sample paths as a tree: `src/main.ts` gives the folder `src` with the file in it. */
function sampleSource(paths: readonly string[]): TreeSource<FileNode> {
  return {
    children: (node) => {
      const prefix = node ? `${node.path}/` : '';
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

const models = new Map<string, TreeModel<FileNode>>();

/** An environment's tree: its worktree's files through the host, else the samples. */
function modelFor(envId: string, samples: readonly string[]): TreeModel<FileNode> {
  let model = models.get(envId);
  if (!model) {
    const host = hostFor(envId);
    const source: TreeSource<FileNode> = host
      ? {
          children: async (node) =>
            (await host.request('fs.list', { path: node ? node.path : envId })) as FileNode[],
          key: (node) => node.path,
          isLeaf: (node) => node.kind === 'file',
        }
      : sampleSource(samples);
    model = new TreeModel(source);
    models.set(envId, model);
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
  return modelFor(env.id, samples).reveal(keys);
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
 * What's selected in the Project tool window, a file or a folder, while it has the focus: null when
 * nothing is; undefined when it hasn't the focus.
 */
export function projectNode(): FileNode | null | undefined {
  const env = active();
  if (!env || !target()?.closest('.playground-project')) return undefined;
  const model = models.get(env.id) as TreeModel<FileNode>;
  return model.rows.find((row) => row.key === model.selected)?.node ?? null;
}

export function ProjectTree(props: {
  samples: readonly string[];
  /** Opens a file in the active environment's editor. */
  open: (tab: Tab) => void;
}): Node {
  return (
    <div class="playground-project">
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        const model = modelFor(env.id, props.samples);
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
              icon(node.kind === 'directory' ? 'folder' : 'file'),
              <span
                class={() =>
                  [
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
            ]}
            onOpen={(node) => {
              props.open({ id: node.path, title: node.name });
            }}
          />
        );
      }}
    </div>
  );
}
