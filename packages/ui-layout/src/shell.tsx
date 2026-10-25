// The layout view, as in IntelliJ's new UI: a stripe of tool window buttons on the left and on the
// right, the open tool windows in their areas, and the editor in the centre. The bottom area spans
// the full width between the stripes; the left and right areas stop above it.
//
// Each stripe's top part holds its side's area (primary group, then secondary); its bottom part
// holds the bottom area's windows: the left stripe the bottom's left part (primary), the right
// stripe its right part (secondary). Buttons toggle their window; dragging one moves it to another
// group or position. Splitters resize areas and the split between an area's two slots.

import type { Child } from '@cerebro-ide/jsx';
import type { Anchor, Area, Layout, Slot, ToolWindow, ToolWindows } from '@cerebro-ide/layout';
import { makeObservable } from '@cerebro-ide/reactive';
import { dragFrom } from './drag.js';
import { Splitter } from './splitter.js';

export interface ShellLayoutProps {
  layout: Layout;
  /** The body of a tool window. */
  content: (id: string) => Child;
  /** The editor area. */
  editor: () => Child;
  /** Draws a tool window's icon. Without it, or without an icon name, the title's first letter shows. */
  icon?: (name: string) => Child;
}

/** The editor keeps at least this much room when an area is resized, in pixels. */
export const MIN_EDITOR = 120;

export type Side = 'left' | 'right';

export interface DropTarget {
  anchor: Anchor;
  slot: Slot;
  index: number;
}

/** The groups on a side's stripe, top to bottom. */
export function stripeGroups(side: Side): { anchor: Anchor; slot: Slot }[] {
  return [
    { anchor: side, slot: 'primary' },
    { anchor: side, slot: 'secondary' },
    { anchor: 'bottom', slot: side === 'left' ? 'primary' : 'secondary' },
  ];
}

/** What is being dragged, and where it would land. */
class DragState {
  id: string | undefined = undefined;
  target: DropTarget | undefined = undefined;
  resizing = false;

  constructor() {
    makeObservable(this);
  }

  setTarget(target: DropTarget | undefined): void {
    const current = this.target;
    const same =
      current === target ||
      (current !== undefined &&
        target !== undefined &&
        current.anchor === target.anchor &&
        current.slot === target.slot &&
        current.index === target.index);
    if (!same) this.target = target;
  }
}

