// New → File and Directory, as IntelliJ's in the Project view's menu (its WeighingNewGroup's
// NewFile and NewDir): a name is asked for, and `a/b.ts` makes the folders on its way. They're made
// in the folder selected in the view, or the selected file's; from elsewhere (or with nothing
// selected there), in the active editor's file's folder, else the worktree's. What's made is selected in the view, and a file
// opens in the editor, as IntelliJ's `IdeView.selectElement`.

import type { Tab } from '@cerebro-ide/layout';
import { prompt } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { TabContext } from './commands.js';
import { active, hostFor } from './environments.js';
import { notifications } from './notifications.js';
import { projectTarget, selectNew, type FileNode } from './project.js';

export interface NewFileSetup {
  /** The active editor tab's id. */
  activeTab: () => string | undefined;
  /** Opens a file with its editor focused. */
  open: (tab: Tab) => void;
}

type Kind = 'file' | 'directory';

/** IntelliJ's titles and prompts (IdeBundle's `title.new.file`, `prompt.enter.new.file.name`). */
const ASK: Record<Kind, { title: string; label: string }> = {
  file: { title: 'New File', label: 'Specify a new file name:' },
  directory: { title: 'New Directory', label: 'Enter new directory name:' },
};

/**
 * Why `name` can't be made in a folder holding `entries`, in IntelliJ's words, or undefined if it
 * can: a name deeper in it that's there already is the host's to find.
 */
export function nameError(name: string, entries: readonly FileNode[]): string | undefined {
  const parts = name.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    return `'${name}' is an invalid file name`;
  }
  const there = entries.find((entry) => entry.name === parts[0]);
  if (!there || (there.kind === 'directory' && parts.length > 1)) return undefined;
  return `A ${there.kind === 'file' ? 'file' : 'directory'} with the name '${there.name}' already exists`;
}

const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** New → File and Directory, and the Project view's New submenu. */
export function setupNewFile(services: MenuServices, setup: NewFileSetup): void {
  const { commands, menus } = services;
  /** The folder to make it in, in the desktop app's active worktree. */
  const folderFor = (context: unknown) => {
    const env = active();
    if (!env || !hostFor(env.id)) return undefined;
    const node = projectTarget(context as TabContext | undefined);
    if (node) return node.kind === 'directory' ? node.path : parent(node.path);
    const tab = setup.activeTab();
    return tab?.startsWith(`${env.id}/`) ? parent(tab) : env.id;
  };
  const create = async (kind: Kind, folder: string) => {
    const worktree = (active() as { id: string }).id;
    const host = hostFor(worktree) as NonNullable<ReturnType<typeof hostFor>>;
    const entries = (await host.request('fs.list', { path: folder })) as FileNode[];
    const name = await prompt({ ...ASK[kind], validate: (typed) => nameError(typed, entries) });
    if (name === undefined) return;
    const path = `${folder}/${name}`;
    try {
      await host.request('fs.create', {
        path,
        ...(kind === 'directory' ? { directory: true } : {}),
      });
    } catch (error) {
      notifications.notify({
        title: kind === 'file' ? 'Cannot Create File' : 'Cannot Create Directory',
        content: (error as Error).message,
        type: 'error',
      });
      return;
    }
    await selectNew(worktree, path);
    if (kind === 'file') setup.open({ id: path, title: path.slice(path.lastIndexOf('/') + 1) });
  };
  for (const [kind, id, label] of [
    ['file', 'project.newFile', '&File'],
    ['directory', 'project.newDirectory', '&Directory'],
  ] as const) {
    commands.register({
      id,
      label,
      dialog: true,
      enabled: (context) => folderFor(context) !== undefined,
      run: (context) => create(kind, folderFor(context) as string),
    });
    menus.contribute({ menu: 'project/node/new', item: { command: id } });
  }
  // First in the Project view's menu, as IntelliJ's.
  menus.contribute({
    menu: 'project/node',
    item: { submenu: 'project/node/new', label: '&New' },
    group: 'a-new',
  });
}
