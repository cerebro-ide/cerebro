// Pushing, as IntelliJ's Push dialog (Git → Push…, and the Commit window's Commit and Push…): the
// checked-out branch, where it goes ("main → origin : main", "New" when the push makes it there),
// and the commits that aren't there yet, with the selected row's files beside them (PushLog). Where
// it goes can be changed, as IntelliJ's GitPushTargetPanel: the remote from a list, the branch
// there typed, with the remote's branches suggested, and Set upstream; or a remote defined, as
// IntelliJ's GitDefineRemoteDialog. Push tags, beside the buttons, sends tags too. Push pushes them,
// "Pushing…" on the status bar meanwhile. When the remote's branch has commits the branch hasn't, a
// banner says so over the tree, as IntelliJ's (PushDivergenceBanner): Force Push, on Push's arrow,
// replaces them, after asking; when they aren't fetched, Fetch fetches them first, to count them;
// its Update project… updates instead.
// How it went is a notification, as IntelliJ's GitPushResultNotification: "Pushed 2 commits to
// origin/main", "Pushed main to new branch origin/main", "Force pushed main to origin/main",
// "Everything is up to date", or "Push rejected" or "Push failed", which stay.

import { onCleanup } from '@cerebro-ide/jsx';
import { batch, computed, effect, signal, untracked, type Signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker } from '@cerebro-ide/ui-popup';
import { notificationIcon } from '@cerebro-ide/ui-notifications';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import {
  active,
  activeProject,
  currentHost,
  gitRepository,
  hostFor,
  showError,
  type Host,
  type ProjectState,
} from './environments.js';
import { CommitFiles, EMPTY_TREE, type LogCommit } from './git-log.js';
import { notifications } from './notifications.js';
import { updateProject } from './update.js';

/** What a push of the checked-out branch sends: the host's `git.outgoing`. */
interface Outgoing {
  branch: string | undefined;
  remote: string | undefined;
  target: string | undefined;
  isNew: boolean;
  commits: LogCommit[];
  remotes: string[];
  upstream: { remote: string; target: string } | undefined;
}

/** How a push went: the host's `git.push`. */
interface Pushed {
  commits: number;
  remote: string;
  target: string;
  isNew: boolean;
  forced: boolean;
  tags: string[];
}

/** Why a push will be rejected: the host's `git.divergence`. */
type PushDivergence =
  | { kind: 'diverged'; remoteCommits: number; lease: string }
  | { kind: 'fetchRequired'; lease: string };

/** Branches a force push doesn't go to: IntelliJ's protected branches, by default. */
const isProtected = (target: string) => target === 'main' || target === 'master';

/** Where force pushes go without asking, as IntelliJ's Don't warn about this target keeps them. */
const silentKey = (worktree: string) => `cerebro.push.silent:${worktree}`;

function readSilentTargets(worktree: string): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(silentKey(worktree)) ?? '[]');
    return Array.isArray(kept) ? kept.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function keepSilentTarget(worktree: string, where: string): void {
  try {
    localStorage.setItem(
      silentKey(worktree),
      JSON.stringify([...readSilentTargets(worktree), where]),
    );
  } catch {
    // Not kept: the next force push there asks again.
  }
}

/** Which tags go too, as IntelliJ's Push tags: all, or the branch's annotated ones. */
type PushTags = 'all' | 'follow';

/** Where a repository's Push tags is kept, as IntelliJ keeps it per project (`GitVcsSettings`). */
const tagsKey = (worktree: string) => `cerebro.push.tags:${worktree}`;

