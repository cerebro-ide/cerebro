// IntelliJ's branches popup, from the toolbar's branch selector (`GitBranchesTreePopup`, its actions
// in `Git.Branch` and `Git.Branches.List`, `GitNewBranchDialog`, `GitBrancher`'s operations and
// their words in `GitBundle`, read from its source): New Branch…, then the active worktree's local
// and remote branches, searchable, each with its menu. Checkout, Open Worktree (a branch checked out
// in another worktree switches to its environment, Ido's choice: git won't check it out twice),
// New Branch from it, Rebase the current branch onto it, Merge it into the current one, Rename and
// Delete. A merge or rebase stopped at conflicts goes through the Conflicts dialog, as Update
// Project's does.

import type { EnvironmentSpec } from '@cerebro-ide/layout';
import { computed, effect, signal, untracked } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { fuzzyFilter, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { compareWithCurrent } from './compare-branches.js';
import { showDiffWithWorkingTree } from './diff-with-working-tree.js';
import { isProtected, openPush, pushTag, pushing } from './push.js';
import { globalSettings } from './settings.js';
import { showUnmergedCommits } from './unmerged-commits.js';
import { notRestored, updateProject } from './update.js';
import { resolveConflicts } from './conflicts.js';
import { saveBeforeGit } from './documents.js';
import { fetching } from './fetch-pull.js';
import { active, hostFor, projectOf, type Host } from './environments.js';
import { isFavorite, repositoryOf, setFavorite } from './branch-favorites.js';
import { branchField } from './git-options.js';
import { favoriteIcon, icon } from './icons.js';
import { paneContext, refsOf, type LogCommitContext } from './git-log.js';
import { branchName, isTag, paneSettings, type BranchesContext } from './log-branches.js';
import { continueRebase } from './merge-rebase.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { refreshAll } from './shelf.js';

/** A branch the popup lists: `main`, or a remote one, `origin/main`; or a tag, `v1`. */
export interface BranchRef {
  name: string;
  remote: boolean;
  tag?: boolean;
}

/** The host's `git.branches`. */
interface HostBranch {
  ref: string;
  current: boolean;
  upstream?: string;
}

/**
 * The active worktree's branches, as last read; the current one, undefined when detached; and the
 * branch each local one tracks, in full, if any. Its tags too, while the Branches settings' Show
 * Tags is on; and its remotes' names, which a tag can be pushed to.
 */
interface Branches {
  local: string[];
  remote: string[];
  tags: string[];
  remotes: string[];
  current: string | undefined;
  upstreams: ReadonlyMap<string, string>;
}

const branches = signal<Branches>({
  local: [],
  remote: [],
  tags: [],
  remotes: [],
  current: undefined,
  upstreams: new Map(),
});

/** Reads the active worktree's branches. */
async function readBranches(host: Host, worktree: string): Promise<void> {
  const [list, tags, remotes] = await Promise.all([
    host.request('git.branches', { worktree }) as Promise<HostBranch[]>,
    // Where the tags can't be read, the branches show without them.
    paneSettings.showTags.peek()
      ? (host.request('git.tags', { path: worktree }) as Promise<string[]>).catch(
          (error: unknown) => {
            console.error('Reading the tags failed', error);
            return [];
          },
        )
      : [],
    // Where they can't be read, a tag's menu has no Push to.
    (host.request('git.remotes', { path: worktree }) as Promise<{ name: string }[]>).then(
      (all) => all.map((r) => r.name),
      (error: unknown) => {
        console.error('Reading the remotes failed', error);
        return [];
      },
    ),
  ]);
  const named = (prefix: string) =>
    list.filter((b) => b.ref.startsWith(prefix)).map((b) => b.ref.slice(prefix.length));
  branches.set({
    local: named('refs/heads/'),
    remote: named('refs/remotes/'),
    tags,
    remotes,
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
  if (!env || branch.remote || branch.tag) return undefined;
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
  // IntelliJ's `showCheckOutOption`: off where the branch is only made (Checkout and Rebase).
  offersCheckout = !renaming,
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
          {offersCheckout ? (
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
          ) : null}
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

/** How Settings' Save changes says local changes are saved, for Smart Checkout and Merge. */
const savingAs = () => globalSettings.get('git.saveChanges') as 'shelve' | 'stash';

/**
 * The files git names in "Your local changes to the following files would be overwritten by
 * checkout" (or merge), one per line after a tab (IntelliJ's
 * `GitLocalChangesWouldBeOverwrittenDetector`), or undefined if that isn't what it says.
 */
function overwritten(message: string, operation: 'checkout' | 'merge'): string[] | undefined {
  const at = message.indexOf(`would be overwritten by ${operation}:`);
  if (at < 0) return undefined;
  const files: string[] = [];
  for (const line of message.slice(at).split('\n').slice(1)) {
    if (!line.startsWith('\t')) break;
    files.push(line.slice(1));
  }
  return files;
}

/**
 * IntelliJ's `GitSmartOperationDialog` for a checkout or merge: the files in the way, and Smart
 * Checkout (saved as `save` says, and put back), Force Checkout (a checkout's only), or Don't
 * Checkout.
 */
function smartOperationDialog(
  files: readonly string[],
  save: 'shelve' | 'stash',
  operation: 'checkout' | 'merge',
): Promise<'smart' | 'force' | undefined> {
  const [saved, restored] = save === 'shelve' ? ['shelve', 'unshelve'] : ['stash', 'unstash'];
  const named = operation === 'checkout' ? 'Checkout' : 'Merge';
  return openDialog<'smart' | 'force'>({
    title: `Git ${named} Problem`,
    width: 520,
    content: () => [
      <p class="cerebro-selectable">
        Your local changes to the following files would be overwritten by {operation}.
        <br />
        Cerebro can {saved} the changes, {operation} and {restored} them after that.
      </p>,
      <ul class="playground-rollback__files">
        {files.map((file) => (
          <li>{file}</li>
        ))}
      </ul>,
    ],
    ok: { label: `Smart ${named}`, accept: () => 'smart' },
    // IntelliJ's merge has none (`GitMergeOperation` passes no force button).
    choices: operation === 'checkout' ? [{ label: 'Force Checkout', accept: () => 'force' }] : [],
    cancelLabel: `Don't ${named}`,
  }).result;
}

/** How a merge went. */
type MergeResult = 'done' | 'upToDate' | 'conflicts';
/** A Smart Merge's: its changes put back or not, or kept saved at conflicts. */
interface SmartMerge {
  result: MergeResult;
  restored?: boolean;
  saved?: unknown;
}

/**
 * IntelliJ's Checkout Tag or Revision… dialog (`GitRefDialog`): "Checkout", a reference typed, the
 * branches and tags that hold what's typed suggested. Its text, trimmed, or undefined if cancelled.
 */
function referenceDialog(suggested: readonly string[]): Promise<string | undefined> {
  const reference = signal('');
  return openDialog<string>({
    title: 'Checkout',
    width: 420,
    ok: {
      label: 'OK',
      // Claude's: IntelliJ's takes an empty one, for git to refuse.
      enabled: () => reference.get().trim() !== '',
      accept: () => reference.peek().trim(),
    },
    content: () => (
      <label class="cerebro-dialog-field">
        <span class="cerebro-dialog-field__label">
          Enter reference (branch, tag) name or commit hash:
        </span>
        {branchField(reference, () => suggested, { label: 'Reference', placeholder: () => '' })}
      </label>
    ),
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
  /** Opens a tab: a diff from a dialog's commit files. */
  openTab: (tab: Tab, chain?: readonly string[]) => void;
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
  /**
   * Whether a branch is given: a branch's actions are off without one, as Find Action, which lists
   * what's on with none, asks; run from there, they'd have nothing to act on.
   */
  const given = (b: BranchRef | undefined): b is BranchRef => b !== undefined;
  const isCurrent = (b: BranchRef) => !b.remote && !b.tag && b.name === branches.get().current;
  const current = () => branches.get().current ?? 'HEAD';

  /**
   * IntelliJ's New Branch: from HEAD, or `from`; the branches read first, which the dialog checks
   * the name against, as IntelliJ's reads the repository's (the popup may not have read them).
   */
  const newBranch = (from: string | undefined, title = 'Create New Branch', value = '') =>
    operate(`Could not create new branch`, async (host, worktree) => {
      // Read as it shows, not before: the name is checked against them once they're in, and
      // what's typed meanwhile goes into the dialog.
      readBranches(host, worktree).catch((error: unknown) => {
        console.error('Reading the branches failed', error);
      });
      const named = await branchDialog(title, 'Create', value, false);
      if (!named) return;
      // As IntelliJ's checkout of a new branch from elsewhere (`GitCheckoutOperation`); one at HEAD
      // changes no file (`GitCheckoutNewBranchOperation` saves nothing).
      if (named.checkout && from !== undefined) await saveBeforeGit();
      await checkoutSmartly(host, 'git.createBranch', {
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
    enabled: given,
    run: (b) => {
      const name = b.remote ? b.name.replace(/^[^/]*\//, '') : b.name;
      if (b.remote && branches.peek().local.includes(name)) return checkoutInto(b.name, name);
      return operate(`Could not checkout ${b.name}`, async (host, worktree) => {
        await saveBeforeGit();
        // A tag's commit, HEAD detached at it, as IntelliJ's (`GitCheckoutAction`).
        const checkedOut = b.tag
          ? await checkoutSmartly(host, 'git.checkoutRevision', {
              path: worktree,
              reference: b.name,
            })
          : await checkoutSmartly(host, 'git.checkout', {
              path: worktree,
              branch: b.name,
              remote: b.remote,
            });
        if (!checkedOut) return;
        notifications.notify({
          content: `Checked out ${b.remote ? b.name.replace(/^[^/]*\//, '') : b.name}`,
        });
      });
    },
  });
  /**
   * Checks out with `method` (`git.checkout`, `git.checkoutRevision`, `git.createBranch`), as
   * IntelliJ's `GitCheckoutOperation`: where local changes are in the way, asks whether to save
   * them and put them back after (Smart Checkout), overwrite them (Force Checkout), or not check
   * out. Whether it was checked out.
   */
  const checkoutSmartly = async (host: Host, method: string, params: object) => {
    try {
      await host.request(method, params);
      return true;
    } catch (error) {
      const files = overwritten((error as Error).message, 'checkout');
      if (files === undefined) throw error;
      const save = savingAs();
      const choice = await smartOperationDialog(files, save, 'checkout');
      if (choice === undefined) return false;
      if (choice === 'force') {
        await host.request(method, { ...params, force: true });
        return true;
      }
      const { restored } = (await host.request(method, { ...params, save })) as {
        restored: boolean;
      };
      if (!restored) notRestored('checkout', save);
      return true;
    }
  };
  /**
   * A remote branch checked out where its local branch exists, as IntelliJ's
   * (`GitRemoteBranchCheckoutUtil`, `GitBranchCheckoutOperation`): one that tracks another branch
   * isn't taken over, a new branch's name asked for instead; otherwise it's moved to the remote
   * branch and checked out, after asking, when it has commits of its own, whether to rebase them
   * onto it or drop them.
   */
  const checkoutInto = (remote: string, name: string) => {
    const tracked = branches.peek().upstreams.get(name);
    if (tracked !== undefined && tracked !== `refs/remotes/${remote}`) {
      return newBranch(remote, `Checkout ${remote}`, name);
    }
    return operate(`Could not checkout ${remote}`, async (host, worktree) => {
      const own = (await host.request('git.hasCommitsNotIn', {
        path: worktree,
        branch: name,
        of: remote,
      })) as boolean;
      const how = own
        ? await openDialog<'rebase' | 'drop'>({
            title: `Checkout ${remote}`,
            content: () => (
              <p class="cerebro-selectable">
                Local branch '{name}' has commits that do not exist in '{remote}'. Rebase '{name}'
                onto '{remote}', or drop local commits?
              </p>
            ),
            ok: { label: 'Rebase onto Remote', accept: () => 'rebase' },
            choices: [{ label: 'Drop Local Commits', accept: () => 'drop' }],
          }).result
        : 'drop';
      if (how === undefined) return;
      await saveBeforeGit();
      if (how === 'rebase') {
        const done = `Checked out ${name} and rebased it on ${remote}`;
        const result = await host.request('git.rebase', {
          path: worktree,
          upstream: remote,
          branch: name,
        });
        if (result === 'conflicts') await continueRebase(host, worktree, 'stopped', done);
        else notifications.notify({ title: 'Rebase successful', content: done });
        return;
      }
      const checkedOut = await checkoutSmartly(host, 'git.createBranch', {
        path: worktree,
        name,
        from: remote,
        checkout: true,
        overwrite: true,
      });
      if (checkedOut) notifications.notify({ content: `Checked out ${name}` });
    });
  };
  commands.register({
    id: 'git.checkoutRevision',
    label: 'Checkout Tag or Revision',
    dialog: true,
    enabled: () => target() !== undefined,
    run: async () => {
      const at = target() as NonNullable<ReturnType<typeof target>>;
      // The tags as well as the branches, read first (IntelliJ reads them as the dialog opens).
      const tags = (await at.host
        .request('git.tags', { path: at.worktree })
        .catch((error: unknown) => {
          console.error('Reading the tags failed', error);
          return [];
        })) as string[];
      const { local, remote } = branches.peek();
      const reference = await referenceDialog([...local, ...remote, ...tags]);
      if (reference === undefined) return;
      await operate(`Could not checkout ${reference}`, async (host, worktree) => {
        await saveBeforeGit();
        if (await checkoutSmartly(host, 'git.checkoutRevision', { path: worktree, reference })) {
          notifications.notify({ content: `Checked out ${reference}` });
        }
      });
    },
  });
  // The Log's commit menu's, as IntelliJ's `GitCreateNewBranchFromCommitAction`: from the commit,
  // the name of the one branch at it suggested (a remote one's without its remote).
  commands.register<LogCommitContext>({
    id: 'log.newBranch',
    label: 'New Branch',
    dialog: true,
    run: async (at) => {
      const names = refsOf(at.commit.refs).flatMap((ref) =>
        ref.kind === 'local' || (ref.kind === 'head' && ref.name !== 'HEAD')
          ? [ref.name]
          : ref.kind === 'remote'
            ? [ref.name.slice(ref.name.indexOf('/') + 1)]
            : [],
      );
      const distinct = [...new Set(names)];
      await newBranch(
        at.commit.hash,
        `Create Branch from ${at.commit.hash.slice(0, 8)}`,
        distinct.length === 1 ? distinct[0] : '',
      );
      await at.refresh();
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.openWorktree',
    label: 'Open Worktree',
    visible: (b) => elsewhere(b) !== undefined,
    enabled: given,
    run: (b) => {
      setup.open((elsewhere(b) as EnvironmentSpec).id);
    },
  });
  commands.register<BranchRef>({
    id: 'git.branch.newFrom',
    label: 'New Branch from Selected',
    text: (b) => `New Branch from ${quoted(b.name)}`,
    dialog: true,
    // IntelliJ's offers it for branches.
    visible: (b) => !b.tag,
    enabled: given,
    run: (b) => newBranch(b.name),
  });
  // IntelliJ's (`GitCompareWithBranchAction`): for a branch, not the one checked out.
  commands.register<BranchRef>({
    id: 'git.branch.compare',
    label: 'Compare with Current',
    text: () => `Compare with ${quoted(current())}`,
    visible: (b) => !isCurrent(b) && !b.tag,
    enabled: given,
    run: (b) => {
      compareWithCurrent(current(), b.name);
    },
  });
  commands.register<BranchRef>({
    // IntelliJ's (`GitCheckoutWithRebaseAction`): `git rebase HEAD <branch>`; a remote branch's
    // local branch made first, tracking it (`GitCheckoutAndRebaseRemoteBranchWorkflow`).
    id: 'git.branch.checkoutRebase',
    label: 'Checkout and Rebase onto Current',
    text: () => `Checkout and Rebase onto ${quoted(current())}`,
    visible: (b) => !isCurrent(b) && !b.tag && elsewhere(b) === undefined,
    enabled: given,
    run: (b) =>
      operate('Checkout and Rebase failed', async (host, worktree) => {
        const name = b.remote ? await localFor(host, worktree, b.name) : b.name;
        if (name === undefined) return;
        const done = `Checked out ${name} and rebased it on ${current()}`;
        const result = await host.request('git.rebase', {
          path: worktree,
          upstream: 'HEAD',
          branch: name,
        });
        if (result === 'conflicts') await continueRebase(host, worktree, 'stopped', done);
        else notifications.notify({ title: 'Rebase successful', content: done });
      }),
  });
  /**
   * The local branch Checkout and Rebase makes for `remote`, as IntelliJ's
   * (`GitCheckoutWithRebaseAction`, `GitCheckoutAndRebaseRemoteBranchWorkflow`): named as it
   * without its remote; where a branch of that name tracks another, a name asked for, the branch
   * only made (no Checkout option). One already there is reset to the remote branch, after asking
   * when it has commits of its own; never the current one. Its name, or undefined if not made.
   */
  const localFor = async (host: Host, worktree: string, remote: string) => {
    let name = remote.replace(/^[^/]*\//, '');
    const tracked = branches.peek().upstreams.get(name);
    if (tracked !== undefined && tracked !== `refs/remotes/${remote}`) {
      const named = await branchDialog(`Checkout ${remote}`, 'Create', name, false, false);
      if (!named) return undefined;
      name = named.name;
    }
    if (name === branches.peek().current)
      throw new Error(`Cannot overwrite current branch ${name}`);
    const overwrite = branches.peek().local.includes(name);
    if (overwrite) {
      const own = (await host.request('git.hasCommitsNotIn', {
        path: worktree,
        branch: name,
        of: remote,
      })) as boolean;
      if (own) {
        const drop = await openDialog<true>({
          title: `Checkout ${remote}`,
          content: () => (
            <p class="cerebro-selectable">
              Local branch '{name}' has commits that do not exist in '{remote}'. Do you want to drop
              local commits?
            </p>
          ),
          ok: { label: 'Drop Local Commits', accept: () => true },
        }).result;
        if (!drop) return undefined;
      }
    }
    await host.request('git.createBranch', {
      path: worktree,
      name,
      from: remote,
      checkout: false,
      overwrite,
    });
    return name;
  };
  commands.register<BranchRef>({
    // IntelliJ's (`GitShowDiffWithRefAction`): for any branch or tag, documents saved first.
    id: 'git.branch.showDiff',
    label: 'Show Diff with Working Tree',
    enabled: given,
    run: (b) => {
      return operate(`Could not load diff with ${b.name}`, async (host, worktree) => {
        await saveBeforeGit();
        showDiffWithWorkingTree({ host, worktree, ref: b.name, current: current() });
      });
    },
  });
  commands.register<BranchRef>({
    // IntelliJ's (`GitUpdateSelectedBranchAction`): a local branch, the current one too, as the
    // Log's branches pane's Update Selected; not without remotes; off while a fetch runs, or for a
    // branch that tracks none, or without one (as Find Action asks).
    id: 'git.branch.update',
    label: 'Update',
    visible: (b) => {
      const at = target();
      return !b.remote && !b.tag && at !== undefined && stateOf(at.worktree).remotes !== false;
    },
    enabled: (b: BranchRef | undefined) =>
      given(b) && !fetching.get() && branches.get().upstreams.has(b.name),
    run: (b) => {
      const { host, worktree } = target() as NonNullable<ReturnType<typeof target>>;
      return updateBranch(isCurrent(b) ? undefined : b.name, () => after(host, worktree));
    },
  });
  commands.register<BranchRef>({
    // IntelliJ's (`GitPushBranchAction`): the Push dialog for a local branch, checked out or not.
    id: 'git.branch.push',
    label: 'Push',
    dialog: true,
    visible: (b) => !b.remote && !b.tag,
    enabled: given,
    run: (b) => {
      const { worktree } = target() as NonNullable<ReturnType<typeof target>>;
      return openPush(worktree, isCurrent(b) ? {} : { source: b.name }).catch((error: unknown) => {
        console.error('Reading what to push failed', error);
      });
    },
  });
  // IntelliJ's (`GitPullBranchAction`): Update Project from a remote branch into the one checked
  // out, by rebase or merge; not with HEAD detached, nor without a branch (as Find Action asks).
  for (const method of ['rebase', 'merge'] as const) {
    const how = method === 'rebase' ? 'Rebase' : 'Merge';
    commands.register<BranchRef>({
      id: `git.branch.pull${how}`,
      label: `Pull into Current Using ${how}`,
      text: () => `Pull into ${quoted(current())} Using ${how}`,
      visible: (b) => b.remote,
      enabled: (b: BranchRef | undefined) => given(b) && branches.get().current !== undefined,
      run: (b) => {
        const { worktree } = target() as NonNullable<ReturnType<typeof target>>;
        const slash = b.name.indexOf('/');
        const from = { remote: b.name.slice(0, slash), branch: b.name.slice(slash + 1) };
        return updateProject(worktree, from, method);
      },
    });
  }
  commands.register<BranchRef>({
    id: 'git.branch.rebase',
    label: 'Rebase Current onto Selected',
    text: (b) => `Rebase ${quoted(current())} onto ${quoted(b.name)}`,
    visible: (b) => !isCurrent(b) && !b.tag,
    // IntelliJ's: not with HEAD detached.
    enabled: (b: BranchRef | undefined) => given(b) && branches.get().current !== undefined,
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
    enabled: given,
    run: (b) => {
      const into = current();
      return operate(`Could not merge ${b.name}`, async (host, worktree) => {
        await saveBeforeGit();
        const params = { path: worktree, branch: b.name };
        const save = savingAs();
        // Smart Merge, as IntelliJ's `GitMergeOperation`, where local changes are in the way: they're
        // saved, and put back after the merge, or once its conflicts are resolved.
        const answer = (await host
          .request('git.mergeBranch', params)
          .catch(async (error: unknown) => {
            const files = overwritten((error as Error).message, 'merge');
            if (files === undefined) throw error;
            if (!(await smartOperationDialog(files, save, 'merge'))) return undefined;
            return host.request('git.mergeBranch', { ...params, save });
          })) as MergeResult | SmartMerge | undefined;
        if (answer === undefined) return;
        const smart = typeof answer === 'object' ? answer : undefined;
        const result = smart ? smart.result : (answer as MergeResult);
        if (result === 'conflicts') {
          // As IntelliJ's: the Conflicts dialog, and the merge committed once none is left.
          if (!(await resolveConflicts(worktree))) {
            notifications.notify({ title: `${b.name} Merged with Conflicts`, type: 'warning' });
            if (smart?.saved) notRestored('merge', save);
            return;
          }
          await host.request('git.continue', { path: worktree });
          if (smart?.saved) {
            const back = await host.request('git.restoreSaved', {
              path: worktree,
              saved: smart.saved,
            });
            if (back !== true) notRestored('merge', save);
          }
        } else if (smart?.restored === false) notRestored('merge', save);
        notifications.notify({
          content: result === 'upToDate' ? 'Already up to date' : `Merged ${b.name} to ${into}`,
          // IntelliJ proposes deleting a local branch merged.
          actions:
            b.remote || b.tag || result === 'upToDate'
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
    visible: (b) => !b.remote && !b.tag,
    enabled: given,
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
      })) as { hash: string; unmerged: boolean; tracked?: string; base?: string };
      const { tracked, base } = deleted;
      const restore = () =>
        operate(`Could not Restore ${b.name}`, async (h, w) => {
          await h.request('git.restoreBranch', { path: w, name: b.name, hash: deleted.hash });
        });
      notifications.notify({
        title: `Deleted Branch: ${b.name}`,
        ...(deleted.unmerged ? { content: 'Unmerged commits were discarded' } : {}),
        actions: [
          {
            label: 'Restore',
            run: () => {
              void restore();
            },
          },
          // The commits discarded, and Restore there too, as IntelliJ's.
          ...(base === undefined
            ? []
            : [
                {
                  label: 'View Commits',
                  run: () => {
                    const unmerged = { host, worktree, name: b.name, tip: deleted.hash, base };
                    void showUnmergedCommits(unmerged, setup.openTab).then(
                      (again) => (again ? restore() : undefined),
                      (error: unknown) => {
                        console.error('Reading the unmerged commits failed', error);
                      },
                    );
                  },
                },
              ]),
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
  /**
   * A tag deleted on the remotes, as IntelliJ's `GitDeleteRemoteTagOperation`: on each that has
   * it, only where it's still at `hash`; saying where it was, or that none had it, and what failed.
   */
  const deleteRemoteTag = (name: string, hash: string, remotes: number) => {
    const where = remotes === 1 ? 'Remote' : 'Remotes';
    return operate(`Failed to delete tag ${name} on ${where}`, async (host, worktree) => {
      const { deleted, failed } = (await host.request('git.deleteRemoteTag', {
        path: worktree,
        name,
        hash,
      })) as { deleted: string[]; failed: { remote: string; error: string }[] };
      if (deleted.length > 0) notifications.notify({ title: `Deleted Tag on ${where}: ${name}` });
      else if (failed.length === 0) {
        notifications.notify({ title: `Tag Doesn't Exist on ${where}: ${name}` });
      }
      if (failed.length > 0) {
        notifications.notify({
          title: `Failed to delete tag ${name} on ${where}`,
          content: failed.map((f) => `${f.remote}: ${f.error}`).join('\n'),
          type: 'error',
          display: 'sticky',
        });
      }
    });
  };
  /**
   * A tag deleted, as IntelliJ's `GitDeleteTagOperation`: no question asked, and Restore offered,
   * which says so once it's done; and Delete on Remote, when there are remotes.
   */
  const deleteTag = (name: string) =>
    operate(`Tag ${name} wasn't deleted`, async (host, worktree) => {
      const { hash, remotes } = (await host.request('git.deleteTag', {
        path: worktree,
        name,
      })) as { hash: string; remotes: number };
      notifications.notify({
        title: `Deleted Tag: ${name}`,
        actions: [
          {
            label: 'Restore',
            run: () => {
              void operate(`Could not Restore ${name}`, async (h, w) => {
                await h.request('git.restoreTag', { path: w, name, hash });
                notifications.notify({
                  title: 'Rollback Successful',
                  content: `Restored tag ${name}`,
                });
              });
            },
          },
          ...(remotes > 0
            ? [
                {
                  label: `Delete on ${remotes === 1 ? 'Remote' : 'Remotes'}`,
                  run: () => {
                    void deleteRemoteTag(name, hash, remotes);
                  },
                },
              ]
            : []),
        ],
      });
    });
  commands.register<BranchRef>({
    id: 'git.branch.delete',
    label: '&Delete',
    visible: (b) => !isCurrent(b),
    enabled: given,
    run: (b) => (b.tag ? deleteTag(b.name) : b.remote ? deleteRemote(b.name) : deleteLocal(b)),
  });
  // The Log's branches pane's toolbar's, as IntelliJ's (BranchesDashboardActions): New Branch from
  // HEAD, the current branch's name suggested; or from a branch's commit (`name^0`, so the new one
  // tracks nothing), its name suggested, a remote one's without its remote.
  commands.register<BranchesContext | undefined>({
    id: 'log.branches.newBranch',
    label: 'New Branch',
    icon: 'add',
    dialog: true,
    enabled: (c) => paneContext(c)?.selection !== undefined,
    run: async (c) => {
      const { selection, refresh } = paneContext(c) as BranchesContext;
      const at = selection as NonNullable<BranchesContext['selection']>;
      if (at.kind === 'head') {
        await newBranch(undefined, undefined, at.branch ?? '');
      } else {
        const name = branchName(at.ref);
        const remote = at.ref.startsWith('refs/remotes/');
        await newBranch(
          `${name}^0`,
          `Create Branch from ${name}`,
          remote ? name.slice(name.indexOf('/') + 1) : name,
        );
      }
      await refresh();
    },
  });
  // Not the current branch, or a protected remote one, as IntelliJ's; a tag too.
  commands.register<BranchesContext | undefined>({
    id: 'log.branches.delete',
    label: 'Delete Branch',
    icon: 'delete',
    enabled: (c) => {
      const at = paneContext(c)?.selection;
      if (at?.kind !== 'branch' || at.current) return false;
      const name = branchName(at.ref);
      return !at.ref.startsWith('refs/remotes/') || !isProtected(name.slice(name.indexOf('/') + 1));
    },
    run: async (c) => {
      const { selection, refresh } = paneContext(c) as BranchesContext;
      const { ref } = selection as { ref: string };
      const name = branchName(ref);
      if (isTag(ref)) await deleteTag(name);
      else if (ref.startsWith('refs/remotes/')) await deleteRemote(name);
      else await deleteLocal({ name, remote: false });
      await refresh();
    },
  });
  // Update Selected, as IntelliJ's (`updateBranches`): the branch checked out by Update Project;
  // another from the branch it tracks, a fast-forward, there if it's checked out in another
  // worktree. Off without a remote, while a fetch runs, and for a branch that tracks none.
  commands.register<BranchesContext | undefined>({
    id: 'log.branches.update',
    label: 'Update Selected',
    icon: 'update',
    enabled: (c) => {
      const at = target();
      const selection = paneContext(c)?.selection;
      return (
        at !== undefined &&
        stateOf(at.worktree).remotes !== false &&
        !fetching.get() &&
        selection?.upstream !== undefined
      );
    },
    run: (c) => {
      const { selection, refresh } = paneContext(c) as BranchesContext;
      const at = selection as NonNullable<BranchesContext['selection']>;
      const name = at.kind === 'head' || at.current ? undefined : branchName(at.ref);
      return updateBranch(name, refresh);
    },
  });
  /**
   * Updates a branch, as IntelliJ's `updateBranches`: the one checked out (`undefined`) by Update
   * Project; another from the branch it tracks.
   */
  async function updateBranch(name: string | undefined, refresh: () => Promise<void>) {
    if (name === undefined) {
      commands.execute('vcs.update');
      return;
    }
    const { host, worktree } = target() as NonNullable<ReturnType<typeof target>>;
    fetching.set(true);
    try {
      const updated = (await host.request('git.updateBranch', {
        path: worktree,
        branch: name,
      })) as { worktree?: string };
      notifications.notify({
        title:
          updated.worktree === undefined
            ? 'Fetched 1 target'
            : 'Updated 1 branch checked out in other worktrees',
      });
    } catch (error) {
      notifications.notify({
        title: 'Update failed',
        content: (error as Error).message,
        type: 'error',
        display: 'sticky',
      });
    } finally {
      fetching.set(false);
    }
    await refresh();
  }
  // SafeDelete's, while the pane has the keyboard, as IntelliJ's: Alt+Delete, Cmd+Delete on macOS.
  services.keymap?.bindDefault(
    services.keymap.platform === 'mac' ? 'Meta+Delete' : 'Alt+Delete',
    'log.branches.delete',
  );
  // IntelliJ's order (`Git.Branch.Backend.Checkout`, `Git.Branch.Backend`), what's here of it.
  const groups: [string, string[]][] = [
    [
      'a',
      [
        'git.branch.checkout',
        'git.branch.openWorktree',
        'git.branch.newFrom',
        'git.branch.checkoutRebase',
      ],
    ],
    ['ab', ['git.branch.compare', 'git.branch.showDiff']],
    [
      'b',
      [
        'git.branch.rebase',
        'git.branch.merge',
        'git.branch.update',
        'git.branch.push',
        'git.branch.pullRebase',
        'git.branch.pullMerge',
      ],
    ],
    ['c', ['git.branch.rename', 'git.branch.delete']],
  ];
  for (const [group, ids] of groups) {
    for (const command of ids) menus.contribute({ menu: 'git/branch', item: { command }, group });
  }
  // A tag's Push to, one per remote, after the branch operations, as IntelliJ's
  // (`GitPushTagsActionGroup`, `GitPushTagAction`); registered again when the remotes change.
  const remotes = computed(() => branches.get().remotes.join('\n'));
  effect(() => {
    const names = remotes.get().split('\n').filter(Boolean);
    // What registering reads (whether the command is there) isn't what this follows.
    const made = untracked(() =>
      names.flatMap((remote) => {
        const id = `git.tag.push.${remote}`;
        return [
          commands.register<BranchRef>({
            id,
            label: `Push to ${remote}`,
            visible: (b) => b.tag === true,
            // Not without a tag, as Find Action asks; nor while a push runs.
            enabled: (b: BranchRef | undefined) => b?.tag === true && !pushing.get(),
            run: (b) => {
              const { host, worktree } = target() as NonNullable<ReturnType<typeof target>>;
              return pushTag(host, worktree, b.name, remote);
            },
          }),
          menus.contribute({ menu: 'git/branch', item: { command: id }, group: 'bc' }),
        ];
      }),
    );
    return () => {
      for (const done of made) done.dispose();
    };
  });

  type Choice = PickerItem & { branch?: BranchRef; run?: () => void };
  const refOf = (branch: BranchRef) =>
    `refs/${branch.tag ? 'tags' : branch.remote ? 'remotes' : 'heads'}/${branch.name}`;
  /**
   * A branch's row: its menu beside it, as IntelliJ's. Its icon marks a favorite, as IntelliJ's
   * (GitBranchesTreeIconProvider): a filled star; on the row highlighted, a muted outline to click;
   * otherwise a branch's or a tag's, as the Log's branches pane's.
   */
  const row = (branch: BranchRef, group: string, repository: string): Choice => {
    const other = elsewhere(branch);
    const ref = refOf(branch);
    return {
      label: branch.name,
      group,
      icon: () => () => {
        if (isCurrent(branch)) return icon('check');
        if (isFavorite(repository, ref)) return favoriteIcon();
        return [
          <span class="playground-branches-popup__unmarked">{icon('favorite')}</span>,
          <span class="playground-branches-popup__kind">{icon(branch.tag ? 'tag' : 'git')}</span>,
        ];
      },
      iconClick: () => {
        setFavorite(repository, ref, !isFavorite(repository, ref));
      },
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
    const repository = repositoryOf(at?.worktree ?? '');
    /** IntelliJ's order (GitBranchesTreeModel): the branch checked out, favorites, then the rest. */
    const rows = (names: readonly string[], kind: 'local' | 'remote' | 'tag', group: string) =>
      names
        .map((name) => ({
          name,
          remote: kind === 'remote',
          ...(kind === 'tag' ? { tag: true } : {}),
        }))
        .map((branch) => ({
          branch,
          weight: isCurrent(branch) ? 0 : isFavorite(repository, refOf(branch)) ? 1 : 2,
        }))
        .sort((a, b) => a.weight - b.weight)
        .map(({ branch }) => row(branch, group, repository));
    const handle: PickerHandle<Choice> = openPicker<Choice>({
      label: 'Branches',
      placeholder: 'Search',
      position: button ? { below: button } : 'top',
      ...(button ? { owner: button } : {}),
      // Space marks the branch highlighted a favorite, or not, as IntelliJ's; the search takes none.
      onKey: (event) => {
        if (event.key !== ' ') return false;
        handle.highlighted()?.iconClick?.();
        return true;
      },
      items: (query) => [
        // IntelliJ's `Git.Branches.List`, what's here of it.
        ...fuzzyFilter(
          [
            { label: 'New Branch…', run: () => commands.execute('git.newBranch') },
            {
              label: 'Checkout Tag or Revision…',
              run: () => commands.execute('git.checkoutRevision'),
            },
          ],
          query,
        ),
        ...fuzzyFilter(rows(branches.get().local, 'local', 'Local'), query),
        ...fuzzyFilter(rows(branches.get().remote, 'remote', 'Remote'), query),
        // As IntelliJ's (GitBranchesTreeModel): the tags after, while Show Tags is on.
        ...fuzzyFilter(rows(branches.get().tags, 'tag', 'Tags'), query),
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
  // Before New Tag…, as IntelliJ's (Git.Log.ContextMenu).
  menus.contribute({
    menu: 'log/commit',
    item: { command: 'log.newBranch' },
    group: 'g',
    order: 9,
  });
  return { pick };
}
