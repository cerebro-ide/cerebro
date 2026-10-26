// The file system, next to the repos: listing a folder for the project tree.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface Entry {
  name: string;
  /** The entry's path: the folder's, joined with its name. */
  path: string;
  kind: 'file' | 'directory';
}

/** Never listed: git's own folder. */
const HIDDEN = new Set(['.git']);

/** A folder's entries: folders first, then files, each by name ignoring case, as IntelliJ sorts. */
export async function listFolder(folder: string): Promise<Entry[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((e) => !HIDDEN.has(e.name))
    .map((e): Entry => ({
      name: e.name,
      path: join(folder, e.name),
      kind: e.isDirectory() ? 'directory' : 'file',
    }))
    .sort(
      (a, b) =>
        Number(a.kind === 'file') - Number(b.kind === 'file') ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}