/** The Push tags last pushed with in a repository, or undefined when it was off. */
function readPushTags(worktree: string): PushTags | undefined {
  try {
    const kept = localStorage.getItem(tagsKey(worktree));
    return kept === 'all' || kept === 'follow' ? kept : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the Push tags pushed with, as IntelliJ's `GitPusher` does with each push. */
function keepPushTags(worktree: string, tags: PushTags | undefined): void {
  try {
    if (tags === undefined) localStorage.removeItem(tagsKey(worktree));
    else localStorage.setItem(tagsKey(worktree), tags);
  } catch {
    // Not kept: the next push starts with it off.
  }
}

/** How a push went, in IntelliJ's words (`push.notification.description.*`). */
function pushedText(pushed: Pushed, branch: string): string {
  const where = `${pushed.remote}/${pushed.target}`;
  const n = pushed.commits;
  const sent = pushed.forced
    ? `Force pushed ${branch} to ${where}`
    : pushed.isNew
      ? `Pushed ${branch} to new branch ${where}`
      : n === 0
        ? undefined
        : `Pushed ${String(n)} ${n === 1 ? 'commit' : 'commits'} to ${where}`;
  const [tag, ...more] = pushed.tags;
  if (tag === undefined) return sent ?? 'Everything is up to date';
  const tags = more.length === 0 ? `tag ${tag}` : `${String(pushed.tags.length)} tags`;
  return sent ? `${sent}, and ${tags} to ${pushed.remote}` : `Pushed ${tags} to ${pushed.remote}`;
}

/** Why nothing can be pushed, if so (Cerebro's words). */
function unpushable(out: Outgoing): string | undefined {
  return out.branch === undefined ? 'No branch is checked out' : undefined;
}

/** While a push is under way: one at a time. */
export const pushing = signal(false);

/** While the Push dialog's Fetch fetches the remote's commits. */
export const fetchingRemote = signal(false);

/**
 * A row of the dialog's tree: the repository, where its branch goes; why its Fetch failed, as
 * IntelliJ's; or a commit to push.
 */
type PushRow =
  { kind: 'repository' } | { kind: 'fetchError' } | { kind: 'commit'; commit: LogCommit };

const REPOSITORY: PushRow = { kind: 'repository' };
const FETCH_ERROR: PushRow = { kind: 'fetchError' };

/** A commit's tooltip, as IntelliJ's (`push.commit.node.tooltip`): hash, date, author, message. */
const tooltipOf = (commit: LogCommit) =>
  `${commit.hash.slice(0, 8)}  ${new Date(commit.time).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}  by ${commit.author}\n\n${[commit.subject, commit.body].filter(Boolean).join('\n\n')}`;

/**
 * A branch name as it's typed, as IntelliJ's `GitRefNameValidator.cleanUpBranchNameOnTyping`: what
 * git refuses is dropped, and spaces and control characters become `-` (its default
 * `git.branch.cleanup.symbol`, in git4idea's plugin XML).
 */
export function cleanUpBranchName(name: string): string {
  return (
    name
      .replace(/(^\.)|(^-)|(^\/)|[~:^?*"[\\]+|(@\{)+|\/(?=\/)|(\.(?=\.))+|\.(?=\/)|(?<=\/)\./g, '')
      // eslint-disable-next-line no-control-regex -- control characters are what it replaces
      .replace(/ +|[\u0000-\u001f\u007f]/g, '-')
  );
}

/** Whether git takes a branch name, as IntelliJ's `GitRefNameValidator.checkInput`. */
export function isBranchName(name: string): boolean {
  return name !== '' && cleanUpBranchName(name) === name && !/([./]|\.lock)$/.test(name);
}

/** What the dialog holds: where the push goes, and what it sends there. */
interface PushState {
  out: Signal<Outgoing>;
  /** Set upstream: the target becomes the branch's upstream. */
  setUpstream: Signal<boolean>;
  /** The branch being typed, while it is. */
  editing: Signal<string | undefined>;
  /** Asks again what a push sends: to another target, or where it goes by default. */
  retarget: (to?: { remote: string; target: string }) => void;
  /** Asks for a remote, as IntelliJ's Define Remote, and adds it. */
  defineRemote: () => void;
  /** The remotes' branches, for suggestions. */
  branches: Signal<readonly string[]>;
  /** Push tags, and which. */
  tags: Signal<boolean>;
  tagMode: Signal<PushTags>;
  /** Why the push will be rejected, if it will. */
  divergence: Signal<PushDivergence | undefined>;
  /** Why the last Fetch failed, until what's pushed changes. */
  fetchError: Signal<string | undefined>;
  /** Fetches the remote's commits, so they're counted. */
  fetch: () => void;
}

/** Whether the push waits for a Fetch, as IntelliJ's: not after one failed (the remote decides). */
const fetchRequired = (state: PushState) =>
  state.divergence.get()?.kind === 'fetchRequired' && state.fetchError.get() === undefined;

/** The warning over the tree, in IntelliJ's words (`push.divergence.banner.*`). */
function divergenceText(state: PushState): string | undefined {
  const divergence = state.divergence.get();
  if (divergence === undefined) return undefined;
  const { branch, target } = state.out.get();
  const name = `branch '${branch as string}'`;
  if (divergence.kind === 'fetchRequired') {
    return state.fetchError.get() === undefined
      ? `Push will be rejected, ${name} has diverged from the remote, and there are unfetched remote commits. Fetch them to review them before a force push.`
      : `Push may be rejected, ${name} has diverged from the remote, and the fetch of the remote commits failed.`;
  }
  const n = divergence.remoteCommits;
  const them = n === 1 ? 'it' : 'them';
  const diverged = `Push will be rejected, ${name} has diverged from the remote: ${String(n)} remote ${n === 1 ? 'commit is' : 'commits are'} not in your local branch.`;
  return isProtected(target as string)
    ? `${diverged} The target branch is protected, so update the project first.`
    : `${diverged} To keep ${them}, update the project first. To replace ${them}, use Force Push.`;
}

/**
 * IntelliJ's banner over the tree, while the push will be rejected, with its Update project…, which
 * closes the dialog and updates.
 */
function DivergenceBanner(props: { state: PushState; update: () => void }): Node {
  return (
    <div class="playground-push__divergence">
      {() => {
        const text = divergenceText(props.state);
        return text === undefined ? null : (
          <div class="playground-push__banner" role="status">
            {notificationIcon('warning')}
            <div class="playground-push__banner-text">
              <span>{text}</span>
              <button type="button" class="playground-link" on:click={props.update}>
                Update project…
              </button>
            </div>
          </div>
        );
      }}
    </div>
  );
}

/** Whether Set upstream applies: the branch has one, and the target isn't it (IntelliJ's). */
const otherThanUpstream = (out: Outgoing, target: string) =>
  out.upstream !== undefined &&
  isBranchName(target) &&
  !(out.upstream.remote === out.remote && out.upstream.target === target);

/**
 * The branch there being typed, as IntelliJ's target editor: the remote's branches that start with
 * it suggested below; Enter, or leaving it, takes it, Escape puts back what was there.
 */
function TargetField(props: {
  state: PushState;
  done: (target: string | undefined) => void;
}): Node {
  const { state } = props;
  const out = state.out.peek();
  const highlighted = signal(-1);
  const prefix = `${out.remote as string}/`;
  const suggestions = () => {
    // The field shows only while there's a branch being typed.
    const typed = state.editing.get() as string;
    return state.branches
      .get()
      .filter((b) => b.startsWith(prefix))
      .map((b) => b.slice(prefix.length))
      .filter((b) => b !== 'HEAD' && b !== typed && b.startsWith(typed));
  };
  let finished = false;
  const finish = (target: string | undefined) => {
    if (finished) return;
    finished = true;
    props.done(target);
  };
  return (
    <span class="playground-push__editor">
      <input
        class="playground-push__field"
        aria-label="Target branch"
        spellcheck={false}
        value={state.editing.peek()}
        ref={(field) => {
          requestAnimationFrame(() => {
            field.focus();
            field.select();
          });
        }}
        on:input={(event) => {
          const field = event.currentTarget as HTMLInputElement;
          const clean = cleanUpBranchName(field.value);
          if (clean !== field.value) field.value = clean;
          state.editing.set(clean);
          highlighted.set(-1);
        }}
        on:keydown={(event) => {
          // The field's keys: not the tree's, nor the dialog's Enter and Escape.
          event.stopPropagation();
          const list = suggestions();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            // Around the suggestions and back to none, -1.
            const h = highlighted.peek();
            highlighted.set(
              event.key === 'ArrowDown'
                ? h + 1 >= list.length
                  ? -1
                  : h + 1
                : h - 1 < -1
                  ? list.length - 1
                  : h - 1,
            );
          } else if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            // Back to the tree, as IntelliJ's: the dialog's keys work again.
            const tree = (event.currentTarget as HTMLElement).closest(
              '[role="tree"]',
            ) as HTMLElement;
            finish(
              event.key === 'Enter'
                ? (list[highlighted.peek()] ?? state.editing.peek())
                : undefined,
            );
            tree.focus();
          }
        }}
        on:blur={() => {
          finish(state.editing.peek());
        }}
      />
      {() => {
        const list = suggestions();
        return list.length === 0 ? null : (
          <ul class="playground-push__suggestions" role="listbox">
            {list.map((branch, index) => (
              <li
                role="option"
                class={() =>
                  highlighted.get() === index
                    ? 'playground-push__suggestion playground-push__suggestion--highlighted'
                    : 'playground-push__suggestion'
                }
                aria-selected={() => highlighted.get() === index}
                on:pointerdown={(event) => {
                  // Chosen, not a press that leaves the field first.
                  event.preventDefault();
                  finish(branch);
                }}
              >
                {branch}
              </li>
            ))}
          </ul>
        );
      }}
    </span>
  );
}

/** IntelliJ's label after the target: the push makes it, and or makes it the upstream. */
function targetLabel(state: PushState): string | undefined {
  const out = state.out.get();
  const upstream = state.setUpstream.get() && otherThanUpstream(out, out.target as string);
  if (out.isNew && upstream) return 'New & Upstream';
  if (out.isNew) return 'New';
  return upstream ? 'Upstream' : undefined;
}

/** The repository's row: "main → origin : main", the remote and the branch there to change. */
function TargetRow(props: { state: PushState }): Node {
  const { state } = props;
  const pickRemote = (button: HTMLElement) => {
    const out = state.out.peek();
    // IntelliJ's list: the remotes, then Define remote under a line.
    const define = { label: 'Define remote', group: '' };
    const handle = openPicker({
      label: 'Remote',
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      width: 240,
      // The remote it goes to, highlighted.
      initial: (items) => items.findIndex((item) => item.label === out.remote),
      items: (query) => fuzzyFilter([...out.remotes.map((label) => ({ label })), define], query),
    });
    void handle.result.then((choice) => {
      if (choice === define) state.defineRemote();
      else if (choice && choice.label !== out.remote) {
        state.retarget({ remote: choice.label, target: out.target as string });
      }
    });
  };
  // Its own, so the field isn't made again as it's typed in.
  const editing = computed(() => state.editing.get() !== undefined);
  return (
    <span class="playground-push__target">
      <span>{() => state.out.get().branch}</span>
      <span class="playground-push__arrow">→</span>
      {/* One link, so it keeps the focus as what it says changes. */}
      <button
        type="button"
        class="playground-link"
        on:click={(event) => {
          event.stopPropagation();
          // No remote: IntelliJ's link says Define remote, and there's no branch there.
          if (state.out.peek().remote === undefined) state.defineRemote();
          else pickRemote(event.currentTarget as HTMLElement);
        }}
      >
        {() => state.out.get().remote ?? 'Define remote'}
      </button>
      {() => (state.out.get().remote === undefined ? null : <span>:</span>)}
      {() =>
        state.out.get().remote === undefined ? null : !editing.get() ? (
          <button
            type="button"
            class="playground-link"
            on:click={(event) => {
              event.stopPropagation();
              state.editing.set(state.out.peek().target);
            }}
          >
            {state.out.get().target}
          </button>
        ) : (
          <TargetField
            state={state}
            done={(target) => {
              state.editing.set(undefined);
              const out = state.out.peek();
              if (target !== undefined && isBranchName(target) && target !== out.target) {
                state.retarget({ remote: out.remote as string, target });
              }
            }}
          />
        )
      }
      {() => {
        const out = state.out.get();
        const typed = state.editing.get();
        // While the branch is typed, as IntelliJ's: when the branch has an upstream that isn't it.
        return typed !== undefined && otherThanUpstream(out, typed) ? (
          <label
            class="playground-push__upstream"
            on:pointerdown={(event) => {
              // Ticked without leaving the field.
              event.preventDefault();
            }}
          >
            <input
              type="checkbox"
              tabIndex={-1}
              checked={() => state.setUpstream.get()}
              on:change={(event) => {
                state.setUpstream.set((event.currentTarget as HTMLInputElement).checked);
              }}
            />
            Set upstream
          </label>
        ) : null;
      }}
      {() => {
        const label = targetLabel(state);
        return label === undefined ? null : <span class="playground-push__label">{label}</span>;
      }}
    </span>
  );
}

/** IntelliJ's Push tags, beside the buttons: whether tags go too, and which. */
function TagsOption(props: { state: PushState }): Node {
  const { state } = props;
  return (
    <span class="playground-push__tags">
      <label>
        <input
          type="checkbox"
          checked={state.tags.peek()}
          on:change={(event) => {
            state.tags.set((event.currentTarget as HTMLInputElement).checked);
          }}
        />
        Push tags:
      </label>
      <select
        class="playground-push__tag-mode"
        aria-label="Tags to push"
        disabled={() => !state.tags.get()}
        prop:value={state.tagMode.peek()}
        on:change={(event) => {
          state.tagMode.set((event.currentTarget as HTMLSelectElement).value as PushTags);
        }}
      >
        <option value="all">All</option>
        <option value="follow">Current Branch</option>
      </select>
    </span>
  );
}

/** The dialog's two panes: the repository and its commits, and the selected row's files. */
function PushLog(props: { worktree: string; state: PushState; host: Host }): Node {
  const { state } = props;
  const log = new TreeModel<PushRow>({
    children: (row) =>
      row
        ? [
            ...(state.fetchError.peek() === undefined ? [] : [FETCH_ERROR]),
            ...state.out.peek().commits.map((commit): PushRow => ({ kind: 'commit', commit })),
          ]
        : [REPOSITORY],
    key: (row) =>
      row.kind === 'commit'
        ? row.commit.hash
        : row.kind === 'repository'
          ? '\u0000repository'
          : '\u0000fetch-error',
    isLeaf: (row) => row.kind !== 'repository',
  });
  // As IntelliJ's: the repository open, and selected, for all the commits' files.
  log.expand(REPOSITORY);
  log.select('\u0000repository');
  // Another target sends other commits; a Fetch that failed says why.
  let first = true;
  const following = effect(() => {
    state.out.get();
    state.fetchError.get();
    if (!first) {
      log.select('\u0000repository');
      void untracked(() => log.load(REPOSITORY, true));
    }
    first = false;
    return undefined;
  });
  onCleanup(() => {
    following.dispose();
  });
  const selected = () => {
    const key = log.selected;
    const { commits } = state.out.get();
    return key === '\u0000repository' ? commits : commits.filter((c) => c.hash === key);
  };
  return (
    <div class="playground-push__panes">
      <div class="playground-push__log">
        <TreeView
          model={log}
          label="Commits to push"
          row={(row) =>
            row.kind === 'repository' ? (
              <TargetRow state={state} />
            ) : row.kind === 'fetchError' ? (
              // IntelliJ's words (`push.divergence.fetch.failed`).
              <span class="playground-push__fetch-error">
                {`Fetch failed: ${state.fetchError.peek() as string} `}
                <button
                  type="button"
                  class="playground-link"
                  on:click={(event) => {
                    event.stopPropagation();
                    state.fetch();
                  }}
                >
                  Retry
                </button>
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

/** A remote to add: its name and URL, and whether to fetch it. */
interface NewRemote {
  name: string;
  url: string;
  fetch: boolean;
}

/**
 * Asks for a remote, as IntelliJ's Define Remote: a name (origin to start with) and a URL, and
 * Fetch remote. OK checks that the URL answers (`git ls-remote`), and says git's words under it
 * when it doesn't. A name git refuses, or one already used, says so as it's typed; OK waits for
 * both (Cerebro's, as its prompts: IntelliJ says so on OK).
 */
function askForRemote(
  host: Host,
  worktree: string,
  remotes: readonly string[],
): Promise<NewRemote | undefined> {
  const name = signal('origin');
  const url = signal('');
  const fetch = signal(true);
  const checking = signal(false);
  /** Why the URL can't be used, from checking it. */
  const unreachable = signal<string | undefined>(undefined);
  let urlField!: HTMLInputElement;
  /** IntelliJ's words for a name it can't take. */
  const nameError = () => {
    const typed = name.get().trim();
    if (typed === '') return undefined;
    if (!isBranchName(typed)) return 'Remote name contains illegal characters';
    return remotes.includes(typed) ? `Remote name '${typed}' is already used` : undefined;
  };
  const field = (label: string, value: Signal<string>, error: () => string | undefined) => (
    <label class="playground-form__row">
      <span>{label}</span>
      <input
        class={() =>
          error() === undefined
            ? 'cerebro-dialog-field__input'
            : 'cerebro-dialog-field__input cerebro-dialog-field__input--invalid'
        }
        type="text"
        spellcheck={false}
        value={value.peek()}
        disabled={() => checking.get()}
        aria-invalid={() => String(error() !== undefined)}
        ref={(input) => {
          if (value !== url) return;
          urlField = input;
          // IntelliJ's: the URL first, as the name is filled in.
          queueMicrotask(() => {
            input.focus();
          });
        }}
        on:input={(event) => {
          value.set((event.currentTarget as HTMLInputElement).value);
          // Checked again on OK.
          if (value === url) unreachable.set(undefined);
        }}
      />
      <span class="cerebro-dialog-field__error" role="alert">
        {() => error() ?? ''}
      </span>
    </label>
  );
  return openDialog<NewRemote>({
    title: 'Define Remote',
    width: 500,
    ok: {
      enabled: () =>
        name.get().trim() !== '' && url.get().trim() !== '' && nameError() === undefined,
      check: async () => {
        checking.set(true);
        try {
          await host.request('git.checkRemote', { path: worktree, url: url.peek().trim() });
          return true;
        } catch (error) {
          unreachable.set((error as Error).message);
          return false;
        } finally {
          checking.set(false);
          urlField.focus();
        }
      },
      accept: () => ({ name: name.peek().trim(), url: url.peek().trim(), fetch: fetch.peek() }),
    },
    content: () => (
      <div class="playground-form">
        {field('Name:', name, nameError)}
        {field('URL:', url, () => unreachable.get())}
        <label class="playground-form__check">
          <input
            type="checkbox"
            checked={fetch.peek()}
            on:change={(event) => {
              fetch.set((event.currentTarget as HTMLInputElement).checked);
            }}
          />
          Fetch remote
        </label>
      </div>
    ),
  }).result;
}

/**
 * Asks before a force push, as IntelliJ's: what it replaces on the remote, when that's counted; and
 * Don't warn about this target, after which a force push there doesn't ask.
 */
async function confirmForcePush(
  worktree: string,
  out: Outgoing,
  divergence: PushDivergence | undefined,
): Promise<boolean> {
  const where = `${out.remote as string}/${out.target as string}`;
  if (readSilentTargets(worktree).includes(where)) return true;
  const n = divergence?.kind === 'diverged' ? divergence.remoteCommits : 0;
  const silent = signal(false);
  const accepted = await openDialog<true>({
    title: 'Force Push',
    width: 460,
    ok: { label: 'Force Push', accept: () => true },
    content: () => (
      <div class="playground-force">
        {notificationIcon('warning')}
        <div class="playground-force__text">
          <p>
            {"You're going to force push to "}
            <b>{`'${out.target as string}'`}</b>
            {n > 0
              ? `. It replaces ${String(n)} ${n === 1 ? 'commit' : 'commits'} on the remote.`
              : '. It may overwrite commits at the remote.'}
            {' Are you sure you want to proceed?'}
          </p>
          <label>
            <input
              type="checkbox"
              on:change={(event) => {
                silent.set((event.currentTarget as HTMLInputElement).checked);
              }}
            />
            Don't warn about this target
          </label>
        </div>
      </div>
    ),
  }).result;
  if (accepted && silent.peek()) keepSilentTarget(worktree, where);
  return accepted === true;
}

/** IntelliJ's description of Push and Force Push while the push waits for a Fetch. */
const FETCH_FIRST = 'Fetch first. The remote has commits that are not fetched.';

/** Opens the Push dialog for a worktree's branch, and pushes when its Push is pressed. */
export async function openPush(worktree: string): Promise<void> {
  const host = hostFor(worktree);
  if (!host || pushing.peek()) return;
  const first = (await host.request('git.outgoing', { path: worktree })) as Outgoing;
  const why = unpushable(first);
  const state: PushState = {
    out: signal(first),
    setUpstream: signal(false),
    editing: signal<string | undefined>(undefined),
    branches: signal<readonly string[]>([]),
    // As last pushed with, IntelliJ's; All to choose from when it was off.
    tags: signal(readPushTags(worktree) !== undefined),
    tagMode: signal(readPushTags(worktree) ?? 'all'),
    divergence: signal<PushDivergence | undefined>(undefined),
    fetchError: signal<string | undefined>(undefined),
    retarget: (to) => {
      host.request('git.outgoing', { path: worktree, ...to }).then(
        (out) => {
          // Together: the tree reads its rows once, after both.
          batch(() => {
            state.out.set(out as Outgoing);
            state.fetchError.set(undefined);
          });
          detect();
        },
        (error: unknown) => {
          console.error('Reading what to push failed', error);
        },
      );
    },
    defineRemote: () => {
      void askForRemote(host, worktree, state.out.peek().remotes).then(async (remote) => {
        if (!remote) return;
        try {
          await host.request('git.addRemote', { path: worktree, ...remote });
        } catch (error) {
          // IntelliJ's words.
          showError('Add Remote', `Could not add remote: ${(error as Error).message}`);
          return;
        }
        // Where the push goes by default now, as IntelliJ's; and the new remote's branches.
        state.retarget();
        loadBranches();
      });
    },
    fetch: () => {
      const { remote, target } = state.out.peek() as { remote: string; target: string };
      fetchingRemote.set(true);
      host
        .request('git.fetchTarget', { path: worktree, remote, target })
        .then(
          () => {
            // Counted now, as IntelliJ's: what's pushed is read again, and checked.
            state.retarget({ remote, target });
          },
          (error: unknown) => {
            state.fetchError.set((error as Error).message);
          },
        )
        .finally(() => {
          fetchingRemote.set(false);
        });
    },
  };
  let checks = 0;
  /**
   * Whether the push will be rejected, as IntelliJ's: from where the remote's branch was fetched,
   * then from where the remote says it is.
   */
  const detect = () => {
    const out = state.out.peek();
    const check = ++checks;
    state.divergence.set(undefined);
    if (out.remote === undefined || out.isNew) return;
    const ask = (checkRemote: boolean) =>
      host
        .request('git.divergence', {
          path: worktree,
          remote: out.remote,
          target: out.target,
          checkRemote,
        })
        .then((divergence) => {
          // Not when what's pushed changed meanwhile.
          if (check === checks) state.divergence.set((divergence ?? undefined) as PushDivergence);
        });
    ask(false)
      .then(() => ask(true))
      .catch((error: unknown) => {
        console.error('Checking the remote failed', error);
      });
  };
  detect();
  /** The remotes' branches, for the target's suggestions. */
  const loadBranches = () => {
    host.request('git.branches', { worktree }).then(
      (branches) => {
        state.branches.set(
          (branches as { ref: string }[])
            .filter((b) => b.ref.startsWith('refs/remotes/'))
            .map((b) => b.ref.slice('refs/remotes/'.length)),
        );
      },
      (error: unknown) => {
        console.error('Reading the branches failed', error);
      },
    );
  };
  loadBranches();
  // A host means a project is open.
  const project = activeProject() as ProjectState;
  const canPush = () => {
    const out = state.out.get();
    return (
      why === undefined &&
      state.editing.get() === undefined &&
      !fetchingRemote.get() &&
      (out.commits.length > 0 ||
        out.isNew ||
        (state.setUpstream.get() && otherThanUpstream(out, out.target as string)) ||
        // Tags alone (Cerebro's: IntelliJ's Push is enabled whenever there's a target).
        (state.tags.get() && out.remote !== undefined))
    );
  };
  // IntelliJ's Push, Force Push and Fetch: the button does the first enabled one, so Fetch while the
  // push waits for one; Force Push never, nor to a protected branch.
  const accepted = await openDialog<'push' | 'force'>({
    title: `Push Commits to ${project.name}`,
    ok: {
      label: 'Push',
      enabled: () => canPush() && !fetchRequired(state),
      description: () => (fetchRequired(state) ? FETCH_FIRST : undefined),
      accept: () => 'push',
      options: [
        {
          label: 'Force Push',
          enabled: () =>
            canPush() && !isProtected(state.out.get().target as string) && !fetchRequired(state),
          description: () => {
            const { remote, target } = state.out.get();
            if (fetchRequired(state)) return FETCH_FIRST;
            return target !== undefined && isProtected(target)
              ? `Force push to ${remote as string}/${target} is prohibited`
              : undefined;
          },
          check: () => confirmForcePush(worktree, state.out.peek(), state.divergence.peek()),
          accept: () => 'force',
        },
        {
          label: 'Fetch',
          visible: () => fetchRequired(state),
          enabled: () => canPush() && fetchRequired(state),
          description: () => 'Fetch the remote commits to review them before a push',
          run: () => {
            state.fetch();
          },
        },
      ],
    },
    width: 800,
    footer: () => (why === undefined ? <TagsOption state={state} /> : null),
    content: (dialog) => (
      <div class="playground-push">
        {why === undefined ? (
          [
            <DivergenceBanner
              state={state}
              update={() => {
                dialog.close();
                void updateProject(worktree);
              }}
            />,
            <PushLog worktree={worktree} state={state} host={host} />,
          ]
        ) : (
          <p class="playground-push__target">{why}</p>
        )}
      </div>
    ),
  }).result;
  // Not after the dialog: what's pushed is no longer checked.
  checks++;
  if (!accepted) return;
  const out = state.out.peek();
  const remote = out.remote as string;
  const target = out.target as string;
  const where = `${remote}/${target}`;
  const tags = state.tags.peek() ? state.tagMode.peek() : undefined;
  keepPushTags(worktree, tags);
  // A force push expects the remote's branch where it was seen, else where it was fetched.
  const lease = state.divergence.peek()?.lease;
  const force =
    accepted === 'force' ? { force: true, ...(lease === undefined ? {} : { lease }) } : {};
  pushing.set(true);
  try {
    const pushed = (await host.request('git.push', {
      path: worktree,
      remote,
      target,
      setUpstream: state.setUpstream.peek() && otherThanUpstream(out, target),
      ...(tags === undefined ? {} : { tags }),
      ...force,
    })) as Pushed;
    notifications.notify({ title: pushedText(pushed, out.branch as string), group: 'push' });
  } catch (error) {
    const { message } = error as Error;
    const rejected = message.includes('[rejected]');
    notifications.notify({
      title: rejected ? 'Push rejected' : 'Push failed',
      // IntelliJ's words; a force push's when the remote's branch wasn't where it was expected.
      content: message.includes('(stale info)')
        ? `Force-with-lease push ${out.branch as string} to ${where} was rejected`
        : rejected
          ? `Push to ${where} was rejected`
          : message,
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
