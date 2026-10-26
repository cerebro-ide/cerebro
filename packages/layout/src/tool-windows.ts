// Tool windows in IntelliJ's fixed areas: left, right and bottom (as in its new UI, which has no top
// area). Each area shows at most one window in its primary slot and one in its secondary slot; showing
// a window replaces the one in its slot. Left and right stack their slots (primary on top); bottom
// puts them side by side (primary on the left).

import { makeObservable, ObservableMap } from '@cerebro-ide/reactive';

export type Anchor = 'left' | 'right' | 'bottom';
export type Slot = 'primary' | 'secondary';

export const ANCHORS: readonly Anchor[] = ['left', 'right', 'bottom'];

/** The smallest size an area can be resized to, in pixels. */
export const MIN_AREA_SIZE = 80;
/** The range of an area's split between its primary and secondary slots. */
export const MIN_SPLIT = 0.1;
export const MAX_SPLIT = 0.9;

export interface ToolWindowSpec {
  id: string;
  title: string;
  anchor: Anchor;
  slot?: Slot;
  /** An icon name for the stripe; how it's drawn is up to the view. */
  icon?: string;
}

export class ToolWindow {
  readonly id: string;
  title: string;
  icon: string | undefined;
  anchor: Anchor;
  slot: Slot;
  /** Position within its anchor and slot; lower comes first. */
  order: number;

  constructor(spec: ToolWindowSpec, order: number) {
    this.id = spec.id;
    this.title = spec.title;
    this.icon = spec.icon;
    this.anchor = spec.anchor;
    this.slot = spec.slot ?? 'primary';
    this.order = order;
    makeObservable(this);
  }
}

export class Area {
  readonly anchor: Anchor;
  /** Width for left and right, height for bottom, in pixels. */
  size: number;
  /** The primary slot's share when both slots are open. */
  split = 0.5;
  primary: string | undefined = undefined;
  secondary: string | undefined = undefined;

  constructor(anchor: Anchor, size: number) {
    this.anchor = anchor;
    this.size = size;
    makeObservable(this);
  }

  get open(): boolean {
    return this.primary !== undefined || this.secondary !== undefined;
  }

  resize(size: number): void {
    this.size = Math.max(MIN_AREA_SIZE, Math.round(size));
  }

  setSplit(split: number): void {
    this.split = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, split));
  }
}

/** Tool windows' places and the areas' sizes and open windows, as plain data to save between runs. */
export interface ToolWindowsState {
  windows: Record<string, { anchor: Anchor; slot: Slot; order: number }>;
  areas: Record<
    Anchor,
    { size: number; split: number; primary: string | undefined; secondary: string | undefined }
  >;
}

