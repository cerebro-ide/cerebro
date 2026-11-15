// The file system, next to the repos: listing a folder for the project tree, reading and writing a
// file for the editor.

import { dirname } from 'node:path';
import {
  cp,
  mkdir,
  open,
  readdir,
  rename,
  stat,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

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

/** A file's bytes, as an image viewer shows them; one over MAX_FILE_SIZE isn't read. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size > MAX_FILE_SIZE) throw new UnreadableFile('too large', path);
    const bytes = new Uint8Array(size);
    await file.read(bytes, 0, size, 0);
    return bytes;
  } finally {
    await file.close();
  }
}

/**
 * A text file's contents, as UTF-8, with its byte order mark if it has one, so it's saved with it.
 * A file with a NUL byte in its first 8 KB is binary, as git decides; one over MAX_FILE_SIZE isn't
 * read.
 */
export async function readTextFile(path: string): Promise<string> {
  const bytes = await readFileBytes(path);
  if (isBinary(bytes)) throw new UnreadableFile('binary', path);
  return decodeText(bytes);
}

/** Whether bytes aren't text: a NUL in the first 8000, as git tells (`buffer_is_binary`). */
export const isBinary = (bytes: Uint8Array): boolean => bytes.subarray(0, 8000).includes(0);

/** Text from its UTF-8 bytes, a byte-order mark kept. */
export const decodeText = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

/**
 * Whether a file or folder is there: false when it, or a folder on its path, isn't; an error when
 * that can't be told (no permission).
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

/** Fails (EEXIST) when a file or folder is at `path`. */
async function notThere(path: string): Promise<void> {
  if (await exists(path)) {
    throw Object.assign(new Error(`EEXIST: already exists, '${path}'`), { code: 'EEXIST' });
  }
}

/**
 * Makes an empty file, or a folder, and the folders on its path, as IntelliJ's New File and New
 * Directory do with a name like `a/b.ts`: an error (EEXIST) when it's there already, never over it.
 */
export async function createEntry(path: string, kind: 'file' | 'directory'): Promise<void> {
  await notThere(path);
  await mkdir(kind === 'directory' ? path : dirname(path), { recursive: true });
  if (kind === 'file') await writeFile(path, '', { flag: 'wx' });
}

/**
 * Makes a new, empty scratch file in `folder` (made if it isn't there), its name as IntelliJ's
 * (ScratchFileCreator, read from its source): `scratch`, or `scratch_` and the lowest number no
 * file there has, whatever its extension, then the language's extension. Its path.
 */
export async function createScratch(folder: string, extension: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const taken = new Set<number>();
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf('.');
    const name = (dot > 0 ? entry.name.slice(0, dot) : entry.name).toLowerCase();
    if (name === 'scratch') taken.add(0);
    else if (/^scratch_\d+$/.test(name)) taken.add(Number(name.slice('scratch_'.length)));
  }
  let number = 0;
  while (taken.has(number)) number++;
  const path = `${folder}/scratch${number === 0 ? '' : `_${String(number)}`}.${extension}`;
  await writeFile(path, '', { flag: 'wx' });
  return path;
}

/**
 * Renames or moves a file or folder, as IntelliJ's Rename and Move in the Project view: an error
 * (EEXIST) when `to` is there already, unless asked to go `over` a file there (a rename on Linux
 * and macOS would replace one unasked).
 */
export async function renameEntry(path: string, to: string, over = false): Promise<void> {
  if (!over) await notThere(to);
  await mkdir(dirname(to), { recursive: true });
  await rename(path, to);
}

/**
 * Copies a file or folder to `to`, making the folders on its way, as IntelliJ's Copy in the Project
 * view: an error (EEXIST) when `to` is there already, unless asked to go `over` it (a folder's
 * files then join it, those of the same name replaced). Never into itself, in IntelliJ's words.
 */
export async function copyEntry(path: string, to: string, over = false): Promise<void> {
  if (to.startsWith(`${path}/`)) {
    throw new Error(
      dirname(to) === path
        ? 'Cannot place directory into itself.'
        : 'Cannot place directory into its subdirectory.',
    );
  }
  if (!over) await notThere(to);
  await mkdir(dirname(to), { recursive: true });
  await cp(path, to, { recursive: true, force: over, errorOnExist: !over });
}

/** Saves a text file as UTF-8, over what's there; the file must exist, so a typo makes none. */
export async function writeTextFile(
  path: string,
  text: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const file = await open(path, 'r+');
  try {
    await empty(file, platform);
    await file.writeFile(text);
  } finally {
    await file.close();
  }
}

/** How long a save waits for another process to let go of the file's mapping, in milliseconds. */
export const MAPPED_WAIT = 2000;

/** How often a save tries again while the file is mapped, in milliseconds. */
const MAPPED_RETRY = 10;

/**
 * Empties a file to save over it. Windows doesn't resize a file another process has mapped into
 * memory (Microsoft's SetEndOfFile docs), and git maps a file over 32 KB while it reads it: the
 * Local History's `git add --all`, or an agent's. Measured on Windows: 37 saves of 300 of a 2 MB
 * file failed beside the Local History's records. Node calls that error UNKNOWN (libuv has no
 * name for ERROR_USER_MAPPED_FILE), so on Windows an UNKNOWN is tried again until `wait` is over.
 */
export async function empty(
  file: Pick<FileHandle, 'truncate'>,
  platform: NodeJS.Platform = process.platform,
  wait = MAPPED_WAIT,
): Promise<void> {
  const until = performance.now() + wait;
  for (;;) {
    try {
      await file.truncate(0);
      return;
    } catch (error) {
      const mapped = platform === 'win32' && (error as NodeJS.ErrnoException).code === 'UNKNOWN';
      if (!mapped || performance.now() >= until) throw error;
      await sleep(MAPPED_RETRY);
    }
  }
}
