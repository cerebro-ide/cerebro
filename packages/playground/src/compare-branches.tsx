// Compare with Current, as IntelliJ's (`GitCompareWithBranchAction`, `GitBrancher.compare`,
// `GitCompareBranchesUi`): an editor tab, "Compare: feature and main", with two Logs one over the
// other, each with what a commit there changes beside it. The top one lists the commits the branch
// has that the current one doesn't; the bottom one, the other way round. Each says so above it, and
// when it has none, that the other has them all.

import type { Tab } from '@cerebro-ide/layout';
import { computed } from '@cerebro-ide/reactive';
import { Splitter } from '@cerebro-ide/ui-layout';
import { openContextMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { TreeView } from '@cerebro-ide/ui-tree';
import { hostFor, type Host } from './environments.js';
import { CommitPane, CommitRow, commitContext, Log, PANE_WIDTH, paneContext } from './git-log.js';
import { branchName, isTag, type BranchesContext } from './log-branches.js';

/** A comparison's tab id: `compare:main..feature`. A ref's name has no `..` (git check-ref-format). */
const COMPARE_ID = /^compare:(.+?)\.\.(.+)$/s;

/** The tab comparing `branch` with `current`, as IntelliJ names it ("Compare: feature and main"). */
export const compareTab = (current: string, branch: string): Tab => ({
  id: `compare:${current}..${branch}`,
  title: `Compare: ${branch} and ${current}`,
});

/** What a comparison's tab compares, if it's one. */
export function compareRefs(tabId: string): { current: string; branch: string } | undefined {
  const match = COMPARE_ID.exec(tabId);
  return match ? { current: match[1] as string, branch: match[2] as string } : undefined;
}

/** A comparison's tab: what `branch` has that `current` doesn't, over the other way round. */
export function CompareBranches(props: {
  worktree: string;
  current: string;
  branch: string;
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  const host = hostFor(props.worktree);
  if (!host)
    return <p class="playground-project__empty">The comparison shows in the desktop app.</p>;
  const half = (start: string, end: string) => (
    <CompareHalf {...props} host={host} start={start} end={end} />
  );
  const top = half(props.current, props.branch) as HTMLElement;
  return (
    <div class="playground-compare">
      {top}
      <Splitter
        line="horizontal"
        start={() => top.offsetHeight}
        onDrag={(height, delta) => {
          top.style.flex = `0 0 ${String(Math.max(0, height + delta))}px`;
        }}
      />
      {half(props.branch, props.current)}
    </div>
  );
}

/** The commits `end` has that `start` doesn't, as IntelliJ's range-filtered Log, with its words. */
function CompareHalf(props: {
  worktree: string;
  host: Host;
  start: string;
  end: string;
  services: MenuServices;
  open: (tab: Tab, chain?: readonly string[]) => void;
}): Node {
  const log = new Log(props.host, props.worktree);
  const reload = () => log.filter(`${props.start}..${props.end}`);
  void reload();
  const empty = computed(() => log.loaded.get() && log.commits.get().length === 0);
  const list = () => {
    const error = log.error.get();
    if (error !== undefined) return <p class="playground-project__empty">{error}</p>;
    if (empty.get()) {
      return (
        <p class="playground-project__empty">
          {props.start} contains all commits from {props.end}
        </p>
      );
    }
    return (
      <TreeView
        model={log.model}
        label={`Commits in ${props.end} not in ${props.start}`}
        row={(commit) => <CommitRow commit={commit} log={log} />}
        onContextMenu={(event, commit) => {
          openContextMenu(props.services, 'log/commit', event, commitContext(log, commit, reload));
        }}
      />
    );
  };
  const pane = (
    <div class="playground-log__pane">
      <CommitPane
        services={props.services}
        log={log}
        host={props.host}
        worktree={props.worktree}
        open={props.open}
      />
    </div>
  ) as HTMLElement;
  pane.style.width = `${String(PANE_WIDTH)}px`;
  return (
    <div class="playground-compare__half">
      <p class="playground-compare__explanation">
        Commits that exist in{' '}
        <code>
          <b>{props.end}</b>
        </code>{' '}
        but don't exist in{' '}
        <code>
          <b>{props.start}</b>
        </code>
      </p>
      <div class="playground-log">
        <div class="playground-log__commits">
          <div class="playground-log__list">{list}</div>
        </div>
        <Splitter
          line="vertical"
          start={() => pane.offsetWidth}
          onDrag={(width, delta) => {
            pane.style.width = `${String(Math.max(0, width - delta))}px`;
          }}
        />
        {pane}
      </div>
    </div>
  );
}

/** Opens a tab in the active environment's editor: given by `setupCompare`, run before any. */
let openTab: (tab: Tab) => void;

/** Opens the comparison of `branch` with `current`, or shows it if it's open. */
export function compareWithCurrent(current: string, branch: string): void {
  openTab(compareTab(current, branch));
}

/**
 * The Log's branches pane's Compare with Current, as IntelliJ's (`ShowBranchDiffAction`, its icon
 * Diff's): for a branch that isn't the current one; and where its tabs open.
 */
export function setupCompare(services: MenuServices, open: (tab: Tab) => void): void {
  openTab = open;
  services.commands.register<BranchesContext | undefined>({
    id: 'log.branches.compare',
    label: 'Compare with Current',
    icon: 'diff',
    enabled: (c) => {
      const selection = paneContext(c)?.selection;
      return selection?.kind === 'branch' && !selection.current && !isTag(selection.ref);
    },
    run: (c) => {
      const pane = paneContext(c) as BranchesContext;
      const { ref } = pane.selection as { ref: string };
      compareWithCurrent(pane.current ?? 'HEAD', branchName(ref));
    },
  });
}
