// The Log's Cherry-Pick, as IntelliJ's (`VcsCherryPickAction`, `GitCherryPickProcess`,
// `GitApplyChangesProcess`, `GitCherryPickContinueProcess`, their words from `GitBundle`): the
// selected commit, or the one right-clicked, picked onto HEAD. Its changes already here, it's
// skipped; at conflicts, the Conflicts dialog, then the pick committed; with some left, "Cherry-pick
// was performed with conflicts", with Resolve… and Abort. While one is under way, the Git menu has
// Continue Cherry-Pick (once no file is in conflict) and Abort Cherry-Pick.

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

/** The host's `git.cherryPick` and `git.continueCherryPick`. */
type Picked = 'picked' | 'empty' | 'conflicts';

/** A commit as IntelliJ's notifications name it (`commitDetails`): its short hash and subject. */
interface Named {
  hash: string;
  subject: string;
}

const details = (commit: Named) => `${commit.hash.slice(0, 8)} ${commit.subject}`;

/** The worktree a pick is under way in: Cherry-Pick is off there until it's done. */
const picking = signal<string | undefined>(undefined);

/**
 * Says how a pick went, as IntelliJ's; at conflicts, the Conflicts dialog, then on (`git cherry-pick
 * --continue`) once none is left.
 */
async function goOn(host: Host, worktree: string, result: Picked, commit?: Named): Promise<void> {
  let picked = result;
  while (picked === 'conflicts' && (await resolveConflicts(worktree))) {
    picked = (await host.request('git.continueCherryPick', { path: worktree })) as Picked;
  }
  if (picked === 'picked') {
    notifications.notify({
      title: 'Cherry-pick successful',
      ...(commit ? { content: details(commit) } : {}),
    });
  } else if (picked === 'empty') {
    notifications.notify({
      title: 'Nothing to cherry-pick',
      content: commit
        ? `All changes from ${commit.hash.slice(0, 8)} have already been applied`
        : 'Empty commit skipped (git cherry-pick --skip)',
      type: 'warning',
    });
  } else {
    notifications.notify({
      title: 'Cherry-pick was performed with conflicts',
      content: `${commit ? `${details(commit)}\n` : ''}There are unresolved conflicts in the working tree.`,
      type: 'warning',
      display: 'sticky',
      actions: [
        {
          label: 'Resolve…',
          run: () => void resolveConflicts(worktree).then(() => refreshAll(worktree)),
        },
        { label: 'Abort Cherry-pick', run: () => void abort(host, worktree, 'cherry-pick') },
      ],
    });
  }
}

/** Says why git wouldn't, in IntelliJ's words where it has its own. */
function failed(error: Error, commit: Named): void {
  const message = error.message;
  const untracked = /untracked working tree files would be overwritten/.test(message);
  const local =
    !untracked && /local changes to the following files would be overwritten/.test(message);
  const about = `${details(commit)}\n`;
  notifications.notify({
    title: untracked ? 'Untracked Files Prevent Cherry-pick' : 'Cherry-pick failed',
    content: local
      ? `${about}Your local changes will be overwritten by cherry-pick.\nCommit, stash, or revert them to proceed.`
      : `${about}${message}`,
    type: 'error',
    display: 'sticky',
  });
}

/** Picks `at`'s commit onto HEAD, and says how it went. */
async function cherryPick(at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  picking.set(worktree);
  try {
    const result = (await host.request('git.cherryPick', {
      path: worktree,
      hash: commit.hash,
      protected: PROTECTED,
    })) as Picked;
    await goOn(host, worktree, result, commit);
  } catch (error) {
    failed(error as Error, commit);
  } finally {
    picking.set(undefined);
  }
  await Promise.all([at.refresh(), refreshAll(worktree)]).catch((error: unknown) => {
    console.error('Reading again after Cherry-Pick', error);
  });
}

/** IntelliJ's Continue Cherry-Pick, from the Git menu. */
async function continuePick(host: Host, worktree: string): Promise<void> {
  try {
    const result = (await host.request('git.continueCherryPick', { path: worktree })) as Picked;
    await goOn(host, worktree, result);
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

export function setupCherryPick(services: MenuServices): void {
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
      return at !== undefined && picking.get() !== at.worktree;
    },
    run: (context) => {
      const at = target(context);
      return at && cherryPick(at);
    },
  });
  // After Copy Revision Number (and Create Patch, which Cerebro hasn't), as IntelliJ's.
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.cherryPick' },
    group: 'a',
    order: 1,
  });
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
  // Last in IntelliJ's Git menu.
  for (const command of ['vcs.continueCherryPick', 'vcs.abortCherryPick']) {
    menus.contribute({ menu: 'main/git', item: { command }, group: 'd' });
  }
}
