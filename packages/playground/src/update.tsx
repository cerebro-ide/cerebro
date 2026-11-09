// Update Project, as IntelliJ's (Git → Update Project…, Ctrl+T): its dialog first, Merge or Rebase,
// with Don't show again (Version Control → Show options before update brings it back); then the
// host fetches the upstream's remote and merges or rebases, local changes in the way shelved or
// stashed meanwhile (Version Control → Git's settings). "Updating…" on the status bar meanwhile.
// How it went is a notification, in IntelliJ's words: "2 files updated in 1 commit", "Nothing to
// update", or why it couldn't. Conflicts are left to git, the Commit window showing the files.

import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
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
  | { kind: 'conflicts'; method: UpdateMethod; saved: boolean };

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

/** Says how an update went, as IntelliJ's notifications. */
function report(updated: Updated, saveChanges: 'shelve' | 'stash', viewSaved: () => void): void {
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
    case 'conflicts':
      if (updated.method === 'merge') {
        failed(
          'Cannot complete update',
          'Merge conflicts detected. Resolve them before continuing update.',
        );
      } else {
        failed(
          'Cannot continue rebase',
          'Merge conflicts detected. Resolve them before continuing rebase. Then you may continue rebase. You also may abort rebase to restore the original branch and stop rebasing.',
        );
      }
      if (updated.saved) notRestored();
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
    const updated = (await host.request('git.update', {
      path: worktree,
      method,
      save: saveChanges,
    })) as Updated;
    report(updated, saveChanges, () => {
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
