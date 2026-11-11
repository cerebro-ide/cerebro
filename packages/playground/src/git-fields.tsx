// Rows IntelliJ's older Git dialogs share (New Tag's and Reset HEAD's, `GitUIUtil` and
// `GitReferenceValidator`, read from its source): the current branch, and a commit's field with
// Validate, which asks git whether it names something.

import type { Child } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { projectOf, type Host } from './environments.js';

/** The worktree's branch, undefined when HEAD is detached. */
export function currentBranch(worktree: string): string | undefined {
  const branch = projectOf(worktree)
    ?.worktrees.get()
    .find((w) => w.id === worktree)?.branch;
  // A detached worktree's environment says 'detached' (`toSpec`'s).
  return branch === 'detached' ? undefined : branch;
}

/** IntelliJ's Current Branch row: the worktree's branch, or `<no active branch>` when detached. */
export function currentBranchRow(worktree: string): Child {
  const branch = currentBranch(worktree);
  return (
    <div class="playground-form__row">
      <span>Current Branch:</span>
      <span title="The currently checked-out branch.">{branch ?? '<no active branch>'}</span>
    </div>
  );
}

export interface RevisionField {
  /** The commit as typed, trimmed: empty for HEAD. */
  value: () => string;
  /** Whether it's the text Validate last found git doesn't know, as IntelliJ's `isInvalid`. */
  invalid: () => boolean;
  /** The row: its label, the field and Validate; built in the dialog's content. */
  row: () => Child;
}

/** A commit's field and its Validate, which asks the host whether git knows it. */
export function revisionField(
  host: Host,
  worktree: string,
  label: string,
  tooltips: { field: string; validate?: string },
): RevisionField {
  const text = signal('');
  /** The text last validated, and whether git knew it. */
  const validated = signal<{ text: string; valid: boolean } | undefined>(undefined);
  const validate = async () => {
    const typed = text.peek();
    const valid = (await host.request('git.validRevision', {
      path: worktree,
      revision: typed.trim(),
    })) as boolean;
    validated.set({ text: typed, valid });
  };
  return {
    value: () => text.peek().trim(),
    invalid: () => {
      const last = validated.get();
      return last !== undefined && last.text === text.get() && !last.valid;
    },
    row: () => (
      <label class="playground-form__row">
        <span>{label}</span>
        <span class="playground-form__revision">
          <input
            class="cerebro-dialog-field__input"
            type="text"
            spellcheck={false}
            title={tooltips.field}
            on:input={(event) => {
              text.set((event.currentTarget as HTMLInputElement).value);
            }}
          />
          <button
            type="button"
            class="cerebro-dialog__button"
            {...(tooltips.validate === undefined ? {} : { title: tooltips.validate })}
            disabled={() => text.get().trim() === ''}
            on:click={() => {
              validate().catch((failure: unknown) => {
                console.error('Validating the commit failed', failure);
              });
            }}
          >
            Validate
          </button>
        </span>
      </label>
    ),
  };
}
