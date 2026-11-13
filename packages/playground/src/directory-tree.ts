// Files grouped by directory, as IntelliJ's changes trees group them (the Commit window's, the
// Log's): folders first, then files, each by name; a folder holding only one folder shows as one
// row (`src/main`).

/** How the tree's rows are made: a file's, and a folder's from its path (`src/main/`). */
export interface DirectoryRows<F, N> {
  file: (file: F) => N;
  folder: (folder: { path: string; name: string; count: number; children: N[] }) => N;
}

interface Dir<F> {
  dirs: Map<string, Dir<F>>;
  files: F[];
}

/** `files` as rows grouped by directory; each file's path is `pathOf`'s, a directory's ending in `/`. */
export function directoryTree<F, N>(
  files: readonly F[],
  pathOf: (file: F) => string,
  rows: DirectoryRows<F, N>,
): N[] {
  const root: Dir<F> = { dirs: new Map(), files: [] };
  const sorted = [...files].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));
  for (const file of sorted) {
    const parts = pathOf(file).replace(/\/$/, '').split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  const count = (dir: Dir<F>): number =>
    dir.files.length + [...dir.dirs.values()].reduce((sum, d) => sum + count(d), 0);
  const items = (dir: Dir<F>, prefix: string): N[] => [
    ...[...dir.dirs].map(([name, sub]) => {
      let label = name;
      let inner = sub;
      // A folder holding only one folder shows as one row.
      while (inner.files.length === 0 && inner.dirs.size === 1) {
        const [childName, child] = [...inner.dirs][0] as [string, Dir<F>];
        label = `${label}/${childName}`;
        inner = child;
      }
      const path = `${prefix}${label}/`;
      return rows.folder({ path, name: label, count: count(inner), children: items(inner, path) });
    }),
    ...dir.files.map(rows.file),
  ];
  return items(root, '');
}
