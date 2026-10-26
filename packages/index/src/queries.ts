// What the index answers about a worktree, by name: symbols for a search, the definitions of a
// name, and its usages. Name matches, not semantic ones: the UI says so.

import type { BlobIndex } from './blob-index.js';

export interface Symbol {
  name: string;
  kind: string;
  /** Relative to the worktree, `/`-separated. */
  path: string;
  line: number;
  column: number;
}

export interface Usage {
  path: string;
  line: number;
  column: number;
}

/**
 * Definitions whose name contains the query, ignoring case: exact names first, then prefixes, then
 * the rest, shorter names before longer, then by path. At most `limit`.
 */
export function symbols(
  index: BlobIndex,
  files: ReadonlyMap<string, string>,
  query: string,
  limit = 200,
): Symbol[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  const found: (Symbol & { rank: number })[] = [];
  for (const [path, blob] of files) {
    for (const d of index.blobs.get(blob)?.definitions ?? []) {
      const name = d.name.toLowerCase();
      const at = name.indexOf(q);
      if (at < 0) continue;
      const rank = name === q ? 0 : at === 0 ? 1 : 2;
      found.push({ ...d, path, rank });
    }
  }
  return found
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.name.length - b.name.length ||
        a.path.localeCompare(b.path) ||
        a.line - b.line,
    )
    .slice(0, limit)
    .map(({ name, kind, path, line, column }) => ({ name, kind, path, line, column }));
}

/** Where a name is defined: every definition with exactly that name, by path. */
export function definitions(
  index: BlobIndex,
  files: ReadonlyMap<string, string>,
  name: string,
): Symbol[] {
  return symbols(index, files, name, Infinity).filter((s) => s.name === name);
}

/** Where a name appears: every identifier with exactly that name, by path and position. */
export function usages(
  index: BlobIndex,
  files: ReadonlyMap<string, string>,
  name: string,
): Usage[] {
  const found: Usage[] = [];
  for (const [path, blob] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const positions = index.blobs.get(blob)?.identifiers.get(name) ?? [];
    for (let i = 0; i < positions.length; i += 2) {
      found.push({ path, line: positions[i] as number, column: positions[i + 1] as number });
    }
  }
  return found;
}
