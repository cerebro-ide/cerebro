// Show Diff with Working Tree, as IntelliJ's (`GitShowDiffWithRefAction`,
// `GitShowDiffWithBranchPanel`, `CompareBranchesDiffPanel`): the files that differ between the
// working tree and a branch or tag, in a Changes tool window on the left, which appears the first
// time (IntelliJ's `ChangesBrowserToolWindow`). A comparison takes the place of the one before.
// Each file opens its diff: the file in the branch, and as it is.

import type { Tab } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import type { Host } from './environments.js';
import { CommitFiles } from './git-log.js';

/** A branch or tag compared with the working tree of `worktree`, where `current` is checked out. */
export interface WorkingTreeDiff {
  host: Host;
  worktree: string;
  ref: string;
  current: string;
}

/** What the window shows: a new object each time, read again even for the same ref. */
const shown = signal<WorkingTreeDiff | undefined>(undefined);

/** Shows the window: given by `setupDiffWithWorkingTree`, run before any. */
let reveal: () => void;

/** Shows what differs between the working tree and `diff.ref`, in the Changes tool window. */
export function showDiffWithWorkingTree(diff: WorkingTreeDiff): void {
  shown.set({ ...diff });
  reveal();
}

/** Where the window is shown from: the app registers it the first time, then shows it. */
export function setupDiffWithWorkingTree(show: () => void): void {
  reveal = show;
}

/** The Changes tool window's content: IntelliJ's words over the files that differ. */
export function DiffWithWorkingTree(props: {
  open: (tab: Tab, chain?: readonly string[]) => void;
}): () => Node {
  return () => {
    const diff = shown.get();
    if (!diff) return <p class="playground-project__empty">Nothing compared</p>;
    return (
      <div class="playground-working-tree-diff">
        <p class="playground-compare__explanation">
          Difference between current working tree on{' '}
          <code>
            <b>{diff.current}</b>
          </code>{' '}
          and files in{' '}
          <code>
            <b>{diff.ref}</b>
          </code>
          :
        </p>
        <CommitFiles
          host={diff.host}
          worktree={diff.worktree}
          range={{ from: diff.ref }}
          label={`Changes Between ${diff.ref} and Current Working Tree`}
          empty="No differences"
          open={props.open}
        />
      </div>
    );
  };
}
