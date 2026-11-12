// Favorite branches, as IntelliJ's (DvcsBranchManager, GitBranchManager, read from its source):
// `main` and `master`, local and on `origin`, are favorites until unmarked; any other branch once
// marked. Kept for each repository, by its path, in the browser's storage.

import { signal, untracked } from '@cerebro-ide/reactive';
import { projectOf } from './environments.js';

/** Where they're kept. */
const KEY = 'cerebro.branchFavorites';

/** IntelliJ's predefined favorites (`getDefaultBranchNames`). */
const PREDEFINED = [
  'refs/heads/master',
  'refs/heads/main',
  'refs/remotes/origin/master',
  'refs/remotes/origin/main',
];

/** A repository's: the branches marked, and the predefined ones unmarked, by their refs in full. */
interface Marks {
  favorites: string[];
  excluded: string[];
}

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];

/** What's kept, or none where it can't be read. */
export function readFavorites(): Record<string, Marks> {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const marks: Record<string, Marks> = {};
    for (const [repository, value] of Object.entries(stored)) {
      const { favorites, excluded } = (value ?? {}) as Record<string, unknown>;
      marks[repository] = { favorites: texts(favorites), excluded: texts(excluded) };
    }
    return marks;
  } catch {
    return {};
  }
}

const marks = signal(readFavorites());

/**
 * What a worktree's favorites are kept by: its project's path, or its own where no project holds
 * it. Not followed: the worktrees' list, which it reads, is read again after every checkout.
 */
export function repositoryOf(worktree: string): string {
  return untracked(() => projectOf(worktree)?.path) ?? worktree;
}

/** Whether a branch, by its ref in full, is a favorite in the repository at `repository`. */
export function isFavorite(repository: string, ref: string): boolean {
  const at = marks.get()[repository];
  if (at?.favorites.includes(ref)) return true;
  if (at?.excluded.includes(ref)) return false;
  return PREDEFINED.includes(ref);
}

/** Marks a branch a favorite, or not, as IntelliJ's `setFavorite`. */
export function setFavorite(repository: string, ref: string, favorite: boolean): void {
  const at = marks.peek()[repository] ?? { favorites: [], excluded: [] };
  const predefined = PREDEFINED.includes(ref);
  const favorites = at.favorites.filter((other) => other !== ref);
  const excluded = at.excluded.filter((other) => other !== ref);
  if (favorite && !predefined) favorites.push(ref);
  if (!favorite && predefined) excluded.push(ref);
  marks.set({ ...marks.peek(), [repository]: { favorites, excluded } });
  try {
    localStorage.setItem(KEY, JSON.stringify(marks.peek()));
  } catch {
    // Not kept: it applies until the page is reloaded.
  }
}
