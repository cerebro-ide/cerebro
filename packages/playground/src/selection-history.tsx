// Show History for Selection, as IntelliJ's `VcsSelectionHistoryDialog` (read from its source):
// the selected lines followed back through the file's commits (`BlockLoader`, `Block`), each one's
// lines compared with the next one's. The latest first, the file as it is ("Local Changes") before
// them; with Changes only (IntelliJ's default), just the commits that changed the lines.

import type { MenuServices } from '@cerebro-ide/ui-menu';
import { computed, signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import { previousBlock, type Block } from '@cerebro-ide/ui-editor';
import { formatCommitDate } from './dates.js';
import { DiffViewer } from './diff-viewer.js';
import type { Host } from './environments.js';
import type { LogCommit } from './git-log.js';
import { settingsFor } from './settings.js';

/** What the dialog is for: a file's lines, from 0, `last` included, as its editor has them. */
export interface SelectionHistoryOf {
  host: Host;
  worktree: string;
  path: string;
  text: string;
  first: number;
  last: number;
}

/** A row: a commit, or the file as it is (no commit). */
type Revision = LogCommit | undefined;

/** The lines a version had, and where they started; `null` where it hadn't them (IntelliJ's `EMPTY_BLOCK`). */
type Lines = { lines: string[]; start: number } | null;

/** How many commits are asked for at a time. */
const PAGE = 500;

/** Changes only, as last left (IntelliJ's `SHOW_ONLY_CHANGED_IN_SELECTION_DIFF`, true at first). */
let changesOnly = true;

const linesOf = (text: string) => text.split(/\r\n?|\n/);

/**
 * The versions whose lines differ from the one before them (`filteredRevisions`): each commit that
 * changed them, the file as it is if it did, and the commit they first appear in.
 */
export function changedRevisions<T>(revisions: readonly T[], blocks: readonly Lines[]): T[] {
  const same = (a: Lines, b: Lines) =>
    a === null || b === null ? a === b : a.lines.join('\n') === b.lines.join('\n');
  const result: T[] = [];
  for (let i = 1; i < revisions.length; i++) {
    const [newer, older] = [blocks[i - 1], blocks[i]];
    if (newer === undefined || older === undefined) break;
    if (!same(newer, older)) result.push(revisions[i - 1] as T);
    if (older === null) break;
  }
  const initial = blocks[revisions.length - 1];
  if (revisions.length > 1 && initial !== undefined && initial !== null) {
    result.push(revisions[revisions.length - 1] as T);
  }
  return result;
}

export async function showSelectionHistory(
  services: MenuServices,
  of: SelectionHistoryOf,
): Promise<void> {
  const { host, worktree, path } = of;
  const revisions = signal<readonly Revision[]>([]);
  const blocks = signal<readonly Lines[]>([
    { lines: linesOf(of.text).slice(of.first, of.last + 1), start: of.first },
  ]);
  const loading = signal<LogCommit | undefined | 'commits'>('commits');
  const failed = signal<string | undefined>(undefined);
  const selected = signal<Revision | null>(null);
  const onlyChanged = signal(changesOnly);
  const shown = () =>
    onlyChanged.get() ? changedRevisions(revisions.get(), blocks.get()) : revisions.get();

  const load = async () => {
    const commits: LogCommit[] = [];
    for (let skip = 0; ; skip += PAGE) {
      const page = (await host.request('git.log', {
        worktree,
        skip,
        max: PAGE,
        filter: { paths: [path] },
      })) as LogCommit[];
      commits.push(...page);
      if (page.length < PAGE) break;
    }
    revisions.set([undefined, ...commits]);
    let text = of.text;
    let block: Block = { start: of.first, end: of.last + 1 };
    for (const commit of commits) {
      // Gone: not in the earlier ones either, which aren't read (`createBlock`).
      if (block.start === block.end) {
        blocks.set([...blocks.peek(), null]);
        continue;
      }
      loading.set(commit);
      const read = (await host.request('git.fileAt', {
        path: worktree,
        hash: commit.hash,
        file: path,
      })) as { text?: string } | null;
      const before = read?.text ?? '';
      block = read === null ? { start: 0, end: 0 } : previousBlock(text, before, block);
      blocks.set([
        ...blocks.peek(),
        block.start === block.end
          ? null
          : { lines: linesOf(before).slice(block.start, block.end), start: block.start },
      ]);
      text = before;
    }
  };
  void load()
    .catch((error: unknown) => {
      failed.set((error as Error).message);
    })
    .finally(() => {
      loading.set(undefined);
    });

  /** The row selected: the first shown until one is chosen. */
  const current = (): Revision | null => {
    const rows = shown();
    const chosen = selected.get();
    return chosen !== null && rows.includes(chosen) ? chosen : rows.length > 0 ? rows[0] : null;
  };
  const settings = settingsFor(worktree);
  const status = () => {
    const at = loading.get();
    if (at === undefined) return '';
    if (at === 'commits') return 'Loading…';
    // IntelliJ's words (`selection.history.loading.revision.status`).
    return `Loading revision ${at.hash.slice(0, 8)}… (${String(blocks.get().length)}/${String(revisions.get().length)})`;
  };
  /**
   * What the diff shows: the selected row's lines and the ones before them. A computed, so the
   * diff is made again only when they change, not as each later revision is read.
   */
  const pair = computed(
    () => {
      const row = current();
      const index = row === null ? -1 : revisions.get().indexOf(row);
      const [newer, older] = [blocks.get()[index], blocks.get()[index + 1]];
      return {
        row,
        newer,
        // Undefined while it's read; none before the first commit.
        older: index + 1 === revisions.get().length ? null : older,
        why: failed.get(),
      };
    },
    {
      equals: (a, b) =>
        a.row === b.row && a.newer === b.newer && a.older === b.older && a.why === b.why,
    },
  );
  const diff = () => {
    const { row, newer, older, why } = pair.get();
    // IntelliJ's words (`selection.history.can.not.load.message`, `history.loading.revisions`),
    // for a log or a version that can't be read alike.
    if (why !== undefined) {
      return <p class="playground-code__note">{`Cannot load revision contents: ${why}`}</p>;
    }
    if (row === null) return <p class="playground-code__note">Loading affected revisions…</p>;
    if (newer === undefined || older === undefined) {
      return <p class="playground-code__note">Loading…</p>;
    }
    const side = (lines: Lines) => (lines ? lines.lines.join('\n') : '');
    return (
      <DiffViewer
        services={services}
        path={path}
        original={side(older)}
        text={side(newer)}
        firstLines={[older?.start ?? 0, newer?.start ?? 0]}
        fontSize={() => settings.get('editor.fontSize') as number}
        tabSize={() => settings.get('editor.tabSize') as number}
      />
    );
  };
  const move = (by: number) => {
    const rows = shown();
    if (rows.length === 0) return;
    const at = rows.indexOf(current() as Revision);
    selected.set(rows[Math.min(Math.max(at + by, 0), rows.length - 1)]);
  };
  await openDialog<never>({
    // IntelliJ's words (`show.history.dialog.title.template`, `action.name.show.history.for.selection`).
    title: 'History for Selection',
    width: 1100,
    cancelLabel: 'Close',
    content: () => (
      <div class="playground-selection-history">
        <div class="playground-selection-history__diff">{diff}</div>
        <div class="playground-selection-history__bar">
          <label class="playground-checkbox">
            <input
              type="checkbox"
              checked={() => onlyChanged.get()}
              on:change={(event) => {
                changesOnly = (event.currentTarget as HTMLInputElement).checked;
                onlyChanged.set(changesOnly);
              }}
            />
            Changes only
          </label>
          <span class="playground-selection-history__status" role="status">
            {status}
          </span>
        </div>
        <div
          class="playground-selection-history__revisions"
          role="grid"
          aria-label="Revisions"
          tabIndex={0}
          autofocus
          on:keydown={(event) => {
            const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
            if (by === undefined) return;
            event.preventDefault();
            move(by);
          }}
        >
          <div
            class="playground-selection-history__row playground-selection-history__head"
            role="row"
          >
            {['Version', 'Date', 'Author', 'Commit Message'].map((name) => (
              <span role="columnheader">{name}</span>
            ))}
          </div>
          {() =>
            shown().map((row) => (
              <div
                role="row"
                class={() =>
                  current() === row
                    ? 'playground-selection-history__row playground-selection-history__row--selected'
                    : 'playground-selection-history__row'
                }
                aria-selected={() => String(current() === row)}
                on:click={() => {
                  selected.set(row);
                }}
              >
                <span role="gridcell">{row ? row.hash.slice(0, 8) : 'Local Changes'}</span>
                <span role="gridcell">{row ? formatCommitDate(row.time) : ''}</span>
                <span role="gridcell">{row?.author ?? ''}</span>
                <span role="gridcell">{row?.subject ?? ''}</span>
              </div>
            ))
          }
        </div>
        <div class="playground-selection-history__message">
          {/* IntelliJ's words (`selection.history.commit.message.label`). */}
          <div>Commit Message:</div>
          <div class="playground-selection-history__text cerebro-selectable">
            {() => {
              const row = current();
              return row ? [row.subject, row.body].filter((part) => part !== '').join('\n\n') : '';
            }}
          </div>
        </div>
      </div>
    ),
  }).result;
}
