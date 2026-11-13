// The Log's commit editing, as IntelliJ's (`GitCommitEditingActionBase`, their words in
// `GitBundle`, read from its source), for a commit of the current branch: why it can't be done
// comes first, in an error dialog (`git.editCheck`); the first commit is asked about. Then Edit
// Commit Message… (`GitRewordAction`, `GitNewCommitMessageActionDialog`, `GitRewordService`): the
// dialog "Edit Commit Message", the commit's message to edit, OK off while it's blank;
// "Rewording…" on the status bar while the host makes the commits again (`git.reword`), "Commit
// message changed" after. Or Drop Commit (`GitDropLogAction`): asked first, unless told not to ask
// again; "Dropping commit…" while the host drops it (`git.drop`), "Dropped 1 commit" after.
// IntelliJ's notifications have Undo, and Edit Again for HEAD's commit: Cerebro's haven't yet.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { saveBeforeGit } from './documents.js';
import { currentBranch } from './git-fields.js';
import type { LogCommitContext } from './git-log.js';
import { shortenText } from './log-paths.js';
import { notifications } from './notifications.js';
import { PROTECTED } from './push.js';
import { resetting } from './reset.js';
import { refreshAll } from './shelf.js';

type Editing = 'reword' | 'drop';

/** IntelliJ's titles for why it can't be done. */
const FAILURE: Record<Editing, string> = {
  reword: 'Could not Edit Commit Message',
  drop: 'Could not Drop Commits',
};

/** IntelliJ's warning before the first commit is edited; whether to go on. */
async function initialCommitAsked(): Promise<boolean> {
  const answer = await openDialog<true>({
    title: 'Editing Initial Commit',
    ok: { label: 'Continue', accept: () => true },
    content: () => <p>Are you sure you want to edit the initial commit?</p>,
  }).result;
  return answer === true;
}

/** IntelliJ's dialog: the message as edited, or undefined if cancelled. */
function messageDialog(at: LogCommitContext): Promise<string | undefined> {
  const { commit } = at;
  const body = commit.body.trimEnd();
  const message = signal(body === '' ? commit.subject : `${commit.subject}\n\n${body}`);
  return openDialog<string>({
    title: 'Edit Commit Message',
    width: 500,
    ok: { label: 'OK', enabled: () => message.get().trim() !== '', accept: () => message.peek() },
    content: () => (
      <label class="playground-git-command__message">
        Edit message for commit {commit.hash.slice(0, 8)} by {commit.author}
        <textarea
          class="cerebro-dialog-field__input playground-git-command__message-field"
          spellcheck={false}
          value={message.peek()}
          ref={(field) => {
            // As IntelliJ's, the caret at the start.
            field.setSelectionRange(0, 0);
          }}
          on:input={(event) => {
            message.set((event.currentTarget as HTMLTextAreaElement).value);
          }}
        />
      </label>
    ),
  }).result;
}

/**
 * The host's checks, then the first commit asked about: HEAD's commit to edit from, or undefined
 * when it can't be done (said why) or isn't to be.
 */
async function checked(at: LogCommitContext, editing: Editing): Promise<string | undefined> {
  const { host, worktree, commit } = at;
  let check: { head: string } | { refused: string };
  try {
    check = (await host.request('git.editCheck', {
      path: worktree,
      hash: commit.hash,
      editing,
      protected: PROTECTED,
    })) as typeof check;
  } catch (error) {
    check = { refused: (error as Error).message };
  }
  if ('refused' in check) {
    const why = check.refused;
    await openDialog({ title: FAILURE[editing], cancelLabel: 'OK', content: () => <p>{why}</p> })
      .result;
    return undefined;
  }
  if (commit.parents.length === 0 && !(await initialCommitAsked())) return undefined;
  return check.head;
}

/** Reads the Log and the worktree again after an edit; the commit it made selected, if it made one. */
async function reread(at: LogCommitContext, what: string, made?: string): Promise<void> {
  try {
    await Promise.all([at.refresh(), refreshAll(at.worktree)]);
    // As IntelliJ focuses it.
    if (made !== undefined) await at.select(made);
  } catch (error) {
    console.error(`Reading again after ${what}`, error);
  }
}

