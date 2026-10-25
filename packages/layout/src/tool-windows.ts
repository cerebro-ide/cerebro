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

  private get(id: string): ToolWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`Unknown tool window "${id}"`);
    return window;
  }
}
