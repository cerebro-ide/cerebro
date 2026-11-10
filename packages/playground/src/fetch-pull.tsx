// Git → Fetch and Git → Pull…, as IntelliJ's (`GitFetch`, `GitFetchSupportImpl`, `GitPull`,
// `GitPullDialog`, `GitPullOption`, `GitMergeAction`, `GitOptionsPopupBuilder`, read from its
// source). Fetch fetches every remote, saying what it pruned. Pull asks, in IntelliJ's dialog,
// which remote's branch to pull and with which options, then merges it; with --rebase, the
// branch is updated as Update Project does it. At conflicts, the Conflicts dialog, then the merge
// committed.

import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { resolveConflicts } from './conflicts.js';
import { active, gitRepository, hostFor, type Host } from './environments.js';
import { icon } from './icons.js';
import { notifications } from './notifications.js';
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
const OPTIONS: { flag: string; description: string; excludes: string[] }[] = [
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

/** Whether `flag` goes with those chosen, as IntelliJ's `isOptionSuitable`. */
const suitable = (flag: string, chosen: readonly string[]) =>
  chosen.every((c) => !OPTIONS.find((o) => o.flag === c)?.excludes.includes(flag));

/** Where a repository's pull options are kept, as IntelliJ keeps them per project. */
const optionsKey = (worktree: string) => `cerebro.pull.options:${worktree}`;

function readOptions(worktree: string): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(optionsKey(worktree)) ?? '[]');
    return Array.isArray(kept)
      ? kept.filter((o): o is string => OPTIONS.some((known) => known.flag === o))
      : [];
  } catch {
    return [];
  }
}

