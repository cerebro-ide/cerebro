// The Git menu's Merge…, and its actions during a merge or a rebase, as IntelliJ's (`GitMerge`,
// `GitMergeDialog`, `GitMergeOption`, `GitMergeCommitAction`, `GitAbortOperationAction`,
// `GitRebaseContinue`, `GitRebaseAbort`, `GitRebaseSkip`, `GitRebaseProcess`,
// `GitAbortRebaseProcess`, their words from `GitBundle`): Merge…, its dialog, then on as Pull goes;
// after it, Commit Merge (once no file is in conflict) and Abort Merge; after Rebase, its menu:
// Abort Rebase, Continue Rebase and Skip Commit. Each shows only while its operation is under way.

import { effect, signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { resolveConflicts, type Conflicts } from './conflicts.js';
import { active, currentHost, gitRepository, hostFor, type Host } from './environments.js';
import { currentBranch } from './git-fields.js';
import { branchField, gitOptions, type GitOption } from './git-options.js';
import { mergeAction } from './merge-action.js';
import { notifications } from './notifications.js';
import { stateOf } from './repository-state.js';
import { refreshAll } from './shelf.js';

type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** IntelliJ's confirmation before aborting: Abort, or Cancel. */
async function confirmAbort(title: string, message: string): Promise<boolean> {
  const yes = await openDialog<true>({
    title,
    width: 420,
    ok: { label: 'Abort', accept: () => true },
    content: () => <p class="playground-abort">{message}</p>,
  }).result;
  return yes === true;
}

/** Abort's words, as IntelliJ's: `GitAbortOperationAction`'s, and `GitAbortRebaseProcess`'s. */
const ABORT: Record<
  Operation,
  { title: string; ask: (worktree: string) => string; done: string; failed: string }
> = {
  merge: {
    title: 'Abort Merge',
    ask: () => 'Abort merge?',
    done: 'Merge abort succeeded',
    failed: 'Merge abort failed',
  },
  rebase: {
    title: 'Abort Rebase',
    ask: (worktree) => `Abort rebase in ${worktree.split(/[\\/]/).at(-1) as string}?`,
    done: 'Abort rebase succeeded',
    failed: 'Abort rebase failed',
  },
  'cherry-pick': {
    title: 'Abort Cherry-pick',
    ask: () => 'Abort cherry-pick?',
    done: 'Cherry-pick abort succeeded',
    failed: 'Cherry-pick abort failed',
  },
  revert: {
    title: 'Abort Revert',
    ask: () => 'Abort revert?',
    done: 'Revert abort succeeded',
    failed: 'Revert abort failed',
  },
};

/** IntelliJ's Abort Merge, Abort Rebase, Abort Cherry-Pick and Abort Revert: asks, then git's `--abort`. */
export async function abort(host: Host, worktree: string, operation: Operation): Promise<void> {
  const words = ABORT[operation];
  if (!(await confirmAbort(words.title, words.ask(worktree)))) return;
  try {
    await host.request('git.abort', { path: worktree, operation });
    notifications.notify({ content: words.done });
  } catch (error) {
    notifications.notify({
      title: words.failed,
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/**
 * A Git menu action shown only while `operation` is under way in the active worktree (and `shows`
 * says so): run on it, what fails besides what git says (in a notification) logged.
 */
export function registerDuring(
  { commands }: MenuServices,
  id: string,
  label: string,
  operation: Operation,
  run: (host: Host, worktree: string) => Promise<void>,
  shows: (worktree: string) => boolean = () => true,
): void {
  /** The active worktree, and its host, while `operation` is under way in it. */
  const during = () => {
    const env = active();
    const host = currentHost();
    return env && host && stateOf(env.id).operation === operation
      ? { worktree: env.id, host }
      : undefined;
  };
  commands.register({
    id,
    label,
    visible: () => {
      const under = during();
      return under !== undefined && shows(under.worktree);
    },
    run: () => {
      const under = during();
      return under === undefined
        ? undefined
        : run(under.host, under.worktree).catch((error: unknown) => {
            console.error(`${label} failed`, error);
          });
    },
  });
}

/** IntelliJ's Commit Merge: the merge committed with git's message. */
async function commitMerge(host: Host, worktree: string): Promise<void> {
  try {
    await host.request('git.continue', { path: worktree });
  } catch (error) {
    notifications.notify({
      title: 'Merge commit failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/**
 * IntelliJ's Continue Rebase and Skip Commit, as its `GitRebaseProcess`; or on from a rebase just
 * stopped at conflicts (`stopped`, as the branches popup's Rebase onto). At conflicts, the Conflicts
 * dialog, then on once none is left; if some are, "Rebase stopped due to conflicts", with Resolve…,
 * Continue and Abort; at the end, "Rebase successful", and what it did (`done`, else git's).
 */
export async function continueRebase(
  host: Host,
  worktree: string,
  how: 'continue' | 'skip' | 'stopped' = 'continue',
  done?: string,
): Promise<void> {
  try {
    // The branch rebased, as git keeps it while the rebase is under way.
    const { yours } = (await host.request('git.conflicts', { path: worktree })) as Conflicts;
    let stopped =
      how === 'stopped' ||
      (await host.request(how === 'skip' ? 'git.skipCommit' : 'git.continue', {
        path: worktree,
      })) === 'conflicts';
    while (stopped && (await resolveConflicts(worktree))) {
      stopped = (await host.request('git.continue', { path: worktree })) === 'conflicts';
    }
    if (stopped) {
      notifications.notify({
        title: 'Rebase stopped due to conflicts',
        type: 'warning',
        display: 'sticky',
        actions: [
          { label: 'Resolve…', run: () => void resolveAndContinue(host, worktree, done) },
          { label: 'Continue', run: () => void continueRebase(host, worktree, 'continue', done) },
          { label: 'Abort', run: () => void abort(host, worktree, 'rebase') },
        ],
      });
    } else {
      notifications.notify({
        title: 'Rebase successful',
        content: done ?? (yours === undefined ? 'Rebased' : `Rebased ${yours}`),
      });
    }
  } catch (error) {
    notifications.notify({
      title: 'Continue rebase failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/** The stopped notification's Resolve…: the dialog, then on if none is left. */
async function resolveAndContinue(host: Host, worktree: string, done?: string): Promise<void> {
  if (await resolveConflicts(worktree)) await continueRebase(host, worktree, 'continue', done);
  else await refreshAll(worktree);
}

/** IntelliJ's `GitMergeOption`: each flag, what it does, and those it can't go with. */
const MERGE_OPTIONS: GitOption[] = [
  {
    flag: '--no-ff',
    description: 'Create a merge commit even if it can be fast-forwarded',
    excludes: ['--ff-only', '--squash'],
  },
  {
    flag: '--ff-only',
    description: 'Merge only if it can be fast-forwarded',
    excludes: ['--no-ff', '--squash', '-m'],
  },
  {
    flag: '--squash',
    description: 'Create a single commit for all merged changes',
    excludes: ['--no-ff', '--ff-only', '-m'],
  },
  {
    flag: '-m',
    description: 'Specify a message for the merge commit',
    excludes: ['--ff-only', '--squash', '--no-commit'],
  },
  { flag: '--no-commit', description: 'Do not commit the merge result', excludes: ['-m'] },
  {
    flag: '--no-verify',
    description: 'Bypass the pre-merge and commit message hooks',
    excludes: [],
  },
  {
    flag: '--allow-unrelated-histories',
    description: 'Allow merging histories that do not share a common ancestor.',
    excludes: [],
  },
];

/** What the Merge dialog chose. */
interface MergeChoice {
  branch: string;
  options: string[];
  message: string;
}

/** A branch's name as the Merge dialog lists it: `main`, `origin/main`; none for `origin/HEAD`. */
const branchName = (ref: string) =>
  ref.startsWith('refs/heads/')
    ? ref.slice('refs/heads/'.length)
    : ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')
      ? ref.slice('refs/remotes/'.length)
      : undefined;

/** IntelliJ's order for branch names (`NaturalComparator`). */
const natural = new Intl.Collator(undefined, { numeric: true }).compare;

/** Where the branch last merged in a repository is kept, as IntelliJ keeps it per project. */
const branchKey = (worktree: string) => `cerebro.merge.branch:${worktree}`;

function keptBranch(worktree: string): string | null {
  try {
    return localStorage.getItem(branchKey(worktree));
  } catch {
    return null;
  }
}

/**
 * IntelliJ's Merge dialog, "Merge into main": `git merge` and the branch, its branches suggested as
 * it's typed, local then remote; the options chosen under it, each removable, and Modify options at
 * the buttons' left; with -m, the commit's message under them. The branch last merged to start with,
 * else the upstream, else the first. One merged already is said so, once the host says which are.
 */
async function askMerge(host: Host, worktree: string): Promise<MergeChoice | undefined> {
  const [tracking, refs] = (await Promise.all([
    host.request('git.tracking', { path: worktree }),
    host.request('git.branches', { worktree }),
  ])) as [
    { branch: string | undefined; upstream: { remote: string; branch: string } | undefined },
    { ref: string }[],
  ];
  const names = refs.map((r) => r.ref);
  const local = names.filter((r) => r.startsWith('refs/heads/'));
  const branches = [
    ...local
      .map(branchName)
      .filter((b) => b !== undefined)
      .sort(natural),
    ...names
      .filter((r) => !local.includes(r))
      .map(branchName)
      .filter((b) => b !== undefined)
      .sort(natural),
  ];
  const kept = keptBranch(worktree);
  const upstream = tracking.upstream && `${tracking.upstream.remote}/${tracking.upstream.branch}`;
  const branch = signal(
    [kept, upstream].find((b) => b != null && branches.includes(b)) ?? branches[0] ?? '',
  );
  /** Those not merged yet, once the host says (IntelliJ reads them in the background). */
  const unmerged = signal<(string | undefined)[] | undefined>(undefined);
  host.request('git.unmerged', { path: worktree }).then(
    (list) => {
      unmerged.set((list as string[]).map(branchName));
    },
    (error: unknown) => {
      console.error('Reading the branches not merged failed', error);
    },
  );
  const options = gitOptions(
    MERGE_OPTIONS,
    'Add Merge Options',
    `cerebro.merge.options:${worktree}`,
    640,
  );
  const message = signal('');
  const error = () => {
    const at = branch.get();
    if (at === '') return 'The merge branch should be selected.';
    if (!branches.includes(at)) return 'There is no matching branch.';
    const left = unmerged.get();
    return left === undefined || left.includes(at) ? undefined : `Branch '${at}' is already merged`;
  };
  const chosen = await openDialog<MergeChoice>({
    title: tracking.branch === undefined ? 'Merge Changes' : `Merge into ${tracking.branch}`,
    width: 560,
    ok: {
      label: 'Merge',
      enabled: () => error() === undefined,
      accept: () => ({
        branch: branch.peek(),
        options: options.chosen.peek(),
        message: message.peek(),
      }),
    },
    footer: options.link,
    content: () => (
      <div class="playground-git-command">
        <div class="playground-git-command__row">
          <span class="playground-git-command__git">git merge</span>
          {branchField(branch, () => branches)}
        </div>
        {options.shown}
        {() =>
          options.chosen.get().includes('-m') ? (
            <label class="playground-git-command__message">
              Commit message:
              <textarea
                class="cerebro-dialog-field__input playground-git-command__message-field"
                on:input={(event) => {
                  message.set((event.currentTarget as HTMLTextAreaElement).value);
                }}
              />
            </label>
          ) : null
        }
        <span class="cerebro-dialog-field__error" role="alert">
          {() => error() ?? ''}
        </span>
      </div>
    ),
  }).result;
  if (chosen) {
    options.keep();
    try {
      localStorage.setItem(branchKey(worktree), chosen.branch);
    } catch {
      // Not kept: the next merge starts at the upstream.
    }
  }
  return chosen;
}

/** Merges what the dialog chose, then goes on as IntelliJ's `GitMergeAction`. */
async function mergeChosen(host: Host, worktree: string, chosen: MergeChoice): Promise<void> {
  const withMessage = chosen.options.includes('-m');
  await mergeAction(
    host,
    worktree,
    'Merge',
    () =>
      host.request('git.merge', {
        path: worktree,
        branch: chosen.branch,
        options: chosen.options.filter((o) => o !== '-m'),
        // The message only when there's one, as IntelliJ's: else git's.
        ...(withMessage ? { message: chosen.message } : {}),
      }),
    !chosen.options.includes('--no-commit'),
  );
}

/**
 * IntelliJ's `GitRebaseOption`, in its order, but --interactive, which needs IntelliJ's interactive
 * rebase editor (not yet). The other branch (no flag in IntelliJ's popup) and --onto are fields of
 * the command, not options under it.
 */
const REBASE_OPTIONS: GitOption[] = [
  { flag: '', description: 'Select another branch to rebase', excludes: [], field: true },
  {
    flag: '--onto',
    description: 'Specify a new base for the rebased commits',
    excludes: [],
    field: true,
  },
  { flag: '--rebase-merges', description: 'Recreate commits topology', excludes: [] },
  { flag: '--keep-empty', description: 'Do not remove empty commits during rebase', excludes: [] },
  { flag: '--root', description: 'Rebase all commits in the branch', excludes: [] },
  {
    flag: '--update-refs',
    description: 'Auto-update branches pointing to rebased commits',
    excludes: [],
  },
  {
    flag: '--autosquash',
    description: 'Auto-squash commits marked for fixup or squash',
    excludes: ['--no-autosquash'],
  },
  {
    flag: '--no-autosquash',
    description: 'Override the Git config setting to disable automatic squashing',
    excludes: ['--autosquash'],
  },
];

/** What the Rebase dialog chose: the host's `git.rebase`'s. */
interface RebaseChoice {
  options: string[];
  onto?: string;
  upstream?: string;
  branch?: string;
}

/** Where the new base last chosen in a repository is kept, as IntelliJ's `newBase` setting. */
const baseKey = (worktree: string) => `cerebro.rebase.base:${worktree}`;

/**
 * IntelliJ's Rebase dialog: `git rebase`, then the base (a branch, tag or hash, suggested as it's
 * typed); with --onto, the new base first and the old one under it; with another branch, that
 * branch; the options under it, Modify options at the buttons' left. The base last chosen to start
 * with, when git still knows it. A base git doesn't know is said so on Rebase, as IntelliJ's.
 */
async function askRebase(host: Host, worktree: string): Promise<RebaseChoice | undefined> {
  const [refs, tags] = (await Promise.all([
    host.request('git.branches', { worktree }),
    host.request('git.tags', { path: worktree }),
  ])) as [{ ref: string }[], string[]];
  const names = refs.map((r) => r.ref);
  const local = names
    .filter((r) => r.startsWith('refs/heads/'))
    .map(branchName)
    .filter((b) => b !== undefined)
    .sort(natural);
  const remote = names
    .filter((r) => r.startsWith('refs/remotes/'))
    .map(branchName)
    .filter((b) => b !== undefined)
    .sort(natural);
  const refsToo = [...local, ...remote, ...[...tags].sort(natural)];
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(baseKey(worktree));
  } catch {
    // None kept.
  }
  const keep =
    kept !== null &&
    ((await host.request('git.validRevision', { path: worktree, revision: kept })) as boolean);
  const upstream = signal(keep ? (kept as string) : '');
  const onto = signal('');
  const branch = signal('');
  const options = gitOptions(
    REBASE_OPTIONS,
    'Add Rebase Options',
    `cerebro.rebase.options:${worktree}`,
    640,
  );
  const has = (flag: string) => options.chosen.get().includes(flag);
  /** What Rebase found git doesn't know: the field's name and its text then. */
  const unknown = signal<{ field: 'onto' | 'upstream'; text: string } | undefined>(undefined);
  // As IntelliJ's: --onto moves the base to its field, and back when it goes.
  let ontoBefore = false;
  const moving = effect(() => {
    const now = has('--onto');
    if (now === ontoBefore) return;
    ontoBefore = now;
    if (now) {
      onto.set(upstream.peek());
      upstream.set('');
    } else {
      upstream.set(onto.peek());
      onto.set('');
    }
  });
  /** Whether Rebase found git doesn't know the field's text, still as it was then. */
  const notKnown = (field: 'onto' | 'upstream') => {
    const missing = unknown.get();
    return missing?.field === field && (field === 'onto' ? onto : upstream).get() === missing.text;
  };
  // In IntelliJ's order (`doValidateAll`): the base, the new base, a rebase under way, the branch.
  const error = () => {
    if (!has('--root')) {
      if (upstream.get() === '') return has('--onto') ? 'Select an upstream' : 'Select a new base';
      if (notKnown('upstream')) return 'There is no such branch or tag';
    }
    if (has('--onto')) {
      if (onto.get() === '') return 'Select a new base';
      if (notKnown('onto')) return 'There is no such branch or tag';
    }
    if (stateOf(worktree).operation === 'rebase') {
      return 'Interactive rebase is already in progress for this Git root';
    }
    if (has('')) {
      const at = branch.get();
      if (at === '') return 'Select a branch to switch to';
      if (!local.includes(at)) return `Branch '${at}' does not exist`;
    }
    return undefined;
  };
  const choice = (): RebaseChoice => {
    // Each field shown is filled: Rebase is off until it is.
    const base = has('--root') ? undefined : upstream.peek();
    const newBase = has('--onto') ? onto.peek() : undefined;
    const other = has('') ? branch.peek() : undefined;
    return {
      options: options.chosen.peek().filter((o) => o !== '' && o !== '--onto' && o !== '--root'),
      ...(newBase === undefined ? {} : { onto: newBase }),
      ...(base === undefined ? {} : { upstream: base }),
      ...(other === undefined ? {} : { branch: other }),
    };
  };
  const chosen = await openDialog<RebaseChoice>({
    title: 'Rebase',
    width: 640,
    ok: {
      label: 'Rebase',
      enabled: () => error() === undefined,
      // As IntelliJ's `RevValidator`: the bases asked of git on Rebase only.
      check: async () => {
        const { onto: newBase, upstream: base } = choice();
        for (const [field, text] of [
          ['onto', newBase],
          ['upstream', base],
        ] as const) {
          if (text === undefined) continue;
          const valid = (await host.request('git.validRevision', {
            path: worktree,
            revision: text,
          })) as boolean;
          if (!valid) {
            unknown.set({ field, text });
            return false;
          }
        }
        return true;
      },
      accept: choice,
    },
    footer: options.link,
    // As IntelliJ's: each field built once, moved as options change, the base focused at first.
    content: () => {
      const newBase = branchField(onto, () => refsToo, {
        label: 'New base',
        placeholder: () => 'new base (branch or hash)',
        focus: false,
      });
      const base = branchField(upstream, () => refsToo, {
        label: 'Base',
        placeholder: () => (has('--onto') ? 'old base (branch or hash)' : 'branch or hash'),
        disabled: () => has('--root'),
      });
      const other = branchField(branch, () => local, {
        label: 'Branch to rebase',
        placeholder: () => 'source branch',
        focus: false,
      });
      return (
        <div class="playground-git-command">
          <div class="playground-git-command__row">
            <span class="playground-git-command__git">git rebase</span>
            {() =>
              has('--onto')
                ? [<span class="playground-git-command__git">--onto</span>, newBase]
                : [base, has('') ? other : null]
            }
          </div>
          {() =>
            has('--onto') ? (
              <div class="playground-git-command__row">
                {base}
                {has('') ? other : null}
              </div>
            ) : null
          }
          {options.shown}
          <span class="cerebro-dialog-field__error" role="alert">
            {() => error() ?? ''}
          </span>
        </div>
      );
    },
  }).result;
  moving.dispose();
  if (chosen) {
    options.keep();
    try {
      localStorage.setItem(baseKey(worktree), chosen.onto ?? chosen.upstream ?? '');
    } catch {
      // Not kept: the next rebase starts empty.
    }
  }
  return chosen;
}

/** Rebases as chosen; on through the Conflicts dialog when it stops, as IntelliJ's. */
async function rebaseChosen(host: Host, worktree: string, chosen: RebaseChoice): Promise<void> {
  const base = chosen.onto ?? chosen.upstream;
  const branch = chosen.branch ?? currentBranch(worktree) ?? 'HEAD';
  const done = base === undefined ? `Rebased ${branch}` : `Rebased ${branch} on ${base}`;
  try {
    const result = await host.request('git.rebase', { path: worktree, ...chosen });
    if (result === 'conflicts') {
      await continueRebase(host, worktree, 'stopped', done);
      return;
    }
    notifications.notify({ title: 'Rebase successful', content: done });
  } catch (error) {
    notifications.notify({
      title: 'Rebase failed',
      content: (error as Error).message,
      type: 'error',
      display: 'sticky',
    });
  }
  await refreshAll(worktree);
}

/** Git's actions for a merge or a rebase under way, as IntelliJ's, in its Git menu. */
export function setupMergeRebase(services: MenuServices): void {
  const { commands, menus } = services;
  const register = (
    id: string,
    label: string,
    operation: Operation,
    run: (host: Host, worktree: string) => Promise<void>,
    shows?: (worktree: string) => boolean,
  ) => {
    registerDuring(services, id, label, operation, run, shows);
  };
  /** The active worktree, and its host, in a git project. */
  const target = () => {
    const env = active();
    const host = env && hostFor(env.id);
    return env && host && gitRepository.get() ? { worktree: env.id, host } : undefined;
  };
  // Merge…: hidden while a merge is under way, as IntelliJ's; off during a rebase.
  commands.register({
    id: 'vcs.merge',
    label: '&Merge',
    dialog: true,
    visible: () => {
      const at = target();
      return at === undefined || stateOf(at.worktree).operation !== 'merge';
    },
    enabled: () => {
      const at = target();
      return at !== undefined && stateOf(at.worktree).operation === undefined;
    },
    run: () => {
      const at = target();
      if (!at) return undefined;
      return askMerge(at.host, at.worktree)
        .then((chosen) => chosen && mergeChosen(at.host, at.worktree, chosen))
        .then(() => refreshAll(at.worktree))
        .catch((error: unknown) => {
          console.error('Merge failed', error);
        });
    },
  });
  // Rebase…, as IntelliJ's: there whatever's under way, its dialog saying when a rebase is.
  commands.register({
    id: 'vcs.rebase',
    label: 'Rebase',
    dialog: true,
    enabled: () => target() !== undefined,
    run: () => {
      const { host, worktree } = target() as { host: Host; worktree: string };
      return askRebase(host, worktree)
        .then((chosen) => chosen && rebaseChosen(host, worktree, chosen))
        .catch((error: unknown) => {
          console.error('Rebase failed', error);
        });
    },
  });
  // Commit Merge shows once no file is in conflict: until then, Resolve Conflicts… does.
  register('vcs.commitMerge', 'Commit Merge', 'merge', commitMerge, (w) => !stateOf(w).conflicts);
  register('vcs.abortMerge', 'Abort Merge', 'merge', (h, w) => abort(h, w, 'merge'));
  register('vcs.abortRebase', 'Abort Rebase', 'rebase', (h, w) => abort(h, w, 'rebase'));
  register('vcs.continueRebase', 'Continue Rebase', 'rebase', (h, w) => continueRebase(h, w));
  register('vcs.skipCommit', 'Skip Commit', 'rebase', (h, w) => continueRebase(h, w, 'skip'));
  // IntelliJ's second group: Merge…, its actions, then the Rebase menu, then Resolve Conflicts….
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.merge' }, group: 'am', order: -1 });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.commitMerge' }, group: 'am' });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.abortMerge' }, group: 'am' });
  menus.contribute({ menu: 'main/git', item: { command: 'vcs.rebase' }, group: 'am' });
  menus.contribute({
    menu: 'main/git',
    item: { submenu: 'main/git/rebase', label: '&Rebase' },
    group: 'am',
  });
  for (const command of ['vcs.abortRebase', 'vcs.continueRebase', 'vcs.skipCommit']) {
    menus.contribute({ menu: 'main/git/rebase', item: { command } });
  }
}
