// Pushing, as IntelliJ's Push dialog (Git → Push…, and the Commit window's Commit and Push…): the
// checked-out branch, where it goes ("main → origin : main", "New" when the push makes it there),
// and the commits that aren't there yet, with the selected row's files beside them (PushLog). Where
// it goes can be changed, as IntelliJ's GitPushTargetPanel: the remote from a list, the branch
// there typed, with the remote's branches suggested, and Set upstream. Push pushes them,
// "Pushing…" on the status bar meanwhile. How it went is a notification, as
// IntelliJ's GitPushResultNotification: "Pushed 2 commits to origin/main", "Pushed main to new
// branch origin/main", "Everything is up to date", or "Push rejected" or "Push failed", which stay.

import { onCleanup } from '@cerebro-ide/jsx';
import { computed, effect, signal, untracked, type Signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker } from '@cerebro-ide/ui-popup';
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
  remotes: string[];
  upstream: { remote: string; target: string } | undefined;
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
  /** Asks again what a push to another target sends. */
  retarget: (remote: string, target: string) => void;
  /** The remotes' branches, for suggestions. */
  branches: Signal<readonly string[]>;
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
    const handle = openPicker({
      label: 'Remote',
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      width: 240,
      // The remote it goes to, highlighted.
      initial: (items) => items.findIndex((item) => item.label === out.remote),
      items: (query) =>
        fuzzyFilter(
          out.remotes.map((label) => ({ label })),
          query,
        ),
    });
    void handle.result.then((choice) => {
      if (choice && choice.label !== out.remote) {
        state.retarget(choice.label, out.target as string);
      }
    });
  };
  // Its own, so the field isn't made again as it's typed in.
  const editing = computed(() => state.editing.get() !== undefined);
  return (
    <span class="playground-push__target">
      <span>{() => state.out.get().branch}</span>
      <span class="playground-push__arrow">→</span>
      {() => {
        const out = state.out.get();
        // IntelliJ's list shows with more than one remote to choose from.
        return out.remotes.length > 1 ? (
          <button
            type="button"
            class="playground-push__link"
            on:click={(event) => {
              event.stopPropagation();
              pickRemote(event.currentTarget as HTMLElement);
            }}
          >
            {out.remote}
          </button>
        ) : (
          <span>{out.remote}</span>
        );
      }}
      <span>:</span>
      {() =>
        !editing.get() ? (
          <button
            type="button"
            class="playground-push__link"
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
                state.retarget(out.remote as string, target);
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

/** The dialog's two panes: the repository and its commits, and the selected row's files. */
function PushLog(props: { worktree: string; state: PushState; host: Host }): Node {
  const { state } = props;
  const log = new TreeModel<PushRow>({
    children: (row) =>
      row ? state.out.peek().commits.map((commit) => ({ kind: 'commit', commit })) : [REPOSITORY],
    key: (row) => (row.kind === 'repository' ? '\u0000repository' : row.commit.hash),
    isLeaf: (row) => row.kind === 'commit',
  });
  // As IntelliJ's: the repository open, and selected, for all the commits' files.
  log.expand(REPOSITORY);
  log.select('\u0000repository');
  // Another target sends other commits.
  let first = true;
  const following = effect(() => {
    state.out.get();
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
  const first = (await host.request('git.outgoing', { path: worktree })) as Outgoing;
  const why = unpushable(first);
  const state: PushState = {
    out: signal(first),
    setUpstream: signal(false),
    editing: signal<string | undefined>(undefined),
    branches: signal<readonly string[]>([]),
    retarget: (remote, target) => {
      host.request('git.outgoing', { path: worktree, remote, target }).then(
        (out) => {
          state.out.set(out as Outgoing);
        },
        (error: unknown) => {
          console.error('Reading what to push failed', error);
        },
      );
    },
  };
  // The remotes' branches, for the target's suggestions.
  void host.request('git.branches', { worktree }).then(
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
  // A host means a project is open.
  const project = activeProject() as ProjectState;
  const accepted = await openDialog<true>({
    title: `Push Commits to ${project.name}`,
    ok: {
      label: 'Push',
      enabled: () => {
        const out = state.out.get();
        return (
          why === undefined &&
          state.editing.get() === undefined &&
          (out.commits.length > 0 ||
            out.isNew ||
            (state.setUpstream.get() && otherThanUpstream(out, out.target as string)))
        );
      },
      accept: () => true,
    },
    width: 800,
    content: () => (
      <div class="playground-push">
        {why === undefined ? (
          <PushLog worktree={worktree} state={state} host={host} />
        ) : (
          <p class="playground-push__target">{why}</p>
        )}
      </div>
    ),
  }).result;
  if (!accepted) return;
  const out = state.out.peek();
  const remote = out.remote as string;
  const target = out.target as string;
  const where = `${remote}/${target}`;
  pushing.set(true);
  try {
    const pushed = (await host.request('git.push', {
      path: worktree,
      remote,
      target,
      setUpstream: state.setUpstream.peek() && otherThanUpstream(out, target),
    })) as Pushed;
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
