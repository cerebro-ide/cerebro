// Merge conflicts, resolved as IntelliJ's (`MultipleFileMergeDialog`, `OneShotMergeFlowDelegate`,
// `GitDefaultMergeDialogCustomizer`, `TextMergeViewer`, their words from `VcsBundle`, `GitBundle`
// and `DiffBundle`). The Conflicts dialog lists the files in conflict, what each side did to them,
// with Accept Yours, Accept Theirs and Merge…; it closes once none is left. Merge… opens the merge
// window on each file selected: yours, the result and theirs (`MergeEditor`), with Apply
// non-conflicting changes, Accept Left, Accept Right and Apply. Git → Resolve Conflicts… and the
// Commit window's Merge Conflicts group open the dialog; so does Update Project, at conflicts.

import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { MergeEditor, type MergeControl, type MergeLeft } from '@cerebro-ide/ui-editor';
import { changeContent } from './changes.js';
import { active, currentHost, hostFor, showError, type Host } from './environments.js';
import { stateOf } from './repository-state.js';
import { settingsFor } from './settings.js';
import { refreshAll } from './shelf.js';

type ConflictSide = 'modified' | 'deleted';

/** The host's `git.conflicts`. */
export interface Conflicts {
  operation?: 'merge' | 'rebase' | 'cherry-pick';
  files: { path: string; yours: ConflictSide; theirs: ConflictSide }[];
  yours?: string;
  theirs?: string;
  onto?: string;
  commit?: { hash: string; author: string; message: string };
}

/** The host's `git.mergeRevisions`. */
type Revisions =
  { binary: false; base: string; yours?: string; theirs?: string } | { binary: true };

/** While the dialog shows: Resolve Conflicts… can't open another. */
export const resolving = signal(false);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What's being merged, over the dialog's list, as `GitDefaultMergeDialogCustomizer` says it. */
export function describe(conflicts: Conflicts): string {
  const { yours, theirs } = conflicts;
  if (conflicts.operation === 'merge') {
    const into = yours === undefined ? '' : ` into branch ${yours}`;
    return `Merging branch ${theirs ?? ''}${into}`;
  }
  if (conflicts.operation === 'rebase') {
    const branch = yours === undefined ? '' : ` branch ${yours}`;
    const onto =
      theirs === undefined
        ? (conflicts.onto ?? '')
        : `branch ${theirs}${conflicts.onto === undefined ? '' : `, revision ${conflicts.onto}`}`;
    const commit = conflicts.commit;
    return commit
      ? `Rebasing${branch} onto ${onto}. Current commit ${commit.hash} made by ${commit.author}:\n${commit.message}`
      : `Rebasing${branch} onto ${onto}`;
  }
  if (conflicts.operation === 'cherry-pick' && conflicts.commit) {
    const { hash, author, message } = conflicts.commit;
    return `Conflicts during cherry-picking commit ${hash} made by ${author}\n${message}`;
  }
  const n = conflicts.files.length;
  return `The following ${plural(n, 'file has', 'files have')} conflicts:`;
}

/** The merge window's titles over yours and theirs, as IntelliJ's for a merge and a rebase. */
export function paneTitles(conflicts: Conflicts): [string, string] {
  const { yours, theirs } = conflicts;
  if (conflicts.operation === 'merge') {
    return [`Changes from ${yours ?? 'HEAD'}`, `Changes from ${theirs ?? ''}`];
  }
  if (conflicts.operation === 'rebase') {
    return [
      `Rebasing ${conflicts.commit?.hash ?? ''} from ${yours ?? 'HEAD'}`,
      theirs === undefined
        ? 'Already rebased commits'
        : `Already rebased commits and commits from ${theirs}`,
    ];
  }
  if (conflicts.operation === 'cherry-pick') {
    return ['Local Changes', `Changes from cherry-pick ${conflicts.commit?.hash ?? ''}`];
  }
  return ['Your version', 'Changes from server'];
}

/** The merge window's count of what's left, as IntelliJ's (`merge.differences.status.text`). */
export function leftText({ changes, conflicts }: MergeLeft): string {
  const count = (n: number, word: string) =>
    n === 0 ? `No ${word}s` : n === 1 ? `1 ${word}` : `${String(n)} ${word}s`;
  return `${count(changes, 'change')}, ${count(conflicts, 'conflict')}`;
}

/**
 * IntelliJ's question when Apply leaves some unprocessed
 * (`merge.dialog.apply.partially.resolved.changes.confirmation.message`).
 */
export function unprocessedText({ changes, conflicts }: MergeLeft): string {
  const verb = (changes === 0 ? conflicts : changes) === 1 ? 'is' : 'are';
  const some = (n: number, word: string) =>
    n === 0 ? '' : n === 1 ? `one ${word}` : `${String(n)} ${word}s`;
  const and = changes > 0 && conflicts > 0 ? ' and ' : '';
  return `There ${verb} ${some(changes, 'change')}${and}${some(conflicts, 'conflict')} left unprocessed.`;
}