interface Context {
  tools: ToolWindows;
  drag: DragState;
  props: ShellLayoutProps;
  /** Set right after a drag, so the click that ends it doesn't toggle the window. */
  suppressClick: boolean;
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function ShellLayout(props: ShellLayoutProps): Node {
  const ctx: Context = {
    tools: props.layout.toolWindows,
    drag: new DragState(),
    props,
    suppressClick: false,
  };
  return (
    <div
      class={() =>
        cls(
          'cerebro-shell',
          ctx.drag.id !== undefined && 'cerebro-shell--dragging',
          ctx.drag.resizing && 'cerebro-shell--resizing',
        )
      }
    >
      <Stripe ctx={ctx} side="left" />
      <div class="cerebro-shell__main">
        <div class="cerebro-shell__row">
          <AreaView ctx={ctx} anchor="left" />
          <div class="cerebro-shell__editor">{props.editor()}</div>
          <AreaView ctx={ctx} anchor="right" />
        </div>
        <AreaView ctx={ctx} anchor="bottom" />
      </div>
      <Stripe ctx={ctx} side="right" />
    </div>
  );
}

function Stripe(props: { ctx: Context; side: Side }): Node {
  const { ctx, side } = props;
  const [primary, secondary, bottom] = stripeGroups(side) as [
    { anchor: Anchor; slot: Slot },
    { anchor: Anchor; slot: Slot },
    { anchor: Anchor; slot: Slot },
  ];
  const empty = () =>
    stripeGroups(side).every(({ anchor, slot }) => ctx.tools.group(anchor, slot).length === 0);
  return (
    <div
      class={`cerebro-stripe cerebro-stripe--${side}`}
      role="toolbar"
      aria-label={`${side} tool windows`}
      aria-orientation="vertical"
      data-side={side}
      hidden={() => ctx.drag.id === undefined && empty()}
    >
      <StripeGroup ctx={ctx} {...primary} />
      <StripeGroup ctx={ctx} {...secondary} />
      <div class="cerebro-stripe__spacer" />
      <StripeGroup ctx={ctx} {...bottom} />
    </div>
  );
}

function StripeGroup(props: { ctx: Context; anchor: Anchor; slot: Slot }): Node {
  const { ctx, anchor, slot } = props;
  const others = () => ctx.tools.group(anchor, slot).filter((w) => w.id !== ctx.drag.id);
  const dropAtEnd = () => {
    const target = ctx.drag.target;
    return target?.anchor === anchor && target.slot === slot && target.index === others().length;
  };
  return (
    <div
      class={() =>
        cls(
          'cerebro-stripe__group',
          `cerebro-stripe__group--${anchor}-${slot}`,
          dropAtEnd() && 'cerebro-stripe__group--drop-end',
        )
      }
      data-anchor={anchor}
      data-slot={slot}
    >
      {() => ctx.tools.group(anchor, slot).map((tool) => <StripeButton ctx={ctx} tool={tool} />)}
    </div>
  );
}

function StripeButton(props: { ctx: Context; tool: ToolWindow }): Node {
  const { ctx, tool } = props;
  const { tools, drag } = ctx;
  const visible = () => tools.isVisible(tool.id);
  const dropBefore = () => {
    const target = drag.target;
    if (!target || drag.id === tool.id) return false;
    if (target.anchor !== tool.anchor || target.slot !== tool.slot) return false;
    const others = tools.group(target.anchor, target.slot).filter((w) => w.id !== drag.id);
    return others.indexOf(tool) === target.index;
  };
  return (
    <button
      type="button"
      class={() =>
        cls(
          'cerebro-stripe-button',
          visible() && 'cerebro-stripe-button--active',
          drag.id === tool.id && 'cerebro-stripe-button--dragged',
          dropBefore() && 'cerebro-stripe-button--drop-before',
        )
      }
      title={() => tool.title}
      aria-label={() => tool.title}
      aria-pressed={() => String(visible())}
      data-id={tool.id}
      on:pointerdown={(event) => {
        startDrag(ctx, tool, event);
      }}
      on:click={() => {
        if (!ctx.suppressClick) tools.toggle(tool.id);
      }}
    >
      {() => {
        const icon = tool.icon;
        return icon !== undefined && ctx.props.icon ? (
          ctx.props.icon(icon)
        ) : (
          <span class="cerebro-stripe-button__letter">{tool.title.slice(0, 1)}</span>
        );
      }}
    </button>
  );
}

function AreaView(props: { ctx: Context; anchor: Anchor }): Child {
  const { ctx, anchor } = props;
  const area = ctx.tools.areas[anchor];
  // Left and right are as wide as their size and stack their slots; bottom is as tall and puts
  // them side by side.
  const sideways = anchor !== 'bottom';
  const both = () => area.primary !== undefined && area.secondary !== undefined;
  const snapshot = () => ({ size: area.size, split: area.split });
  const resizing = (active: boolean) => {
    ctx.drag.resizing = active;
  };
  const view = (
    <div
      class={`cerebro-area cerebro-area--${anchor}`}
      data-area={anchor}
      hidden={() => !area.open}
      style={
        sideways
          ? { width: () => `${String(area.size)}px` }
          : { height: () => `${String(area.size)}px` }
      }
    >
      {() =>
        area.primary !== undefined && (
          <Pane ctx={ctx} area={area} id={area.primary} slot="primary" />
        )
      }
      {() =>
        both() && (
          <Splitter
            line={sideways ? 'horizontal' : 'vertical'}
            start={snapshot}
            onResizing={resizing}
            onDrag={(start, delta, element) => {
              const container = element.parentElement as HTMLElement;
              const extent = sideways ? container.clientHeight : container.clientWidth;
              area.setSplit(start.split + delta / extent);
            }}
          />
        )
      }
      {() =>
        area.secondary !== undefined && (
          <Pane ctx={ctx} area={area} id={area.secondary} slot="secondary" />
        )
      }
    </div>
  );
  const splitter = (
    <Splitter
      line={sideways ? 'vertical' : 'horizontal'}
      hidden={() => !area.open}
      start={snapshot}
      onResizing={resizing}
      onDrag={(start, delta, element) => {
        // The left area grows with the pointer; right and bottom grow against it.
        const sign = anchor === 'left' ? 1 : -1;
        const container = element.parentElement as HTMLElement;
        const extent = sideways ? container.clientWidth : container.clientHeight;
        const opposite =
          anchor === 'bottom' ? undefined : ctx.tools.areas[anchor === 'left' ? 'right' : 'left'];
        const max = extent - (opposite?.open ? opposite.size : 0) - MIN_EDITOR;
        area.resize(Math.min(max, start.size + sign * delta));
      }}
    />
  );
  return anchor === 'left' ? [view, splitter] : [splitter, view];
}

function Pane(props: { ctx: Context; area: Area; id: string; slot: Slot }): Node {
  const { ctx, area, id, slot } = props;
  const tool = ctx.tools.windows.get(id) as ToolWindow;
  const grow = () => {
    if (area.primary === undefined || area.secondary === undefined) return '1';
    return String(slot === 'primary' ? area.split : 1 - area.split);
  };
  return (
    <section
      class={`cerebro-tool-window cerebro-tool-window--${slot}`}
      aria-label={() => tool.title}
      data-id={id}
      style={{ flexGrow: grow }}
    >
      <header class="cerebro-tool-window__header">
        <span class="cerebro-tool-window__title">{() => tool.title}</span>
        <button
          type="button"
          class="cerebro-tool-window__hide"
          title="Hide"
          aria-label={() => `Hide ${tool.title}`}
          on:click={() => {
            ctx.tools.hide(id);
          }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <div class="cerebro-tool-window__body">{ctx.props.content(id)}</div>
    </section>
  );
}

function startDrag(ctx: Context, tool: ToolWindow, down: PointerEvent): void {
  if (down.button !== 0) return;
  const { drag, tools } = ctx;
  dragFrom(down, tool.title, {
    start() {
      drag.id = tool.id;
    },
    move(event) {
      drag.setTarget(findTarget(event.clientX, event.clientY));
    },
    end(committed) {
      const target = drag.target;
      drag.setTarget(undefined);
      drag.id = undefined;
      if (committed && target) tools.move(tool.id, target.anchor, target.slot, target.index);
      // The click that may follow this release must not toggle the window.
      ctx.suppressClick = true;
      setTimeout(() => {
        ctx.suppressClick = false;
      });
    },
  });
}

/**
 * Where a drop at (x, y) would land: the stripe group under the pointer, or the nearest group of the
 * stripe under it, and the index among that group's buttons.
 */
export function findTarget(x: number, y: number): DropTarget | undefined {
  const hit = document.elementFromPoint(x, y);
  let group = hit?.closest<HTMLElement>('[data-anchor][data-slot]');
  if (!group) {
    const stripe = hit?.closest<HTMLElement>('[data-side]');
    if (!stripe) return undefined;
    const groups = [...stripe.querySelectorAll<HTMLElement>('[data-anchor][data-slot]')];
    group = nearest(groups, y);
  }
  const anchor = group.dataset['anchor'] as Anchor;
  const slot = group.dataset['slot'] as Slot;
  const buttons = group.querySelectorAll<HTMLElement>(
    '.cerebro-stripe-button:not(.cerebro-stripe-button--dragged)',
  );
  let index = 0;
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    if (y > rect.top + rect.height / 2) index++;
  }
  return { anchor, slot, index };
}

function nearest(groups: HTMLElement[], y: number): HTMLElement {
  const distance = (group: HTMLElement) => {
    const rect = group.getBoundingClientRect();
    return y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  };
  return groups.reduce((best, group) => (distance(group) < distance(best) ? group : best));
}
