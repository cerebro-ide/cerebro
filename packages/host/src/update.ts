// Update Project, as IntelliJ's `GitUpdateProcess` (read from its source): the upstream's remote is
// fetched, then the upstream merged into the checked-out branch or the branch rebased on it. Local
// changes in the way are saved first (shelved or stashed, IntelliJ's Save changes) and put back
// after. At conflicts, the merge or rebase stays under way and what was saved stays saved, as
// IntelliJ leaves them while its Conflicts dialog is open: once they're resolved, `continueUpdate`
// carries on from where it stopped, as IntelliJ does when the dialog closes with none left.

import { continueOperation, operation } from './conflicts.js';
import { listChanges, type Change, type Git } from './git.js';
import { shelve, stash, unshelve, unstash } from './shelf.js';

/** How the branch takes the upstream's commits, as IntelliJ's Update Type. */
export type UpdateMethod = 'merge' | 'rebase';

/** Where local changes in the way go meanwhile, as IntelliJ's Save changes. */
export type SaveChanges = 'shelve' | 'stash';

/** How an update went. */
export type Updated =
  /** A merge or rebase under way, or files unmerged: IntelliJ doesn't update then. */
  | { kind: 'unfinished'; state: 'merge' | 'rebase' | 'unmerged' }
  | { kind: 'detached' }
  | { kind: 'noUpstream'; branch: string }
  /** The upstream has nothing the branch hasn't. */
  | { kind: 'nothing' }
  /**
   * Updated: the files it changed and the commits it brought, and HEAD before and after (View
   * Commits'); whether local changes saved were put back (true when none were saved).
   */
  | { kind: 'updated'; files: number; commits: number; range: HashRange; restored: boolean }
  /** Stopped at conflicts; local changes saved stay saved. */
  | { kind: 'conflicts'; method: UpdateMethod; saved: boolean; resume: Resume };

/**
 * HEAD before and after an update or a merge, as IntelliJ's `HashRange`: View Commits shows the
 * commits between (`start..end`).
 */
export interface HashRange {
  start: string;
  end: string;
}

/** Where local changes were saved: a shelf's id, or the newest stash. */
export type Saved = { how: 'shelve'; id: string } | { how: 'stash' };

/** What `continueUpdate` needs to carry on after conflicts: given back as the update gave it. */
export interface Resume {
  method: UpdateMethod;
  /** The commit before the update, and how many it brought. */
  before: string;
  commits: number;
  saved?: Saved;
}

/** The message local changes are saved under, as IntelliJ's (`stash.changes.message.with.date`). */
export function savedMessage(at: Date): string {
  return `Uncommitted changes before Update at ${at.toLocaleString()}`;
}

/** What stops an update before it starts, as IntelliJ's `isUpdateNotReady`. */
async function unfinished(
  worktree: string,
  run: Git,
): Promise<'merge' | 'rebase' | 'unmerged' | undefined> {
  const under = await operation(worktree, run);
  // A cherry-pick or revert under way stops it by its unmerged files alone, as IntelliJ's.
  if (under === 'merge' || under === 'rebase') return under;
  const unmerged = await run(worktree, ['diff', '--name-only', '--diff-filter=U']);
  return unmerged.trim() === '' ? undefined : 'unmerged';
}

/** Lines of git's output. */
const lines = (output: string) => output.split('\n').filter(Boolean);

/**
 * Whether local changes would be in the way, as IntelliJ's `isSaveNeeded`: always for a rebase; for
 * a merge, when the index has changes, or a file changed here was changed upstream too.
 */
async function inTheWay(
  worktree: string,
  method: UpdateMethod,
  changes: Change[],
  upstream: string,
  run: Git,
): Promise<boolean> {
  if (changes.length === 0) return false;
  if (method === 'rebase') return true;
  if (lines(await run(worktree, ['diff', '--cached', '--name-only'])).length > 0) return true;
  const changed = new Set(
    lines(await run(worktree, ['diff', '--name-only', `HEAD...${upstream}`])),
  );
  // A rename is in the index, so its old path needn't be looked at.
  return changes.some((c) => changed.has(c.path));
}

/** Saves the changes in the way. */
async function save(
  worktree: string,
  changes: Change[],
  how: SaveChanges,
  message: string,
  run: Git,
): Promise<Saved> {
  if (how === 'shelve') return { how, id: await shelve(worktree, changes, message, run) };
  await stash(worktree, message, { keepIndex: false, includeUntracked: false }, run);
  return { how };
}

