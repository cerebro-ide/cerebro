// Delete in the Project view's menu, and its key, as IntelliJ's ($Delete, DeleteHandler): asked
// first in IntelliJ's words (DeleteUtil's message), then moved to the system's trash, as IntelliJ
// does by default (GeneralSettings' `deleteToBin`). The view is read again, and the tabs of what's
// gone close as files deleted outside Cerebro do. Only in the desktop app, whose shell has the trash.

import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { TabContext } from './commands.js';
import { active } from './environments.js';
import { notifications } from './notifications.js';
import { projectTargets, refreshTree, type FileNode } from './project.js';

export interface DeleteSetup {
  /** Reads the open files again, closing the tabs of those gone. */
  reload: () => Promise<void>;
}

/**
 * IntelliJ's question (IdeBundle's `prompt.delete.elements`, `warning.delete.all.files…`, put
 * together as DeleteUtil's `generateDeleteWarningMessage`): one by name, several counted by kind,
 * files first (Claude's choice: IntelliJ's order is a hash map's).
 */
export function deleteQuestion(nodes: readonly FileNode[]): string[] {
  const [node] = nodes as [FileNode];
  const undo = 'You might not be able to fully undo this operation!';
  if (nodes.length === 1) {
    if (node.kind === 'file') return [`Delete file "${node.name}"?`];
    return [
      `Delete directory "${node.name}"?`,
      `All files and subdirectories in "${node.name}" will be deleted.`,
      undo,
    ];
  }
  const files = nodes.filter((n) => n.kind === 'file').length;
  const folders = nodes.length - files;
  const counted = [
    files > 0 && `${String(files)} ${files === 1 ? 'file' : 'files'}`,
    folders > 0 && `${String(folders)} ${folders === 1 ? 'directory' : 'directories'}`,
  ].filter(Boolean);
  const question = `Delete ${counted.join(' and ')}?`;
  if (folders === 0) return [question];
  return [
    question,
    'All files and subdirectories in the selected directory(s) will be deleted.',
    undo,
  ];
}

/**
 * Delete, for the Project view's selection while it has the focus, every row of it: not with the
 * worktree itself among them.
 */
export function setupDelete(services: MenuServices, setup: DeleteSetup): void {
  const { commands, menus, keymap } = services;
  const target = (context: unknown) => {
    const nodes = projectTargets(context as TabContext | undefined);
    const env = active();
    const fine = nodes && nodes.length > 0 && !nodes.some((node) => node.path === env?.id);
    return fine && window.cerebro ? nodes : undefined;
  };
  commands.register({
    id: 'project.delete',
    label: '&Delete',
    dialog: true,
    enabled: (context) => target(context) !== undefined,
    run: async (context) => {
      const nodes = target(context) as FileNode[];
      const worktree = (active() as { id: string }).id;
      const yes = await openDialog<true>({
        title: 'Delete',
        ok: { label: 'Delete', accept: () => true },
        content: () =>
          deleteQuestion(nodes).map((line) => <p class="cerebro-selectable">{line}</p>),
      }).result;
      if (!yes) return;
      try {
        // One by one, as IntelliJ's; the first the trash won't take stops the rest, and those
        // before it are gone, so the view is read again all the same.
        for (const node of nodes) await window.cerebro?.shell.trash(node.path);
      } catch (error) {
        notifications.notify({
          title: 'Cannot Delete',
          content: (error as Error).message,
          type: 'error',
        });
      }
      await refreshTree(worktree);
      await setup.reload();
    },
  });
  keymap?.bindDefault('Delete', 'project.delete');
  // After Bookmarks, as IntelliJ's $Delete after its Refactoring group.
  menus.contribute({
    menu: 'project/node',
    item: { command: 'project.delete' },
    group: 'd-bookmarks',
    order: 1,
  });
}
