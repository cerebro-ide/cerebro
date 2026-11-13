// The Log's Edit Commit Message…, as IntelliJ's (`GitRewordAction`, `GitCommitEditingActionBase`,
// `GitNewCommitMessageActionDialog`, `GitRewordService`, their words in `GitBundle`, read from its
// source): for a commit of the current branch, a merge only at HEAD. Why it can't be done comes
// first, in an error dialog; the first commit is asked about; then the dialog "Edit Commit
// Message", the commit's message to edit, OK off while it's blank; "Rewording…" on the status bar
// while the host makes the commits again (`git.reword`), and "Commit message changed" after.
// IntelliJ's notification has Undo, and Edit Again for HEAD's commit: Cerebro's hasn't yet.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { LogCommitContext } from './git-log.js';
import { notifications } from './notifications.js';
import { PROTECTED } from './push.js';
import { resetting } from './reset.js';
import { refreshAll } from './shelf.js';

/** IntelliJ's title for why it can't be done. */
const FAILURE = 'Could not Edit Commit Message';

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

/** Edit Commit Message…: the checks, the dialog, then the message given. */
async function rewordCommit(at: LogCommitContext): Promise<void> {
  const { host, worktree, commit } = at;
  let check: { head: string } | { refused: string };
  try {
    check = (await host.request('git.rewordCheck', {
      path: worktree,
      hash: commit.hash,
      protected: PROTECTED,
    })) as typeof check;
  } catch (error) {
    check = { refused: (error as Error).message };
  }
  if ('refused' in check) {
    const why = check.refused;
    await openDialog({ title: FAILURE, cancelLabel: 'OK', content: () => <p>{why}</p> }).result;
    return;
  }
  if (commit.parents.length === 0 && !(await initialCommitAsked())) return;
  const message = await messageDialog(at);
  if (message === undefined) return;
  resetting.set('Rewording…');
  try {
    await host.request('git.reword', {
      path: worktree,
      hash: commit.hash,
      message,
      head: check.head,
    });
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
  await Promise.all([at.refresh(), refreshAll(worktree)]).catch((error: unknown) => {
    console.error('Reading again after Edit Commit Message', error);
  });
}

export function setupReword(services: MenuServices): void {
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
}
