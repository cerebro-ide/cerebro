// The Git menu's actions during a merge or a rebase, as IntelliJ's (`GitMergeCommitAction`,
// `GitAbortOperationAction`, `GitRebaseContinue`, `GitRebaseAbort`, `GitRebaseSkip`,
// `GitRebaseProcess`, `GitAbortRebaseProcess`, their words from `GitBundle`): after Merge, Commit
// Merge (once no file is in conflict) and Abort Merge; after Rebase, its menu: Abort Rebase,
// Continue Rebase and Skip Commit. Each shows only while its operation is under way.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { resolveConflicts, type Conflicts } from './conflicts.js';
import { active, currentHost, type Host } from './environments.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { refreshAll } from './shelf.js';

type Operation = 'merge' | 'rebase';

/** IntelliJ's confirmation before aborting: Abort, or Cancel. */
async function confirmAbort(title: string, message: string): Promise<boolean> {
  const yes = await openDialog<true>({
    title,
    width: 420,
    ok: { label: 'Abort', accept: () => true },
    content: () => <p class="playground-abort">{message}</p>,
  }).result;
  return yes === true;
}

/** IntelliJ's Abort Merge and Abort Rebase: asks, then `git merge|rebase --abort`. */
async function abort(host: Host, worktree: string, operation: Operation): Promise<void> {
  const asked =
    operation === 'merge'
      ? await confirmAbort('Abort Merge', 'Abort merge?')
      : await confirmAbort(
          'Abort Rebase',
          `Abort rebase in ${worktree.split(/[\\/]/).at(-1) as string}?`,
        );
  if (!asked) return;
  try {
    await host.request('git.abort', { path: worktree, operation });
    notifications.notify({
      content: operation === 'merge' ? 'Merge abort succeeded' : 'Abort rebase succeeded',
    });
  } catch (error) {
    notifications.notify({
      title: operation === 'merge' ? 'Merge abort failed' : 'Abort rebase failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/** IntelliJ's Commit Merge: the merge committed with git's message. */
async function commitMerge(host: Host, worktree: string): Promise<void> {
  try {
    await host.request('git.continue', { path: worktree });
  } catch (error) {
    notifications.notify({
      title: 'Merge commit failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/**
 * IntelliJ's Continue Rebase and Skip Commit, as its `GitRebaseProcess`: at conflicts, the Conflicts
 * dialog, then on once none is left; if some are, "Rebase stopped due to conflicts", with Resolve…,
 * Continue and Abort; at the end, "Rebase successful".
 */
async function continueRebase(host: Host, worktree: string, skip = false): Promise<void> {
  try {
    // The branch rebased, as git keeps it while the rebase is under way.
    const { yours } = (await host.request('git.conflicts', { path: worktree })) as Conflicts;
    let stopped =
      (await host.request(skip ? 'git.skipCommit' : 'git.continue', { path: worktree })) ===
      'conflicts';
    while (stopped && (await resolveConflicts(worktree))) {
      stopped = (await host.request('git.continue', { path: worktree })) === 'conflicts';
    }
    if (stopped) {
      notifications.notify({
        title: 'Rebase stopped due to conflicts',
        type: 'warning',
        display: 'sticky',
        actions: [
          { label: 'Resolve…', run: () => void resolveAndContinue(host, worktree) },
          { label: 'Continue', run: () => void continueRebase(host, worktree) },
          { label: 'Abort', run: () => void abort(host, worktree, 'rebase') },
        ],
      });
    } else {
      notifications.notify({
        title: 'Rebase successful',
        content: yours === undefined ? 'Rebased' : `Rebased ${yours}`,
      });
    }
  } catch (error) {
    notifications.notify({
      title: 'Continue rebase failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/** The stopped notification's Resolve…: the dialog, then on if none is left. */
async function resolveAndContinue(host: Host, worktree: string): Promise<void> {
  if (await resolveConflicts(worktree)) await continueRebase(host, worktree);
  else await refreshAll(worktree);
}

/** Git's actions for a merge or a rebase under way, as IntelliJ's, in its Git menu. */
export function setupMergeRebase(services: MenuServices): void {
  const { commands, menus } = services;
  /** The active worktree, and its host, while `operation` is under way in it. */
  const during = (operation: Operation) => {
    const env = active();
    const host = currentHost();
    return env && host && stateOf(env.id).operation === operation
      ? { worktree: env.id, host }
      : undefined;
  };
  const register = (
    id: string,
    label: string,
    operation: Operation,
    run: (host: Host, worktree: string) => Promise<void>,
    shows: (worktree: string) => boolean = () => true,
  ) => {
    commands.register({
      id,
      label,
      visible: () => {
        const under = during(operation);
        return under !== undefined && shows(under.worktree);
      },
      run: () => {
        const under = during(operation);
        // What git says is in a notification: what fails besides (reading the lists after) is logged.
        return under === undefined
          ? undefined
          : run(under.host, under.worktree).catch((error: unknown) => {
              console.error(`${label} failed`, error);
            });
      },
    });
  };
  // Commit Merge shows once no file is in conflict: until then, Resolve Conflicts… does.
  register('vcs.commitMerge', 'Commit Merge', 'merge', commitMerge, (w) => !stateOf(w).conflicts);
  register('vcs.abortMerge', 'Abort Merge', 'merge', (h, w) => abort(h, w, 'merge'));
  register('vcs.abortRebase', 'Abort Rebase', 'rebase', (h, w) => abort(h, w, 'rebase'));
  register('vcs.continueRebase', 'Continue Rebase', 'rebase', (h, w) => continueRebase(h, w));
  register('vcs.skipCommit', 'Skip Commit', 'rebase', (h, w) => continueRebase(h, w, true));
  // IntelliJ's second group: Merge's actions, then the Rebase menu, then Resolve Conflicts….
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.commitMerge' }, group: 'am' });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.abortMerge' }, group: 'am' });
  menus.contribute({
    menu: 'main/git',
    item: { submenu: 'main/git/rebase', label: '&Rebase' },
    group: 'am',
  });
  for (const command of ['vcs.abortRebase', 'vcs.continueRebase', 'vcs.skipCommit']) {
    menus.contribute({ menu: 'main/git/rebase', item: { command } });
  }
}
