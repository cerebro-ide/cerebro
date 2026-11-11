// IntelliJ's branches popup, from the toolbar's branch selector (`GitBranchesTreePopup`, its actions
// in `Git.Branch` and `Git.Branches.List`, `GitNewBranchDialog`, `GitBrancher`'s operations and
// their words in `GitBundle`, read from its source): New Branch…, then the active worktree's local
// and remote branches, searchable, each with its menu. Checkout, Open Worktree (a branch checked out
// in another worktree switches to its environment, Ido's choice: git won't check it out twice),
// New Branch from it, Rebase the current branch onto it, Merge it into the current one, Rename and
// Delete. A merge or rebase stopped at conflicts goes through the Conflicts dialog, as Update
// Project's does.

import type { EnvironmentSpec } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { resolveConflicts } from './conflicts.js';
import { active, hostFor, projectOf, type Host } from './environments.js';
import { icon } from './icons.js';
import { continueRebase } from './merge-rebase.js';
import { notifications } from './notifications.js';
import { isProtected } from './push.js';
import { refreshAll } from './shelf.js';

/** A branch the popup lists: `main`, or a remote one, `origin/main`. */
export interface BranchRef {
  name: string;
  remote: boolean;
}

/** The host's `git.branches`. */
interface HostBranch {
  ref: string;
  current: boolean;
  upstream?: string;
}

/**
 * The active worktree's branches, as last read; the current one, undefined when detached; and the
 * branch each local one tracks, in full, if any.
 */
interface Branches {
  local: string[];
  remote: string[];
  current: string | undefined;
  upstreams: ReadonlyMap<string, string>;
}

const branches = signal<Branches>({
  local: [],
  remote: [],
  current: undefined,
  upstreams: new Map(),
});

/** Reads the active worktree's branches. */
async function readBranches(host: Host, worktree: string): Promise<void> {
  const list = (await host.request('git.branches', { worktree })) as HostBranch[];
  const named = (prefix: string) =>
    list.filter((b) => b.ref.startsWith(prefix)).map((b) => b.ref.slice(prefix.length));
  branches.set({
    local: named('refs/heads/'),
    remote: named('refs/remotes/'),
    current: list.find((b) => b.current)?.ref.slice('refs/heads/'.length),
    upstreams: new Map(
      list.flatMap((b) =>
        b.upstream === undefined ? [] : [[b.ref.slice('refs/heads/'.length), b.upstream]],
      ),
    ),
  });
}

/** The worktree another environment has `branch` checked out in, if one has. */
function elsewhere(branch: BranchRef): EnvironmentSpec | undefined {
  const env = active();
  if (!env || branch.remote) return undefined;
  return projectOf(env.id)
    ?.worktrees.get()
    .find((w) => w.id !== env.id && w.branch === branch.name);
}

/** IntelliJ's quotes around a branch's name in an action's text (`wrapWithQuotes`). */
const quoted = (name: string) => `'${name}'`;