const SLOTS: readonly Slot[] = ['primary', 'secondary'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export class ToolWindows {
  readonly windows = new ObservableMap<string, ToolWindow>();
  readonly areas: Readonly<Record<Anchor, Area>> = {
    left: new Area('left', 280),
    right: new Area('right', 280),
    bottom: new Area('bottom', 220),
  };

  #nextOrder = 0;

  constructor() {
    makeObservable(this);
  }

  register(spec: ToolWindowSpec): ToolWindow {
    if (this.windows.has(spec.id))
      throw new Error(`Tool window "${spec.id}" is already registered`);
    const window = new ToolWindow(spec, this.#nextOrder++);
    this.windows.set(spec.id, window);
    return window;
  }

  unregister(id: string): void {
    this.hide(id);
    this.windows.delete(id);
  }

  /** The windows on an area's stripe, in order: primary slot first, then secondary. */
  stripe(anchor: Anchor): ToolWindow[] {
    return [...this.group(anchor, 'primary'), ...this.group(anchor, 'secondary')];
  }

  /** The windows in one anchor and slot, in order. */
  group(anchor: Anchor, slot: Slot): ToolWindow[] {
    return [...this.windows.values()]
      .filter((w) => w.anchor === anchor && w.slot === slot)
      .sort((a, b) => a.order - b.order);
  }

  isVisible(id: string): boolean {
    const window = this.windows.get(id);
    return window !== undefined && this.areas[window.anchor][window.slot] === id;
  }

  show(id: string): void {
    const window = this.get(id);
    this.areas[window.anchor][window.slot] = id;
  }

  hide(id: string): void {
    if (!this.isVisible(id)) return;
    const window = this.get(id);
    this.areas[window.anchor][window.slot] = undefined;
  }

  toggle(id: string): void {
    if (this.isVisible(id)) this.hide(id);
    else this.show(id);
  }

  /**
   * Moves a window to an anchor and slot, at `index` in that group (default: the end). A visible
   * window stays visible there, replacing the window open in that slot.
   */
  move(id: string, anchor: Anchor, slot: Slot = 'primary', index?: number): void {
    const window = this.get(id);
    const visible = this.isVisible(id);
    this.hide(id);
    const others = this.group(anchor, slot).filter((w) => w !== window);
    const at = Math.min(Math.max(index ?? others.length, 0), others.length);
    others.splice(at, 0, window);
    others.forEach((w, i) => (w.order = i));
    window.anchor = anchor;
    window.slot = slot;
    if (visible) this.show(id);
  }

  /** The windows' places and the areas, as plain data to save between runs. */
  state(): ToolWindowsState {
    const windows: ToolWindowsState['windows'] = {};
    for (const anchor of ANCHORS) {
      for (const slot of SLOTS) {
        this.group(anchor, slot).forEach((w, order) => {
          windows[w.id] = { anchor, slot, order };
        });
      }
    }
    const area = (a: Area) => ({
      size: a.size,
      split: a.split,
      primary: a.primary,
      secondary: a.secondary,
    });
    return {
      windows,
      areas: {
        left: area(this.areas.left),
        right: area(this.areas.right),
        bottom: area(this.areas.bottom),
      },
    };
  }

  /**
   * Applies a saved state to the windows registered now, keeping only what's valid: places of
   * known windows (others keep theirs, after the saved ones), sizes and splits (clamped), and open
   * windows that are registered and in that slot.
   */
  restore(saved: unknown): void {
    if (!isRecord(saved)) return;
    const places = isRecord(saved['windows']) ? saved['windows'] : {};
    const savedOrder = new Map<string, number>();
    for (const window of this.windows.values()) {
      const place = places[window.id];
      if (!isRecord(place)) continue;
      const { anchor, slot, order } = place;
      if (!ANCHORS.includes(anchor as Anchor) || !SLOTS.includes(slot as Slot)) continue;
      window.anchor = anchor as Anchor;
      window.slot = slot as Slot;
      if (isNumber(order)) savedOrder.set(window.id, order);
    }
    for (const anchor of ANCHORS) {
      for (const slot of SLOTS) {
        // Saved windows first, in their saved order; the rest after, in their own.
        [...this.group(anchor, slot)]
          .sort(
            (a, b) =>
              (savedOrder.get(a.id) ?? Infinity) - (savedOrder.get(b.id) ?? Infinity) ||
              a.order - b.order,
          )
          .forEach((w, i) => (w.order = i));
      }
      const area = this.areas[anchor];
      const savedArea = isRecord(saved['areas']) ? saved['areas'][anchor] : undefined;
      if (!isRecord(savedArea)) continue;
      if (isNumber(savedArea['size'])) area.resize(savedArea['size']);
      if (isNumber(savedArea['split'])) area.setSplit(savedArea['split']);
      for (const slot of SLOTS) {
        const id = savedArea[slot];
        const window = typeof id === 'string' ? this.windows.get(id) : undefined;
        area[slot] = window?.anchor === anchor && window.slot === slot ? window.id : undefined;
      }
    }
  }

  private get(id: string): ToolWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`Unknown tool window "${id}"`);
    return window;
  }
}
