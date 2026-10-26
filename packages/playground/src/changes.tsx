// The Commit tool window's changes: the active worktree's files changed since its last commit,
// read through the host every few seconds (an agent changes files without telling), each opening
// its diff in an editor tab. Each environment keeps its own list.

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

/** A diff tab's id: the file's path in the worktree, marked as a diff. */
const DIFF = 'diff:';

export const diffTab = (path: string): Tab => ({
  id: `${DIFF}${path}`,
  title: path.split('/').at(-1) as string,
});

/** The file a diff tab shows, if it's one. */
export function diffPath(tabId: string): string | undefined {
  return tabId.startsWith(DIFF) ? tabId.slice(DIFF.length) : undefined;
}

/** How often the list is read again while it shows. */
const REFRESH_MS = 2000;

interface Changes {
  model: TreeModel<Change>;
  /** The list last read, as JSON: the tree is reloaded only when it changes. */
  last: string;
  /** Reads the list again. */
  refresh: () => Promise<void>;
}

const lists = new Map<string, Changes>();

function changesOf(worktree: string): Changes {
  let changes = lists.get(worktree);
  if (!changes) {
    const host = currentHost() as NonNullable<ReturnType<typeof currentHost>>;
    let latest: Change[] = [];
    const model = new TreeModel<Change>({
      children: () => latest,
      key: (change) => change.path,
      isLeaf: () => true,
    });
    const list: Changes = {
      model,
      last: '',
      refresh: async () => {
        const read = (await host.request('git.changes', { path: worktree })) as Change[];
        const json = JSON.stringify(read);
        // Reloading draws the rows again: not while nothing changed, under the user's pointer.
        if (json === list.last) return;
        list.last = json;
        latest = read;
        await model.load(undefined, true);
      },
    };
    changes = list;
    lists.set(worktree, changes);
  }
  return changes;
}

/** A change's row: its name in its status's colour, then its folder. */
function row(change: Change): Node[] {
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
        const { model, refresh: read } = changesOf(env.id);
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
        // Only whether there are any: the tree itself follows the list.
        const empty = computed(() => model.loaded.size > 0 && model.rows.length === 0);
        return () =>
          empty.get() ? (
            <p class="playground-project__empty">No changes</p>
          ) : (
            <TreeView
              model={model}
              label={`${env.name} changes`}
              row={row}
              onOpen={(change) => {
                props.open(diffTab(change.path));
              }}
            />
          );
      }}
    </div>
  );
}
