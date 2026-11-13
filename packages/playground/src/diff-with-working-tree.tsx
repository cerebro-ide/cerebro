// Show Diff with Working Tree, as IntelliJ's (`GitShowDiffWithRefAction`,
// `GitShowDiffWithBranchPanel`, `CompareBranchesDiffPanel`): the files that differ between the
// working tree and a branch or tag, in a Changes tool window on the left, which appears the first
// time (IntelliJ's `ChangesBrowserToolWindow`). A comparison takes the place of the one before.
// Each file opens its diff: the file in the branch, and as it is. Get from Branch, in the
// toolbar and a file's menu, makes the selected file as the branch has it (IntelliJ's
// `CompareBranchesDiffPanel.GetVersionActionProvider`, read from its source).

import type { Tab } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openContextMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import type { Change } from './changes.js';
import { saveBeforeGit } from './documents.js';
import type { Host } from './environments.js';
import { CommitFiles } from './git-log.js';
import { icon } from './icons.js';

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

/**
 * What reads the selected file's change, from the window's list while it shows: a signal, as each
 * comparison's list gives its own, after the toolbar has read the one before.
 */
const selection = signal<() => Change | undefined>(() => undefined);
const selected = () => selection.get()();

const GET_FROM_BRANCH = 'vcsChanges.getFromBranch';
const FILE_MENU = 'vcsChanges/file';

/** Shows what differs between the working tree and `diff.ref`, in the Changes tool window. */
export function showDiffWithWorkingTree(diff: WorkingTreeDiff): void {
  shown.set({ ...diff });
  reveal();
}

/**
 * Where the window is shown from (the app registers it the first time, then shows it), and Get
 * from Branch.
 */
export function setupDiffWithWorkingTree(services: MenuServices, show: () => void): void {
  reveal = show;
  services.commands.register({
    id: GET_FROM_BRANCH,
    label: 'Get from Branch',
    icon: 'download',
    enabled: () => selected() !== undefined,
    run: async () => {
      const change = selected();
      if (!change) return;
      // A file is selected only in a comparison shown.
      await getFromBranch(shown.peek() as WorkingTreeDiff, change);
    },
  });
  services.menus.contribute({ menu: FILE_MENU, item: { command: GET_FROM_BRANCH }, group: 'a' });
}

/**
 * Makes the file as `diff.ref` has it, as IntelliJ's: after asking when it has local changes,
 * which are lost (`ReplaceFileConfirmationDialog`), the documents saved; then the list read again.
 * The list's sides: the ref's, then the working tree's.
 */
async function getFromBranch(diff: WorkingTreeDiff, change: Change): Promise<void> {
  const { host, worktree, ref } = diff;
  try {
    const local = (await host.request('git.changes', { path: worktree })) as Change[];
    if (local.some((c) => c.path === change.path)) {
      const overwrite = await openDialog<true>({
        title: `Get from Branch '${ref}'`,
        content: () => (
          <p class="cerebro-selectable">File {change.path} has been locally modified.</p>
        ),
        ok: { label: 'Overwrite Modified File', accept: () => true },
      }).result;
      if (!overwrite) return;
    }
    await saveBeforeGit();
    await host.request('git.getFrom', {
      path: worktree,
      ref,
      // Not in the ref: removed. Renamed since: the ref's path back in place of this one.
      checkout: change.status === 'added' ? [] : [change.from ?? change.path],
      remove: change.status === 'added' || change.from !== undefined ? [change.path] : [],
    });
  } catch (error) {
    await openDialog({
      title: 'Cannot Copy Changes',
      content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
      cancelLabel: 'OK',
    }).result;
  }
  // Read again, as IntelliJ's, whatever happened.
  shown.set({ ...diff });
}

/** The Changes tool window's content: IntelliJ's words over the files that differ. */
export function DiffWithWorkingTree(props: {
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): () => Node {
  const { services } = props;
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
        <div class="playground-changes__toolbar" role="toolbar" aria-label="Changes">
          <ToolbarButton
            commands={services.commands}
            command={GET_FROM_BRANCH}
            icon={icon('download')}
          />
        </div>
        <CommitFiles
          services={services}
          host={diff.host}
          worktree={diff.worktree}
          range={{ from: diff.ref }}
          label={`Changes Between ${diff.ref} and Current Working Tree`}
          empty="No differences"
          open={props.open}
          selection={(read) => {
            selection.set(read);
          }}
          onContextMenu={(event) => {
            openContextMenu(services, FILE_MENU, event);
          }}
        />
      </div>
    );
  };
}
