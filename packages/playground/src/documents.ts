// The files open for editing, as IntelliJ keeps them: a document per file, which outlives its tabs,
// read through the host. Saving is on its own, as IntelliJ's (its SaveAndSyncHandlerImpl): when the
// window loses the focus or closes, and after the IDE has been idle for a while; and when an editor
// loses the focus. File → Save All (Mod+S) saves at once. A file changed on disk (by an agent, or
// git) is read again when the window gets the focus and every few seconds while it has it. One also
// changed in the editor is a conflict, as IntelliJ's File Cache Conflict: nothing is written over
// it, and the user chooses between the two, or merges them. A file deleted on disk has its tabs
// closed, its edits with them, as IntelliJ's FileEditorManagerImpl closes a deleted file's editors.
// What's saved may first be changed by a plugin, as IntelliJ's Actions on Save (Prettier's Run on
// save), on every save: Save All's and the ones made on their own.

import { effect, ObservableMap, untracked } from '@cerebro-ide/reactive';
import { EditorDocument } from '@cerebro-ide/ui-editor';
import { currentHost, hostFor, type Host } from './environments.js';

/** How often open files are read again for changes on disk, while the window has the focus. */
export const RELOAD_EVERY = 2000;

/**
 * Asks how a conflict is resolved, and resolves it through `EditorDocument.resolve`: left as it is,
 * the edits are kept unsaved, and the conflict found again.
 */
export type ConflictResolver = (path: string, doc: EditorDocument, disk: string) => Promise<void>;

// All set by `setupSaving`, which the page calls before any file is read.
let resolveConflict!: ConflictResolver;

/** Closes a deleted file's tabs. */
let closeDeleted!: (path: string) => void;

/** Says why saving failed. */
let reportSaving!: (error: unknown) => void;

/** The files whose conflict is being resolved, which aren't asked about, or saved, meanwhile. */
const resolving = new Set<string>();

/**
 * The files being saved, and how many saves each has started. A read from disk made while a file
 * is saved, or across a save, isn't news: the host writes a file over in place, so a read may find
 * the save's write, whole or in part, before the document knows it's saved, which isn't a conflict;
 * or the text from before it.
 */
const saving = new Set<string>();
const saves = new Map<string, number>();

/**
 * Whether the file changed on disk while it has edits, given what's on disk: if so, the conflict
 * is resolved first. Returns whether it's still unresolved, or being resolved.
 */
async function conflicts(path: string, doc: EditorDocument, disk: string): Promise<boolean> {
  if (resolving.has(path)) return true;
  if (!doc.modified.peek() || !doc.changedFrom(disk)) return false;
  resolving.add(path);
  try {
    await resolveConflict(path, doc, disk);
  } finally {
    resolving.delete(path);
  }
  return doc.changedFrom(disk);
}

type Loaded = EditorDocument | { error: string };

const documents = new Map<string, Promise<Loaded>>();

/** The documents read, by path: what shows them as they are reads them here (the status bar). */
const read = new ObservableMap<string, EditorDocument>();

/** A file's document once it's read; undefined before, or when it can't be. Read reactively. */
export function documentRead(path: string): EditorDocument | undefined {
  return read.get(path);
}

/** The files whose documents have edits not saved yet: the Commit window lists them as changed. */
export function unsavedFiles(): string[] {
  // Not read reactively: the Commit window reads its lists as it's shown.
  return untracked(() =>
    [...read.entries()].filter(([, doc]) => doc.modified.peek()).map(([path]) => path),
  );
}

/** Told of each change to a file's text that leaves it unsaved: an edit, not a read from disk. */
const editListeners = new Set<(path: string) => void>();

/** Calls `listener` with a file's path as its text is edited (Recent Files' edited ones). */
export function onEdited(listener: (path: string) => void): void {
  editListeners.add(listener);
}

/** Tells the listeners of `doc`'s edits. */
function watchEdits(path: string, doc: EditorDocument): void {
  effect(() => {
    doc.text.get();
    untracked(() => {
      if (doc.modified.get()) for (const listener of editListeners) listener(path);
    });
    return undefined;
  });
}

/**
 * A file's document, read the first time it's asked for, or why it can't be read; in a browser, a
 * document of the sample text, which isn't saved (empty without one).
 */
export function documentFor(path: string, sample?: () => string): Promise<Loaded> {
  let loaded = documents.get(path);
  if (!loaded) {
    const host = hostFor(path);
    loaded = host
      ? host.request('fs.read', { path }).then(
          (result) => new EditorDocument((result as { text: string }).text),
          (error: unknown) => ({ error: (error as Error).message }),
        )
      : Promise.resolve(new EditorDocument(sample?.() ?? ''));
    // A file that couldn't be read is tried again the next time.
    void loaded.then((result) => {
      if (result instanceof EditorDocument) {
        read.set(path, result);
        watchEdits(path, result);
      } else documents.delete(path);
    });
    documents.set(path, loaded);
  }
  return loaded;
}

