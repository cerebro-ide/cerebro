// Git → Reset HEAD…, as IntelliJ's (`GitResetHead`, `GitResetDialog`, their words in `GitBundle`,
// read from its source): the dialog "Reset Head" with the current branch, Reset Type (Mixed, Soft
// or Hard) and To Commit (HEAD when empty) with Validate; then `git reset`, "Resetting HEAD…" on the
// status bar while it runs.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { active, hostFor, type Host } from './environments.js';
import { currentBranchRow, revisionField } from './git-fields.js';
import { notifications } from './notifications.js';
import { refreshAll } from './shelf.js';

type ResetMode = 'mixed' | 'soft' | 'hard';

/** IntelliJ's modes, in its order, by their names there. */
const MODES: [ResetMode, string][] = [
  ['mixed', 'Mixed'],
  ['soft', 'Soft'],
  ['hard', 'Hard'],
];

/** A reset under way, as IntelliJ's background task "Resetting HEAD…". */
export const resetting = signal(false);

interface Reset {
  mode: ResetMode;
  commit?: string;
}

/** The dialog; what it chose, or undefined if cancelled. */
function resetDialog(host: Host, worktree: string): Promise<Reset | undefined> {
  const mode = signal<ResetMode>('mixed');
  const commit = revisionField(host, worktree, 'To Commit:', {
    field: 'The commit that will become the current HEAD\n as result of reset operation.',
  });
  return openDialog<Reset>({
    title: 'Reset Head',
    width: 500,
    ok: {
      label: 'Reset',
      // Cerebro's: IntelliJ's dialog means to turn Reset off too, but goes on to turn it back on
      // (`validateFields` has no return after the error; read from its source).
      enabled: () => !commit.invalid(),
      accept: () => {
        const to = commit.value();
        return { mode: mode.peek(), ...(to === '' ? {} : { commit: to }) };
      },
    },
    content: () => (
      <div class="playground-form">
        {currentBranchRow(worktree)}
        <label class="playground-form__row">
          <span>Reset Type:</span>
          <select
            class="playground-reset__type"
            title={
              'The reset type (see also git reset man page):\n' +
              '• Mixed resets index but not working tree\n' +
              '• Soft leaves index and working tree, just moves head pointer\n' +
              '• Hard resets index and working tree. Changes in the working tree will be lost'
            }
            on:change={(event) => {
              mode.set((event.currentTarget as HTMLSelectElement).value as ResetMode);
            }}
          >
            {MODES.map(([value, label]) => (
              <option value={value}>{label}</option>
            ))}
          </select>
        </label>
        {commit.row()}
        <span class="cerebro-dialog-field__error playground-form__error" role="alert">
          {() =>
            commit.invalid() ? 'The specified commit expression did not pass validation.' : ''
          }
        </span>
      </div>
    ),
  }).result;
}

/** Git → Reset HEAD…: the dialog, then the active worktree's branch reset. */
export function setupReset(services: MenuServices): void {
  const { commands, menus } = services;
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host ? { worktree: env.id, host } : undefined;
  };
  commands.register({
    id: 'git.reset',
    label: 'Reset HEAD',
    dialog: true,
    enabled: () => target() !== undefined && !resetting.get(),
    run: async () => {
      const { worktree, host } = target() as { worktree: string; host: Host };
      const reset = await resetDialog(host, worktree);
      if (!reset) return;
      resetting.set(true);
      try {
        await host.request('git.reset', { path: worktree, ...reset });
      } catch (error) {
        // As IntelliJ's: titled by the task, git's words under it; nothing said when it works.
        notifications.notify({
          title: 'Resetting HEAD…',
          content: (error as Error).message,
          type: 'error',
          display: 'sticky',
        });
      } finally {
        resetting.set(false);
      }
      await refreshAll(worktree).catch((error: unknown) => {
        console.error('Reading again after Reset HEAD', error);
      });
    },
  });
  // IntelliJ's: after New Tag….
  menus.contribute({ menu: 'main/git', item: { command: 'git.reset' }, group: 'an', order: 4 });
}
