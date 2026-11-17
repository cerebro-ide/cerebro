// The Log's Interactively Rebase from Here…, as IntelliJ's (`GitInteractiveRebaseAction`,
// `GitInteractiveRebaseUsingLog`, `GitInteractiveRebaseDialog`, `ChangeEntryStateActions`,
// `GitRebaseCommitsTableView`, `CommitMessageCellEditor`, their words in `GitBundle`, read from its
// source). Edit Commit Message…'s checks first ("Cannot Start Rebase"). Then the dialog "Rebasing
// Commits": the commits from the one chosen to HEAD, oldest first, as git lists them (the host's
// `git.rebaseCommits`), each with what's done with it (`rebase-todo.ts`). Over them, IntelliJ's
// toolbar: Move Up and Down (Alt+Up and Down), Pick and Stop to Edit, then Reword, Squash (with
// Fixup on its arrow) and Drop, each also on Alt and its command's first letter, Drop on Delete
// too; Reset at its right once the list's changed. Reword edits the message in its row (Ctrl+Enter
// applies it, Escape asks before the message typed is lost), as Squash does with the messages put
// together. Start Rebasing gives the list to git (`git.interactiveRebase`), which stops at
// conflicts (the Conflicts dialog, as any rebase) or to edit a commit.

import { formatSequence, type Platform } from '@cerebro-ide/commands';
import { computed, signal } from '@cerebro-ide/reactive';
import { openDialog, optionButton } from '@cerebro-ide/ui-dialog';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { saveBeforeGit } from './documents.js';
import { currentBranch } from './git-fields.js';
import type { LogCommitContext } from './git-log.js';
import { icon } from './icons.js';
import { abort, continueRebase } from './merge-rebase.js';
import { notifications } from './notifications.js';
import {
  groupOf,
  initialRows,
  isChild,
  isRoot,
  messageOf,
  prettySquash,
  RebaseTodo,
  type TodoCommit,
  type TodoRow,
} from './rebase-todo.js';
import { resetting } from './reset.js';

/** What the dialog gives git: each commit's action, a reword's message. */
export type RebaseEntries = ReturnType<RebaseTodo['entries']>;

/** IntelliJ's question before the list's changes are lost; whether to discard them. */
async function discardAsked(): Promise<boolean> {
  const answer = await openDialog<'discard'>({
    title: 'Cancel Rebase',
    cancelLabel: 'Continue Rebasing',
    ok: { label: 'Discard', accept: () => 'discard' },
    content: () => <p>Discard changes and cancel rebase?</p>,
  }).result;
  return answer === 'discard';
}

/** IntelliJ's question before a message typed in a row is lost; whether to lose it. */
async function cancelRewordAsked(): Promise<boolean> {
  const answer = await openDialog<'cancel'>({
    title: 'Cancel Reword',
    cancelLabel: 'Keep Editing',
    ok: { label: 'Cancel Reword', accept: () => 'cancel' },
    content: () => <p>Entered commit message will be lost</p>,
  }).result;
  return answer === 'cancel';
}

/** The row's node, as IntelliJ's graph column draws it (`getDrawNodeType`). */
function nodeOf(rows: readonly TodoRow[], index: number): 'edit' | 'none' | 'double' | 'simple' {
  const type = (rows[index] as TodoRow).type;
  if (type === 'edit') return 'edit';
  if (type === 'drop' || type === 'fixup') return 'none';
  return isRoot(rows, index) ? 'double' : 'simple';
}

/**
 * The dialog: the list as git's to take, or undefined if cancelled. `commits` are the host's,
 * oldest first.
 */
