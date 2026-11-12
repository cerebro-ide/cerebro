// Git → Reset HEAD…, as IntelliJ's (`GitResetHead`, `GitResetDialog`, their words in `GitBundle`,
// read from its source): the dialog "Reset Head" with the current branch, Reset Type (Mixed, Soft
// or Hard) and To Commit (HEAD when empty) with Validate; then `git reset`, "Resetting HEAD…" on the
// status bar while it runs. And the Log's Reset Current Branch to Here… (`GitResetAction`,
// `GitNewResetDialog`, `GitResetOperation`): the dialog "Git Reset", the branch and the commit, and
// Soft, Mixed, Hard or Keep, the one chosen kept for next time; "Git Reset" while it runs. And its
// Undo Commit… (`GitUncommitAction`, `GitCommitEditingActionBase`): HEAD's commit taken back, its
// changes staged and its message in the Commit window, unless a protected branch on a remote has
// it. Cerebro has no changelists, so there's no "Select Target Changelist" dialog, as IntelliJ's
// without them.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { setCommitMessage } from './changes.js';
import { saveBeforeGit } from './documents.js';
import { active, hostFor, type Host } from './environments.js';
import { currentBranch, currentBranchRow, revisionField } from './git-fields.js';
import type { LogCommitContext } from './git-log.js';
import { shortenText } from './log-paths.js';
import { notifications } from './notifications.js';
import { PROTECTED } from './push.js';
import { refreshAll } from './shelf.js';

type ResetMode = 'mixed' | 'soft' | 'hard' | 'keep';

/** IntelliJ's modes, in its order, by their names there. */
const MODES: [ResetMode, string][] = [
  ['mixed', 'Mixed'],
  ['soft', 'Soft'],
  ['hard', 'Hard'],
];

/** A reset under way, by its background task's title: "Resetting HEAD…", or the Log's "Git Reset". */
export const resetting = signal<string | undefined>(undefined);

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

/** IntelliJ's `GitResetMode`, in its order: each name, and its comment's lines. */
const LOG_MODES: [ResetMode, string, string[]][] = [
  ['soft', 'Soft', ["Files won't change, differences will be staged for commit."]],
  ['mixed', 'Mixed', ["Files won't change, differences won't be staged."]],
  [
    'hard',
    'Hard',
    [
      'Files will be reverted to the state of the selected commit.',
      'Warning: any local changes will be lost.',
    ],
  ],
  [
    'keep',
    'Keep',
    [
      'Files will be reverted to the state of the selected commit,',
      'but local changes will be kept intact.',
    ],
  ],
];

/** Where the Log's mode chosen is kept, per repository, as IntelliJ's settings keep it per project. */
const modeKey = (worktree: string) => `cerebro.reset.mode:${worktree}`;

/** The mode chosen last in the repository; IntelliJ's default, Mixed, before. */
function keptMode(worktree: string): ResetMode {
  try {
    const kept = localStorage.getItem(modeKey(worktree));
    return LOG_MODES.find(([mode]) => mode === kept)?.[0] ?? 'mixed';
  } catch {
    return 'mixed';
  }
}

/** IntelliJ's Git Reset dialog: the mode chosen, kept for next time; undefined if cancelled. */
async function logResetDialog(context: LogCommitContext): Promise<ResetMode | undefined> {
  const { worktree, commit, head } = context;
  const mode = signal(keptMode(worktree));
  // IntelliJ's `getSourceText`: the branch, else HEAD with its hash.
  const source =
    currentBranch(worktree) ?? (head === undefined ? 'HEAD' : `HEAD (${head.slice(0, 8)})`);
  const chosen = await openDialog<ResetMode>({
    title: 'Git Reset',
    ok: { label: 'Reset', accept: () => mode.peek() },
    content: () => (
      <div class="playground-reset">
        <p>
          <b>{source}</b> -&gt; <b>{commit.hash.slice(0, 8)}</b> "{shortenText(commit.subject)}" by{' '}
          <code>{shortenText(commit.author)}</code>
        </p>
        <p>
          This will reset the current branch head to the selected commit,
          <br />
          and update the working tree and the index according to the selected mode:
        </p>
        <div role="radiogroup" aria-label="Reset mode">
          {LOG_MODES.map(([value, name, comment]) => (
            <div class="playground-reset__mode">
              <label class="playground-rollback__option">
                <input
                  type="radio"
                  name="reset-mode"
                  checked={() => mode.get() === value}
                  on:change={() => {
                    mode.set(value);
                  }}
                />
                {name}
              </label>
              <p class="playground-reset__comment">
                {comment.flatMap((line, i) => (i === 0 ? [line] : [<br />, line]))}
              </p>
            </div>
          ))}
        </div>
      </div>
    ),
  }).result;
  if (chosen === undefined) return undefined;
  try {
    localStorage.setItem(modeKey(worktree), chosen);
  } catch {
    // Not kept: the next time starts at Mixed.
  }
  return chosen;
}

