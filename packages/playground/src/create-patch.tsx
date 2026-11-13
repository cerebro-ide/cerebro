// Create Patch…, as IntelliJ's (`CreatePatchFromChangesAction`, `CreatePatchCommitExecutor`,
// `CreatePatchConfigurationPanel`, their words in `VcsBundle` and `IdeBundle`, read from its
// source): the dialog "Patch File Settings", to a file (named from the commit's message, in the
// folder used last) or to the clipboard (the choice kept), with the base path its paths are
// relative to (the repository, to start with) and Reverse patch. A file there already is asked
// over; once written, IntelliJ offers to show it in the file manager, unless told not to ask
// again. The patch itself is the host's (`git.createPatch`).

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { Host } from './environments.js';
import { notifications } from './notifications.js';
import { fileManagerLabel } from './select-in.js';

/** What a patch is made of: a commit's changes, in some files or all of them. */
export interface PatchRequest {
  host: Host;
  worktree: string;
  from: string;
  to: string;
  /** The files it keeps to; all the commit changed, if none. */
  files?: readonly string[];
  /** The paths of the changes in it, in the repository, for the base path it needs. */
  changed: readonly string[];
  /** The commit's message, the patch's header and its file's name; none for "unnamed". */
  message?: string | undefined;
}

/** What the dialog chose. */
interface Settings {
  file?: string;
  base: string;
  reverse: boolean;
}

/** IntelliJ's keys (`vcs.patch.to.clipboard`, `vcs.patch.path`, `SHOW_PATCH_IN_EXPLORER`). */
const TO_CLIPBOARD = 'cerebro.patch.toClipboard';
const FOLDER = 'cerebro.patch.folder';
const REVEAL = 'cerebro.patch.reveal';

function kept(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key: string, value: string | undefined): void {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not kept: the default next time.
  }
}

/** IntelliJ's `PatchNameChecker.MAX`: a file name's length. */
const MAX = 100;

/**
 * A file name from a commit's message, as IntelliJ's (`PathUtil.suggestFileName`, `shortenAndSanitize`):
 * what can't be in a file name, dots and spaces as `_`; "unnamed" for none; 90 characters at most.
 */