export function rebaseDialog(
  commits: readonly TodoCommit[],
  platform: Platform,
): Promise<RebaseEntries | undefined> {
  const initial = initialRows(commits);
  let todo = new RebaseTodo(initial);
  /** Read again after each change: the model isn't observable itself, and changes rows in place. */
  const version = signal(0);
  const rows = computed(() => {
    version.get();
    return todo.rows.map((row) => ({ ...row }));
  });
  /** Changed since it opened, or since Reset, as IntelliJ's link shows once it's changed. */
  const modified = signal(false);
  /** The rows selected, by commit, so a moved row stays selected; the first to start with. */
  const selected = signal<readonly string[]>(commits.slice(0, 1).map((c) => c.hash));
  /** The row whose message is being edited, and the text so far. */
  const editing = signal<{ hash: string; text: string } | undefined>(undefined);
  const indices = () => {
    const chosen = selected.get();
    return rows
      .get()
      .map((row, i) => (chosen.includes(row.commit.hash) ? i : -1))
      .filter((i) => i >= 0);
  };
  const change = (run: () => void) => {
    run();
    version.set(version.peek() + 1);
    modified.set(true);
  };
  /** The row being edited, alone: its field isn't made again as the text changes. */
  const editingHash = computed(() => editing.get()?.hash);
  const busy = () => editingHash.get() !== undefined;
  const startEditing = (index: number) => {
    const row = todo.rows[index] as TodoRow;
    selected.set([row.commit.hash]);
    editing.set({ hash: row.commit.hash, text: messageOf(row) });
  };
  /** The edit applied, as IntelliJ's `setValueAt`: the commit's own message picks it again. */
  const applyEdit = () => {
    // Only while a row's edited: its keys, and a press elsewhere, call it.
    const now = editing.peek() as { hash: string; text: string };
    const index = todo.rows.findIndex((row) => row.commit.hash === now.hash);
    const row = todo.rows[index] as TodoRow;
    editing.set(undefined);
    change(() => {
      if (now.text === row.commit.message) todo.pick([index]);
      else todo.reword(index, now.text);
    });
  };
  /** The edit given up, asked first when what's typed isn't the row's message. */
  const cancelEdit = async () => {
    const now = editing.peek() as { hash: string; text: string };
    const row = todo.rows.find((r) => r.commit.hash === now.hash) as TodoRow;
    if (now.text !== messageOf(row) && !(await cancelRewordAsked())) return;
    editing.set(undefined);
  };
  /** Move Up and Down, as IntelliJ's `MoveTableItemRunnable`: each selected row by one. */
  const move = (delta: number) => {
    const chosen = indices();
    if (delta > 0) chosen.reverse();
    // Not past either end: the buttons and keys are off then.
    change(() => {
      for (const i of chosen) todo.move(i, i + delta);
    });
  };
  /**
   * Squash and Fixup, as IntelliJ's `SquashAction` and `FixupAction`: the rows united; Squash then
   * edits the root's message, the messages put together (`prettySquash`): onto a group already, its
   * message as it is and the new rows' own; else each commit's own.
   */
  const squash = (fixup: boolean) => {
    const toUnite = todo.toUnite(indices()) as number[];
    const first = toUnite[0] as number;
    const had = isChild(todo.rows, first) || isRoot(todo.rows, first);
    const [oldRoot, oldLast] = groupOf(todo.rows, first);
    const kept = had ? oldLast - oldRoot : 0;
    let root = 0;
    change(() => {
      root = todo.unite(toUnite);
    });
    selected.set([(todo.rows[root] as TodoRow).commit.hash]);
    if (fixup) return;
    const [, last] = groupOf(todo.rows, root);
    const group = todo.rows.slice(root, last + 1);
    const messages = had
      ? [messageOf(group[0] as TodoRow), ...group.slice(1 + kept).map((r) => r.commit.message)]
      : group.map((r) => r.commit.message);
    change(() => {
      todo.reword(root, prettySquash(messages));
    });
    startEditing(root);
  };
  const actions: {
    label: string;
    name?: string;
    key: string;
    enabled: () => boolean;
    run: () => void;
  }[] = [
    {
      label: 'Move Up',
      name: 'previousDiff',
      key: 'Alt+ArrowUp',
      enabled: () => !busy() && indices().length > 0 && (indices()[0] as number) > 0,
      run: () => {
        move(-1);
      },
    },
    {
      label: 'Move Down',
      name: 'nextDiff',
      key: 'Alt+ArrowDown',
      enabled: () =>
        !busy() && indices().length > 0 && (indices().at(-1) as number) < rows.get().length - 1,
      run: () => {
        move(1);
      },
    },
    {
      label: 'Pick',
      name: 'rollback',
      key: 'Alt+P',
      enabled: () => !busy() && todo.canPick(indices()),
      run: () => {
        change(() => {
          todo.pick(indices());
        });
      },
    },
    {
      label: 'Stop to Edit',
      name: 'pause',
      key: 'Alt+E',
      enabled: () => !busy() && todo.canEdit(indices()),
      run: () => {
        change(() => {
          todo.edit(indices());
        });
      },
    },
  ];
  const reword = {
    label: 'Reword',
    key: 'Alt+R',
    enabled: () => !busy() && indices().length === 1 && todo.canReword(indices()[0] as number),
    run: () => {
      startEditing(indices()[0] as number);
    },
  };
  const unite = (fixup: boolean) => ({
    label: fixup ? 'Fixup' : 'Squash',
    key: fixup ? 'Alt+F' : 'Alt+S',
    enabled: () => !busy() && todo.toUnite(indices()) !== undefined,
    run: () => {
      squash(fixup);
    },
  });
  const drop = {
    label: 'Drop',
    key: 'Alt+D',
    enabled: () => !busy() && todo.canDrop(indices()),
    run: () => {
      change(() => {
        todo.drop(indices());
      });
    },
  };
  const squashing = unite(false);
  const fixing = unite(true);
  const keyed = [...actions, reword, squashing, fixing, drop];
  const iconButton = (action: (typeof actions)[number]) => (
    <button
      type="button"
      class="cerebro-toolbar-button"
      aria-label={action.label}
      disabled={() => !action.enabled()}
      ref={tooltip({
        text: () => action.label,
        shortcut: () => formatSequence(action.key, platform),
      })}
      on:click={action.run}
    >
      {icon(action.name as string)}
    </button>
  );
  const textButton = (action: typeof reword) => (
    <button
      type="button"
      class="cerebro-dialog__button playground-rebase__button"
      disabled={() => !action.enabled()}
      ref={tooltip({
        text: () => action.label,
        shortcut: () => formatSequence(action.key, platform),
      })}
      on:click={action.run}
    >
      {action.label}
    </button>
  );
  /** A row pressed: as a table's selection, Ctrl (Cmd) adding one, Shift a range. */
  const press = (hash: string, event: MouseEvent) => {
    // A press elsewhere ends the edit, applying it, as a table's does.
    if (editing.peek() && editing.peek()?.hash !== hash) applyEdit();
    const chosen = selected.peek();
    const all = todo.rows.map((row) => row.commit.hash);
    if (event.ctrlKey || event.metaKey) {
      selected.set(chosen.includes(hash) ? chosen.filter((h) => h !== hash) : [...chosen, hash]);
    } else if (event.shiftKey && chosen.length > 0) {
      const from = all.indexOf(chosen[0] as string);
      const to = all.indexOf(hash);
      selected.set(all.slice(Math.min(from, to), Math.max(from, to) + 1));
    } else selected.set([hash]);
  };
  /** Up and Down select the row beside the last selected, Shift adding it. */
  const step = (delta: number, extend: boolean) => {
    const all = todo.rows.map((row) => row.commit.hash);
    const at = all.indexOf(selected.peek().at(-1) as string);
    const next = all[Math.min(Math.max(at + delta, 0), all.length - 1)] as string;
    selected.set(extend ? [...new Set([...selected.peek(), next])] : [next]);
  };
  /** A key as the actions name theirs: a letter by its key's code, as Alt changes what it types (macOS's Alt+D types ∂). */
  const keyFor = (event: KeyboardEvent) => {
    const name = event.code.startsWith('Key') ? event.code.slice(3) : event.key;
    return event.altKey && !event.ctrlKey && !event.metaKey ? `Alt+${name}` : name;
  };

  return openDialog<RebaseEntries>({
    title: 'Rebasing Commits',
    width: 1000,
    ok: {
      label: 'Start Rebasing',
      enabled: () => !busy(),
      accept: () => todo.entries(),
    },
    confirmCancel: async () => !modified.peek() || (await discardAsked()),
    content: () => (
      <div class="playground-rebase">
        <div class="playground-rebase__toolbar" role="toolbar" aria-label="Rebasing Commits">
          {actions.map(iconButton)}
          <span class="playground-rebase__separator" />
          {textButton(reword)}
          {optionButton(
            textButton(squashing),
            () => [{ label: 'Fixup', enabled: fixing.enabled, run: fixing.run }],
            () => !fixing.enabled() && !squashing.enabled(),
          )}
          {textButton(drop)}
          {() =>
            modified.get() ? (
              <a
                class="playground-rebase__reset"
                href="#"
                on:click={(event) => {
                  event.preventDefault();
                  editing.set(undefined);
                  todo = new RebaseTodo(initial);
                  version.set(version.peek() + 1);
                  modified.set(false);
                }}
              >
                Reset
              </a>
            ) : null
          }
        </div>
        <div class="playground-rebase__list">
          <table
            class="playground-rebase__table"
            tabIndex={0}
            aria-multiselectable="true"
            ref={(table) => {
              queueMicrotask(() => {
                table.focus();
              });
            }}
            on:keydown={(event) => {
              if (event.target !== event.currentTarget) return;
              const key = keyFor(event);
              const action =
                key === 'Delete' ? drop : keyed.find((a) => a.key === key && a.enabled());
              if (action?.enabled()) {
                event.preventDefault();
                event.stopPropagation();
                action.run();
              } else if (key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                step(key === 'ArrowDown' ? 1 : -1, event.shiftKey);
              }
            }}
          >
            <tbody>
              {() => {
                const list = rows.get();
                return list.map((row, index) => {
                  const node = nodeOf(list, index);
                  const hash = row.commit.hash;
                  return (
                    <tr
                      class={[
                        'playground-rebase__row',
                        `playground-rebase__row--${row.type}`,
                        index === list.length - 1 && 'playground-rebase__row--head',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-hash={hash}
                      aria-selected={() => String(selected.get().includes(hash))}
                      on:mousedown={(event) => {
                        press(hash, event);
                      }}
                    >
                      <td class={`playground-rebase__node playground-rebase__node--${node}`}>
                        {node === 'edit' ? icon('pause') : <span class="playground-rebase__dot" />}
                      </td>
                      <td class="playground-rebase__subject">
                        {() =>
                          editingHash.get() === hash ? (
                            <div class="playground-rebase__editor">
                              <textarea
                                class="cerebro-dialog-field__input playground-rebase__message"
                                rows={5}
                                spellcheck={false}
                                aria-label="Commit message"
                                value={(editing.peek() as { text: string }).text}
                                ref={(field) => {
                                  queueMicrotask(() => {
                                    field.focus();
                                    // As IntelliJ's, the caret at the start.
                                    field.setSelectionRange(0, 0);
                                  });
                                }}
                                on:input={(event) => {
                                  const text = (event.currentTarget as HTMLTextAreaElement).value;
                                  editing.set({ hash, text });
                                }}
                                on:keydown={(event) => {
                                  // Its keys, not the dialog's Enter and Escape.
                                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    applyEdit();
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void cancelEdit();
                                  } else if (event.key === 'Enter') event.stopPropagation();
                                }}
                              />
                              <div class="playground-rebase__hint">
                                Press{' '}
                                {formatSequence(
                                  platform === 'mac' ? 'Meta+Enter' : 'Ctrl+Enter',
                                  platform,
                                )}{' '}
                                to apply changes
                              </div>
                            </div>
                          ) : (
                            messageOf(row).split('\n')[0]
                          )
                        }
                      </td>
                    </tr>
                  );
                });
              }}
            </tbody>
          </table>
        </div>
      </div>
    ),
  }).result;
}

/**
 * Interactively Rebase from Here…: the dialog, then git with its list; at conflicts, the Conflicts
 * dialog as any rebase; stopped to edit, IntelliJ's notification with Continue and Abort.
 * `checked` is Edit Commit Message…'s checks, `reread` what reads the Log again after.
 */
export async function interactivelyRebase(
  at: LogCommitContext,
  platform: Platform,
  checked: () => Promise<string | undefined>,
  reread: () => Promise<void>,
): Promise<void> {
  const { host, worktree, commit } = at;
  if ((await checked()) === undefined) return;
  let commits: TodoCommit[];
  try {
    commits = (await host.request('git.rebaseCommits', {
      path: worktree,
      hash: commit.hash,
    })) as TodoCommit[];
  } catch (error) {
    notifications.notify({
      title: 'Cannot Start Rebase',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
    return;
  }
  const entries = await rebaseDialog(commits, platform);
  if (entries === undefined) return;
  resetting.set('Rebasing…');
  let result: 'done' | 'conflicts' | 'editing' | undefined;
  try {
    await saveBeforeGit();
    result = (await host.request('git.interactiveRebase', {
      path: worktree,
      hash: commit.hash,
      expected: commits.map((c) => c.hash),
      entries,
    })) as typeof result;
  } catch (error) {
    notifications.notify({
      title: 'Rebase failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  } finally {
    resetting.set(undefined);
  }
  const branch = currentBranch(worktree);
  if (result === 'done') {
    notifications.notify({
      title: 'Rebase successful',
      content: branch === undefined ? 'Rebased' : `Rebased ${branch}`,
    });
  } else if (result === 'conflicts') {
    await continueRebase(host, worktree, 'stopped');
  } else if (result === 'editing') {
    notifications.notify({
      title: 'Rebase stopped for editing',
      type: 'warning',
      display: 'sticky',
      actions: [
        { label: 'Continue', run: () => void continueRebase(host, worktree, 'continue') },
        { label: 'Abort', run: () => void abort(host, worktree, 'rebase') },
      ],
    });
  }
  await reread();
}
