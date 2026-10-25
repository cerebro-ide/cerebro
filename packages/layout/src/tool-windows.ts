// Tool windows in IntelliJ's fixed areas: left, right, top and bottom. Each area shows at most one window
// in its primary slot and one in its secondary slot; showing a window replaces the one in its slot.

import { makeObservable, ObservableMap } from '@cerebro-ide/reactive';

export type Anchor = 'left' | 'right' | 'top' | 'bottom';
export type Slot = 'primary' | 'secondary';

export const ANCHORS: readonly Anchor[] = ['left', 'right', 'top', 'bottom'];

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

  constructor(spec: ToolWindowSpec) {
    this.id = spec.id;
    this.title = spec.title;
    this.icon = spec.icon;
    this.anchor = spec.anchor;
    this.slot = spec.slot ?? 'primary';
    makeObservable(this);
  }
}

export class Area {
  readonly anchor: Anchor;
  /** Width for left and right, height for top and bottom, in pixels. */
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
    top: new Area('top', 220),
    bottom: new Area('bottom', 220),
  };

  constructor() {
    makeObservable(this);
  }

  register(spec: ToolWindowSpec): ToolWindow {
    if (this.windows.has(spec.id))
      throw new Error(`Tool window "${spec.id}" is already registered`);
    const window = new ToolWindow(spec);
    this.windows.set(spec.id, window);
    return window;
  }

  unregister(id: string): void {
    this.hide(id);
    this.windows.delete(id);
  }

  /** The windows on an area's stripe, in registration order: primary slot first, then secondary. */
  stripe(anchor: Anchor): ToolWindow[] {
    const windows = [...this.windows.values()].filter((w) => w.anchor === anchor);
    return [
      ...windows.filter((w) => w.slot === 'primary'),
      ...windows.filter((w) => w.slot === 'secondary'),
    ];
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

  /** Moves a window to another area or slot; a visible window stays visible there. */
  move(id: string, anchor: Anchor, slot: Slot = 'primary'): void {
    const window = this.get(id);
    const visible = this.isVisible(id);
    this.hide(id);
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