/** IntelliJ's Undo Commit…: `at`'s commit, HEAD's, undone; or why it can't be. */
async function undoCommit(at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  resetting.set('Undoing Last Commit…');
  try {
    const pushed = (await host.request('git.undoCommit', {
      path: worktree,
      hash: commit.hash,
      protected: PROTECTED,
    })) as string | null;
    if (pushed !== null) {
      await openDialog({
        title: 'Cannot Undo Commit',
        cancelLabel: 'OK',
        content: () => <p>The commit is already pushed to protected branch '{pushed}'</p>,
      }).result;
      return;
    }
    notifications.notify({ title: 'Undo commit successful' });
    const body = commit.body.trimEnd();
    setCommitMessage(worktree, body === '' ? commit.subject : `${commit.subject}\n\n${body}`);
  } catch (error) {
    notifications.notify({
      title: 'Undo commit failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  } finally {
    resetting.set(undefined);
  }
  await Promise.all([at.refresh(), refreshAll(worktree)]).catch((error: unknown) => {
    console.error('Reading again after Undo Commit', error);
  });
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
    enabled: () => target() !== undefined && resetting.get() === undefined,
    run: async () => {
      const { worktree, host } = target() as { worktree: string; host: Host };
      const reset = await resetDialog(host, worktree);
      if (!reset) return;
      resetting.set('Resetting HEAD…');
      try {
        await saveBeforeGit();
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
        resetting.set(undefined);
      }
      await refreshAll(worktree).catch((error: unknown) => {
        console.error('Reading again after Reset HEAD', error);
      });
    },
  });

  // The Log's, on a commit: first in IntelliJ's Git group of the menu (Git.Log.ContextMenu).
  commands.register<LogCommitContext>({
    id: 'log.reset',
    label: 'Reset Current Branch to Here',
    dialog: true,
    enabled: () => resetting.get() === undefined,
    run: async (context) => {
      const { worktree, host, commit } = context;
      const mode = await logResetDialog(context);
      if (!mode) return;
      resetting.set('Git Reset');
      try {
        await saveBeforeGit();
        await host.request('git.reset', { path: worktree, mode, commit: commit.hash });
        notifications.notify({ title: 'Reset successful' });
      } catch (error) {
        notifications.notify({
          title: 'Reset failed',
          content: (error as Error).message,
          type: 'error',
          display: 'sticky',
        });
      } finally {
        resetting.set(undefined);
      }
      await Promise.all([context.refresh(), refreshAll(worktree)]).catch((error: unknown) => {
        console.error('Reading again after Git Reset', error);
      });
    },
  });
  menus.contribute({ menu: 'log/commit', item: { command: 'log.reset' }, group: 'g', order: 0 });
  // After Revert Commit, as IntelliJ's: only for HEAD's commit, not a merge's (IntelliJ's
  // `checkNotMergeCommit`) nor the first's, which has no parent to go back to (IntelliJ asks, then
  // takes its first parent: Claude's, open to change).
  commands.register<LogCommitContext>({
    id: 'log.undoCommit',
    label: 'Undo Commit',
    dialog: true,
    enabled: (at?: LogCommitContext) =>
      at !== undefined &&
      resetting.get() === undefined &&
      at.head === at.commit.hash &&
      at.commit.parents.length === 1,
    run: undoCommit,
  });
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.undoCommit' },
    group: 'g',
    order: 2,
  });
  // IntelliJ's: after New Tag….
  menus.contribute({ menu: 'main/git', item: { command: 'git.reset' }, group: 'an', order: 4 });
}