/** Whether a name can't be a branch's, by `git check-ref-format --branch`'s rules. */
function invalidName(name: string): boolean {
  return (
    // Control characters are what's outside space to tilde and beyond ASCII.
    /[^ -~\u0080-\uffff]|[\s~^:?*[\\]|\.\.|@\{|\/\/|^[-/.]|\/\.|[/.]$|^@$/.test(name) ||
    name.split('/').some((part) => part.endsWith('.lock'))
  );
}

interface NamedBranch {
  name: string;
  checkout: boolean;
  overwrite: boolean;
}

/**
 * IntelliJ's New Branch dialog ("Create New Branch") and its Rename's ("Rename Branch x"): the name,
 * and for a new one, Checkout branch (on) and Overwrite existing branch, which a name taken allows.
 */
function branchDialog(
  title: string,
  ok: string,
  value: string,
  renaming: boolean,
): Promise<NamedBranch | undefined> {
  const name = signal(value);
  const checkout = signal(true);
  const overwrite = signal(false);
  const taken = () => branches.get().local.includes(name.get().trim());
  const error = () => {
    const text = name.get().trim();
    if (text === 'HEAD') return 'HEAD is a reserved keyword';
    if (text !== '' && invalidName(text)) return `Branch name ${text} is not valid`;
    if (branches.get().remote.includes(text)) {
      return `Branch name ${text} conflicts with remote branch with the same name`;
    }
    if (taken() && (renaming || !overwrite.get())) {
      return renaming
        ? `Branch name ${text} already exists`
        : `Branch name ${text} already exists. Change the name or overwrite existing branch`;
    }
    return undefined;
  };
  return openDialog<NamedBranch>({
    title,
    width: 420,
    ok: {
      label: ok,
      enabled: () => name.get().trim() !== '' && error() === undefined,
      accept: () => ({
        name: name.get().trim(),
        checkout: checkout.get(),
        overwrite: overwrite.get() && taken(),
      }),
    },
    content: () => [
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">Branch Name:</span>
        <input
          class={() =>
            error() === undefined
              ? 'cerebro-dialog-field__input'
              : 'cerebro-dialog-field__input cerebro-dialog-field__input--invalid'
          }
          type="text"
          spellcheck={false}
          value={name.get()}
          aria-invalid={() => String(error() !== undefined)}
          ref={(input) => {
            queueMicrotask(() => {
              input.select();
            });
          }}
          on:input={(event) => {
            name.set((event.currentTarget as HTMLInputElement).value);
          }}
        />
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error() ?? ''}
        </span>
      </label>,
      renaming ? null : (
        <div class="playground-branch-options">
          <label class="playground-rollback__option">
            <input
              type="checkbox"
              checked={checkout.get()}
              on:change={(event) => {
                checkout.set((event.currentTarget as HTMLInputElement).checked);
              }}
            />
            Checkout branch
          </label>
          <label class="playground-rollback__option">
            <input
              type="checkbox"
              checked={overwrite.get()}
              disabled={() => !taken()}
              on:change={(event) => {
                overwrite.set((event.currentTarget as HTMLInputElement).checked);
              }}
            />
            Overwrite existing branch
          </label>
        </div>
      ),
    ],
  }).result;
}

/**
 * IntelliJ's question before deleting a remote branch (`confirmRemoteBranchDeletion`): Delete or
 * Cancel, and whether the local branches tracking it go too (off to start with), when there are any.
 * Undefined when cancelled.
 */
async function confirmRemoteDeletion(
  name: string,
  tracking: readonly string[],
): Promise<{ withTracking: boolean } | undefined> {
  const withTracking = signal(false);
  const yes = await openDialog<true>({
    title: 'Delete Remote Branch',
    ok: { label: 'Delete', accept: () => true },
    content: () => [
      <p class="cerebro-selectable">{`Delete remote branch ${name}?`}</p>,
      tracking.length === 0 ? null : (
        <label class="playground-rollback__option">
          <input
            type="checkbox"
            on:change={(event) => {
              withTracking.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          {tracking.length === 1
            ? `Delete tracking local branch ${tracking[0] as string} as well`
            : `Delete tracking local branches: ${tracking.join(', ')}`}
        </label>
      ),
    ],
  }).result;
  return yes === true ? { withTracking: withTracking.peek() } : undefined;
}

export interface BranchesSetup {
  /** Reads the worktrees again, for the branch each has: after a checkout. */
  readWorktrees: (worktree: string) => Promise<void>;
  /** Shows a worktree's environment. */
  open: (worktree: string) => void;
}

/** The branches popup's actions, and the popup, for the toolbar's branch selector. */
export function setupBranches(
  services: MenuServices,
  setup: BranchesSetup,
): { pick: (button?: HTMLElement) => PickerHandle<unknown> } {
  const { commands, menus } = services;
  /** The active worktree and its host. */
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host ? { worktree: env.id, host } : undefined;
  };
  /** What's read again after an operation: the lists, the state, the branches, the worktrees'. */
  const after = async (host: Host, worktree: string) => {
    await Promise.all([
      refreshAll(worktree),
      readBranches(host, worktree),
      setup.readWorktrees(worktree),
    ]);
  };
  /** Runs an operation on the active worktree; git's words in an error notification if it fails. */
  const operate = async (
    failure: string,
    run: (host: Host, worktree: string) => Promise<void>,
  ): Promise<void> => {
    const at = target();
    if (!at) return;
    try {
      await run(at.host, at.worktree);
    } catch (error) {
      notifications.notify({
        title: failure,
        content: (error as Error).message,
        type: 'error',
        display: 'sticky',
      });
    }
    // What fails besides is logged.
    await after(at.host, at.worktree).catch((error: unknown) => {
      console.error(`Reading again after "${failure}"`, error);
    });
  };
  const isCurrent = (b: BranchRef) => !b.remote && b.name === branches.get().current;
  const current = () => branches.get().current ?? 'HEAD';

  const newBranch = (from: string | undefined) =>
    operate(`Could not create new branch`, async (host, worktree) => {
      const named = await branchDialog('Create New Branch', 'Create', '', false);
      if (!named) return;
      await host.request('git.createBranch', {
        path: worktree,
        ...named,
        ...(from === undefined ? {} : { from }),
      });
    });
  commands.register({
    id: 'git.newBranch',
    label: 'New Branch',
    dialog: true,
    enabled: () => target() !== undefined,
    run: () => newBranch(undefined),
  });
  commands.register<BranchRef>({
    id: 'git.branch.checkout',
    label: '&Checkout',
    visible: (b) => !isCurrent(b) && elsewhere(b) === undefined,
    run: (b) => {
      return operate(`Could not checkout ${b.name}`, async (host, worktree) => {
        await host.request('git.checkout', { path: worktree, branch: b.name, remote: b.remote });
        notifications.notify({
          content: `Checked out ${b.remote ? b.name.replace(/^[^/]*\//, '') : b.name}`,
        });
      });
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.openWorktree',
    label: 'Open Worktree',
    visible: (b) => elsewhere(b) !== undefined,
    run: (b) => {
      setup.open((elsewhere(b) as EnvironmentSpec).id);
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.newFrom',
    label: 'New Branch from Selected',
    text: (b) => `New Branch from ${quoted(b.name)}`,
    dialog: true,
    run: (b) => newBranch(b.name),
  });
  commands.register<BranchRef>({
    id: 'git.branch.rebase',
    label: 'Rebase Current onto Selected',
    text: (b) => `Rebase ${quoted(current())} onto ${quoted(b.name)}`,
    visible: (b) => !isCurrent(b),
    // IntelliJ's: not with HEAD detached.
    enabled: () => branches.get().current !== undefined,
    run: (b) => {
      const done = `Rebased ${current()} on ${b.name}`;
      return operate('Rebase failed', async (host, worktree) => {
        const result = await host.request('git.rebaseOnto', { path: worktree, onto: b.name });
        if (result === 'conflicts') await continueRebase(host, worktree, 'stopped', done);
        else notifications.notify({ title: 'Rebase successful', content: done });
      });
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.merge',
    label: 'Merge into Current',
    text: (b) => `Merge ${quoted(b.name)} into ${quoted(current())}`,
    visible: (b) => !isCurrent(b),
    run: (b) => {
      const into = current();
      return operate(`Could not merge ${b.name}`, async (host, worktree) => {
        const result = await host.request('git.mergeBranch', { path: worktree, branch: b.name });
        if (result === 'conflicts') {
          // As IntelliJ's: the Conflicts dialog, and the merge committed once none is left.
          if (!(await resolveConflicts(worktree))) {
            notifications.notify({ title: `${b.name} Merged with Conflicts`, type: 'warning' });
            return;
          }
          await host.request('git.continue', { path: worktree });
        }
        notifications.notify({
          content: result === 'upToDate' ? 'Already up to date' : `Merged ${b.name} to ${into}`,
          // IntelliJ proposes deleting a local branch merged.
          actions:
            b.remote || result === 'upToDate'
              ? []
              : [
                  {
                    label: `Delete ${b.name}`,
                    run: () => commands.execute('git.branch.delete', b),
                  },
                ],
        });
      });
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.rename',
    label: '&Rename',
    dialog: true,
    visible: (b) => !b.remote,
    run: (b) => {
      return operate(`Could not rename ${b.name}`, async (host, worktree) => {
        const named = await branchDialog(`Rename Branch ${b.name}`, 'Rename', b.name, true);
        if (!named) return;
        await host.request('git.renameBranch', { path: worktree, from: b.name, to: named.name });
      });
    },
  });
  /**
   * Deletes a remote branch (`origin/x`) where it is, once asked, and the local branches tracking it
   * if chosen, as IntelliJ's `GitDeleteRemoteBranchOperation`.
   */
  const deleteRemote = (name: string) =>
    operate(`Failed to delete remote branch ${name}`, async (host, worktree) => {
      const { local, current: checkedOut, upstreams } = branches.peek();
      // Not the current branch, even if it tracks it, as IntelliJ's.
      const tracking = local.filter(
        (l) => l !== checkedOut && upstreams.get(l) === `refs/remotes/${name}`,
      );
      const decision = await confirmRemoteDeletion(name, tracking);
      if (!decision) return;
      await host.request('git.deleteRemoteBranch', { path: worktree, name });
      const also: string[] = [];
      for (const l of decision.withTracking ? tracking : []) {
        try {
          await host.request('git.deleteBranch', { path: worktree, name: l });
          also.push(l);
        } catch (error) {
          notifications.notify({
            title: `Branch ${l} wasn't deleted`,
            content: (error as Error).message,
            type: 'error',
            display: 'sticky',
          });
        }
      }
      notifications.notify({
        title: `Deleted remote branch ${name}`,
        ...(also.length === 0
          ? {}
          : {
              content: `Also deleted local ${also.length === 1 ? 'branch' : 'branches'}: ${also.join(', ')}`,
            }),
      });
    });
  const deleteLocal = (b: BranchRef) =>
    operate(`Branch ${b.name} wasn't deleted`, async (host, worktree) => {
      const deleted = (await host.request('git.deleteBranch', {
        path: worktree,
        name: b.name,
      })) as { hash: string; unmerged: boolean; tracked?: string };
      const { tracked } = deleted;
      notifications.notify({
        title: `Deleted Branch: ${b.name}`,
        ...(deleted.unmerged ? { content: 'Unmerged commits were discarded' } : {}),
        actions: [
          {
            label: 'Restore',
            run: () => {
              void operate(`Could not Restore ${b.name}`, async (h, w) => {
                await h.request('git.restoreBranch', {
                  path: w,
                  name: b.name,
                  hash: deleted.hash,
                });
              });
            },
          },
          // The remote branch it alone tracked, unless it's protected, as IntelliJ's.
          ...(tracked === undefined || isProtected(tracked.slice(tracked.indexOf('/') + 1))
            ? []
            : [
                {
                  label: 'Delete Tracked Branch',
                  run: () => {
                    void deleteRemote(tracked);
                  },
                },
              ]),
        ],
      });
    });
  commands.register<BranchRef>({
    id: 'git.branch.delete',
    label: '&Delete',
    visible: (b) => !isCurrent(b),
    run: (b) => (b.remote ? deleteRemote(b.name) : deleteLocal(b)),
  });
  // IntelliJ's order (`Git.Branch.Backend.Checkout`, `Git.Branch.Backend`), what's here of it.
  const groups: [string, string[]][] = [
    ['a', ['git.branch.checkout', 'git.branch.openWorktree', 'git.branch.newFrom']],
    ['b', ['git.branch.rebase', 'git.branch.merge']],
    ['c', ['git.branch.rename', 'git.branch.delete']],
  ];
  for (const [group, ids] of groups) {
    for (const command of ids) menus.contribute({ menu: 'git/branch', item: { command }, group });
  }

  type Choice = PickerItem & { branch?: BranchRef; run?: () => void };
  /** A branch's row: its menu beside it, as IntelliJ's. */
  const row = (branch: BranchRef, group: string): Choice => {
    const other = elsewhere(branch);
    return {
      label: branch.name,
      group,
      ...(isCurrent(branch) ? { icon: () => icon('check') } : {}),
      // The worktree it's checked out in.
      ...(other === undefined ? {} : { detail: other.name }),
      branch,
      submenu: (anchor) =>
        new Promise<boolean>((resolve) => {
          const menu = openMenu(
            services,
            'git/branch',
            { anchor, placement: 'right' },
            {
              context: branch,
              focusFirst: true,
              onClose: (how) => {
                resolve(how !== 'cancelled');
              },
              // Left goes back to the list, as Escape does.
              onNavigate: (direction) => {
                if (direction < 0) menu.close();
              },
            },
          );
        }),
    };
  };
  /** The popup, below the toolbar's button; from the Git menu or its key, at the window's top. */
  const pick = (button?: HTMLElement) => {
    const at = target();
    if (at) {
      readBranches(at.host, at.worktree).catch((error: unknown) => {
        console.error('Reading the branches failed', error);
      });
    }
    const handle = openPicker<Choice>({
      label: 'Branches',
      placeholder: 'Search',
      position: button ? { below: button } : 'top',
      ...(button ? { owner: button } : {}),
      items: (query) => [
        ...fuzzyFilter(
          [{ label: 'New Branch…', run: () => commands.execute('git.newBranch') }],
          query,
        ),
        ...fuzzyFilter(
          branches.get().local.map((name) => row({ name, remote: false }, 'Local')),
          query,
        ),
        ...fuzzyFilter(
          branches.get().remote.map((name) => row({ name, remote: true }, 'Remote')),
          query,
        ),
      ],
    });
    void handle.result.then((choice) => choice?.run?.());
    return handle;
  };
  commands.register({
    id: 'git.branches',
    label: '&Branches',
    dialog: true,
    enabled: () => target() !== undefined,
    run: () => {
      pick();
    },
  });
  // IntelliJ's Git menu, its third group: Branches…, New Branch….
  menus.contribute({ menu: 'main/git', item: { command: 'git.branches' }, group: 'an', order: 1 });
  menus.contribute({ menu: 'main/git', item: { command: 'git.newBranch' }, group: 'an', order: 2 });
  return { pick };
}
