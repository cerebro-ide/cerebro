// Pushing, as IntelliJ's Push dialog (Git → Push…, and the Commit window's Commit and Push…): the
// checked-out branch, where it goes ("main → origin : main", "New" when the push makes it there),
// and the commits that aren't there yet; Push pushes them. How it went is a notification, as
// IntelliJ's GitPushResultNotification: "Pushed 2 commits to origin/main", "Pushed main to new
// branch origin/main", "Everything is up to date", or "Push rejected" or "Push failed", which stay.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import {
  active,
  activeProject,
  currentHost,
  gitRepository,
  hostFor,
  type ProjectState,
} from './environments.js';
import type { LogCommit } from './git-log.js';
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

/** Opens the Push dialog for a worktree's branch, and pushes when its Push is pressed. */
export async function openPush(worktree: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host) return;
  const out = (await host.request('git.outgoing', { path: worktree })) as Outgoing;
  const why = unpushable(out);
  // A host means a project is open.
  const project = activeProject() as ProjectState;
  const pushing = await openDialog<true>({
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
          <div class="playground-push__target">
            <span>{out.branch}</span>
            <span class="playground-push__arrow">→</span>
            <span>{`${out.remote as string} : ${out.target as string}`}</span>
            {out.isNew ? <span class="playground-push__new">New</span> : null}
          </div>
        ) : (
          <p class="playground-push__target">{why}</p>
        )}
        <ul class="playground-push__commits">
          {out.commits.map((commit) => (
            <li class="playground-push__commit" title={commit.hash}>
              {commit.subject}
            </li>
          ))}
        </ul>
      </div>
    ),
  }).result;
  if (!pushing) return;
  const where = `${out.remote as string}/${out.target as string}`;
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
    enabled: () => active() !== undefined && currentHost() !== undefined && gitRepository.get(),
    run: () =>
      openPush((active() as NonNullable<ReturnType<typeof active>>).id).catch((error: unknown) => {
        console.error('Reading what to push failed', error);
      }),
  });
  keymap?.bindDefault('Mod+Shift+K', 'vcs.push');
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.push' }, group: 'a', order: 1 });
}
