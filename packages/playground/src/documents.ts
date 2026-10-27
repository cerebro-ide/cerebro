// The files open for editing, as IntelliJ keeps them: a document per file, which outlives its tabs,
// read through the host. Saving is on its own, as IntelliJ's (its SaveAndSyncHandlerImpl): when the
// window loses the focus or closes, and after the IDE has been idle for a while; and when an editor
// loses the focus. File → Save All (Mod+S) saves at once. A file changed on disk (by an agent, or
// git) is read again when the window gets the focus and every few seconds while it has it. One also
// changed in the editor is a conflict, as IntelliJ's File Cache Conflict: nothing is written over
// it, and the user chooses between the two, or merges them.

import { EditorDocument } from '@cerebro-ide/ui-editor';
import { currentHost, hostFor } from './environments.js';

/** How often open files are read again for changes on disk, while the window has the focus. */
export const RELOAD_EVERY = 2000;

/**
 * How long without a key or the mouse before modified files are saved: IntelliJ's "Save files if
 * the IDE is idle for" default (GeneralSettings.kt: 15 seconds), there off by default.
 */
export const SAVE_WHEN_IDLE = 15_000;

/**
 * Asks how a conflict is resolved, and resolves it through `EditorDocument.resolve`: left as it is,
 * the edits are kept unsaved, and the conflict found again.
 */
export type ConflictResolver = (path: string, doc: EditorDocument, disk: string) => Promise<void>;

let resolveConflict: ConflictResolver = () => Promise.resolve();

/** The files whose conflict is being resolved, which aren't asked about, or saved, meanwhile. */
const resolving = new Set<string>();

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

/**
 * A file's document, read the first time it's asked for, or why it can't be read; in a browser, a
 * document of the sample text, which isn't saved.
 */
export function documentFor(path: string, sample: () => string): Promise<Loaded> {
  let loaded = documents.get(path);
  if (!loaded) {
    const host = hostFor(path);
    loaded = host
      ? host.request('fs.read', { path }).then(
          (result) => new EditorDocument((result as { text: string }).text),
          (error: unknown) => ({ error: (error as Error).message }),
        )
      : Promise.resolve(new EditorDocument(sample()));
    // A file that couldn't be read is tried again the next time.
    void loaded.then((result) => {
      if (!(result instanceof EditorDocument)) documents.delete(path);
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

/** Saves every modified document; a file that can't be saved is reported, and stays modified. */
export async function saveAll(): Promise<void> {
  await saveFiles();
}

/** Saves these files' documents, if modified (all of them without `paths`), as Save All does. */
export async function saveFiles(paths?: readonly string[]): Promise<void> {
  if (!currentHost()) return;
  const failed: string[] = [];
  for (const [path, doc] of await opened()) {
    if (paths && !paths.includes(path)) continue;
    const host = hostFor(path);
    if (!host || !doc.modified.peek()) continue;
    try {
      // Not over a change made on disk since it was read: that's a conflict.
      const disk = await host.request('fs.read', { path }).then(
        (result) => (result as { text: string }).text,
        // Gone: written again.
        () => undefined,
      );
      if (disk !== undefined && (await conflicts(path, doc, disk))) continue;
      if (!doc.modified.peek()) continue;
      // What's written, which the editor may change while it's being written.
      const text = doc.text.peek();
      await host.request('fs.write', { path, text: doc.content() });
      doc.saved(text);
    } catch (error) {
      failed.push(`${path}: ${(error as Error).message}`);
    }
  }
  if (failed.length > 0) throw new Error(`Couldn’t save ${failed.join('; ')}`);
}

/**
 * Reads the open files again, taking what changed on disk where there are no unsaved edits; where
 * there are, it's a conflict.
 */
export async function reloadAll(): Promise<void> {
  if (!currentHost()) return;
  for (const [path, doc] of await opened()) {
    const host = hostFor(path);
    if (!host || resolving.has(path)) continue;
    let text: string;
    try {
      ({ text } = (await host.request('fs.read', { path })) as { text: string });
    } catch {
      // Gone, or unreadable now: the editor keeps what it shows.
      continue;
    }
    if (!(await conflicts(path, doc, text))) doc.changedOnDisk(text);
  }
}

/**
 * Saves on its own, as IntelliJ: when the window loses the focus, and after `SAVE_WHEN_IDLE`
 * without a key or the mouse. Reads changed files when the window has the focus. Conflicts are
 * resolved through `resolver`.
 */
export function setupSaving(report: (error: unknown) => void, resolver: ConflictResolver): void {
  resolveConflict = resolver;
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
  let idle: ReturnType<typeof setTimeout> | undefined;
  const active = () => {
    clearTimeout(idle);
    idle = setTimeout(save, SAVE_WHEN_IDLE);
  };
  for (const type of ['keydown', 'pointerdown', 'wheel']) {
    window.addEventListener(type, active, { capture: true, passive: true });
  }
}
