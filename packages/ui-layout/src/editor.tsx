// The editor area's view: the tree of splits, each group with its tab strip and its active tab's
// content. Tabs activate on click and close with their button or a middle-click. Dragging a tab
// moves it within its strip, into another group, or onto a group's edge to split it there.
//
// Each group's view is rendered once into its own element and moved when the tree changes, so a
// group's content is not recreated by splits and moves elsewhere.

import { onCleanup, render, type Child } from '@cerebro-ide/jsx';
import type {
  Direction,
  EditorArea,
  EditorGroup,
  EditorNode,
  EditorSplit,
  Tab,
} from '@cerebro-ide/layout';
import { effect, makeObservable } from '@cerebro-ide/reactive';
import { dragFrom } from './drag.js';
import { Splitter } from './splitter.js';

export interface EditorAreaViewProps {
  area: EditorArea;
  /** The content of a tab, rendered while it's its group's active tab. */
  content: (tab: Tab) => Child;
  /** Shown in a group without tabs; only the last group can be empty. */
  empty?: () => Child;
}

/** Where a dragged tab would land. */
export type TabDropTarget =
  | { kind: 'strip'; groupId: string; index: number }
  | { kind: 'group'; groupId: string }
  | { kind: 'split'; groupId: string; direction: Direction };

/** How close to a group's edge a drop splits the group, as a share of its width or height. */
export const SPLIT_EDGE = 0.25;

class TabDrag {
  tab: string | undefined = undefined;
  from: string | undefined = undefined;
  target: TabDropTarget | undefined = undefined;
  resizing = false;

  constructor() {
    makeObservable(this);
  }

  setTarget(target: TabDropTarget | undefined): void {
    if (JSON.stringify(target) !== JSON.stringify(this.target)) this.target = target;
  }
}

