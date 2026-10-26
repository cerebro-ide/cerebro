// The file system, next to the repos: listing a folder for the project tree, reading a file for the
// editor.

import { open, readdir } from 'node:fs/promises';
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

/** The largest file the editor opens, in bytes. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Why a file isn't opened as text. */
export class UnreadableFile extends Error {
  constructor(
    readonly reason: 'binary' | 'too large',
    path: string,
  ) {
    super(reason === 'binary' ? `${path} is a binary file` : `${path} is too large to open`);
    this.name = 'UnreadableFile';
  }
}

/**
 * A text file's contents, as UTF-8. A file with a NUL byte in its first 8 KB is binary, as git
 * decides; one over MAX_FILE_SIZE isn't read.
 */
export async function readTextFile(path: string): Promise<string> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > MAX_FILE_SIZE) throw new UnreadableFile('too large', path);
    const bytes = new Uint8Array(size);
    await file.read(bytes, 0, size, 0);
    if (bytes.subarray(0, 8000).includes(0)) throw new UnreadableFile('binary', path);
    return new TextDecoder().decode(bytes);
  } finally {
    await file.close();
  }
}
