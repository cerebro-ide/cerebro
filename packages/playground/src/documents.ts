// The files open for editing, as IntelliJ keeps them: a document per file, which outlives its tabs,
// read through the host. Saving is IntelliJ's too: File → Save All (Mod+S), and on its own when the
// window loses the focus or closes. A file changed on disk (by an agent, or git) is read again when
// the window gets the focus and every few seconds while it has it; one with unsaved edits keeps
// them.

import { EditorDocument } from '@cerebro-ide/ui-editor';
import { currentHost, hostFor } from './environments.js';

/** How often open files are read again for changes on disk, while the window has the focus. */
export const RELOAD_EVERY = 2000;

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
  if (!currentHost()) return;
  const failed: string[] = [];
  for (const [path, doc] of await opened()) {
    const host = hostFor(path);
    if (!host || !doc.modified.peek()) continue;
    // What's written, which the editor may change while it's being written.
    const text = doc.text.peek();
    try {
      await host.request('fs.write', { path, text: doc.content() });
      doc.saved(text);
    } catch (error) {
      failed.push(`${path}: ${(error as Error).message}`);
    }
  }
  if (failed.length > 0) throw new Error(`Couldn’t save ${failed.join('; ')}`);
}

/** Reads the open files again, taking what changed on disk where there are no unsaved edits. */
export async function reloadAll(): Promise<void> {
  if (!currentHost()) return;
  for (const [path, doc] of await opened()) {
    const host = hostFor(path);
    if (!host || doc.modified.peek()) continue;
    try {
      const { text } = (await host.request('fs.read', { path })) as { text: string };
      doc.changedOnDisk(text);
    } catch {
      // Gone, or unreadable now: the editor keeps what it shows.
    }
  }
}

/** Saves when the window loses the focus, and reads changed files when it has it. */
export function setupSaving(report: (error: unknown) => void): void {
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
}
