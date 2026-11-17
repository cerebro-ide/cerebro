// Show Diff with Working Tree, as IntelliJ's (`GitShowDiffWithRefAction`,
// `GitShowDiffWithBranchPanel`, `CompareBranchesDiffPanel`): the files that differ between the
// working tree and a branch or tag, in a Changes tool window on the left, which appears the first
// time (IntelliJ's `ChangesBrowserToolWindow`). A comparison takes the place of the one before.
// Each file opens its diff: the file in the branch, and as it is. Get from Branch, in the
// toolbar and a file's menu, makes the selected file as the branch has it (IntelliJ's
// `CompareBranchesDiffPanel.GetVersionActionProvider`, read from its source).
// A commit's Compare with Local in the Log shows there too, as IntelliJ's (`GitLogDiffHandler`,
// `CompareWithLocalDialog` as a tab): its words over the files, and its Get. So does a folder's
// Compare with Branch or Tag (`DvcsCompareWithAction`).

import type { Child } from '@cerebro-ide/jsx';
import type { Tab } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openContextMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { replacing, type Change } from './changes.js';
import { sideTitles } from './diff-viewer.js';
import { saveBeforeGit } from './documents.js';
import type { Host } from './environments.js';
import { currentBranch } from './git-fields.js';
import {
  CommitFiles,
  getRevision,
  REFRESH_KEY,
  shortcutOf,
  type LogCommitContext,
} from './git-log.js';
import { icon } from './icons.js';

/** A branch or tag compared with the working tree of `worktree`, where `current` is checked out. */
export interface BranchDiff {
  host: Host;
  worktree: string;
  ref: string;
  current: string;
}

