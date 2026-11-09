// Update Project, as IntelliJ's (Git → Update Project…, Ctrl+T): its dialog first, Merge or Rebase,
// with Don't show again (Version Control → Show options before update brings it back); then the
// host fetches the upstream's remote and merges or rebases, local changes in the way shelved or
// stashed meanwhile (Version Control → Git's settings). "Updating…" on the status bar meanwhile.
// How it went is a notification, in IntelliJ's words: "2 files updated in 1 commit", "Nothing to
// update", or why it couldn't. At conflicts, the Conflicts dialog shows; once none is left, the
// update carries on (the merge committed, the rebase continued), as IntelliJ's `GitConflictResolver`.
// Closed with some left, the notification's Resolve… shows the dialog again, carrying on no more.

import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { resolveConflicts } from './conflicts.js';
import { active, currentHost, gitRepository, hostFor } from './environments.js';
import { notifications } from './notifications.js';
import { globalSettings, save } from './settings.js';
import { refreshAll } from './shelf.js';

type UpdateMethod = 'merge' | 'rebase';

/** How an update went: the host's `git.update`. */
type Updated =
  | { kind: 'unfinished'; state: 'merge' | 'rebase' | 'unmerged' }
  | { kind: 'detached' }
  | { kind: 'noUpstream'; branch: string }
  | { kind: 'nothing' }
  | { kind: 'updated'; files: number; commits: number; restored: boolean }
  | { kind: 'conflicts'; method: UpdateMethod; saved: boolean; resume: unknown };

/** While an update runs. */
export const updating = signal(false);

/** The app's commands, for View saved changes…: given by `setupUpdate`. */
let commands: MenuServices['commands'];

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** IntelliJ's words for what stopped an update before it started. */
const UNFINISHED = {
  merge: 'You have unfinished merge. These conflicts must be resolved before update.',
  rebase: 'You have unfinished rebase process. These conflicts must be resolved before update.',
  unmerged: 'Unmerged files detected. These conflicts must be resolved before update.',
} as const;

/** Asks how to update, as IntelliJ's Update Project dialog; undefined when cancelled. */
async function askMethod(): Promise<UpdateMethod | undefined> {
  const method = signal(globalSettings.get('git.updateMethod') as UpdateMethod);
  const silent = signal(false);
  const chosen = await openDialog<UpdateMethod>({
    title: 'Update Project',
    width: 400,
    ok: { accept: () => method.peek() },
    footer: () => (
      <label class="playground-rollback__option">
        <input
          type="checkbox"
          on:change={(event) => {
            silent.set((event.currentTarget as HTMLInputElement).checked);
          }}
        />
        Don't show again
      </label>
    ),
    content: () => (
      <div role="radiogroup" aria-label="Update method">
        {(['merge', 'rebase'] as const).map((value) => (
          <label class="playground-rollback__option">
            <input
              type="radio"
              name="update-method"
              checked={() => method.get() === value}
              on:change={() => {
                method.set(value);
              }}
            />
            {value === 'merge' ? 'Merge' : 'Rebase'}
          </label>
        ))}
      </div>
    ),
  }).result;
  if (chosen === undefined) return undefined;
  // Kept, as IntelliJ's dialog keeps it in the settings.
  globalSettings.layers.global.set('git.updateMethod', chosen);
  if (silent.peek()) globalSettings.layers.global.set('vcs.showUpdateOptions', false);
  save(globalSettings, ['global']);
  return chosen;
}

/** What the Conflicts dialog says over the list during an update, as IntelliJ's. */
const DURING = {
  merge: 'Merge conflicts detected. Resolve them before continuing update.',
  rebase: 'Merge conflicts detected. Resolve them before continuing rebase.',
} as const;