/** Edit Commit Message…: the checks, the dialog, then the message given. */
async function rewordCommit(at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  const head = await checked(at, 'reword');
  if (head === undefined) return;
  const message = await messageDialog(at);
  if (message === undefined) return;
  resetting.set('Rewording…');
  let reworded: string | undefined;
  try {
    reworded = (await host.request('git.reword', {
      path: worktree,
      hash: commit.hash,
      message,
      head,
    })) as string;
    notifications.notify({ title: 'Commit message changed' });
  } catch (error) {
    // IntelliJ's in-memory reword's title, its words under it.
    notifications.notify({
      title: 'Failed to reword',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  } finally {
    resetting.set(undefined);
  }
  await reread(at, 'Edit Commit Message', reworded);
}

/** Where "Don't ask again" before a drop is kept, as IntelliJ's `isShowDropCommitDialog`. */
const DROP_ASKS = 'cerebro.drop.ask';

/** IntelliJ's question before a drop, unless told not to ask again; whether to go on. */
async function dropAsked(worktree: string): Promise<boolean> {
  try {
    if (localStorage.getItem(DROP_ASKS) === 'false') return true;
  } catch {
    // Not read: asked.
  }
  const branch = currentBranch(worktree);
  const again = signal(false);
  const answer = await openDialog<true>({
    title: 'Drop Commit',
    ok: { label: 'OK', accept: () => true },
    content: () => (
      <div class="playground-question">
        <p>
          {branch === undefined ? (
            'The repository is in the detached HEAD state. Do you want to drop 1 commit?'
          ) : (
            <>
              Do you want to drop 1 commit from the <b>{branch}</b> branch?
            </>
          )}
        </p>
        <label class="playground-checkbox">
          <input
            type="checkbox"
            checked={() => again.get()}
            on:change={(event) => {
              again.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Don’t ask again
        </label>
      </div>
    ),
  }).result;
  // As IntelliJ's: kept whichever button was pressed.
  if (again.peek()) {
    try {
      localStorage.setItem(DROP_ASKS, 'false');
    } catch {
      // Not kept: asked next time.
    }
  }
  return answer === true;
}

/** Drop Commit: the checks, the question, then the commit dropped. */
async function dropCommit(at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  const head = await checked(at, 'drop');
  if (head === undefined || !(await dropAsked(worktree))) return;
  resetting.set('Dropping commit…');
  try {
    await saveBeforeGit();
    await host.request('git.drop', { path: worktree, hash: commit.hash, head });
    notifications.notify({
      title: 'Dropped 1 commit',
      content: `"${shortenText(commit.subject)}"`,
    });
  } catch (error) {
    notifications.notify({
      title: FAILURE.drop,
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  } finally {
    resetting.set(undefined);
  }
  await reread(at, 'Drop Commit');
}

export function setupCommitEditing(services: MenuServices): void {
  const { commands, menus } = services;
  // After Undo Commit, as IntelliJ's; a merge only at HEAD (its `checkNotMergeCommit`, overridden).
  commands.register<LogCommitContext>({
    id: 'log.reword',
    label: 'Edit Commit Message',
    dialog: true,
    enabled: (at?: LogCommitContext) =>
      at !== undefined &&
      resetting.get() === undefined &&
      (at.commit.parents.length <= 1 || at.head === at.commit.hash),
    run: rewordCommit,
  });
  menus.contribute({ menu: 'log/commit', item: { command: 'log.reword' }, group: 'g', order: 3 });
  // After it, IntelliJ's Fixup and Squash Into between (Cerebro hasn't them); not for a merge.
  commands.register<LogCommitContext>({
    id: 'log.drop',
    label: 'Drop Commit',
    enabled: (at?: LogCommitContext) =>
      at !== undefined && resetting.get() === undefined && at.commit.parents.length <= 1,
    run: dropCommit,
  });
  menus.contribute({ menu: 'log/commit', item: { command: 'log.drop' }, group: 'g', order: 4 });
}
