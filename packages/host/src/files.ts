// The file system, next to the repos: listing a folder for the project tree.

import { readdir } from 'node:fs/promises';

export interface Entry {
  name: string;
  /** The entry's path: the folder's and its name, with `/` between, as git writes paths. */
  path: string;
  kind: 'file' | 'directory';
}

/** Never listed: git's own folder. */
const HIDDEN = new Set(['.git']);

/**
 * A path with `/` between its parts, on every OS, as git writes paths (Windows takes either), so
 * paths from git and from the file system compare equal.
 */
export function toSlashes(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.replaceAll('\\', '/') : path;
}

/** A folder's entries: folders first, then files, each by name ignoring case, as IntelliJ sorts. */
export async function listFolder(folder: string): Promise<Entry[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const base = toSlashes(folder).replace(/\/+$/, '');
  return entries
    .filter((e) => !HIDDEN.has(e.name))
    .map((e): Entry => ({
      name: e.name,
      path: `${base}/${e.name}`,
      kind: e.isDirectory() ? 'directory' : 'file',
    }))
    .sort(
      (a, b) =>
        Number(a.kind === 'file') - Number(b.kind === 'file') ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}
