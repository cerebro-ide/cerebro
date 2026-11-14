// Copy and Paste in the Project view, as IntelliJ's there (its CopyPasteDelegator): Copy keeps the
// file or folder selected, and Paste copies it into the folder selected, or the selected file's, or
// nowhere with nothing selected. Paste asks first in IntelliJ's Copy dialog
// (CopyFilesOrDirectoriesDialog, RefactoringBundle's words): the new name, its name to start with
// (a file's selected without its extension), the folder to copy it to, made if it isn't there,
// and Open in editor, for a file. One of that name there already is asked about, Overwrite or Skip
// (SkipOverwriteChoice). The copy is selected in the view, and a file opened. They're the Edit
// commands, with their keys, while the view has the focus (edit.ts's `provideClipboard`).

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { Tab } from '@cerebro-ide/layout';
import { tabFile } from './commands.js';
import { provideClipboard } from './edit.js';
import { active, hostFor, type Host } from './environments.js';
import { notifications } from './notifications.js';
import { projectNode, selectNew, type FileNode } from './project.js';

export interface CopyFileSetup {
  /** Opens a file with its editor focused. */
  open: (tab: Tab) => void;
}

/** What Copy kept: a file or folder, in its worktree. */
let copied: { node: FileNode; worktree: string } | undefined;

/** What the Copy dialog gives: where to, and whether to open the copy. */
export interface CopyAnswer {
  to: string;
  open: boolean;
}

/** Whether a name is one file name: IntelliJ's `PathUtilRt.isValidFileName`, in part. */
export function validName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[/\\]/.test(name);
}

const parent = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** The path as the system writes it, as IntelliJ's `presentableUrl`. */
const shown = (path: string) => tabFile(path, undefined).system as string;

/** IntelliJ's Copy dialog for a file or folder, with the folder it's pasted into. */
export function askCopy(node: FileNode, folder: string): Promise<CopyAnswer | undefined> {
  const name = signal(node.name);
  const directory = signal(shown(folder));
  const open = signal(node.kind === 'file');
  const typedName = () => name.get().trim();
  return openDialog<CopyAnswer>({
    title: 'Copy',
    width: 520,
    ok: {
      enabled: () => validName(typedName()) && directory.get().trim() !== '',
      accept: () => ({
        to: `${directory.get().trim().replaceAll('\\', '/').replace(/\/+$/, '')}/${typedName()}`,
        open: open.get(),
      }),
    },
    content: () => [
      <p class="cerebro-selectable">
        {`Copy ${node.kind === 'file' ? 'file' : 'directory'} ${shown(node.path)}`}
      </p>,
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">New name:</span>
        <input
          class="cerebro-dialog-field__input"
          type="text"
          spellcheck={false}
          value={name.get()}
          autofocus
          ref={(input) => {
            queueMicrotask(() => {
              // A file's name without its extension, as IntelliJ's `selectNameWithoutExtension`.
              const dot = node.kind === 'file' ? node.name.lastIndexOf('.') : -1;
              input.setSelectionRange(0, dot > 0 ? dot : node.name.length);
            });
          }}
          on:input={(event) => {
            name.set((event.currentTarget as HTMLInputElement).value);
          }}
        />
      </label>,
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">To directory:</span>
        <input
          class="cerebro-dialog-field__input"
          type="text"
          spellcheck={false}
          value={directory.get()}
          on:input={(event) => {
            directory.set((event.currentTarget as HTMLInputElement).value);
          }}
        />
      </label>,
      node.kind === 'file' ? (
        <label class="playground-rollback__option">
          <input
            type="checkbox"
            checked={open.get()}
            on:change={(event) => {
              open.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Open in editor
        </label>
      ) : null,
    ],
  }).result;
}

/** IntelliJ's question for a name taken where it's pasted: whether to go over it. */
function askOverwrite(to: string): Promise<boolean | undefined> {
  const name = to.slice(to.lastIndexOf('/') + 1);
  return openDialog<boolean>({
    title: 'Copy',
    ok: { label: 'Overwrite', accept: () => true },
    cancelLabel: 'Skip',
    content: () => (
      <p class="cerebro-selectable">
        {`File '${name}' already exists in directory '${shown(parent(to))}'`}
      </p>
    ),
  }).result;
}

/** Copy and Paste for the Project view, while it has the focus. */
export function setupCopyFile(services: MenuServices, setup: CopyFileSetup): void {
  const { menus } = services;
  const host = () => {
    const env = active();
    const found = env && hostFor(env.id);
    return env && found ? { worktree: env.id, host: found } : undefined;
  };
  // Run only while enabled: what's copied is of this worktree, and something's selected.
  const paste = async () => {
    const { worktree, host: request } = host() as { worktree: string; host: Host };
    const node = projectNode() as FileNode;
    const source = (copied as { node: FileNode }).node;
    const folder = node.kind === 'directory' ? node.path : parent(node.path);
    const answer = await askCopy(source, folder);
    if (!answer || answer.to === source.path) return;
    const exists = (await request.request('fs.exists', { path: answer.to })) as boolean;
    const over = exists ? await askOverwrite(answer.to) : false;
    if (over === undefined) return;
    try {
      await request.request('fs.copy', { path: source.path, to: answer.to, over });
    } catch (error) {
      notifications.notify({
        title: 'Cannot Copy',
        content: (error as Error).message,
        type: 'error',
      });
      return;
    }
    if (answer.to.startsWith(`${worktree}/`)) await selectNew(worktree, answer.to);
    if (answer.open && source.kind === 'file') {
      setup.open({ id: answer.to, title: answer.to.slice(answer.to.lastIndexOf('/') + 1) });
    }
  };
  provideClipboard({
    focused: () => projectNode() !== undefined,
    enabled: (action) => {
      const env = host();
      const node = projectNode();
      if (!env) return false;
      if (action === 'copy') return node != null && node.path !== env.worktree;
      return action === 'paste' && node != null && copied?.worktree === env.worktree;
    },
    // Not Cut, which is never enabled here.
    run: (action) => {
      if (action === 'copy') {
        const { worktree } = host() as { worktree: string };
        copied = { node: projectNode() as FileNode, worktree };
      } else void paste();
    },
  });
  // Around Copy Path, as IntelliJ's CutCopyPasteGroup: Copy before it, Paste after.
  menus.contribute({
    menu: 'project/node',
    item: { command: 'edit.copy' },
    group: 'b-copy',
    order: -1,
  });
  menus.contribute({
    menu: 'project/node',
    item: { command: 'edit.paste' },
    group: 'b-copy',
    order: 1,
  });
}
