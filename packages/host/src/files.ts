// The file system, next to the repos: listing a folder for the project tree, reading and writing a
// file for the editor.

import { open, readdir } from 'node:fs/promises';

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

/** Saves a text file as UTF-8, over what's there; the file must exist, so a typo makes none. */
export async function writeTextFile(path: string, text: string): Promise<void> {
  const file = await open(path, 'r+');
  try {
    await file.truncate(0);
    await file.writeFile(text);
  } finally {
    await file.close();
  }
}
