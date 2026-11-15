// Cut, Copy and Paste in the Project view, as IntelliJ's there (its CopyPasteDelegator): Cut and
// Copy keep the file or folder selected, and Paste copies or moves it into the folder selected, or
// the selected file's. A copy is asked for first in IntelliJ's Copy dialog
// (CopyFilesOrDirectoriesDialog, RefactoringBundle's words): the new name, its name to start with
// (a file's selected without its extension), the folder to copy it to, made if it isn't there,
// and Open in editor, for a file. A move, in its Move dialog (MoveFilesOrDirectoriesDialog): the
// folder, its last name selected, Search for references and Open in editor; not where it is
// already. A file of that name there already is asked about, Overwrite or Skip
// (SkipOverwriteChoice). What's made or moved is selected in the view, and a file opened; a move
// is Rename's (`moveEntry`): its tabs follow it, and what refers to a file changes with it. They're
// the Edit commands, with their keys, while the view has the focus (edit.ts's `provideClipboard`).

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { EditorArea, Tab } from '@cerebro-ide/layout';
import { tabFile } from './commands.js';
import { provideClipboard } from './edit.js';
import { active, hostFor, type Host } from './environments.js';
import { notifications } from './notifications.js';
import { kept, projectNode, selectNew, type FileNode } from './project.js';
import { moveEntry } from './rename-file.js';

export interface FileClipboardSetup {
  /** Opens a file with its editor focused. */
  open: (tab: Tab) => void;
  /** The editor area whose tabs follow what's moved. */
  editor: () => EditorArea | undefined;
}

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

/** What the Move dialog gives: the folder, and its two options. */
export interface MoveAnswer {
  folder: string;
  references: boolean;
  open: boolean;
}

/** A checkbox of a dialog's options. */
function option(label: string, value: ReturnType<typeof signal<boolean>>) {
  return (
    <label class="playground-rollback__option">
      <input
        type="checkbox"
        checked={value.get()}
        on:change={(event) => {
          value.set((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      {label}
    </label>
  );
}

/** IntelliJ's Move dialog for a file or folder, with the folder it's pasted into. */
export function askMove(node: FileNode, folder: string): Promise<MoveAnswer | undefined> {
  const directory = signal(shown(folder));
  const references = signal(true);
  const open = signal(true);
  const error = signal<string | undefined>(undefined);
  const typed = () => directory.get().trim().replaceAll('\\', '/').replace(/\/+$/, '');
  return openDialog<MoveAnswer>({
    title: 'Move',
    width: 520,
    ok: {
      label: 'Refactor',
      enabled: () => typed() !== '',
      // Not where it is already, in IntelliJ's words, said in the dialog.
      check: () => {
        const here = typed() === parent(node.path);
        error.set(here ? 'Already in this directory. Choose another one.' : undefined);
        return Promise.resolve(!here);
      },
      accept: () => ({ folder: typed(), references: references.get(), open: open.get() }),
    },
    content: () => [
      <p class="cerebro-selectable">
        {`Move ${node.kind === 'file' ? 'file' : 'directory'} ${shown(node.path)}`}
      </p>,
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">To directory:</span>
        <input
          class={() =>
            error.get() === undefined
              ? 'cerebro-dialog-field__input'
              : 'cerebro-dialog-field__input cerebro-dialog-field__input--invalid'
          }
          type="text"
          spellcheck={false}
          value={directory.get()}
          autofocus
          ref={(input) => {
            queueMicrotask(() => {
              // Its last folder's name, as IntelliJ's.
              const text = input.value;
              const last = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
              input.setSelectionRange(last + 1, text.length);
            });
          }}
          on:input={(event) => {
            directory.set((event.currentTarget as HTMLInputElement).value);
            error.set(undefined);
          }}
        />
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error.get() ?? ''}
        </span>
      </label>,
      option('Search for references', references),
      option('Open in editor', open),
    ],
  }).result;
}

/** IntelliJ's question for a file's name taken where it's pasted: whether to go over it. */
function askOverwrite(to: string, title: 'Copy' | 'Move'): Promise<boolean | undefined> {
  const name = to.slice(to.lastIndexOf('/') + 1);
  return openDialog<boolean>({
    title,
    ok: { label: 'Overwrite', accept: () => true },
    cancelLabel: 'Skip',
    content: () => (
      <p class="cerebro-selectable">
        {`File '${name}' already exists in directory '${shown(parent(to))}'`}
      </p>
    ),
  }).result;
}

/** Cut, Copy and Paste for the Project view, while it has the focus. */
export function setupFileClipboard(services: MenuServices, setup: FileClipboardSetup): void {
  const { menus } = services;
  const host = () => {
    const env = active();
    const found = env && hostFor(env.id);
    return env && found ? { worktree: env.id, host: found } : undefined;
  };
  const opened = (path: string) => {
    setup.open({ id: path, title: path.slice(path.lastIndexOf('/') + 1) });
  };
  const copy = async (worktree: string, request: Host, source: FileNode, folder: string) => {
    const answer = await askCopy(source, folder);
    if (!answer || answer.to === source.path) return;
    const exists = (await request.request('fs.exists', { path: answer.to })) as boolean;
    const over = exists ? await askOverwrite(answer.to, 'Copy') : false;
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
    if (answer.open && source.kind === 'file') opened(answer.to);
  };
  const move = async (worktree: string, request: Host, source: FileNode, folder: string) => {
    const answer = await askMove(source, folder);
    if (!answer) return;
    const to = `${answer.folder}/${source.name}`;
    // A folder there already is the host's to refuse.
    const exists =
      source.kind === 'file' && ((await request.request('fs.exists', { path: to })) as boolean);
    const over = exists ? await askOverwrite(to, 'Move') : false;
    if (over === undefined) return;
    const moved = await moveEntry({
      worktree,
      host: request,
      node: source,
      to,
      editor: setup.editor() as EditorArea,
      title: 'Move',
      references: answer.references,
      over,
    });
    if (!moved) return;
    // Pasted once, as IntelliJ's cut.
    kept.set(undefined);
    if (answer.open && source.kind === 'file') opened(to);
  };
  // Run only while enabled: what's kept is of this worktree, and something's selected.
  const paste = () => {
    const { worktree, host: request } = host() as { worktree: string; host: Host };
    const node = projectNode() as FileNode;
    const { node: source, cut } = kept.get() as { node: FileNode; cut: boolean };
    const folder = node.kind === 'directory' ? node.path : parent(node.path);
    return cut ? move(worktree, request, source, folder) : copy(worktree, request, source, folder);
  };
  provideClipboard({
    focused: () => projectNode() !== undefined,
    enabled: (action) => {
      const env = host();
      const node = projectNode();
      if (!env || node == null) return false;
      if (action === 'paste') return kept.get()?.worktree === env.worktree;
      return node.path !== env.worktree;
    },
    run: (action) => {
      if (action === 'paste') {
        void paste();
        return;
      }
      const { worktree } = host() as { worktree: string };
      kept.set({ node: projectNode() as FileNode, worktree, cut: action === 'cut' });
    },
  });
  // Around Copy Path, as IntelliJ's CutCopyPasteGroup: Cut and Copy before it, Paste after.
  for (const [command, order] of [
    ['edit.cut', -2],
    ['edit.copy', -1],
    ['edit.paste', 1],
  ] as const) {
    menus.contribute({ menu: 'project/node', item: { command }, group: 'b-copy', order });
  }
}
