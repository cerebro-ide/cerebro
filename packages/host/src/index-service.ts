// The shared index, as the host serves it: one blob index for the repository (its worktrees share
// most file contents), each worktree indexed on first use and again, incrementally, once its last
// indexing is a moment old, so typing in a search doesn't re-run git on every key.

import {
  BlobIndex,
  definitions,
  indexWorktree,
  symbols,
  usages,
  type IndexedWorktree,
} from '@cerebro-ide/index';
import type { Git } from './git.js';

/** How long a worktree's indexing is reused before it's checked again, in milliseconds. */
export const FRESH_FOR = 2000;

export class IndexService {
  private index: Promise<BlobIndex> | undefined;
  private readonly worktrees = new Map<string, { at: number; indexed: Promise<IndexedWorktree> }>();

  constructor(
    private readonly git: Git,
    private readonly now: () => number = Date.now,
    /** Told how far a worktree's indexing has got, as it goes. */
    private readonly progress?: (worktree: string, done: number, total: number) => void,
  ) {}

  /** Starts indexing a worktree, without waiting: so the first search finds it ready. */
  warm(worktree: string): void {
    void this.files(worktree).catch(() => undefined);
  }

  /** A worktree's files in the index, indexing it if it's new or a moment old. */
  private async files(worktree: string): Promise<{ index: BlobIndex; files: Map<string, string> }> {
    this.index ??= BlobIndex.create();
    const index = await this.index;
    let entry = this.worktrees.get(worktree);
    if (!entry || this.now() - entry.at > FRESH_FOR) {
      entry = {
        at: this.now(),
        indexed: indexWorktree(index, worktree, this.git, (done, total) =>
          this.progress?.(worktree, done, total),
        ),
      };
      this.worktrees.set(worktree, entry);
    }
    return { index, files: (await entry.indexed).files };
  }

  /** Paths in answers are the worktree's, joined with `/`. */
  private static absolute<T extends { path: string }>(worktree: string, items: T[]): T[] {
    return items.map((item) => ({ ...item, path: `${worktree}/${item.path}` }));
  }

  async symbols(worktree: string, query: string) {
    const { index, files } = await this.files(worktree);
    return IndexService.absolute(worktree, symbols(index, files, query));
  }

  async definitions(worktree: string, name: string) {
    const { index, files } = await this.files(worktree);
    return IndexService.absolute(worktree, definitions(index, files, name));
  }

  async usages(worktree: string, name: string) {
    const { index, files } = await this.files(worktree);
    return IndexService.absolute(worktree, usages(index, files, name));
  }
}
