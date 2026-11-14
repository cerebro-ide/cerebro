// Delete in the Project view's menu, and its key, as IntelliJ's ($Delete, DeleteHandler): asked
// first in IntelliJ's words (DeleteUtil's message), then moved to the system's trash, as IntelliJ
// does by default (GeneralSettings' `deleteToBin`). The view is read again, and the tabs of what's
// gone close as files deleted outside Cerebro do. Only in the desktop app, whose shell has the trash.

import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { TabContext } from './commands.js';
import { active } from './environments.js';
import { notifications } from './notifications.js';
import { projectTarget, refreshTree, type FileNode } from './project.js';

export interface DeleteSetup {
  /** Reads the open files again, closing the tabs of those gone. */
  reload: () => Promise<void>;
}

/** IntelliJ's question (IdeBundle's `prompt.delete.elements`, `warning.delete.all.files…`). */
export function deleteQuestion(node: FileNode): string[] {
  if (node.kind === 'file') return [`Delete file "${node.name}"?`];
  return [
    `Delete directory "${node.name}"?`,
    `All files and subdirectories in "${node.name}" will be deleted.`,
    'You might not be able to fully undo this operation!',
  ];
}

/** Delete, for the Project view's selection while it has the focus: not the worktree itself. */
export function setupDelete(services: MenuServices, setup: DeleteSetup): void {
  const { commands, menus, keymap } = services;
  const target = (context: unknown) => {
    const node = projectTarget(context as TabContext | undefined);
    const env = active();
    return node && env && window.cerebro && node.path !== env.id ? node : undefined;
  };
  commands.register({
    id: 'project.delete',
    label: '&Delete',
    dialog: true,
    enabled: (context) => target(context) !== undefined,
    run: async (context) => {
      const node = target(context) as FileNode;
      const worktree = (active() as { id: string }).id;
      const yes = await openDialog<true>({
        title: 'Delete',
        ok: { label: 'Delete', accept: () => true },
        content: () => deleteQuestion(node).map((line) => <p class="cerebro-selectable">{line}</p>),
      }).result;
      if (!yes) return;
      try {
        await window.cerebro?.shell.trash(node.path);
      } catch (error) {
        notifications.notify({
          title: 'Cannot Delete',
          content: (error as Error).message,
          type: 'error',
        });
        return;
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