function keepOptions(worktree: string, options: readonly string[]): void {
  try {
    localStorage.setItem(optionsKey(worktree), JSON.stringify(options));
  } catch {
    // Not kept: the next pull starts without them.
  }
}

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
  const options = signal(readOptions(worktree));
  const suggesting = signal(false);
  /** The branch field, which the suggestions show under. */
  let field!: HTMLInputElement;
  const error = () => {
    const at = remote.get();
    if (at === undefined) return 'Select the remote to pull from';
    if (branch.get() === '') return 'The branch to pull from should be selected.';
    return remoteBranches(at).includes(branch.get()) ? undefined : 'There is no matching branch.';
  };
  const toggle = (flag: string) => {
    const now = options.peek();
    options.set(now.includes(flag) ? now.filter((o) => o !== flag) : [...now, flag]);
  };
  const modify = (button: HTMLElement) => {
    openPicker<PickerItem>({
      label: 'Add Pull Options',
      placeholder: 'Add Pull Options',
      // Its longest description and flag on one line, as IntelliJ's popup fits them.
      width: 480,
      position: { below: button },
      owner: button,
      items: () =>
        OPTIONS.map((o) => {
          const checked = options.get().includes(o.flag);
          return {
            label: o.description,
            shortcut: o.flag,
            ...(checked ? { icon: () => icon('check') } : {}),
            option: {
              checked,
              enabled: suitable(o.flag, options.get()),
              run: () => {
                toggle(o.flag);
              },
            },
          };
        }),
    });
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
        options: options.peek(),
      }),
    },
    footer: () => (
      <button
        type="button"
        class="playground-link"
        on:click={(event) => {
          modify(event.currentTarget as HTMLElement);
        }}
      >
        Modify options
      </button>
    ),
    content: () => (
      <div class="playground-pull">
        <div class="playground-pull__command">
          <span class="playground-pull__git">git pull</span>
          <select
            class="playground-pull__remote"
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
          <span class="playground-pull__branch">
            <input
              class="playground-pull__field"
              aria-label="Branch"
              placeholder="Specify branch"
              spellcheck={false}
              value={() => branch.get()}
              ref={(element) => {
                field = element;
                requestAnimationFrame(() => {
                  element.focus();
                  element.select();
                });
              }}
              on:input={(event) => {
                branch.set((event.currentTarget as HTMLInputElement).value.trim());
                suggesting.set(true);
              }}
              on:blur={() => {
                suggesting.set(false);
              }}
            />
            {() => {
              const at = remote.get();
              const typed = branch.get();
              const list =
                at === undefined || !suggesting.get()
                  ? []
                  : remoteBranches(at).filter((b) => b !== typed && b.includes(typed));
              return list.length === 0 ? null : (
                <ul
                  class="playground-pull__suggestions"
                  role="listbox"
                  ref={(list) => {
                    // Under the field, over the dialog's edge: its content would clip it.
                    const at = field.getBoundingClientRect();
                    list.style.left = `${String(at.left)}px`;
                    list.style.top = `${String(at.bottom + 2)}px`;
                    list.style.width = `${String(at.width)}px`;
                  }}
                >
                  {list.map((b) => (
                    <li
                      role="option"
                      class="playground-pull__suggestion"
                      on:pointerdown={(event) => {
                        // Chosen, not a press that leaves the field first.
                        event.preventDefault();
                        branch.set(b);
                        suggesting.set(false);
                      }}
                    >
                      {b}
                    </li>
                  ))}
                </ul>
              );
            }}
          </span>
        </div>
        {() =>
          options.get().length === 0 ? null : (
            <div class="playground-pull__options">
              {options.get().map((flag) => (
                <span class="playground-pull__option">
                  {flag}
                  <button
                    type="button"
                    class="playground-pull__remove"
                    aria-label={`Remove ${flag}`}
                    on:click={() => {
                      toggle(flag);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )
        }
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error() ?? ''}
        </span>
      </div>
    ),
  }).result;
  if (chosen) keepOptions(worktree, chosen.options);
  return chosen;
}

/** The host's `git.pull`. */
type Pulled =
  { kind: 'pulled'; files: number; commits: number } | { kind: 'conflicts'; resume: unknown };

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** Says how a pull went, as IntelliJ's `GitMergeAction` does. */
function reportPulled(pulled: { files: number; commits: number }): void {
  notifications.notify({
    title:
      pulled.commits === 0
        ? 'All files are up to date'
        : `${plural(pulled.files, 'file')} updated in ${plural(pulled.commits, 'commit')}`,
  });
}

/** Says why a pull failed, in IntelliJ's words where it has its own. */
function reportFailed(error: Error): void {
  const message = error.message;
  const untracked = /untracked working tree files would be overwritten/.test(message);
  const local = !untracked && /would be overwritten by merge/.test(message);
  notifications.notify({
    title: untracked
      ? 'Untracked Files Prevent Pull'
      : local
        ? 'Git Pull Failed'
        : 'Git Pull failed',
    content: local
      ? 'Your local changes will be overwritten by pull.\nCommit, stash, or revert them to proceed.'
      : message,
    type: 'error',
    display: 'sticky',
  });
}

/** Pulls what the dialog chose: merged, or rebased as Update Project does. */
async function pull(host: Host, worktree: string, chosen: PullChoice): Promise<void> {
  if (chosen.options.includes('--rebase')) {
    await updateProject(worktree, { remote: chosen.remote, branch: chosen.branch });
    return;
  }
  pullingFrom.set(chosen.remote);
  try {
    const pulled = (await host.request('git.pull', { path: worktree, ...chosen })) as Pulled;
    if (pulled.kind === 'pulled') {
      reportPulled(pulled);
      return;
    }
    // As IntelliJ's: the Conflicts dialog, and the merge committed once none is left.
    if (!(await resolveConflicts(worktree))) {
      notifications.notify({
        title: '',
        content: 'There are pending unresolved conflicts.',
        type: 'warning',
        display: 'sticky',
        actions: [
          {
            label: 'Resolve…',
            run: () => {
              void resolveConflicts(worktree).then(() => refreshAll(worktree));
            },
          },
        ],
      });
      return;
    }
    // Without --no-commit, the merge committed; then how it went, as without conflicts.
    if (chosen.options.includes('--no-commit')) return;
    reportPulled(
      (await host.request('git.continueUpdate', { path: worktree, resume: pulled.resume })) as {
        files: number;
        commits: number;
      },
    );
  } catch (error) {
    reportFailed(error as Error);
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
    enabled: () => target() !== undefined && !fetching.get(),
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
