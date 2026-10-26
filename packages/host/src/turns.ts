// An agent's turns, kept as snapshots of the worktree: one when a prompt is sent, one when the turn
// ends, so what the turn changed is the difference between them, whoever else touched the files.
// A snapshot is a commit of every file git doesn't ignore, made through a copy of the worktree's
// index (the real one, and so what's staged, is untouched), and kept by a ref in the worktree's own
// namespace (refs/worktree/), so git keeps it and other worktrees don't see it.

import { copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Git } from './git.js';

/** Where a worktree's turns are kept, a ref each. */
export const TURNS = 'refs/worktree/cerebro/turns/';

/** Snapshots are commits; git wants a name for them, whoever the user is. */
const IDENTITY = ['-c', 'user.name=Cerebro', '-c', 'user.email=cerebro@localhost'];

/** The longest prompt kept with a turn, in characters. */
const PROMPT_LIMIT = 200;

export interface Turn {
  /** The turn's ref, under TURNS. */
  id: string;
  /** The snapshots before and after it. */
  start: string;
  end: string;
  /** The prompt that started it, cut short. */
  prompt: string;
  /** When it ended, in milliseconds. */
  time: number;
}

let indexes = 0;

/** A commit of the worktree's files as they are, after `parent` (if any). */
export async function snapshot(
  worktree: string,
  parent: string | undefined,
  message: string,
  run: Git,
): Promise<string> {
  const index = resolve(
    worktree,
    (await run(worktree, ['rev-parse', '--git-path', 'index'])).trim(),
  );
  const temp = join(tmpdir(), `cerebro-index-${String(process.pid)}-${String(++indexes)}`);
  // A repository with nothing added yet has no index: the copy starts empty.
  await copyFile(index, temp).catch(() => undefined);
  try {
    const env = { GIT_INDEX_FILE: temp };
    await run(worktree, ['add', '--all'], env);
    const tree = (await run(worktree, ['write-tree'], env)).trim();
    const parents = parent === undefined ? [] : ['-p', parent];
    return (
      await run(worktree, [...IDENTITY, 'commit-tree', tree, ...parents, '-m', message])
    ).trim();
  } finally {
    await rm(temp, { force: true });
  }
}

/** The worktree's last commit; undefined before the first. */
async function head(worktree: string, run: Git): Promise<string | undefined> {
  try {
    return (await run(worktree, ['rev-parse', '--verify', 'HEAD'])).trim();
  } catch {
    return undefined;
  }
}

/** The worktree's turns, the latest first. */
export async function listTurns(worktree: string, run: Git): Promise<Turn[]> {
  const output = await run(worktree, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(parent)%09%(subject)',
    TURNS,
  ]);
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, end, start, subject] = line.split('\t') as [string, string, string, string];
      const id = ref.slice(TURNS.length);
      let prompt = '';
      try {
        prompt = (JSON.parse(subject) as { prompt?: string }).prompt ?? '';
      } catch {
        // Not one of ours: no prompt to show.
      }
      return { id, start, end, prompt, time: Number(id.split('-')[0]) };
    })
    .sort((a, b) => b.time - a.time);
}

/** Records each agent's turns: a snapshot when it's sent a prompt, another when it's done. */
export class TurnRecorder {
  /** Each agent's turn under way: its snapshot is taken, or being taken, by its queue. */
  private readonly starts = new Map<
    string,
    { worktree: string; commit: Promise<string>; prompt: string }
  >();
  /** Each worktree's snapshots, one after the other. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private count = 0;

  constructor(
    private readonly run: Git,
    private readonly now: () => number = Date.now,
  ) {}

  /** The agent `key`, in `worktree`, was sent `prompt`. */
  started(key: string, worktree: string, prompt: string): Promise<void> {
    const commit = this.queue(worktree, async () =>
      snapshot(worktree, await head(worktree, this.run), 'Cerebro: before a turn', this.run),
    );
    // Known at once, so a turn that ends before its snapshot is taken is still kept.
    this.starts.set(key, { worktree, commit, prompt: prompt.slice(0, PROMPT_LIMIT) });
    return commit.then(() => undefined);
  }

  /** The agent `key` is done with its turn: kept, if it was seen starting. */
  ended(key: string): Promise<void> {
    const start = this.starts.get(key);
    if (!start) return Promise.resolve();
    this.starts.delete(key);
    return this.queue(start.worktree, async () => {
      const message = JSON.stringify({ prompt: start.prompt });
      const end = await snapshot(start.worktree, await start.commit, message, this.run);
      const id = `${String(this.now())}-${String(++this.count)}`;
      await this.run(start.worktree, ['update-ref', `${TURNS}${id}`, end]);
    });
  }

  private queue<T>(worktree: string, task: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(worktree) ?? Promise.resolve()).then(task);
    // A failed snapshot doesn't stop the next.
    this.queues.set(
      worktree,
      next.catch(() => undefined),
    );
    return next;
  }
}
