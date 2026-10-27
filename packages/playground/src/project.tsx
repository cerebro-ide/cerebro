// The Project tool window: the active environment's files as a tree. In the desktop app they come
// from the host, folder by folder as they're opened, those git ignores in the ignored colour, as
// IntelliJ shows them; in a browser, from the sample paths. Each
// environment keeps its own tree, so switching back finds its folders as they were.

import type { Tab } from '@cerebro-ide/layout';
import { TreeModel, TreeView, type TreeSource } from '@cerebro-ide/ui-tree';
import { active, currentHost, hostFor } from './environments.js';
import { icon } from './icons.js';

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
        return (
          <TreeView
            model={modelFor(env.id, props.samples)}
            label={`${env.name} files`}
            row={(node) => [
              icon(node.kind === 'directory' ? 'folder' : 'file'),
              node.ignored ? (
                <span class="playground-change--ignored">{node.name}</span>
              ) : (
                node.name
              ),
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