/** The documents read so far, by path. */
async function opened(): Promise<[string, EditorDocument][]> {
  const all = await Promise.all(
    [...documents].map(async ([path, loaded]) => [path, await loaded] as const),
  );
  return all.filter(
    (entry): entry is [string, EditorDocument] => entry[1] instanceof EditorDocument,
  );
}

/**
 * Whether a file that couldn't be read was deleted; if so, its document is forgotten and its tabs
 * closed.
 */
async function deleted(path: string): Promise<boolean> {
  const there = await hostFor(path)
    ?.request('fs.exists', { path })
    .then(
      (result) => result as boolean,
      // Can't tell: kept.
      () => true,
    );
  if (there !== false) return false;
  documents.delete(path);
  read.delete(path);
  closeDeleted(path);
  return true;
}

/**
 * Changes a file's text as it's saved: the text it becomes, and the change's name for undo; or
 * undefined, to leave it as it is.
 */
export type BeforeSave = (file: {
  path: string;
  text: string;
}) => Promise<{ text: string; name: string } | undefined>;

const beforeSave = new Set<BeforeSave>();

/** Calls `hook` before each file is saved; returns what stops it. */
export function onBeforeSave(hook: BeforeSave): () => void {
  beforeSave.add(hook);
  return () => {
    beforeSave.delete(hook);
  };
}

/** Lets the hooks change what's saved: an edit undo takes back, unless it was typed into meanwhile. */
async function changeBeforeSave(path: string, doc: EditorDocument): Promise<void> {
  for (const hook of beforeSave) {
    const asked = doc.text.peek();
    let changed: Awaited<ReturnType<BeforeSave>>;
    try {
      changed = await hook({ path, text: asked.toString() });
    } catch (error) {
      // A hook that fails leaves the text as it is: it's still saved.
      console.error(error);
      continue;
    }
    if (changed && doc.text.peek() === asked) doc.replace(changed.text, changed.name);
  }
}

/** Saves every modified document; a file that can't be saved is reported, and stays modified. */
export async function saveAll(): Promise<void> {
  await saveFiles();
}

/**
 * Saves every modified document before a git action that reads or changes the files, as IntelliJ's
 * do (`FileDocumentManager.saveAllDocuments()`, in `GitCheckoutOperation`, `GitMergeOperation`,
 * `GitResetOperation`, `GitRepositoryAction`, `VcsUpdateTask` and the shelf's actions, read from
 * its source). A file that can't be saved doesn't stop the action, as in IntelliJ's: it's reported
 * as saving's failures are, and stays modified.
 */
export async function saveBeforeGit(): Promise<void> {
  await saveAll().catch(reportSaving);
}

/** The saves asked for, one after another. */
let saved: Promise<unknown> = Promise.resolve();

/**
 * Saves these files' documents, if modified (all of them without `paths`), as Save All does; with
 * `label`, the Local History records the change as that. After the saves asked for before: two at
 * once would each find the other's write on disk, and call it a conflict.
 */
export function saveFiles(paths?: readonly string[], label?: string): Promise<void> {
  const asked = performance.now();
  const next = saved.then(() => save(paths, label, asked));
  // A save that fails doesn't stop the next.
  saved = next.catch(() => undefined);
  return next;
}

/**
 * How long a save may take, from when it was asked for, before it says on the console where the time
 * went: the e2e test of saving when idle has seen 6 s with the idle time at 1 s (docs/backlog.md).
 */
export const SLOW_SAVE = 2000;

async function save(
  paths: readonly string[] | undefined,
  label: string | undefined,
  asked: number,
) {
  if (!currentHost()) return;
  const failed: string[] = [];
  const started = performance.now();
  for (const [path, doc] of await opened()) {
    if (paths && !paths.includes(path)) continue;
    const host = hostFor(path);
    if (!host || !doc.modified.peek()) continue;
    saving.add(path);
    saves.set(path, (saves.get(path) ?? 0) + 1);
    try {
      // Not over a change made on disk since it was read: that's a conflict.
      const reading = performance.now();
      const disk = await host.request('fs.read', { path }).then(
        (result) => (result as { text: string }).text,
        () => undefined,
      );
      const read = performance.now();
      // Deleted: not made again. Unreadable: written over, which says why it fails.
      if (disk === undefined && (await deleted(path))) continue;
      if (disk !== undefined && (await conflicts(path, doc, disk))) continue;
      if (!doc.modified.peek()) continue;
      await changeBeforeSave(path, doc);
      const hooked = performance.now();
      // What's written, which the editor may change while it's being written.
      const text = doc.text.peek();
      const format = doc.format.peek();
      await host.request('fs.write', {
        path,
        text: doc.content(),
        ...(label === undefined ? {} : { label }),
      });
      doc.saved(text, format);
      const written = performance.now();
      if (written - asked > SLOW_SAVE) {
        const ms = (from: number, to: number) => `${String(Math.round(to - from))} ms`;
        console.warn(
          `Saving ${path} took ${ms(asked, written)}: ${ms(asked, started)} after the saves before, ` +
            `${ms(started, reading)} to the file, ${ms(reading, read)} reading it, ` +
            `${ms(read, hooked)} before saving, ${ms(hooked, written)} writing it`,
        );
      }
    } catch (error) {
      failed.push(`${path}: ${(error as Error).message}`);
    } finally {
      saving.delete(path);
    }
  }
  if (failed.length > 0) throw new Error(`Couldn’t save ${failed.join('; ')}`);
}

