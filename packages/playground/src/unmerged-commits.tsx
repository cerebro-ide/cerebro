// The commits a branch deleted unmerged had, as IntelliJ's `GitBranchIsNotFullyMergedDialog`
// (from the deletion's View Commits): its words over the commits not in the branch it wasn't
// merged to, beside the selected one's files (`GitCommitListWithDiffPanel`); Restore, at the left,
// puts the branch back, and Close, the default, leaves it deleted.

import type { Tab } from '@cerebro-ide/layout';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { formatCommitDate } from './dates.js';
import type { Host } from './environments.js';
import { CommitFiles, PAGE, rangeOf, type LogCommit } from './git-log.js';

/** A branch deleted unmerged: its name, where it was, and where it wasn't merged to. */
export interface Unmerged {
  host: Host;
  worktree: string;
  name: string;
  tip: string;
  base: string;
}

/** Shows the commits; whether Restore was chosen. */
export async function showUnmergedCommits(
  branch: Unmerged,
  open: (tab: Tab, chain?: readonly string[]) => void,
): Promise<boolean> {
  const { host, worktree, name, tip, base } = branch;
  const commits = (await host.request('git.log', {
    worktree,
    skip: 0,
    max: PAGE,
    branches: [`${base}..${tip}`],
  })) as LogCommit[];
  const list = new TreeModel<LogCommit>({
    children: () => commits,
    key: (commit) => commit.hash,
    isLeaf: () => true,
  });
  await list.load(undefined, true);
  list.select(commits[0]?.hash);
  const restored = await openDialog<true>({
    title: 'Branch Was Not Fully Merged',
    width: 860,
    content: () => [
      <p class="cerebro-selectable">
        The branch {name} was not fully merged to {base}.
        <br />
        Below is the list of unmerged commits.
      </p>,
      <div class="playground-unmerged">
        <div class="playground-unmerged__commits">
          <TreeView
            model={list}
            label="Unmerged commits"
            row={(commit) => [
              <span class="playground-log__subject">{commit.subject}</span>,
              <span class="playground-log__author">{commit.author}</span>,
              <span class="playground-log__date">{formatCommitDate(commit.time)}</span>,
            ]}
          />
        </div>
        {() => {
          const commit = commits.find((c) => c.hash === list.selected);
          return commit ? (
            <CommitFiles
              host={host}
              worktree={worktree}
              range={rangeOf(commit)}
              label={`Changes in ${commit.hash.slice(0, 8)}`}
              open={open}
            />
          ) : null;
        }}
      </div>,
    ],
    ok: { label: 'Restore', accept: () => true },
    cancelLabel: 'Close',
  }).result;
  return restored === true;
}