/** How a file's merge ended: one side's version, or the text merged. */
type Merged = { side: 'yours' | 'theirs' } | { text: string };

/** The merge window for one file: what to resolve it with, or undefined if cancelled. */
async function mergeFile(
  worktree: string,
  host: Host,
  conflicts: Conflicts,
  path: string,
): Promise<Merged | undefined> {
  const revisions = (await host.request('git.mergeRevisions', {
    path: worktree,
    file: path,
  })) as Revisions;
  if (revisions.binary) {
    // Cerebro's words: IntelliJ's merge of binary files, a side chosen, isn't here yet.
    showError('Cannot Show Merge Dialog', `${path} is binary: accept yours or theirs for it.`);
    return undefined;
  }
  const settings = settingsFor(worktree);
  // Given as the merge editor shows, after the toolbar that reads it.
  const control = signal<MergeControl | undefined>(undefined);
  const [leftTitle, rightTitle] = paneTitles(conflicts);
  const handle = openDialog<Merged>({
    title: `Merge Revisions for ${worktree}/${path}`,
    width: Math.min(window.innerWidth - 80, 1400),
    content: () => (
      <div class="playground-merge">
        <div class="playground-merge__toolbar">
          <span>Apply non-conflicting changes:</span>
          {(['yours', 'all', 'theirs'] as const).map((side) => (
            <button
              class="playground-link"
              on:click={() => {
                control.peek()?.applyNonConflicting(side);
              }}
            >
              {{ yours: 'Left', all: 'All', theirs: 'Right' }[side]}
            </button>
          ))}
          <span class="playground-merge__left">
            {() => {
              const left = control.get()?.left() ?? { changes: 0, conflicts: 0 };
              return left.changes + left.conflicts === 0
                ? 'All changes have been processed'
                : leftText(left);
            }}
          </span>
        </div>
        <div class="playground-merge__titles">
          <span>{leftTitle}</span>
          <span>Result</span>
          <span>{rightTitle}</span>
        </div>
        <div class="playground-merge__panes">
          <MergeEditor
            path={path}
            base={revisions.base}
            yours={revisions.yours ?? ''}
            theirs={revisions.theirs ?? ''}
            fontSize={() => settings.get('editor.fontSize') as number}
            tabSize={() => settings.get('editor.tabSize') as number}
            control={(given) => {
              control.set(given);
            }}
          />
        </div>
      </div>
    ),
    footer: () => (
      <div class="playground-merge__accept">
        <button
          class="cerebro-dialog__button"
          on:click={() => {
            handle.close({ side: 'yours' });
          }}
        >
          Accept Left
        </button>
        <button
          class="cerebro-dialog__button"
          on:click={() => {
            handle.close({ side: 'theirs' });
          }}
        >
          Accept Right
        </button>
      </div>
    ),
    ok: {
      label: 'Apply',
      // Asked first, as IntelliJ, when changes are left unprocessed.
      check: async () => {
        const left = (control.peek() as MergeControl).left();
        if (left.changes + left.conflicts === 0) return true;
        return (
          (await openDialog<true>({
            title: 'Apply Changes',
            content: () => (
              <p class="playground-merge__question">
                {unprocessedText(left)}
                <br />
                Save changes and mark the conflict resolved anyway?
              </p>
            ),
            ok: { label: 'Apply Changes', accept: () => true },
            cancelLabel: 'Continue Merge',
          }).result) === true
        );
      },
      accept: () => ({ text: (control.peek() as MergeControl).text() }),
    },
  });
  return handle.result;
}

/**
 * Shows the Conflicts dialog until it's closed, or no file is left in conflict; says whether none
 * is. `description` is what's said over the list instead of what's being merged.
 */
