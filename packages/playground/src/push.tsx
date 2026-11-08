// Pushing, as IntelliJ's Push dialog (Git → Push…, and the Commit window's Commit and Push…): the
// checked-out branch, where it goes ("main → origin : main", "New" when the push makes it there),
// and the commits that aren't there yet, with the selected row's files beside them (PushLog); Push
// pushes them, "Pushing…" on the status bar meanwhile. How it went is a notification, as
// IntelliJ's GitPushResultNotification: "Pushed 2 commits to origin/main", "Pushed main to new
// branch origin/main", "Everything is up to date", or "Push rejected" or "Push failed", which stay.

import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import {
  active,
  activeProject,
  currentHost,
  gitRepository,
  hostFor,
  type Host,
  type ProjectState,
} from './environments.js';
import { CommitFiles, EMPTY_TREE, type LogCommit } from './git-log.js';
import { notifications } from './notifications.js';

/** What a push of the checked-out branch sends: the host's `git.outgoing`. */
interface Outgoing {
  branch: string | undefined;
  remote: string | undefined;
  target: string | undefined;
  isNew: boolean;
  commits: LogCommit[];
}

/** How a push went: the host's `git.push`. */
interface Pushed {
  commits: number;
  remote: string;
  target: string;
  isNew: boolean;
}

/** Why nothing can be pushed, if so (Cerebro's words: IntelliJ's dialog offers Define remote). */
function unpushable(out: Outgoing): string | undefined {
  if (out.branch === undefined) return 'No branch is checked out';
  if (out.remote === undefined) return 'The repository has no remote';
  return undefined;
}

/** While a push is under way: one at a time. */
export const pushing = signal(false);

/** A row of the dialog's tree: the repository, where its branch goes, or a commit to push. */
type PushRow = { kind: 'repository' } | { kind: 'commit'; commit: LogCommit };

const REPOSITORY: PushRow = { kind: 'repository' };

/** A commit's tooltip, as IntelliJ's (`push.commit.node.tooltip`): hash, date, author, message. */
const tooltipOf = (commit: LogCommit) =>
  `${commit.hash.slice(0, 8)}  ${new Date(commit.time).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}  by ${commit.author}\n\n${[commit.subject, commit.body].filter(Boolean).join('\n\n')}`;

/** The dialog's two panes: the repository and its commits, and the selected row's files. */
function PushLog(props: { worktree: string; out: Outgoing; host: Host }): Node {
  const { out } = props;
  const log = new TreeModel<PushRow>({
    children: (row) =>
      row ? out.commits.map((commit) => ({ kind: 'commit', commit })) : [REPOSITORY],
    key: (row) => (row.kind === 'repository' ? '\u0000repository' : row.commit.hash),
    isLeaf: (row) => row.kind === 'commit',
  });
  // As IntelliJ's: the repository open, and selected, for all the commits' files.
  log.expand(REPOSITORY);
  log.select('\u0000repository');
  const selected = () => {
    const key = log.selected;
    return key === '\u0000repository' ? out.commits : out.commits.filter((c) => c.hash === key);
  };
  return (
    <div class="playground-push__panes">
      <div class="playground-push__log">
        <TreeView
          model={log}
          label="Commits to push"
          row={(row) =>
            row.kind === 'repository' ? (
              <span class="playground-push__target">
                <span>{out.branch}</span>
                <span class="playground-push__arrow">→</span>
                <span>{`${out.remote as string} : ${out.target as string}`}</span>
                {out.isNew ? <span class="playground-push__new">New</span> : null}
              </span>
            ) : (
              <span class="playground-push__commit" title={tooltipOf(row.commit)}>
                {row.commit.subject}
              </span>
            )
          }
        />
      </div>
      <div class="playground-push__files">
        {() => {
          const commits = selected();
          if (commits.length === 0) {
            return <p class="playground-project__empty">No commits selected</p>;
          }
          // Newest first: from the oldest's parent to the newest.
          const oldest = commits.at(-1) as LogCommit;
          return (
            <CommitFiles
              host={props.host}
              worktree={props.worktree}
              range={{ from: oldest.parents[0] ?? EMPTY_TREE, to: (commits[0] as LogCommit).hash }}
              label="Changes to push"
            />
          );
        }}
      </div>
    </div>
  );
}

/** Opens the Push dialog for a worktree's branch, and pushes when its Push is pressed. */
export async function openPush(worktree: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host || pushing.peek()) return;
  const out = (await host.request('git.outgoing', { path: worktree })) as Outgoing;
  const why = unpushable(out);
  // A host means a project is open.
  const project = activeProject() as ProjectState;
  const accepted = await openDialog<true>({
    title: `Push Commits to ${project.name}`,
    ok: {
      label: 'Push',
      enabled: () => why === undefined && (out.commits.length > 0 || out.isNew),
      accept: () => true,
    },
    width: 800,
    content: () => (
      <div class="playground-push">
        {why === undefined ? (
          <PushLog worktree={worktree} out={out} host={host} />
        ) : (
          <p class="playground-push__target">{why}</p>
        )}
      </div>
    ),
  }).result;
  if (!accepted) return;
  const where = `${out.remote as string}/${out.target as string}`;
  pushing.set(true);
  try {
    const pushed = (await host.request('git.push', { path: worktree })) as Pushed;
    const n = pushed.commits;
    notifications.notify({
      title: pushed.isNew
        ? `Pushed ${out.branch as string} to new branch ${pushed.remote}/${pushed.target}`
        : n === 0
          ? 'Everything is up to date'
          : `Pushed ${String(n)} ${n === 1 ? 'commit' : 'commits'} to ${pushed.remote}/${pushed.target}`,
      group: 'push',
    });
  } catch (error) {
    const rejected = (error as Error).message.includes('[rejected]');
    notifications.notify({
      title: rejected ? 'Push rejected' : 'Push failed',
      content: rejected ? `Push to ${where} was rejected` : (error as Error).message,
      type: rejected ? 'warning' : 'error',
      display: 'sticky',
      group: 'push',
    });
  } finally {
    pushing.set(false);
  }
}

/** Git → Push…, with IntelliJ's Ctrl+Shift+K. */
export function setupPush(services: MenuServices): void {
  const { commands, menus, keymap } = services;
  commands.register({
    id: 'vcs.push',
    label: 'Push',
    icon: 'push',
    dialog: true,
    enabled: () =>
      active() !== undefined &&
      currentHost() !== undefined &&
      gitRepository.get() &&
      !pushing.get(),
    run: () =>
      openPush((active() as NonNullable<ReturnType<typeof active>>).id).catch((error: unknown) => {
        console.error('Reading what to push failed', error);
      }),
  });
  keymap?.bindDefault('Mod+Shift+K', 'vcs.push');
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.push' }, group: 'a', order: 1 });
}
