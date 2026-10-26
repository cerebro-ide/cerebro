// The Commit tool window's changes: the active worktree's files changed since its last commit,
// then each of its agent's turns (the host keeps a snapshot before and after each), the latest
// first, with the files the turn changed. Read through the host every few seconds (an agent changes
// files without telling); each file opens its diff in an editor tab. Each environment keeps its own.

import type { Tab } from '@cerebro-ide/layout';
import { onCleanup } from '@cerebro-ide/jsx';
import { computed } from '@cerebro-ide/reactive';
import { TreeModel, TreeView } from '@cerebro-ide/ui-tree';
import { active, currentHost } from './environments.js';
import { icon } from './icons.js';

export interface Change {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  from?: string;
}

/** An agent's turn, as the host keeps it: its snapshots before and after. */
export interface Turn {
  id: string;
  start: string;
  end: string;
  prompt: string;
  time: number;
}

/** Two commits to compare: a turn's snapshots. */
export interface Range {
  from: string;
  to: string;
}

/** A row: the uncommitted changes, a turn, or a file changed in either. */
type Item =
  | { kind: 'changes' }
  | { kind: 'turn'; turn: Turn }
  | { kind: 'change'; change: Change; turn?: Turn };

/**
 * A diff tab's id: the file's path in the worktree, marked as a diff, against its last commit
 * (`diff:path`) or between two commits (`diff@from..to:path`).
 */
const DIFF = 'diff';

export const diffTab = (path: string, range?: Range): Tab => ({
  id: range ? `${DIFF}@${range.from}..${range.to}:${path}` : `${DIFF}:${path}`,
  title: path.split('/').at(-1) as string,
});

const DIFF_ID = /^diff(?:@([^.:]+)\.\.([^:]+))?:(.*)$/s;

/** The file a diff tab shows, if it's one. */
export function diffPath(tabId: string): string | undefined {
  return DIFF_ID.exec(tabId)?.[3];
}

/** The commits a diff tab compares, if it compares two. */
export function diffRange(tabId: string): Range | undefined {
  const match = DIFF_ID.exec(tabId);
  return match?.[1] === undefined ? undefined : { from: match[1], to: match[2] as string };
}

/** How often the list is read again while it shows. */
const REFRESH_MS = 2000;

const CHANGES_KEY = '\u0000changes';
const UNCOMMITTED: Item = { kind: 'changes' };

interface Changes {
  model: TreeModel<Item>;
  /** Whether there's nothing to show: no changes, no turns. */
  empty: () => boolean;
  /** Reads the lists again. */
  refresh: () => Promise<void>;
}

const lists = new Map<string, Changes>();

function changesOf(worktree: string): Changes {
  let changes = lists.get(worktree);
  if (!changes) {
    const host = currentHost() as NonNullable<ReturnType<typeof currentHost>>;
    let latest: Change[] = [];
    let turns: Turn[] = [];
    // The lists last read, as JSON: the tree is reloaded only when they change. Reloading draws the
    // rows again: not while nothing changed, under the user's pointer.
    let lastChanges = '';
    let lastTurns = '';
    const model = new TreeModel<Item>({
      children: async (item) => {
        if (item === undefined)
          return [UNCOMMITTED, ...turns.map((turn) => ({ kind: 'turn', turn }) as const)];
        if (item.kind === 'changes')
          return latest.map((change) => ({ kind: 'change', change }) as const);
        // A turn's changes never change: read once, when it's first expanded.
        const { turn } = item as { turn: Turn };
        const read = (await host.request('git.changes', {
          path: worktree,
          from: turn.start,
          to: turn.end,
        })) as Change[];
        return read.map((change) => ({ kind: 'change', change, turn }) as const);
      },
      key: (item) =>
        item.kind === 'changes'
          ? CHANGES_KEY
          : item.kind === 'turn'
            ? `turn:${item.turn.id}`
            : item.turn
              ? `${item.turn.id}:${item.change.path}`
              : item.change.path,
      isLeaf: (item) => item.kind === 'change',
    });
    model.expanded.add(CHANGES_KEY);
    // No uncommitted changes and no turns: the groups' rows would show nothing.
    const empty = computed(
      () => model.loaded.get(CHANGES_KEY)?.length === 0 && model.rows.length === 1,
    );
    changes = {
      model,
      empty: () => empty.get(),
      refresh: async () => {
        const [readChanges, readTurns] = (await Promise.all([
          host.request('git.changes', { path: worktree }),
          host.request('agent.turns', { path: worktree }),
        ])) as [Change[], Turn[]];
        const changesJson = JSON.stringify(readChanges);
        const turnsJson = JSON.stringify(readTurns);
        latest = readChanges;
        turns = readTurns;
        const loads: Promise<void>[] = [];
        if (turnsJson !== lastTurns) loads.push(model.load(undefined, true));
        if (changesJson !== lastChanges) loads.push(model.load(UNCOMMITTED, true));
        lastChanges = changesJson;
        lastTurns = turnsJson;
        await Promise.all(loads);
      },
    };
    lists.set(worktree, changes);
  }
  return changes;
}

/** A turn's label: when it ended, and its prompt's first line. */
function turnLabel(turn: Turn): string {
  const time = new Date(turn.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const prompt = turn.prompt.split('\n')[0] ?? '';
  return prompt === '' ? `Turn at ${time}` : `${time} ${prompt}`;
}

/** A row: a group's name, or a change's name in its status's colour, then its folder. */
function row(item: Item): Node[] {
  if (item.kind === 'changes') return [icon('commit'), <span>Changes</span>] as Node[];
  if (item.kind === 'turn') {
    return [
      icon('agent'),
      <span class="playground-turn" title={item.turn.prompt}>
        {turnLabel(item.turn)}
      </span>,
    ] as Node[];
  }
  const { change } = item;
  const slash = change.path.lastIndexOf('/');
  const folder = slash < 0 ? '' : change.path.slice(0, slash);
  return [
    icon('file'),
    <span class={`playground-change playground-change--${change.status}`}>
      {change.path.slice(slash + 1)}
    </span>,
    <span class="playground-change__folder">
      {change.from === undefined ? folder : `${folder} ← ${change.from}`}
    </span>,
  ] as Node[];
}

export function ChangesView(props: { open: (tab: Tab) => void }): Node {
  return (
    <div class="playground-project">
      {() => {
        const env = active();
        if (!env) return <p class="playground-project__empty">No environment open</p>;
        if (!currentHost()) {
          return <p class="playground-project__empty">Changes show in the desktop app.</p>;
        }
        const { model, empty, refresh: read } = changesOf(env.id);
        const refresh = () => {
          read().catch((error: unknown) => {
            console.error('Reading the changes failed', error);
          });
        };
        refresh();
        const timer = setInterval(refresh, REFRESH_MS);
        window.addEventListener('focus', refresh);
        onCleanup(() => {
          clearInterval(timer);
          window.removeEventListener('focus', refresh);
        });
        // Only whether there are any: the tree itself follows the lists.
        return () =>
          empty() ? (
            <p class="playground-project__empty">No changes</p>
          ) : (
            <TreeView
              model={model}
              label={`${env.name} changes`}
              row={row}
              onOpen={(item) => {
                // Only files open: TreeView opens leaves alone.
                const { change, turn } = item as Extract<Item, { kind: 'change' }>;
                props.open(diffTab(change.path, turn && { from: turn.start, to: turn.end }));
              }}
            />
          );
      }}
    </div>
  );
}