/** Puts saved changes back; says whether it could. */
function restore(worktree: string, saved: Saved, run: Git): Promise<boolean> {
  return (
    saved.how === 'shelve'
      ? unshelve(worktree, saved.id, run)
      : unstash(worktree, 'stash@{0}', { pop: true, reinstateIndex: true }, run)
  ).then(
    () => true,
    () => false,
  );
}

/** What the update brought, the files it changed counted; and whether what was saved went back. */
async function updated(worktree: string, resume: Resume, run: Git): Promise<Updated> {
  const restored = resume.saved ? await restore(worktree, resume.saved, run) : true;
  const files = lines(await run(worktree, ['diff', '--name-only', `${resume.before}..HEAD`]));
  const range = { start: resume.before, end: (await run(worktree, ['rev-parse', 'HEAD'])).trim() };
  return { kind: 'updated', files: files.length, commits: resume.commits, range, restored };
}

/** Stopped at conflicts. */
const stopped = (resume: Resume): Updated => ({
  kind: 'conflicts',
  method: resume.method,
  saved: resume.saved !== undefined,
  resume,
});

/**
 * Updates the checked-out branch from its upstream, or from another remote branch (Pull's with
 * `--rebase`, as IntelliJ's); `remote` runs git's remote commands.
 */
export async function update(
  worktree: string,
  options: {
    method: UpdateMethod;
    save: SaveChanges;
    from?: { remote: string; branch: string };
    now?: Date;
  },
  run: Git,
  remote: Git,
): Promise<Updated> {
  const state = await unfinished(worktree, run);
  if (state) return { kind: 'unfinished', state };
  let branch: string;
  try {
    branch = (await run(worktree, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch {
    return { kind: 'detached' };
  }
  const upstreamRemote =
    options.from?.remote ??
    (
      await run(worktree, [
        'for-each-ref',
        '--format=%(upstream:remotename)',
        `refs/heads/${branch}`,
      ])
    ).trim();
  if (upstreamRemote === '') return { kind: 'noUpstream', branch };
  const upstream = options.from
    ? `refs/remotes/${options.from.remote}/${options.from.branch}`
    : '@{upstream}';
  // As IntelliJ's: the upstream's remote, all of it.
  await remote(worktree, ['fetch', '--quiet', '--end-of-options', upstreamRemote], {
    GIT_TERMINAL_PROMPT: '0',
  });
  const commits = Number(
    (await run(worktree, ['rev-list', '--count', `HEAD..${upstream}`])).trim(),
  );
  if (commits === 0) return { kind: 'nothing' };
  const resume: Resume = {
    method: options.method,
    before: (await run(worktree, ['rev-parse', 'HEAD'])).trim(),
    commits,
  };
  // Untracked files aren't local changes to IntelliJ: they stay where they are.
  const changes = (await listChanges(worktree, run)).filter((c) => c.status !== 'untracked');
  // A rebase with local changes tries a fast-forward first, which needs nothing saved
  // (IntelliJ's `tryFastForwardMergeForRebaseUpdaters`).
  if (
    options.method === 'rebase' &&
    changes.length > 0 &&
    (await run(worktree, ['merge', '--ff-only', upstream]).then(
      () => true,
      () => false,
    ))
  ) {
    return updated(worktree, resume, run);
  }
  if (await inTheWay(worktree, options.method, changes, upstream, run)) {
    const message = savedMessage(options.now ?? new Date());
    resume.saved = await save(worktree, changes, options.save, message, run);
  }
  try {
    await run(
      worktree,
      options.method === 'merge' ? ['merge', '--no-stat', '-v', upstream] : ['rebase', upstream],
    );
  } catch (error) {
    if ((await unfinished(worktree, run)) !== undefined) return stopped(resume);
    // Nothing changed (local changes or untracked files git won't overwrite): they go back.
    if (resume.saved) await restore(worktree, resume.saved, run);
    throw error;
  }
  return updated(worktree, resume, run);
}

/**
 * Carries on with an update once its conflicts are resolved: the merge committed or the rebase
 * continued (which may stop at more), then what was saved put back.
 */
export async function continueUpdate(worktree: string, resume: Resume, run: Git): Promise<Updated> {
  if ((await continueOperation(worktree, run)) === 'conflicts') return stopped(resume);
  return updated(worktree, resume, run);
}
