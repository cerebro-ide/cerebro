// The Log's Cherry-Pick and Revert Commit, as IntelliJ's (`VcsCherryPickAction`, `GitRevertAction`,
// `GitApplyChangesProcess` and its `GitCherryPickProcess` and `GitRevertProcess`,
// `GitCherryPickContinueProcess`, their words from `GitBundle`): a commit's changes applied onto
// HEAD, or undone. Already there (or undone), it's skipped; at conflicts, the Conflicts dialog, then
// the commit made; with some left, "Cherry-pick was performed with conflicts" (or Revert), with
// Resolve… and Abort. While a pick is under way, the Git menu has Continue Cherry-Pick (once no file
// is in conflict) and Abort Cherry-Pick; while a revert is, Abort Revert.

import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { resolveConflicts } from './conflicts.js';
import type { Host } from './environments.js';
import { selectedCommit, type LogCommitContext } from './git-log.js';
import { abort, registerDuring } from './merge-rebase.js';
import { notifications } from './notifications.js';
import { PROTECTED } from './push.js';
import { stateOf } from './repository-state.js';
import { refreshAll } from './shelf.js';

/** What applies a commit's changes: the host's. */
type Applying = 'cherry-pick' | 'revert';

/** The host's `git.cherryPick`, `git.revert` and `git.continueApplying`. */
type Applied = 'picked' | 'empty' | 'conflicts';

/** Each one's words, as IntelliJ's `operationName` and `appliedWord` make them. */
const WORDS: Record<Applying, { name: string; title: string; applied: string }> = {
  'cherry-pick': { name: 'cherry-pick', title: 'Cherry-pick', applied: 'applied' },
  revert: { name: 'revert', title: 'Revert', applied: 'reverted' },
};

/** A commit as IntelliJ's notifications name it (`commitDetails`): its short hash and subject. */
interface Named {
  hash: string;
  subject: string;
}

const details = (commit: Named) => `${commit.hash.slice(0, 8)} ${commit.subject}`;

/** The worktree one is under way in: Cherry-Pick and Revert Commit are off there until it's done. */
const applying = signal<string | undefined>(undefined);

/**
 * Says how it went, as IntelliJ's; at conflicts, the Conflicts dialog, then on (`--continue`) once
 * none is left.
 */
async function goOn(
  host: Host,
  worktree: string,
  how: Applying,
  result: Applied,
  commit?: Named,
): Promise<void> {
  const words = WORDS[how];
  let applied = result;
  while (applied === 'conflicts' && (await resolveConflicts(worktree))) {
    applied = (await host.request('git.continueApplying', {
      path: worktree,
      operation: how,
    })) as Applied;
  }
  if (applied === 'picked') {
    notifications.notify({
      title: `${words.title} successful`,
      ...(commit ? { content: details(commit) } : {}),
    });
  } else if (applied === 'empty') {
    notifications.notify({
      title: `Nothing to ${words.name}`,
      content: commit
        ? `All changes from ${commit.hash.slice(0, 8)} have already been ${words.applied}`
        : 'Empty commit skipped (git cherry-pick --skip)',
      type: 'warning',
    });
  } else {
    notifications.notify({
      title: `${words.title} was performed with conflicts`,
      content: `${commit ? `${details(commit)}\n` : ''}There are unresolved conflicts in the working tree.`,
      type: 'warning',
      display: 'sticky',
      actions: [
        {
          label: 'Resolve…',
          run: () => void resolveConflicts(worktree).then(() => refreshAll(worktree)),
        },
        { label: `Abort ${words.title}`, run: () => void abort(host, worktree, how) },
      ],
    });
  }
}