export async function resolveConflicts(worktree: string, description?: string): Promise<boolean> {
  const host = hostFor(worktree);
  if (!host || resolving.peek()) return false;
  const read = async () => (await host.request('git.conflicts', { path: worktree })) as Conflicts;
  const first = await read();
  if (first.files.length === 0) return true;
  const conflicts = signal(first);
  const selected = signal<readonly string[]>([first.files[0]?.path as string]);
  const busy = signal(false);
  /** Reads the files again: the selection keeps those still there, else the first. */
  const reload = async () => {
    const now = await read();
    conflicts.set(now);
    const kept = selected.peek().filter((p) => now.files.some((f) => f.path === p));
    selected.set(kept.length > 0 || !now.files[0] ? kept : [now.files[0].path]);
    return now;
  };
  resolving.set(true);
  const handle = openDialog<never>({
    title: 'Conflicts',
    width: 700,
    content: (dialog) => {
      /** Runs an action on the selection, then reads the files again; closes once none is left. */
      const act = async (run: (files: readonly string[]) => Promise<void>) => {
        busy.set(true);
        try {
          await run(selected.peek());
        } catch (error) {
          showError('Cannot Resolve Conflict', (error as Error).message);
        } finally {
          busy.set(false);
        }
        if ((await reload()).files.length === 0) dialog.close();
      };
      const accept = (side: 'yours' | 'theirs') =>
        act(async (files) => {
          await host.request('git.acceptSide', { path: worktree, files, side });
        });
      // Each file selected in turn, until one is cancelled.
      const merge = () =>
        act(async (files) => {
          for (const path of files) {
            const merged = await mergeFile(worktree, host, conflicts.peek(), path);
            if (merged === undefined) return;
            await ('side' in merged
              ? host.request('git.acceptSide', { path: worktree, files: [path], side: merged.side })
              : host.request('git.resolve', { path: worktree, file: path, text: merged.text }));
          }
        });
      const none = () => selected.get().length === 0 || busy.get();
      const select = (path: string, event: MouseEvent) => {
        const files = conflicts.peek().files.map((f) => f.path);
        if (event.ctrlKey || event.metaKey) {
          const now = selected.peek();
          selected.set(now.includes(path) ? now.filter((p) => p !== path) : [...now, path]);
        } else if (event.shiftKey && selected.peek().length > 0) {
          const from = files.indexOf(selected.peek()[0] as string);
          const to = files.indexOf(path);
          selected.set(files.slice(Math.min(from, to), Math.max(from, to) + 1));
        } else selected.set([path]);
      };
      const moveBy = (step: number) => {
        const files = conflicts.peek().files.map((f) => f.path);
        const at = files.indexOf(selected.peek().at(-1) as string);
        // There's always one: the dialog closes when none is left.
        selected.set([files[Math.min(Math.max(at + step, 0), files.length - 1)] as string]);
      };
      const status = (side: ConflictSide) => (side === 'modified' ? 'Modified' : 'Deleted');
      const column = (name: string, branch: string | undefined) =>
        branch === undefined ? name : `${name} (${branch})`;
      return (
        <div class="playground-conflicts">
          <p class="playground-conflicts__description cerebro-selectable">
            {() => description ?? describe(conflicts.get())}
          </p>
          <div class="playground-conflicts__body">
            <div class="playground-conflicts__list">
              <table
                class="playground-conflicts__table"
                tabIndex={0}
                aria-multiselectable="true"
                on:keydown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveBy(event.key === 'ArrowDown' ? 1 : -1);
                  }
                }}
              >
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>{() => column('Yours', conflicts.get().yours)}</th>
                    <th>{() => column('Theirs', conflicts.get().theirs)}</th>
                  </tr>
                </thead>
                <tbody>
                  {() =>
                    conflicts.get().files.map((file) => (
                      <tr
                        class="playground-conflicts__row"
                        aria-selected={() => String(selected.get().includes(file.path))}
                        on:mousedown={(event) => {
                          select(file.path, event);
                        }}
                        on:dblclick={() => {
                          selected.set([file.path]);
                          void merge();
                        }}
                      >
                        <td>
                          <span class="playground-conflicts__name">
                            {changeContent({ path: file.path, status: 'conflict' }, true)}
                          </span>
                        </td>
                        <td>{status(file.yours)}</td>
                        <td>{status(file.theirs)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
            <div class="playground-conflicts__buttons">
              <button
                class="cerebro-dialog__button"
                disabled={none}
                on:click={() => void accept('yours')}
              >
                Accept Yours
              </button>
              <button
                class="cerebro-dialog__button"
                disabled={none}
                on:click={() => void accept('theirs')}
              >
                Accept Theirs
              </button>
              <button class="cerebro-dialog__button" disabled={none} on:click={() => void merge()}>
                Merge…
              </button>
            </div>
          </div>
        </div>
      );
    },
  });
  try {
    await handle.result;
  } finally {
    resolving.set(false);
  }
  return (await read()).files.length === 0;
}

/** Git → Resolve Conflicts…, as IntelliJ's, after Merge and Rebase. */
export function setupConflicts(services: MenuServices): void {
  const { commands, menus } = services;
  commands.register({
    id: 'vcs.resolveConflicts',
    label: 'Resolve Conflicts',
    dialog: true,
    // As IntelliJ's, only while files are in conflict.
    visible: () => {
      const env = active();
      return env !== undefined && currentHost() !== undefined && stateOf(env.id).conflicts;
    },
    enabled: () => !resolving.get(),
    run: async () => {
      const worktree = (active() as NonNullable<ReturnType<typeof active>>).id;
      try {
        await resolveConflicts(worktree);
      } catch (error) {
        showError('Cannot Resolve Conflicts', (error as Error).message);
      }
      await refreshAll(worktree).catch((error: unknown) => {
        console.error('Reading the changes failed', error);
      });
    },
  });
  // IntelliJ's second group, where Merge and Rebase go, after their actions.
  menus.contribute({
    menu: 'main/git',
    item: { command: 'vcs.resolveConflicts' },
    group: 'am',
    order: 1,
  });
}