/** What the window compares the working tree of `worktree` with, and how it says so. */
interface WorkingTreeDiff {
  host: Host;
  worktree: string;
  /** A branch, a tag, or a commit's hash. */
  ref: string;
  /** The only paths compared (a commit's, under the Log's Show Only Affected Changes). */
  paths?: readonly string[];
  /** Said over the files. */
  explanation: () => Child;
  /** Its Get's name, and what makes a file as `ref` has it. */
  get: { label: string; run: (change: Change) => Promise<void> };
  /**
   * Whether it has Refresh: a commit's, as IntelliJ's (`CompareWithLocalDialog.MyRefreshAction`);
   * a branch's reads once (`GitShowDiffWithBranchPanel`).
   */
  refresh?: true;
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

const GET = 'vcsChanges.get';
const REFRESH = 'vcsChanges.refresh';
const FILE_MENU = 'vcsChanges/file';

/** Shows what differs between the working tree and `diff.ref`, in the Changes tool window. */
export function showDiffWithWorkingTree(branch: BranchDiff): void {
  const diff: WorkingTreeDiff = {
    ...branch,
    explanation: () => [
      'Difference between current working tree on ',
      <code>
        <b>{branch.current}</b>
      </code>,
      ' and files in ',
      <code>
        <b>{branch.ref}</b>
      </code>,
      ':',
    ],
    get: { label: 'Get from Branch', run: (change) => getFromBranch(diff, change) },
  };
  shown.set(diff);
  reveal();
}

/**
 * What differs between the working tree and a commit, as IntelliJ's Compare with Local on a commit
 * (`ShowDiffAfterWithLocalFromLogActionProvider`, `GitLogDiffHandler.showDiffForPaths`): its
 * title, "Changes Between abc12345 and local version", over the files; with `paths`, those alone,
 * named after it ("... in src/a.ts, lib", cut at 100 characters: `getTitleForPaths`).
 */
export function showDiffWithCommit(
  host: Host,
  worktree: string,
  hash: string,
  paths?: readonly string[],
): void {
  const title = `Changes Between ${hash.slice(0, 8)} and local version`;
  showDiffWithLocal(
    host,
    worktree,
    hash,
    paths
      ? // A folder's without the Paths filter's closing slash, as IntelliJ's relative path.
        `${title} in ${shortened(paths.map((path) => path.replace(/\/$/, '')).join(', '))}`
      : title,
    paths,
  );
}

/**
 * What differs in a folder between the working tree and a branch or a tag (`ref`, in full), as
 * IntelliJ's Compare with Branch or Tag on one (`DvcsCompareWithAction.showDiffBetweenRevision`):
 * its title, "Difference Between feature and main (Local) Versions in src", the sides' titles of a
 * file's (`sideTitles`), over the files in `folder` (the worktree's own: all of them).
 */
export function showFolderDiffWithRef(
  host: Host,
  worktree: string,
  ref: string,
  folder: { path: string; name: string },
): void {
  const [theirs, local] = sideTitles({ from: ref }, currentBranch(worktree));
  showDiffWithLocal(
    host,
    worktree,
    ref,
    `Difference Between ${theirs} and ${local} Versions in ${folder.name}`,
    folder.path === '' ? undefined : [`${folder.path}/`],
  );
}

/**
 * IntelliJ's `CompareWithLocalDialog`, as a tab of the window: `title` over the files that differ
 * from `ref` (those under `paths` alone, if given), with Refresh, and Get, which makes one as `ref`
 * has it, from where it was if renamed since (`GetVersionActionProvider`).
 */
function showDiffWithLocal(
  host: Host,
  worktree: string,
  ref: string,
  title: string,
  paths: readonly string[] | undefined,
): void {
  const diff: WorkingTreeDiff = {
    host,
    worktree,
    ref,
    ...(paths ? { paths } : {}),
    refresh: true,
    explanation: () => title,
    get: {
      label: 'Get',
      run: async (change) => {
        await getRevision(host, worktree, ref, change.path, change.from ?? change.path);
        shown.set({ ...diff });
      },
    },
  };
  shown.set({ ...diff });
  reveal();
}

/**
 * A text cut to 100 characters, its end three dots, as IntelliJ's `shortenTextWithEllipsis(text,
 * 100, 0)` (its "..." rather than "…": `useEllipsisSymbol` false).
 */
export function shortened(text: string): string {
  return text.length <= 100 ? text : `${text.slice(0, 97)}...`;
}

/**
 * Where the window is shown from (the app registers it the first time, then shows it), and Get
 * from Branch.
 */
export function setupDiffWithWorkingTree(services: MenuServices, show: () => void): void {
  reveal = show;
  services.commands.register({
    id: GET,
    label: 'Get from Branch',
    // The comparison's: Get from Branch, or a commit's Get.
    text: () => shown.get()?.get.label ?? 'Get from Branch',
    icon: 'download',
    enabled: () => selected() !== undefined,
    run: async () => {
      const change = selected();
      if (!change) return;
      // A file is selected only in a comparison shown.
      await (shown.peek() as WorkingTreeDiff).get.run(change);
    },
  });
  services.menus.contribute({ menu: FILE_MENU, item: { command: GET }, group: 'a' });
  // A commit's comparison's Refresh, as IntelliJ's: documents saved, then the list read again; its
  // key IntelliJ's Refresh, the Log's too, while the window has the keyboard.
  services.commands.register({
    id: REFRESH,
    label: 'Refresh',
    icon: 'refresh',
    enabled: (context) =>
      shown.get()?.refresh === true &&
      ((context as { source?: string } | undefined)?.source === 'compare' ||
        document.activeElement?.closest('.playground-working-tree-diff') != null),
    run: async () => {
      await saveBeforeGit();
      shown.set({ ...(shown.peek() as WorkingTreeDiff) });
    },
  });
  services.keymap?.bindDefault(REFRESH_KEY[services.keymap.platform], REFRESH);
  // A commit's, in the Log, after Copy Revision Number as IntelliJ's (Vcs.ShowDiffWithLocal in
  // Vcs.Log.ContextMenu); documents saved first, as IntelliJ's.
  services.commands.register<LogCommitContext>({
    id: 'log.compareWithLocal',
    label: 'Compare with Local',
    run: async (c) => {
      await saveBeforeGit();
      showDiffWithCommit(c.host, c.worktree, c.commit.hash, c.affected);
    },
  });
  services.menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.compareWithLocal' },
    group: 'b',
  });
}

/**
 * Makes the file as `diff.ref` has it, as IntelliJ's: after asking when it has local changes,
 * which are lost (`ReplaceFileConfirmationDialog`), the documents saved; then the list read again.
 * The list's sides: the ref's, then the working tree's.
 */
async function getFromBranch(diff: WorkingTreeDiff, change: Change): Promise<void> {
  const { host, worktree, ref } = diff;
  try {
    if (!(await replacing(host, worktree, change.path, `Get from Branch '${ref}'`))) return;
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

/** Where the toolbar's commands come from. */
const FROM_COMPARE = { source: 'compare' };

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
        <p class="playground-compare__explanation">{diff.explanation()}</p>
        <div class="playground-changes__toolbar" role="toolbar" aria-label="Changes">
          {/* First, as IntelliJ's. */}
          {diff.refresh ? (
            <ToolbarButton
              commands={services.commands}
              command={REFRESH}
              icon={icon('refresh')}
              shortcut={shortcutOf(services, REFRESH)}
              context={() => FROM_COMPARE}
            />
          ) : null}
          <ToolbarButton commands={services.commands} command={GET} icon={icon('download')} />
        </div>
        <CommitFiles
          services={services}
          host={diff.host}
          worktree={diff.worktree}
          range={{ from: diff.ref }}
          paths={diff.paths}
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