/** Says why git wouldn't, in IntelliJ's words where it has its own. */
function failed(how: Applying, error: Error, commit: Named): void {
  const words = WORDS[how];
  const message = error.message;
  const untracked = /untracked working tree files would be overwritten/.test(message);
  const local =
    !untracked && /local changes to the following files would be overwritten/.test(message);
  const about = `${details(commit)}\n`;
  notifications.notify({
    title: untracked ? `Untracked Files Prevent ${words.title}` : `${words.title} failed`,
    content: local
      ? `${about}Your local changes will be overwritten by ${words.name}.\nCommit, stash, or revert them to proceed.`
      : `${about}${message}`,
    type: 'error',
    display: 'sticky',
  });
}

/** Picks or reverts `at`'s commit, and says how it went. */
async function apply(how: Applying, at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  applying.set(worktree);
  try {
    const result = (await (how === 'cherry-pick'
      ? host.request('git.cherryPick', { path: worktree, hash: commit.hash, protected: PROTECTED })
      : host.request('git.revert', { path: worktree, hash: commit.hash }))) as Applied;
    await goOn(host, worktree, how, result, commit);
  } catch (error) {
    failed(how, error as Error, commit);
  } finally {
    applying.set(undefined);
  }
  await Promise.all([at.refresh(), refreshAll(worktree)]).catch((error: unknown) => {
    console.error(`Reading again after ${WORDS[how].title}`, error);
  });
}

/** IntelliJ's Continue Cherry-Pick, from the Git menu. */
async function continuePick(host: Host, worktree: string): Promise<void> {
  try {
    const result = (await host.request('git.continueApplying', {
      path: worktree,
      operation: 'cherry-pick',
    })) as Applied;
    await goOn(host, worktree, 'cherry-pick', result);
  } catch (error) {
    notifications.notify({
      title: 'Continue cherry-pick failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

export function setupApplyChanges(services: MenuServices): void {
  const { commands, menus } = services;
  /** The commit right-clicked, or from the toolbar, the one selected. */
  const target = (context: unknown) =>
    (context as Partial<LogCommitContext> | undefined)?.commit === undefined
      ? selectedCommit()
      : (context as LogCommitContext);
  commands.register({
    id: 'log.cherryPick',
    label: 'Cherry-Pick',
    icon: 'cherryPick',
    enabled: (context) => {
      const at = target(context);
      return at !== undefined && applying.get() !== at.worktree;
    },
    run: (context) => {
      const at = target(context);
      return at && apply('cherry-pick', at);
    },
  });
  // After Copy Revision Number (and Create Patch, which Cerebro hasn't), as IntelliJ's.
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.cherryPick' },
    group: 'a',
    order: 1,
  });
  // Off for a merge commit, as IntelliJ's ("Can't revert merge commit").
  commands.register<LogCommitContext>({
    id: 'log.revert',
    label: 'Revert Commit',
    // Asked with no commit, as Find Action asks each command: off.
    enabled: (at?: LogCommitContext) =>
      at !== undefined && at.commit.parents.length < 2 && applying.get() !== at.worktree,
    run: (at) => apply('revert', at),
  });
  // After Reset Current Branch to Here…, as IntelliJ's (Git.Log.ContextMenu).
  menus.contribute({ menu: 'log/commit', item: { command: 'log.revert' }, group: 'g', order: 1 });
  // Continue shows once no file is in conflict: until then, Resolve Conflicts… does.
  registerDuring(
    services,
    'vcs.continueCherryPick',
    'Continue Cherry-Pick',
    'cherry-pick',
    continuePick,
    (worktree) => !stateOf(worktree).conflicts,
  );
  registerDuring(services, 'vcs.abortCherryPick', 'Abort Cherry-Pick', 'cherry-pick', (h, w) =>
    abort(h, w, 'cherry-pick'),
  );
  registerDuring(services, 'vcs.abortRevert', 'Abort Revert', 'revert', (h, w) =>
    abort(h, w, 'revert'),
  );
  // Last in IntelliJ's Git menu: Abort Revert, then Cherry-Pick's.
  for (const command of ['vcs.abortRevert', 'vcs.continueCherryPick', 'vcs.abortCherryPick']) {
    menus.contribute({ menu: 'main/git', item: { command }, group: 'd' });
  }
}
