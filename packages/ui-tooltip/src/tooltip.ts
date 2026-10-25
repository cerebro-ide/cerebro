// Tooltips in the app's own style, replacing the browser's: the text, and the shortcut when there is
// one. One tooltip shows at a time. It appears after a pause; moving straight on to another control
// shows that one's at once, as IntelliJ does. Leaving the control, a press, a key, scrolling or the
// window losing focus hides it.

import { onCleanup } from '@cerebro-ide/jsx';
import type { Disposable } from '@cerebro-ide/reactive';

export type Placement = 'right' | 'left' | 'below' | 'above';

export interface TooltipOptions {
  text: () => string;
  /** Shown after the text, muted: the shortcut that does the same, if any. */
  shortcut?: () => string | undefined;
  /**
   * Where to show it, read when it shows; it flips to the other side to stay inside the window.
   * Default: below.
   */
  placement?: Placement | (() => Placement);
}

/** How long the pointer rests on a control before its tooltip shows, in milliseconds. */
export const SHOW_DELAY = 500;
/** After a tooltip hides, another shows at once if the pointer reaches its control within this. */
export const QUICK_WINDOW = 300;
/** The gap between a control and its tooltip, in pixels. */
const GAP = 6;

let tip: HTMLElement | undefined;
let shownFor: Element | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let hiddenAt = Number.NEGATIVE_INFINITY;
let listening = false;

function hide(): void {
  clearTimeout(timer);
  timer = undefined;
  if (tip) {
    tip.remove();
    tip = undefined;
    hiddenAt = performance.now();
  }
  shownFor = undefined;
}

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}

function show(element: Element, options: TooltipOptions): void {
  hide();
  const text = options.text();
  if (text === '') return;
  tip = document.createElement('div');
  tip.className = 'cerebro-tooltip';
  tip.setAttribute('role', 'tooltip');
  const label = document.createElement('span');
  label.className = 'cerebro-tooltip__text';
  label.textContent = text;
  tip.append(label);
  const shortcut = options.shortcut?.();
  if (shortcut) {
    const keys = document.createElement('span');
    keys.className = 'cerebro-tooltip__shortcut';
    keys.textContent = shortcut;
    tip.append(keys);
  }
  document.body.append(tip);
  shownFor = element;
  const placement = options.placement ?? 'below';
  place(
    tip,
    element.getBoundingClientRect(),
    typeof placement === 'function' ? placement() : placement,
  );
}

function place(tip: HTMLElement, rect: DOMRect, placement: Placement): void {
  // Exact, fractional sizes: offsetWidth would round, and a tooltip to the left would be off.
  const { width, height } = tip.getBoundingClientRect();
  const fits = {
    right: rect.right + GAP + width <= window.innerWidth,
    left: rect.left - GAP - width >= 0,
    below: rect.bottom + GAP + height <= window.innerHeight,
    above: rect.top - GAP - height >= 0,
  };
  const opposite = { right: 'left', left: 'right', below: 'above', above: 'below' } as const;
  const side = fits[placement] || !fits[opposite[placement]] ? placement : opposite[placement];
  let left: number;
  let top: number;
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? rect.right + GAP : rect.left - GAP - width;
    top = rect.top + rect.height / 2 - height / 2;
  } else {
    left = rect.left + rect.width / 2 - width / 2;
    top = side === 'below' ? rect.bottom + GAP : rect.top - GAP - height;
  }
  left = Math.max(0, Math.min(left, window.innerWidth - width));
  top = Math.max(0, Math.min(top, window.innerHeight - height));
  tip.style.left = `${String(left)}px`;
  tip.style.top = `${String(top)}px`;
}

/** Gives `element` a tooltip until disposed. */
export function attachTooltip(element: Element, options: TooltipOptions): Disposable {
  listen();
  const enter = () => {
    clearTimeout(timer);
    if (performance.now() - hiddenAt < QUICK_WINDOW || tip) show(element, options);
    else
      timer = setTimeout(() => {
        show(element, options);
      }, SHOW_DELAY);
  };
  const leave = () => {
    if (shownFor === element || timer !== undefined) hide();
  };
  element.addEventListener('pointerenter', enter);
  element.addEventListener('pointerleave', leave);
  element.addEventListener('pointerdown', hide);
  return {
    dispose: () => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointerdown', hide);
      if (shownFor === element) hide();
    },
  };
}

/** For JSX `ref`: gives the element a tooltip for as long as the component that renders it lives. */
export function tooltip(options: TooltipOptions): (element: Element) => void {
  return (element) => {
    const handle = attachTooltip(element, options);
    onCleanup(() => {
      handle.dispose();
    });
  };
}
