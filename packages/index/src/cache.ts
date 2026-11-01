// The index kept on disk between runs. Blobs are keyed by their content's hash, so a saved blob is
// right for as long as it's parsed the same way: the cache names the parser it was made with (the
// grammars, the queries, web-tree-sitter's version), and one made otherwise is ignored.
// Measured on ag-charts (5,231 files): indexing from nothing took 13 s; the saved index is 14.4 MB
// of JSON, written in 0.37 s and read back in 0.24 s.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Blob, BlobIndex } from './blob-index.js';
import { LANGUAGES } from './languages.js';

/** Bumped when what's saved changes shape. */
const FORMAT = 1;

/** A blob as saved: its definitions as `[name, kind, line, column]`, its identifiers by name. */
type SavedBlob = [[string, string, number, number][], Record<string, number[]>];

interface Saved {
  version: string;
  blobs: Record<string, SavedBlob>;
}

/** What the index's blobs depend on, hashed: a cache from another parser doesn't apply. */
export function indexVersion(): string {
  const hash = createHash('sha256').update(String(FORMAT));
  const runtime = dirname(createRequire(import.meta.url).resolve('web-tree-sitter'));
  hash.update(readFileSync(join(runtime, 'package.json')));
  for (const [id, spec] of Object.entries(LANGUAGES)) {
    hash.update(id).update(spec.tags).update(spec.identifiers).update(readFileSync(spec.wasm));
  }
  return hash.digest('hex');
}

/**
 * Adds the blobs saved in `file` that the index doesn't have; returns how many. A missing or
 * unreadable file, or one from another parser, adds none.
 */
export async function loadIndex(index: BlobIndex, file: string, version: string): Promise<number> {
  let saved: Saved;
  try {
    saved = JSON.parse(await readFile(file, 'utf8')) as Saved;
  } catch {
    return 0;
  }
  if (saved.version !== version) return 0;
  let added = 0;
  for (const [hash, [definitions, identifiers]] of Object.entries(saved.blobs)) {
    if (index.blobs.has(hash)) continue;
    const blob: Blob = {
      definitions: definitions.map(([name, kind, line, column]) => ({ name, kind, line, column })),
      identifiers: new Map(Object.entries(identifiers)),
    };
    index.blobs.set(hash, blob);
    added++;
  }
  return added;
}

/** Saves the index's blobs to `file`, whole or not at all: written beside it, then moved over it. */
export async function saveIndex(index: BlobIndex, file: string, version: string): Promise<void> {
  const blobs: Record<string, SavedBlob> = {};
  for (const [hash, blob] of index.blobs) {
    blobs[hash] = [
      blob.definitions.map((d) => [d.name, d.kind, d.line, d.column]),
      Object.fromEntries(blob.identifiers),
    ];
  }
  await mkdir(dirname(file), { recursive: true });
  const partial = `${file}.${String(process.pid)}.tmp`;
  await writeFile(partial, JSON.stringify({ version, blobs } satisfies Saved));
  await rename(partial, file);
}
