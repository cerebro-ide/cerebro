// The shared index, as the host serves it: one blob index for the repository (its worktrees share
// most file contents), each worktree indexed on first use and again, incrementally, once its last
// indexing is a moment old, so typing in a search doesn't re-run git on every key. Given a cache
// file, the index starts from what it saved, and is saved again after indexing parses something.

import {
  BlobIndex,
  definitions,
  indexVersion,
  indexWorktree,
  loadIndex,
  saveIndex,
  symbols,
  usages,
  type IndexedWorktree,
} from '@cerebro-ide/index';
import type { Git } from './git.js';

/** How long a worktree's indexing is reused before it's checked again, in milliseconds. */
export const FRESH_FOR = 2000;

/** How long after indexing parsed something the index is saved, in ms: a burst of them saves once. */
export const SAVE_AFTER = 1000;

export class IndexService {
  private index: Promise<BlobIndex> | undefined;
  private readonly worktrees = new Map<string, { at: number; indexed: Promise<IndexedWorktree> }>();

  constructor(
    private readonly git: Git,
    private readonly now: () => number = Date.now,
    /** Told how far a worktree's indexing has got, as it goes. */
    private readonly progress?: (worktree: string, done: number, total: number) => void,
    /** Where the index is kept between runs; without it, it's rebuilt each run. */
    private readonly cache?: string,
  ) {}

  private saving: ReturnType<typeof setTimeout> | undefined;

  /** The index: what the cache has, to start with. */
  private async open(): Promise<BlobIndex> {
    const index = await BlobIndex.create();
    if (this.cache) await loadIndex(index, this.cache, indexVersion());
    return index;
  }

  /** Saves the index a moment from now, unless asked again meanwhile. */
  private save(index: BlobIndex, cache: string): void {
    clearTimeout(this.saving);
    this.saving = setTimeout(() => {
      // A cache that can't be written only costs the next run its head start.
      saveIndex(index, cache, indexVersion()).catch(() => undefined);
    }, SAVE_AFTER);
    // Not what keeps the host running.
    this.saving.unref();
  }

  /** Starts indexing a worktree, without waiting: so the first search finds it ready. */
  warm(worktree: string): void {
    void this.files(worktree).catch(() => undefined);
  }

  /** A worktree's files in the index, indexing it if it's new or a moment old. */
  private async files(worktree: string): Promise<{ index: BlobIndex; files: Map<string, string> }> {
    this.index ??= this.open();
    const index = await this.index;
    let entry = this.worktrees.get(worktree);
    if (!entry || this.now() - entry.at > FRESH_FOR) {
      const indexed = indexWorktree(index, worktree, this.git, (done, total) =>
        this.progress?.(worktree, done, total),
      );
      entry = { at: this.now(), indexed };
      this.worktrees.set(worktree, entry);
      const { cache } = this;
      if (cache) {
        void indexed.then(
          ({ parsed }) => {
            if (parsed > 0) this.save(index, cache);
          },
          () => undefined,
        );
      }
    }
    return { index, files: (await entry.indexed).files };
  }

  /** Paths in answers are the worktree's, joined with `/`. */
  private static absolute<T extends { path: string }>(worktree: string, items: T[]): T[] {
    return items.map((item) => ({ ...item, path: `${worktree}/${item.path}` }));
  }

  async symbols(worktree: string, query: string, kinds?: readonly string[]) {
    const { index, files } = await this.files(worktree);
    return IndexService.absolute(worktree, symbols(index, files, query, undefined, kinds));
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
