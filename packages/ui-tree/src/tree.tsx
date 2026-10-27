// A virtualised tree view: only the rows in view (and a few either side) are in the DOM, inside a
// spacer as tall as all the rows, so a tree of tens of thousands of nodes scrolls as fast as a short
// one. Rows have a fixed height.
//
// Keyboard, as in IntelliJ's project tree: Up and Down move, Home and End go to the ends, Page Up
// and Page Down move by a screen, Right expands or steps in, Left collapses or steps out, Enter
// opens a file or toggles a folder. A click selects; a double click opens or toggles; the arrow
// toggles. A selection made from outside (a "select opened file") is scrolled into view.

import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { effect, makeObservable, untracked } from '@cerebro-ide/reactive';
import type { TreeModel, TreeRow } from './model.js';

export interface TreeViewProps<T> {
  model: TreeModel<T>;
  /** What the tree is, for screen readers. */
  label: string;
  /** A row's content after its arrow: an icon and a name, say. */
  row: (node: T) => Child;
  /** A file opened: double click or Enter on a leaf. */
  onOpen?: (node: T) => void;
  /** A class for a node's row, to style kinds of rows: groups, say. */
  rowClass?: (node: T) => string | undefined;
  /** A context menu asked for on a row, which is selected first. */
  onContextMenu?: (event: MouseEvent, node: T) => void;
  /** Default: 24. */
  rowHeight?: number;
}

/** Rows drawn beyond each edge of the view, so a quick scroll doesn't show blanks. */
const OVERSCAN = 8;

/** How far each level is indented, as WebStorm (measured). */
const INDENT = 19;

class Viewport {
  top = 0;
  height = 0;

  constructor() {
    makeObservable(this);
  }
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function TreeView<T>(props: TreeViewProps<T>): Node {
  const { model } = props;
  const rowHeight = props.rowHeight ?? 24;
  const viewport = new Viewport();
  let element: HTMLElement | undefined;

  /** Scrolls the selected row into view, if it isn't. */
  const reveal = () => {
    const index = model.selectedIndex;
    if (!element || index < 0) return;
    const top = index * rowHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + rowHeight - element.clientHeight;
    }
    viewport.top = element.scrollTop;
  };

  const open = (row: TreeRow<T>) => {
    if (row.leaf) props.onOpen?.(row.node);
    else model.toggle(row.node);
  };

  const onKey = (event: KeyboardEvent) => {
    const page = Math.max(1, Math.floor(viewport.height / rowHeight) - 1);
    const keys: Record<string, () => void> = {
      ArrowDown: () => {
        model.move(1);
      },
      ArrowUp: () => {
        model.move(-1);
      },
      PageDown: () => {
        model.move(page);
      },
      PageUp: () => {
        model.move(-page);
      },
      Home: () => {
        model.edge(false);
      },
      End: () => {
        model.edge(true);
      },
      ArrowRight: () => {
        model.right();
      },
      ArrowLeft: () => {
        model.left();
      },
      Enter: () => {
        const row = model.rows[model.selectedIndex];
        if (row) open(row);
      },
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    reveal();
  };

  // Set as the tree is drawn, before it's ever fitted.
  let spacer!: HTMLElement;
  /** The rows last fitted: while they're the same, scrolling only widens. */
  let fitted: readonly TreeRow<T>[] | undefined;
  /**
   * As wide as the widest row drawn, so each row, and the selection's colour, spans the width the
   * tree scrolls across, as IntelliJ's; at least the tree's own width (the spacer's minimum). It
   * keeps the widest seen while the rows stay the same, so scrolling down past a long row doesn't
   * narrow it; `fresh` starts again, when they change or the tree is resized.
   */
  const fit = (fresh: boolean) => {
    if (fresh) spacer.style.width = '';
    const rows = [...spacer.children] as HTMLElement[];
    const overflow = Math.max(0, ...rows.map((row) => row.scrollWidth - row.clientWidth));
    if (overflow > 0) spacer.style.width = `${String(spacer.clientWidth + overflow)}px`;
  };

  const Row = (p: { row: TreeRow<T>; index: number }) => {
    const { row, index } = p;
    return (
      <div
        class={() =>
          cls(
            'cerebro-tree-row',
            model.selected === row.key && 'cerebro-tree-row--selected',
            props.rowClass?.(row.node),
          )
        }
        role="treeitem"
        aria-level={row.depth + 1}
        aria-expanded={row.leaf ? null : String(row.expanded)}
        aria-selected={() => String(model.selected === row.key)}
        data-key={row.key}
        style={{
          top: `${String(index * rowHeight)}px`,
          height: `${String(rowHeight)}px`,
          paddingLeft: `${String(row.depth * INDENT)}px`,
        }}
        on:click={() => {
          model.select(row.key);
        }}
        on:dblclick={() => {
          open(row);
        }}
        on:contextmenu={(event) => {
          if (!props.onContextMenu) return;
          model.select(row.key);
          props.onContextMenu(event, row.node);
        }}
      >
        <span
          class={cls(
            'cerebro-tree-row__arrow',
            row.expanded && 'cerebro-tree-row__arrow--open',
            row.leaf && 'cerebro-tree-row__arrow--none',
          )}
          on:click={(event) => {
            event.stopPropagation();
            model.select(row.key);
            if (!row.leaf) model.toggle(row.node);
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M6 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="cerebro-tree-row__content">{props.row(row.node)}</span>
        {row.loading ? <span class="cerebro-tree-row__note">Loading…</span> : null}
      </div>
    );
  };

  return (
    <div
      class="cerebro-tree"
      role="tree"
      aria-label={props.label}
      tabIndex={0}
      ref={(tree) => {
        element = tree;
        const measure = () => {
          viewport.height = tree.clientHeight;
          viewport.top = tree.scrollTop;
          fit(true);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(tree);
        // A selection made from outside shows; one made here is in view already.
        // Only the selection is followed, not the rows: a refresh doesn't scroll.
        const follow = effect(() => {
          if (model.selected !== undefined) untracked(reveal);
          return undefined;
        });
        onCleanup(() => {
          observer.disconnect();
          follow.dispose();
        });
        queueMicrotask(measure);
      }}
      on:scroll={(event) => {
        viewport.top = (event.currentTarget as HTMLElement).scrollTop;
      }}
      on:keydown={onKey}
      on:focus={() => {
        if (model.selected === undefined) model.move(0);
      }}
    >
      <div
        class="cerebro-tree__spacer"
        style={{ height: () => `${String(model.rows.length * rowHeight)}px` }}
        ref={(element) => {
          spacer = element;
        }}
      >
        {() => {
          const rows = model.rows;
          const fresh = rows !== fitted;
          fitted = rows;
          queueMicrotask(() => {
            fit(fresh);
          });
          const first = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN);
          const last = Math.min(
            rows.length,
            Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN,
          );
          return rows.slice(first, last).map((row, i) => <Row row={row} index={first + i} />);
        }}
      </div>
    </div>
  );
}
