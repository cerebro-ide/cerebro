// Rename in the Project view's menu, and its key while the view has the focus, as IntelliJ's
// RenameElement there: a file's or folder's new name, asked for in IntelliJ's words
// (RefactoringBundle's `rename.0.to`). Saves under way, and unsaved edits, are saved first; then
// a file's language server changes what refers to it (TypeScript's, its imports: IntelliJ's
// "Search for references", on by default); the host renames it, never over another; the tabs of
// what moved follow it, and it's selected again in the view. It's the editor's Rename command,
// whose keys each keymap gives: the editor runs its own (a symbol's, through its language
// server), and the Project view's selection takes this one.

import type { EditorArea } from '@cerebro-ide/layout';
import { prompt } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { TabContext } from './commands.js';
import { editFiles, saveAll, type FileEdits } from './documents.js';
import { active, hostFor } from './environments.js';
import { EDITOR_ACTIONS } from './keymaps.js';
import { notifications } from './notifications.js';
import { projectTarget, selectNew, type FileNode } from './project.js';

export interface RenameFileSetup {
  /** The editor area whose tabs follow what's renamed. */
  editor: () => EditorArea | undefined;
}

/**
 * Why a file or folder can't be renamed to `name` beside `entries`, in IntelliJ's words, or
 * undefined if it can: one name, not a path, and none there already.
 */
export function renameError(name: string, entries: readonly FileNode[]): string | undefined {
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return `'${name}' is an invalid file name`;
  }
  return entries.some((entry) => entry.name === name) ? `File ${name} already exists` : undefined;
}

/** `path` with `from`, or a folder holding it, as `to`; else undefined. */
export function movedPath(path: string, from: string, to: string): string | undefined {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : undefined;
}

/** Rename for the Project view's selection: not the worktree itself. */
export function setupRenameFile(services: MenuServices, setup: RenameFileSetup): void {
  const { commands, menus } = services;
  const target = (context: unknown) => {
    const node = projectTarget(context as TabContext | undefined);
    const env = active();
    return node && env && hostFor(env.id) && node.path !== env.id ? node : undefined;
  };
  commands.register({
    id: EDITOR_ACTIONS.rename,
    label: '&Rename',
    dialog: true,
    enabled: (context) => target(context) !== undefined,
    run: async (context) => {
      const node = target(context) as FileNode;
      const worktree = (active() as { id: string }).id;
      const host = hostFor(worktree) as NonNullable<ReturnType<typeof hostFor>>;
      const folder = node.path.slice(0, node.path.lastIndexOf('/'));
      const entries = (await host.request('fs.list', { path: folder })) as FileNode[];
      const name = await prompt({
        title: 'Rename',
        label: `Rename ${node.kind === 'file' ? 'file' : 'directory'} '${node.name}' to:`,
        value: node.name,
        validate: (typed) => (typed === node.name ? undefined : renameError(typed, entries)),
        valid: (typed) => typed !== node.name,
      });
      if (name === undefined) return;
      const to = `${folder}/${name}`;
      try {
        await saveAll();
        if (node.kind === 'file') {
          const edits = (await host.request('lsp.willRename', {
            worktree,
            path: node.path,
            to,
          })) as FileEdits[] | null;
          const failed = edits ? await editFiles(edits, 'Rename') : [];
          if (failed.length > 0) {
            notifications.notify({
              title: 'Rename',
              content: `Not changed: ${failed.map((f) => `${f.path}: ${f.error}`).join(', ')}`,
              type: 'warning',
            });
          }
        }
        await host.request('fs.rename', { path: node.path, to });
      } catch (error) {
        notifications.notify({
          title: 'Cannot Rename',
          content: (error as Error).message,
          type: 'error',
        });
        return;
      }
      const area = setup.editor() as EditorArea;
      for (const tab of area.groups.flatMap((group) => group.tabs)) {
        const moved = movedPath(tab.id, node.path, to);
        if (moved !== undefined) {
          area.replaceTab(tab.id, { id: moved, title: moved.slice(moved.lastIndexOf('/') + 1) });
        }
      }
      await selectNew(worktree, to);
    },
  });
  // Before Bookmarks, as IntelliJ's RenameElement before its Refactoring group.
  menus.contribute({
    menu: 'project/node',
    item: { command: EDITOR_ACTIONS.rename },
    group: 'd-bookmarks',
    order: -1,
  });
}