interface Context {
  area: EditorArea;
  drag: TabDrag;
  props: EditorAreaViewProps;
  /** Set right after a drag, so the click that ends it doesn't activate the tab. */
  suppressClick: boolean;
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function EditorAreaView(props: EditorAreaViewProps): Node {
  const ctx: Context = { area: props.area, drag: new TabDrag(), props, suppressClick: false };
  const views = new Map<string, { element: HTMLElement; dispose: () => void }>();

  const viewOf = (group: EditorGroup): HTMLElement => {
    let view = views.get(group.id);
    if (!view) {
      const element = document.createElement('div');
      element.className = 'cerebro-editor-holder';
      const handle = render(() => <GroupView ctx={ctx} group={group} />, element);
      view = {
        element,
        dispose: () => {
          handle.dispose();
        },
      };
      views.set(group.id, view);
    }
    return view.element;
  };

  // Dispose the views of groups that are gone.
  const pruning = effect(() => {
    const live = new Set(ctx.area.groups.map((g) => g.id));
    for (const [id, view] of views) {
      if (!live.has(id)) {
        view.dispose();
        views.delete(id);
      }
    }
    return undefined;
  });
  onCleanup(() => {
    pruning.dispose();
    for (const view of views.values()) view.dispose();
    views.clear();
  });

  const renderNode = (node: EditorNode): Child =>
    node.kind === 'group' ? (
      viewOf(node)
    ) : (
      <SplitView ctx={ctx} split={node} renderNode={renderNode} />
    );

  return (
    <div
      class={() =>
        cls(
          'cerebro-editor-area',
          ctx.drag.tab !== undefined && 'cerebro-editor-area--dragging',
          ctx.drag.resizing && 'cerebro-editor-area--resizing',
        )
      }
    >
      {() => renderNode(ctx.area.root)}
    </div>
  );
}

function SplitView(props: {
  ctx: Context;
  split: EditorSplit;
  renderNode: (node: EditorNode) => Child;
}): Node {
  const { ctx, split, renderNode } = props;
  const horizontal = split.orientation === 'horizontal';
  return (
    <div
      class={`cerebro-editor-split cerebro-editor-split--${split.orientation}`}
      data-split={split.id}
    >
      {() =>
        split.children.flatMap((child, i) => {
          const cell = (
            <div class="cerebro-editor-cell" style={{ flexGrow: () => String(split.sizes[i]) }}>
              {renderNode(child)}
            </div>
          );
          if (i === 0) return [cell];
          const splitter = (
            <Splitter
              line={horizontal ? 'vertical' : 'horizontal'}
              start={() => [...split.sizes]}
              onResizing={(active) => {
                ctx.drag.resizing = active;
              }}
              onDrag={(start, delta, element) => {
                const container = element.parentElement as HTMLElement;
                const shift = delta / (horizontal ? container.clientWidth : container.clientHeight);
                const sizes = [...start];
                sizes[i - 1] = (start[i - 1] as number) + shift;
                sizes[i] = (start[i] as number) - shift;
                ctx.area.resize(split.id, sizes);
              }}
            />
          );
          return [splitter, cell];
        })
      }
    </div>
  );
}

function GroupView(props: { ctx: Context; group: EditorGroup }): Node {
  const { ctx, group } = props;
  const { area, drag } = ctx;
  const others = () => group.tabs.filter((t) => !(drag.from === group.id && t.id === drag.tab));
  const dropAtEnd = () => {
    const target = drag.target;
    return (
      target?.kind === 'strip' && target.groupId === group.id && target.index === others().length
    );
  };
  const zone = () => {
    const target = drag.target;
    if (target === undefined || target.kind === 'strip' || target.groupId !== group.id)
      return undefined;
    return target.kind === 'group' ? 'center' : target.direction;
  };
  return (
    <div
      class={() =>
        cls(
          'cerebro-editor-group',
          area.activeGroupId === group.id && 'cerebro-editor-group--active',
        )
      }
      data-group={group.id}
    >
      <div
        class={() => cls('cerebro-editor-tabs', dropAtEnd() && 'cerebro-editor-tabs--drop-end')}
        role="tablist"
        data-strip={group.id}
      >
        {() => group.tabs.map((tab) => <TabView ctx={ctx} group={group} tab={tab} />)}
      </div>
      <div
        class="cerebro-editor-content"
        role="tabpanel"
        data-content={group.id}
        on:pointerdown={() => {
          area.activeGroupId = group.id;
        }}
      >
        {() => {
          const tab = group.activeTab;
          return tab ? ctx.props.content(tab) : ctx.props.empty?.();
        }}
        <div
          class="cerebro-editor-drop"
          hidden={() => zone() === undefined}
          data-zone={() => zone()}
        />
      </div>
    </div>
  );
}

function TabView(props: { ctx: Context; group: EditorGroup; tab: Tab }): Node {
  const { ctx, group, tab } = props;
  const { area, drag } = ctx;
  const dragged = () => drag.from === group.id && drag.tab === tab.id;
  const dropBefore = () => {
    const target = drag.target;
    if (target?.kind !== 'strip' || target.groupId !== group.id || dragged()) return false;
    const others = group.tabs.filter((t) => !(drag.from === group.id && t.id === drag.tab));
    return others.indexOf(tab) === target.index;
  };
  return (
    <div
      class={() =>
        cls(
          'cerebro-editor-tab',
          group.active === tab.id && 'cerebro-editor-tab--active',
          dragged() && 'cerebro-editor-tab--dragged',
          dropBefore() && 'cerebro-editor-tab--drop-before',
        )
      }
      role="tab"
      tabIndex={0}
      aria-selected={() => String(group.active === tab.id)}
      title={tab.title}
      data-tab={tab.id}
      on:pointerdown={(event) => {
        startTabDrag(ctx, group, tab, event);
      }}
      on:click={() => {
        if (!ctx.suppressClick) area.activate(group.id, tab.id);
      }}
      on:auxclick={(event) => {
        if (event.button === 1) area.close(group.id, tab.id);
      }}
    >
      <span class="cerebro-editor-tab__title">{tab.title}</span>
      <button
        type="button"
        class="cerebro-editor-tab__close"
        aria-label={`Close ${tab.title}`}
        on:pointerdown={(event) => {
          event.stopPropagation();
        }}
        on:click={(event) => {
          event.stopPropagation();
          area.close(group.id, tab.id);
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M4.5 4.5l7 7M11.5 4.5l-7 7"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function startTabDrag(ctx: Context, group: EditorGroup, tab: Tab, down: PointerEvent): void {
  if (down.button !== 0) return;
  const { area, drag } = ctx;
  dragFrom(down, tab.title, {
    start() {
      drag.tab = tab.id;
      drag.from = group.id;
    },
    move(event) {
      drag.setTarget(findTabTarget(event.clientX, event.clientY));
    },
    end(committed) {
      const target = drag.target;
      drag.setTarget(undefined);
      drag.tab = undefined;
      drag.from = undefined;
      if (committed && target) drop(area, group.id, tab.id, target);
      // The click that may follow this release must not activate the tab.
      ctx.suppressClick = true;
      setTimeout(() => {
        ctx.suppressClick = false;
      });
    },
  });
}

function drop(area: EditorArea, from: string, tab: string, target: TabDropTarget): void {
  if (target.kind === 'strip') area.move(tab, from, target.groupId, target.index);
  else if (target.kind === 'split') area.moveToSplit(tab, from, target.groupId, target.direction);
  else if (target.groupId !== from) area.move(tab, from, target.groupId);
}

/**
 * Where a tab dropped at (x, y) would land: a position in a tab strip, a group's content (into the
 * group), or near a content's edge (a new group split off in that direction).
 */
export function findTabTarget(x: number, y: number): TabDropTarget | undefined {
  const hit = document.elementFromPoint(x, y);
  const strip = hit?.closest<HTMLElement>('[data-strip]');
  if (strip) {
    let index = 0;
    for (const tab of strip.querySelectorAll(
      '.cerebro-editor-tab:not(.cerebro-editor-tab--dragged)',
    )) {
      const rect = tab.getBoundingClientRect();
      if (x > rect.left + rect.width / 2) index++;
    }
    return { kind: 'strip', groupId: strip.dataset['strip'] as string, index };
  }
  const content = hit?.closest<HTMLElement>('[data-content]');
  if (!content) return undefined;
  const groupId = content.dataset['content'] as string;
  const rect = content.getBoundingClientRect();
  const edges: [Direction, number][] = [
    ['left', (x - rect.left) / rect.width],
    ['right', (rect.right - x) / rect.width],
    ['up', (y - rect.top) / rect.height],
    ['down', (rect.bottom - y) / rect.height],
  ];
  const [direction, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return distance < SPLIT_EDGE ? { kind: 'split', groupId, direction } : { kind: 'group', groupId };
}