/** Each file's read under way, and the one asked for while it runs. */
const reading = new Map<string, Promise<void>>();
const readNext = new Map<string, Promise<void>>();

/** Reads a file again, taking what changed on disk where there are no unsaved edits. */
function readAgain(path: string, doc: EditorDocument, host: Host): Promise<void> {
  readNext.delete(path);
  const now = (async () => {
    if (resolving.has(path) || saving.has(path)) return;
    const before = saves.get(path);
    let text: string;
    try {
      ({ text } = (await host.request('fs.read', { path })) as { text: string });
    } catch {
      // Deleted, its tabs closed; or unreadable now: the editor keeps what it shows.
      await deleted(path);
      return;
    }
    if (saving.has(path) || saves.get(path) !== before) return;
    if (!(await conflicts(path, doc, text))) doc.changedOnDisk(text);
  })().finally(() => reading.delete(path));
  reading.set(path, now);
  return now;
}

/**
 * Reads the open files again, taking what changed on disk where there are no unsaved edits; where
 * there are, it's a conflict. Asked while a file's read runs, one more follows it, for all asked
 * meanwhile: the window's focus asks, and the editing e2e test sends a focus event every 5 ms
 * (measured: 1,708 reads in that file's run, 532 in one second, the host's reads then 4 s in CI).
 */
export async function reloadAll(): Promise<void> {
  if (!currentHost()) return;
  for (const [path, doc] of await opened()) await reload(path, doc);
}

/** Reads an open file again, after the read under way, if any: one for all asked meanwhile. */
async function reload(path: string, doc: EditorDocument): Promise<void> {
  const host = hostFor(path);
  // A file asked about is left alone: its question waits on the person.
  if (!host || resolving.has(path) || saving.has(path)) return;
  const waiting = readNext.get(path);
  if (waiting) return waiting;
  const running = reading.get(path);
  if (!running) return readAgain(path, doc, host);
  const next = running.catch(() => undefined).then(() => readAgain(path, doc, host));
  readNext.set(path, next);
  return next;
}

/**
 * Reads a file again if it's open, as the window's focus does, so a place in it found on disk (a
 * diff read from disk, say) is in its text; undefined, at once, if it isn't open.
 */
export function reloadOpen(path: string): Promise<void> | undefined {
  const loaded = documents.get(path);
  if (!loaded || !currentHost()) return undefined;
  return loaded.then((doc) => (doc instanceof EditorDocument ? reload(path, doc) : undefined));
}

/**
 * Saves on its own, as IntelliJ: when the window loses the focus, and after `idle()` ms without a
 * key or the mouse (none when it's undefined: the setting is off). Reads changed files when the
 * window has the focus. Conflicts are resolved through `resolver`; a deleted file's tabs are closed
 * through `close`.
 */
export function setupSaving(
  report: (error: unknown) => void,
  resolver: ConflictResolver,
  close: (path: string) => void,
  idle: () => number | undefined,
): void {
  resolveConflict = resolver;
  closeDeleted = close;
  reportSaving = report;
  const save = () => {
    saveAll().catch(report);
  };
  const reload = () => {
    void reloadAll();
  };
  window.addEventListener('blur', save);
  window.addEventListener('focus', reload);
  setInterval(() => {
    if (document.hasFocus()) reload();
  }, RELOAD_EVERY);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const active = () => {
    clearTimeout(timer);
    // Read each time: a change in Settings counts from the next key or move.
    const after = idle();
    if (after !== undefined) timer = setTimeout(idleSave, after);
  };
  /**
   * Saves when idle, saying so on the console with the files modified then: the e2e test of it has
   * seen the save come seconds late, no save slow (docs/backlog.md).
   */
  const idleSave = () => {
    void opened().then((docs) => {
      const modified = docs.filter(([, doc]) => doc.modified.peek()).map(([path]) => path);
      console.info(
        `Saving when idle at ${String(Math.round(performance.now()))} ms, modified: ${JSON.stringify(modified)}`,
      );
    });
    save();
  };
  for (const type of ['keydown', 'pointerdown', 'wheel']) {
    window.addEventListener(type, active, { capture: true, passive: true });
  }
}