/** Says how an update went, as IntelliJ's notifications. */
function report(
  worktree: string,
  updated: Updated,
  saveChanges: 'shelve' | 'stash',
  viewSaved: () => void,
): void {
  const notify = notifications.notify.bind(notifications);
  const failed = (title: string, content: string) => {
    notify({ title, content, type: 'error', display: 'sticky', group: 'update' });
  };
  /** IntelliJ's, when what was saved stays saved. */
  const notRestored = () => {
    notify({
      title: 'Local changes were not restored',
      content: `Before update your uncommitted changes were saved to ${saveChanges === 'shelve' ? 'shelf' : 'stash'}.`,
      type: 'warning',
      display: 'sticky',
      actions: [{ label: 'View saved changes…', run: viewSaved }],
    });
  };
  switch (updated.kind) {
    case 'unfinished':
      failed('Cannot update', UNFINISHED[updated.state]);
      return;
    case 'detached':
      failed(
        'Cannot Update: No Current Branch',
        "You are in the 'detached HEAD' state, which means that you're not on any branch. Checkout a branch to be able to update the project.",
      );
      return;
    case 'noUpstream':
      failed('Cannot update', `${updated.branch} has no tracked branch`);
      return;
    case 'nothing':
      notify({ title: 'Nothing to update', type: 'warning', group: 'update' });
      return;
    case 'updated':
      notify({
        title: `${plural(updated.files, 'file')} updated in ${plural(updated.commits, 'commit')}`,
        group: 'update',
      });
      if (!updated.restored) notRestored();
      return;
    case 'conflicts': {
      // IntelliJ's `notifyUnresolvedRemain`, its Resolve… showing the dialog again.
      const pending = 'There are pending unresolved conflicts.';
      notify({
        ...(updated.method === 'merge'
          ? { title: 'Cannot complete update', content: pending }
          : {
              title: 'Cannot continue rebase',
              content: `${pending} Then you may continue rebase. You also may abort rebase to restore the original branch and stop rebasing.`,
            }),
        type: 'warning',
        display: 'sticky',
        group: 'update',
        actions: [
          {
            label: 'Resolve…',
            run: () => {
              void resolveConflicts(worktree)
                .then(() => refreshAll(worktree))
                .catch((error: unknown) => {
                  console.error('Resolving the conflicts failed', error);
                });
            },
          },
        ],
      });
      if (updated.saved) notRestored();
    }
  }
}

/**
 * Updates a worktree's branch from its upstream, after the Update Project dialog while Show options
 * before update is on.
 */
export async function updateProject(worktree: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host || updating.peek()) return;
  const method =
    globalSettings.get('vcs.showUpdateOptions') === false
      ? (globalSettings.get('git.updateMethod') as UpdateMethod)
      : await askMethod();
  if (method === undefined) return;
  const saveChanges = globalSettings.get('git.saveChanges') as 'shelve' | 'stash';
  updating.set(true);
  try {
    let updated = (await host.request('git.update', {
      path: worktree,
      method,
      save: saveChanges,
    })) as Updated;
    // At conflicts, the dialog; with none left, on to the next stop, or the end.
    while (
      updated.kind === 'conflicts' &&
      (await resolveConflicts(worktree, DURING[updated.method]))
    ) {
      updated = (await host.request('git.continueUpdate', {
        path: worktree,
        resume: updated.resume,
      })) as Updated;
    }
    report(worktree, updated, saveChanges, () => {
      commands.execute(saveChanges === 'shelve' ? 'vcs.showShelf' : 'vcs.showStash');
    });
  } catch (error) {
    // Git's words: the fetch failed, or the merge or rebase couldn't start.
    notifications.notify({
      title: 'Update failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
      group: 'update',
    });
  } finally {
    updating.set(false);
  }
  // What the update changed, and what it saved, in the Commit window.
  await refreshAll(worktree);
}

/** Git → Update Project…, with IntelliJ's Ctrl+T. */
export function setupUpdate(services: MenuServices): void {
  const { menus, keymap } = services;
  commands = services.commands;
  commands.register({
    id: 'vcs.update',
    label: 'Update Project',
    icon: 'update',
    dialog: true,
    enabled: () =>
      active() !== undefined &&
      currentHost() !== undefined &&
      gitRepository.get() &&
      !updating.get(),
    run: () =>
      updateProject((active() as NonNullable<ReturnType<typeof active>>).id).catch(
        (error: unknown) => {
          console.error('Updating the project failed', error);
        },
      ),
  });
  keymap?.bindDefault('Mod+T', 'vcs.update');
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.update' }, group: 'a', order: 2 });
}
