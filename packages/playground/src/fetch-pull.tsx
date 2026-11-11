// Git → Fetch and Git → Pull…, as IntelliJ's (`GitFetch`, `GitFetchSupportImpl`, `GitPull`,
// `GitPullDialog`, `GitPullOption`, `GitMergeAction`, `GitOptionsPopupBuilder`, read from its
// source). Fetch fetches every remote, saying what it pruned; it's off while there's none. Pull asks, in IntelliJ's dialog,
// which remote's branch to pull and with which options, then merges it; with --rebase, the
// branch is updated as Update Project does it. At conflicts, the Conflicts dialog, then the merge
// committed.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { active, gitRepository, hostFor, type Host } from './environments.js';
import { branchField, gitOptions, type GitOption } from './git-options.js';
import { mergeAction } from './merge-action.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { refreshAll } from './shelf.js';
import { updateProject, updating } from './update.js';

/** A fetch under way, as IntelliJ's background task "Fetching…". */
export const fetching = signal(false);
/** The remote a pull is under way from, as IntelliJ's "Pulling changes from origin". */
export const pullingFrom = signal<string | undefined>(undefined);

/** The host's `git.fetch`. */
interface Fetched {
  pruned: string[];
  failed: { remote: string; error: string }[];
}

/** Fetches every remote of a worktree's repository, saying how it went, as IntelliJ's. */
async function fetchAll(host: Host, worktree: string): Promise<void> {
  fetching.set(true);
  try {
    const fetched = (await host.request('git.fetch', { path: worktree })) as Fetched;
    // Each remote's error, named when there are several.
    const errors = fetched.failed.map((f) =>
      fetched.failed.length > 1 ? `${f.remote}: ${f.error}` : f.error,
    );
    const content = [...errors, ...fetched.pruned].join('\n');
    notifications.notify(
      errors.length > 0
        ? { title: 'Fetch failed', content, type: 'error', display: 'sticky' }
        : { title: 'Fetch successful', content },
    );
  } catch (error) {
    notifications.notify({
      title: 'Fetch failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  } finally {
    fetching.set(false);
  }
}

/** IntelliJ's `GitPullOption`: each flag, what it does, and those it can't go with. */
const OPTIONS: GitOption[] = [
  {
    flag: '--rebase',
    description: 'Rebase the current branch on top of incoming changes',
    excludes: ['--ff-only', '--no-ff', '--squash', '--no-commit'],
  },
  {
    flag: '--ff-only',
    description: 'Merge only if it can be fast-forwarded',
    excludes: ['--no-ff', '--squash', '--rebase'],
  },
  {
    flag: '--no-ff',
    description: 'Create a merge commit even if it can be fast-forwarded',
    excludes: ['--ff-only', '--squash', '--rebase'],
  },
  {
    flag: '--squash',
    description: 'Create a single commit for all pulled changes',
    excludes: ['--no-ff', '--ff-only', '--rebase'],
  },
  {
    flag: '--no-commit',
    description: 'Merge, but do not commit the result',
    excludes: ['--rebase'],
  },
  {
    flag: '--no-verify',
    description: 'Bypass the pre-merge and commit message hooks',
    excludes: [],
  },
];

/** The host's `git.tracking`. */
interface Tracking {
  branch: string | undefined;
  remotes: string[];
  upstream: { remote: string; branch: string } | undefined;
}

/** What the Pull dialog chose. */
export interface PullChoice {
  remote: string;
  branch: string;
  options: string[];
}

/**
 * IntelliJ's Pull dialog: "Pull to main", then `git pull`, the remote, and the branch there (its
 * branches suggested as it's typed); the options chosen under it, each removable, and Modify
 * options at the buttons' left. The upstream's remote and branch to start with.
 */
async function askPull(host: Host, worktree: string): Promise<PullChoice | undefined> {
  const [tracking, branches] = (await Promise.all([
    host.request('git.tracking', { path: worktree }),
    host.request('git.branches', { worktree }),
  ])) as [Tracking, { ref: string }[]];
  const remoteBranches = (remote: string) =>
    branches
      .map((b) => b.ref)
      .filter((ref) => ref.startsWith(`refs/remotes/${remote}/`))
      .map((ref) => ref.slice(`refs/remotes/${remote}/`.length))
      .filter((b) => b !== 'HEAD')
      .sort();
  /** The branch to start with for a remote, as IntelliJ's: the upstream, else the same name. */
  const startingBranch = (remote: string) =>
    tracking.upstream?.remote === remote
      ? tracking.upstream.branch
      : (remoteBranches(remote).find((b) => b === tracking.branch) ?? '');
  // IntelliJ's `getCurrentOrDefaultRemote`: the upstream's, else origin, else the first.
  const remote = signal(
    tracking.upstream?.remote ??
      (tracking.remotes.includes('origin') ? 'origin' : tracking.remotes[0]),
  );
  const branch = signal(remote.peek() === undefined ? '' : startingBranch(remote.peek() as string));
  const options = gitOptions(OPTIONS, 'Add Pull Options', `cerebro.pull.options:${worktree}`, 480);
  const error = () => {
    const at = remote.get();
    if (at === undefined) return 'Select the remote to pull from';
    if (branch.get() === '') return 'The branch to pull from should be selected.';
    return remoteBranches(at).includes(branch.get()) ? undefined : 'There is no matching branch.';
  };
  const chosen = await openDialog<PullChoice>({
    title: tracking.branch === undefined ? 'Pull' : `Pull to ${tracking.branch}`,
    width: 560,
    ok: {
      label: 'Pull',
      enabled: () => error() === undefined,
      accept: () => ({
        remote: remote.peek() as string,
        branch: branch.peek(),
        options: options.chosen.peek(),
      }),
    },
    footer: options.link,
    content: () => (
      <div class="playground-git-command">
        <div class="playground-git-command__row">
          <span class="playground-git-command__git">git pull</span>
          <select
            class="playground-git-command__remote"
            aria-label="Remote"
            disabled={tracking.remotes.length === 0}
            on:change={(event) => {
              const at = (event.currentTarget as HTMLSelectElement).value;
              remote.set(at);
              branch.set(startingBranch(at));
            }}
          >
            {tracking.remotes.length === 0 ? (
              <option>None</option>
            ) : (
              tracking.remotes.map((r) => (
                <option value={r} selected={r === remote.peek()}>
                  {r}
                </option>
              ))
            )}
          </select>
          {branchField(branch, () => {
            const at = remote.get();
            return at === undefined ? [] : remoteBranches(at);
          })}
        </div>
        {options.shown}
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error() ?? ''}
        </span>
      </div>
    ),
  }).result;
  if (chosen) options.keep();
  return chosen;
}

/** Pulls what the dialog chose: merged, or rebased as Update Project does. */
async function pull(host: Host, worktree: string, chosen: PullChoice): Promise<void> {
  if (chosen.options.includes('--rebase')) {
    await updateProject(worktree, { remote: chosen.remote, branch: chosen.branch });
    return;
  }
  pullingFrom.set(chosen.remote);
  try {
    await mergeAction(
      host,
      worktree,
      'Pull',
      () => host.request('git.pull', { path: worktree, ...chosen }),
      !chosen.options.includes('--no-commit'),
    );
  } finally {
    pullingFrom.set(undefined);
  }
}

/** Git → Fetch and Git → Pull…, after Update Project, as IntelliJ's. */
export function setupFetchPull(services: MenuServices): void {
  const { commands, menus } = services;
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host && gitRepository.get() ? { worktree: env.id, host } : undefined;
  };
  /** Runs on the active worktree, then reads the lists again; what fails besides is logged. */
  const on = (name: string, run: (host: Host, worktree: string) => Promise<void>) => {
    const at = target();
    if (!at) return undefined;
    return run(at.host, at.worktree)
      .then(() => refreshAll(at.worktree))
      .catch((error: unknown) => {
        console.error(`${name} failed`, error);
      });
  };
  commands.register({
    id: 'vcs.fetch',
    label: 'Fetch',
    icon: 'fetch',
    // As IntelliJ's: off without a remote, and while a fetch runs.
    enabled: () => {
      const at = target();
      return at !== undefined && stateOf(at.worktree).remotes !== false && !fetching.get();
    },
    run: () => on('Fetch', fetchAll),
  });
  commands.register({
    id: 'vcs.pull',
    label: 'Pull',
    dialog: true,
    enabled: () => target() !== undefined && pullingFrom.get() === undefined && !updating.get(),
    run: () =>
      on('Pull', async (host, worktree) => {
        const chosen = await askPull(host, worktree);
        if (chosen) await pull(host, worktree, chosen);
      }),
  });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.pull' }, group: 'a', order: 3 });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.fetch' }, group: 'a', order: 4 });
}