export function patchName(message: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  const name = (message ?? '').replace(/[\u0000-\u001f/\\:*?"<>|.\s]/g, '_');
  return (name === '' ? 'unnamed' : name).slice(0, MAX - 10);
}

/** The path's parent folder, with `/`; the path itself for a folder's. */
const parent = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** A path with forward slashes and no slash at its end, for comparing. */
const plain = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '');

/**
 * The folder holding all the changes, as IntelliJ's (`ChangesUtil.findCommonAncestor`, a file's
 * folder for one file): the base path must hold it.
 */
export function commonFolder(worktree: string, changed: readonly string[]): string {
  const folders = changed.map((path) => parent(`${plain(worktree)}/${path}`).split('/'));
  const first = folders[0] ?? plain(worktree).split('/');
  let length = first.length;
  for (const other of folders) {
    let same = 0;
    while (same < length && other[same] === first[same]) same++;
    length = same;
  }
  return first.slice(0, length).join('/');
}

/** Whether `folder` is `inner` or holds it. */
const holds = (folder: string, inner: string) =>
  inner === plain(folder) || inner.startsWith(`${plain(folder)}/`);

/** The first of `name.patch`, `name1.patch`, … not there yet, as IntelliJ's `findSequentFile`. */
async function freeFile(host: Host, folder: string, name: string): Promise<string> {
  for (let n = 0; ; n++) {
    const file = `${folder}/${name}${n === 0 ? '' : String(n)}.patch`;
    if (!((await host.request('fs.exists', { path: file })) as boolean)) return file;
  }
}

/** The dialog "Patch File Settings"; what it chose, or undefined if cancelled. */
async function settingsDialog(request: PatchRequest): Promise<Settings | undefined> {
  const { host, worktree } = request;
  const folder = kept(FOLDER) ?? plain(worktree);
  const file = signal(await freeFile(host, folder, patchName(request.message)));
  const toClipboard = signal(kept(TO_CLIPBOARD) === 'true');
  const base = signal(plain(worktree));
  const reverse = signal(false);
  const common = commonFolder(worktree, request.changed);
  // IntelliJ's checks as each field is typed in: an error turns OK off, a warning doesn't.
  const fileError = signal<string | undefined>(undefined);
  const fileWarning = signal<string | undefined>(undefined);
  const baseError = signal<string | undefined>(undefined);
  const checkFile = async (path: string) => {
    const name = path.trim();
    const error =
      plain(name).split('/').at(-1)?.trim() === ''
        ? 'Name cannot be empty'
        : name.length > 255
          ? 'File path should not be too long.'
          : undefined;
    const there =
      error === undefined && ((await host.request('fs.exists', { path: name })) as boolean);
    if (path !== file.peek()) return;
    fileError.set(error);
    fileWarning.set(there ? `A file with the name '${name}' already exists` : undefined);
  };
  const checkBase = async (path: string) => {
    const folder = path.trim();
    const error =
      folder === ''
        ? 'Base path cannot be empty!'
        : !((await host.request('fs.exists', { path: folder })) as boolean)
          ? "Base dir doesn't exist"
          : !holds(folder, common)
            ? `Base path doesn't contain all selected changes (use ${common})`
            : undefined;
    if (path === base.peek()) baseError.set(error);
  };
  void checkFile(file.peek());
  const field = (
    value: typeof file,
    check: (path: string) => Promise<void>,
    label: string,
    disabled?: () => boolean,
  ) => (
    <input
      class="cerebro-dialog-field__input"
      aria-label={label}
      value={() => value.get()}
      disabled={disabled}
      on:input={(event) => {
        value.set((event.currentTarget as HTMLInputElement).value);
        void check(value.peek());
      }}
    />
  );
  return openDialog<Settings>({
    title: 'Patch File Settings',
    width: 560,
    ok: {
      enabled: () =>
        (toClipboard.get() || fileError.get() === undefined) && baseError.get() === undefined,
      accept: () => ({
        ...(toClipboard.peek() ? {} : { file: file.peek().trim() }),
        base: base.peek().trim(),
        reverse: reverse.peek(),
      }),
    },
    content: () => (
      <div class="playground-form playground-patch">
        <label class="playground-form__row">
          <span class="playground-patch__choice">
            <input
              type="radio"
              name="patch-to"
              checked={() => !toClipboard.get()}
              on:change={() => {
                toClipboard.set(false);
              }}
            />
            To file:
          </span>
          {field(file, checkFile, 'To file', () => toClipboard.get())}
        </label>
        <span class="playground-form__row">
          <span />
          <span
            class={() =>
              fileError.get() === undefined
                ? 'playground-patch__warning'
                : 'cerebro-dialog-field__error'
            }
            role="alert"
          >
            {() => (toClipboard.get() ? '' : (fileError.get() ?? fileWarning.get() ?? ''))}
          </span>
        </span>
        <label class="playground-form__check">
          <input
            type="radio"
            name="patch-to"
            checked={() => toClipboard.get()}
            on:change={() => {
              toClipboard.set(true);
            }}
          />
          To clipboard
        </label>
        <label class="playground-form__row">
          <span>Base path:</span>
          {field(base, checkBase, 'Base path')}
        </label>
        <span class="playground-form__row">
          <span />
          <span class="cerebro-dialog-field__error" role="alert">
            {() => baseError.get() ?? ''}
          </span>
        </span>
        <label class="playground-form__check">
          <input
            type="checkbox"
            checked={() => reverse.get()}
            on:change={(event) => {
              reverse.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Reverse patch
        </label>
      </div>
    ),
  }).result;
}

/** IntelliJ's question before writing over a file; whether to. */
async function overwrite(file: string): Promise<boolean> {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const answer = await openDialog<true>({
    title: 'Save Patch File',
    ok: { label: 'Overwrite', accept: () => true },
    content: () => (
      <p class="playground-question">
        File {name} ({parent(file)}) already exists.
        <br />
        Do you want to overwrite it?
      </p>
    ),
  }).result;
  return answer === true;
}

/**
 * Once written, IntelliJ's "Successfully created patch …", which offers to show it in the file
 * manager; its answer kept, if told not to ask again, and then acted on unasked.
 */
async function created(file: string): Promise<void> {
  const app = window.cerebro;
  const choice = kept(REVEAL);
  if (choice !== null) {
    if (choice === 'true') app?.shell.reveal(file);
    return;
  }
  const again = signal(false);
  // Only the desktop app can show it.
  const answer = await openDialog<() => void>({
    title: 'Create Patch',
    ...(app === undefined
      ? {}
      : {
          ok: {
            label: fileManagerLabel(app.platform),
            accept: () => () => {
              app.shell.reveal(file);
            },
          },
        }),
    cancelLabel: 'Close',
    content: () => (
      <div class="playground-question">
        <p>Successfully created patch {file}</p>
        <label class="playground-checkbox">
          <input
            type="checkbox"
            checked={() => again.get()}
            on:change={(event) => {
              again.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Don’t ask again
        </label>
      </div>
    ),
  }).result;
  if (again.peek()) keep(REVEAL, String(answer !== undefined));
  answer?.();
}

/** Create Patch…: the dialog, then the patch, written or copied. */
export async function createPatch(request: PatchRequest): Promise<void> {
  const settings = await settingsDialog(request);
  if (settings === undefined) return;
  keep(TO_CLIPBOARD, String(settings.file === undefined));
  const params = {
    path: request.worktree,
    from: request.from,
    to: request.to,
    ...(request.files === undefined ? {} : { files: request.files }),
    base: settings.base,
    reverse: settings.reverse,
    ...(request.message === undefined ? {} : { message: request.message }),
  };
  try {
    if (settings.file === undefined) {
      const { text } = (await request.host.request('git.createPatch', params)) as { text: string };
      await navigator.clipboard.writeText(text);
      notifications.notify({ title: 'Patch copied to clipboard' });
      return;
    }
    const file = settings.file;
    if (
      ((await request.host.request('fs.exists', { path: file })) as boolean) &&
      !(await overwrite(plain(file)))
    ) {
      return;
    }
    // The folder kept for next time, unless it's the default, as IntelliJ's.
    const folder = parent(plain(file));
    keep(FOLDER, folder === plain(request.worktree) ? undefined : folder);
    await request.host.request('git.createPatch', { ...params, file });
    await created(file);
  } catch (error) {
    await openDialog({
      title: 'Error',
      cancelLabel: 'OK',
      content: () => <p>Error creating patch: {(error as Error).message}</p>,
    }).result;
  }
}
