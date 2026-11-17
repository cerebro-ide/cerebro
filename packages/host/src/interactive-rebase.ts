// The Log's Interactive Rebase from Here…, as IntelliJ's `GitInteractiveRebaseAction` (read from its
// source): the commits from the one chosen to HEAD, as git would list them, for the dialog; then
// `git rebase -i` with the dialog's list, given to git by its editors (`rebase-editor.ts`).
//
// IntelliJ reads the commits from its Log first (`GitInteractiveRebaseEntriesProvider`), and checks
// them against git's list when git asks for it; so does Cerebro, from `git log`. Where its Log can't
// give git's list (a fixup! commit git would move, or `rebase.updateRefs`), IntelliJ shows git's
// own instead; Cerebro's rebase turns both off (`--no-autosquash`, `rebase.updateRefs=false`), so
// its list is git's (Claude's choice, open to change).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { operation } from './conflicts.js';
import type { Git } from './git.js';
import type { RebasePlan, Reworded } from './rebase-editor.js';

/** A commit the rebase goes through. */
export interface RebaseCommit {
  hash: string;
  subject: string;
  /** Its whole message, as git keeps it. */
  message: string;
}

/** What's done with a commit: IntelliJ's actions, which make every list its dialog can (`Type`). */
export type RebaseAction = 'pick' | 'edit' | 'reword' | 'fixup' | 'drop';

/** A line of the list given to git; a reworded commit's new message with it. */
export interface RebaseEntry {
  action: RebaseAction;
  hash: string;
  message?: string;
}

/** How it went: done, or stopped under way, at conflicts or to edit a commit. */
export type InteractiveResult = 'done' | 'conflicts' | 'editing';

/** The commit a rebase from `hash` goes onto: its first parent, or none for the first commit. */
async function baseOf(worktree: string, hash: string, run: Git): Promise<string | undefined> {
  const [, parent] = (await run(worktree, ['rev-list', '--parents', '-n', '1', hash]))
    .trim()
    .split(' ');
  return parent;
}

/**
 * The commits from `hash` to HEAD, the oldest first, as `git rebase -i` lists them: merges left
 * out, as git leaves them out (`--no-merges`, `--topo-order`, its sequencer's walk).
 */
export async function rebaseCommits(
  worktree: string,
  hash: string,
  run: Git,
): Promise<RebaseCommit[]> {
  const base = await baseOf(worktree, hash, run);
  const out = await run(worktree, [
    'log',
    '--reverse',
    '--no-merges',
    '--topo-order',
    '--format=%x00%H%x00%s%x00%B',
    base === undefined ? 'HEAD' : `${base}..HEAD`,
  ]);
  const fields = out.split('\0').slice(1);
  const commits: RebaseCommit[] = [];
  for (let i = 0; i < fields.length; i += 3) {
    commits.push({
      hash: fields[i] as string,
      subject: fields[i + 1] as string,
      // The line `log` ends each commit with taken off.
      message: (fields[i + 2] as string).replace(/\n$/, ''),
    });
  }
  return commits;
}

/**
 * Rebases from `hash` with `entries` (IntelliJ's `GitRebaseParams.editCommits`), local changes
 * stashed and put back (`--autostash`), as Cerebro's other rebases. `expected` is the list the
 * dialog showed: git's must be the same, or nothing's done and git's words say so. `editor` is the
 * command git runs as its editors, `sequence` or `message` and a file after it.
 */
export async function interactiveRebase(
  worktree: string,
  hash: string,
  expected: readonly string[],
  entries: readonly RebaseEntry[],
  editor: string,
  run: Git,
): Promise<InteractiveResult> {
  const base = await baseOf(worktree, hash, run);
  const messages: Reworded[] = [];
  for (const entry of entries) {
    if (entry.action !== 'reword' || entry.message === undefined) continue;
    const original = await run(worktree, ['show', '-s', '--format=%B', entry.hash]);
    messages.push({ original: original.replace(/\n$/, ''), reworded: entry.message });
  }
  const plan: RebasePlan = {
    expected: [...expected],
    todo: entries.map((entry) => `${entry.action} ${entry.hash}\n`).join(''),
    messages,
  };
  const folder = mkdtempSync(join(tmpdir(), 'cerebro-rebase-'));
  const planFile = join(folder, 'plan.json');
  writeFileSync(planFile, JSON.stringify(plan));
  const gitDir = (await run(worktree, ['rev-parse', '--absolute-git-dir'])).trim();
  try {
    await run(
      worktree,
      [
        '-c',
        'rebase.updateRefs=false',
        'rebase',
        '--interactive',
        '--autostash',
        '--no-autosquash',
        base ?? '--root',
      ],
      {
        GIT_SEQUENCE_EDITOR: `${editor} sequence`,
        GIT_EDITOR: `${editor} message`,
        CEREBRO_REBASE_PLAN: planFile,
        CEREBRO_GIT_DIR: gitDir,
      },
    );
  } catch (error) {
    // Stopped at conflicts: under way. Anything else changed nothing, and says why in git's words.
    if ((await operation(worktree, run)) !== undefined) return 'conflicts';
    throw error;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  // Stopped to edit a commit: git ends well, the rebase under way.
  return (await operation(worktree, run)) === undefined ? 'done' : 'editing';
}
