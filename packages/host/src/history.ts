// Local History, as IntelliJ's: the worktree's files as they were, recorded as they change, with
// what changed them, to compare with and revert to; whatever git does or doesn't have.
//
// Each record is a snapshot of the worktree (turns.ts's: every file git doesn't ignore, made
// through a copy of the index), after the one before it, so the records are a chain of commits
// kept by one ref in the worktree's own namespace, and a file's history is `git log` of it. A
// record is made only when something changed since the last, except a label put by the user.
// Records are made one after another, per worktree.

import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { Git } from './git.js';
import { snapshot } from './turns.js';

/** The worktree's latest record; each after the one before it. */
export const HISTORY = 'refs/worktree/cerebro/history';

/** A file's version, as recorded. */
export interface Revision {
  /** The record's commit. */
  commit: string;
  /** When it was recorded, in milliseconds. */
  time: number;
  /** What made it ("Rollback", "External change", a label the user put); empty for a save. */
  label: string;
  /** Whether the user put the label: it's in every file's history. */
  put: boolean;
}

/** Paths as they are, not patterns: a file named `*.ts` is just that file. */
const LITERAL = { GIT_LITERAL_PATHSPECS: '1' };

/** Each worktree's records under way, one after another. */
const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after the worktree's records under way. */
function queued<T>(worktree: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(worktree) ?? Promise.resolve()).then(task, task);
  queues.set(
    worktree,
    next.catch(() => undefined),
  );
  return next;
}

/** The worktree's latest record; undefined before the first. */
async function latest(worktree: string, run: Git): Promise<string | undefined> {
  try {
    return (await run(worktree, ['rev-parse', '--verify', '--quiet', HISTORY])).trim();
  } catch {
    return undefined;
  }
}

/**
 * Records the worktree's files as they are, labelled: only if they changed since the last record,
 * unless `always` (a label the user puts). The first record is the files as they were found, with
 * no label but the user's. Resolves with the record's commit, or undefined if none was made.
 */
export function record(
  worktree: string,
  label: string,
  run: Git,
  options: { always?: boolean; now?: () => number } = {},
): Promise<string | undefined> {
  return queued(worktree, async () => {
    const last = await latest(worktree, run);
    const time = (options.now ?? Date.now)();
    const put = options.always === true;
    const message = { label: last === undefined && !put ? '' : label, time, put };
    const commit = await snapshot(worktree, last, JSON.stringify(message), run);
    if (last !== undefined && !put) {
      const [now, before] = (
        await run(worktree, ['rev-parse', `${commit}^{tree}`, `${last}^{tree}`])
      )
        .trim()
        .split('\n');
      if (now === before) return undefined;
    }
    await run(worktree, ['update-ref', HISTORY, commit]);
    return commit;
  });
}

/**
 * Records what Cerebro's about to change, if it changed outside Cerebro since the last record,
 * then the change itself. A record that fails (not a git repository) doesn't stop the change.
 */
export async function recording<T>(
  worktree: string,
  label: string,
  run: Git,
  change: () => Promise<T>,
): Promise<T> {
  const quietly = (label: string) => record(worktree, label, run).catch(() => undefined);
  await quietly('External change');
  const result = await change();
  await quietly(label);
  return result;
}

/**
 * A file's versions, the latest first: the records in which it changed, and the labels the user
 * put, as IntelliJ shows them.
 */
export async function fileHistory(worktree: string, path: string, run: Git): Promise<Revision[]> {
  if ((await latest(worktree, run)) === undefined) return [];
  const [all, changed] = await Promise.all([
    run(worktree, ['log', '-z', '--format=%H%x1f%s', HISTORY]),
    run(worktree, ['log', '--format=%H', HISTORY, '--', path], LITERAL),
  ]);
  const changes = new Set(changed.split('\n'));
  return all
    .split('\0')
    .filter(Boolean)
    .map((entry): Revision => {
      const [commit, subject] = entry.split('\x1f') as [string, string];
      const { label, time, put } = JSON.parse(subject) as Omit<Revision, 'commit'>;
      return { commit, time, label, put };
    })
    .filter((revision) => revision.put || changes.has(revision.commit));
}

/** A file's text in a record; undefined if it wasn't there. */
export async function textIn(
  worktree: string,
  commit: string,
  path: string,
  run: Git,
): Promise<string | undefined> {
  try {
    return await run(worktree, ['show', `${commit}:${path}`]);
  } catch {
    return undefined;
  }
}

/** Puts a file back as it was in a record, as IntelliJ's Revert: deleted if it wasn't there. */
export async function revert(
  worktree: string,
  path: string,
  commit: string,
  run: Git,
): Promise<void> {
  try {
    await run(worktree, ['cat-file', '-e', `${commit}:${path}`]);
  } catch {
    await rm(join(worktree, path), { force: true });
    return;
  }
  await run(worktree, ['restore', `--source=${commit}`, '--worktree', '--', path], LITERAL);
}
