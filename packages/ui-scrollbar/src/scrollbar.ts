// Scrollbars as IntelliJ's: a rounded thumb drawn over the content, which shows through it, taking no
// room. The browser's own scrollbars are hidden (styles.css; a shadow root needs
// `scrollbar-width: none` of its own), and a layer over the page draws the thumbs of the areas under
// the pointer, and of an area while it scrolls, fading out after. A thumb is less transparent under the
// pointer, and can be dragged.

/** How long an area's thumbs stay after it scrolled, the pointer elsewhere, in milliseconds. */
export const HIDE_AFTER = 1000;
/** How long thumbs take to fade out (styles.css), after which they're removed, in milliseconds. */
export const FADE = 200;
/** The shortest a thumb gets, in pixels. */
const MIN_LENGTH = 24;

type Axis = 'x' | 'y';

/** An area whose thumbs are shown, or fading out. */
interface Bars {
  scroller: HTMLElement;
  thumbs: Record<Axis, HTMLElement>;
  /** The axes it scrolls along: overflow auto or scroll. */
  axes: Record<Axis, boolean>;
  observer: ResizeObserver;
  hovered: boolean;
  dragging: boolean;
  /** Set while it shows after scrolling. */
  scrolled?: ReturnType<typeof setTimeout> | undefined;
  /** Set while it fades out. */
  removing?: ReturnType<typeof setTimeout> | undefined;
}

const SCROLLS = /auto|scroll/;

/** Whether an element is an area that scrolls, with more content than it shows. */
function scrollable(target: EventTarget): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target === document.body || target === document.documentElement) return false;
  if (target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) {
    return false;
  }
  const { overflowX, overflowY } = getComputedStyle(target);
  return SCROLLS.test(overflowX) || SCROLLS.test(overflowY);
}

/** Where a thumb starts along its area and how long it is, or nothing when all is shown. */
function measure(size: number, view: number, offset: number) {
  if (size <= view) return undefined;
  const length = Math.max(MIN_LENGTH, (view * view) / size);
  return { start: ((view - length) * offset) / (size - view), length };
}

/** Puts an area's thumbs over its edges, as it's scrolled. */
function place(bars: Bars): void {
  const { scroller: s, thumbs, axes } = bars;
  const rect = s.getBoundingClientRect();
  const left = rect.left + s.clientLeft;
  const top = rect.top + s.clientTop;
  const y = axes.y ? measure(s.scrollHeight, s.clientHeight, s.scrollTop) : undefined;
  thumbs.y.hidden = !y;
  if (y) {
    thumbs.y.style.left = `${String(left + s.clientWidth)}px`;
    thumbs.y.style.top = `${String(top + y.start)}px`;
    thumbs.y.style.height = `${String(y.length)}px`;
  }
  const x = axes.x ? measure(s.scrollWidth, s.clientWidth, s.scrollLeft) : undefined;
  thumbs.x.hidden = !x;
  if (x) {
    thumbs.x.style.top = `${String(top + s.clientHeight)}px`;
    thumbs.x.style.left = `${String(left + x.start)}px`;
    thumbs.x.style.width = `${String(x.length)}px`;
  }
}

/** Shows Cerebro's scrollbars over the page, the browser's hidden; returns what removes them. */
export function installScrollbars(hideAfter = HIDE_AFTER): () => void {
  const layer = document.createElement('div');
  layer.className = 'cerebro-scrollbars';
  document.body.append(layer);
  const shown = new Map<HTMLElement, Bars>();
  /** Shadow roots listened to for scrolling, which doesn't leave them. */
  const roots = new Set<ShadowRoot>();

  const detach = (bars: Bars) => {
    clearTimeout(bars.scrolled);
    clearTimeout(bars.removing);
    bars.observer.disconnect();
    bars.thumbs.x.remove();
    bars.thumbs.y.remove();
    shown.delete(bars.scroller);
  };

  /** Shows an area's thumbs while it's hovered, dragged or just scrolled, else fades them out. */
  const refresh = (bars: Bars) => {
    const visible = bars.hovered || bars.dragging || bars.scrolled !== undefined;
    for (const thumb of [bars.thumbs.x, bars.thumbs.y]) {
      thumb.classList.toggle('cerebro-scrollbar--shown', visible);
    }
    clearTimeout(bars.removing);
    bars.removing = visible
      ? undefined
      : setTimeout(() => {
          detach(bars);
        }, FADE);
  };

  const drag = (bars: Bars, axis: Axis, event: PointerEvent) => {
    event.preventDefault();
    const thumb = bars.thumbs[axis];
    const s = bars.scroller;
    thumb.setPointerCapture(event.pointerId);
    const vertical = axis === 'y';
    const from = vertical ? event.clientY : event.clientX;
    const start = vertical ? s.scrollTop : s.scrollLeft;
    const size = vertical ? s.scrollHeight - s.clientHeight : s.scrollWidth - s.clientWidth;
    const track = vertical
      ? s.clientHeight - thumb.offsetHeight
      : s.clientWidth - thumb.offsetWidth;
    const ratio = size / Math.max(1, track);
    bars.dragging = true;
    thumb.classList.add('cerebro-scrollbar--dragging');
    const move = (next: PointerEvent) => {
      const to = start + ((vertical ? next.clientY : next.clientX) - from) * ratio;
      if (vertical) s.scrollTop = to;
      else s.scrollLeft = to;
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener(
      'lostpointercapture',
      () => {
        thumb.removeEventListener('pointermove', move);
        thumb.classList.remove('cerebro-scrollbar--dragging');
        bars.dragging = false;
        refresh(bars);
      },
      { once: true },
    );
  };

  const attach = (scroller: HTMLElement): Bars => {
    const existing = shown.get(scroller);
    if (existing) return existing;
    const thumb = (axis: Axis) => {
      const element = document.createElement('div');
      element.className = `cerebro-scrollbar cerebro-scrollbar--${axis}`;
      element.addEventListener('pointerdown', (event) => {
        drag(bars, axis, event);
      });
      layer.append(element);
      return element;
    };
    const { overflowX, overflowY } = getComputedStyle(scroller);
    const bars: Bars = {
      scroller,
      thumbs: { x: thumb('x'), y: thumb('y') },
      axes: { x: SCROLLS.test(overflowX), y: SCROLLS.test(overflowY) },
      observer: new ResizeObserver(() => {
        place(bars);
      }),
      hovered: false,
      dragging: false,
    };
    bars.observer.observe(scroller);
    shown.set(scroller, bars);
    return bars;
  };

  const onScroll = (event: Event) => {
    if (!event.target || !scrollable(event.target)) return;
    const bars = attach(event.target);
    clearTimeout(bars.scrolled);
    bars.scrolled = setTimeout(() => {
      bars.scrolled = undefined;
      refresh(bars);
    }, hideAfter);
    place(bars);
    refresh(bars);
  };

  /** Listens for scrolling in the shadow roots on an event's way. */
  const listenIn = (path: EventTarget[]) => {
    for (const node of path) {
      if (node instanceof ShadowRoot && !roots.has(node)) {
        roots.add(node);
        node.addEventListener('scroll', onScroll, true);
      }
    }
  };

  /** Marks the areas under the pointer hovered, and only those. */
  const hover = (under: Set<EventTarget>) => {
    for (const bars of shown.values()) {
      if (bars.hovered && !under.has(bars.scroller)) {
        bars.hovered = false;
        refresh(bars);
      }
    }
    for (const scroller of under) {
      if (!scrollable(scroller)) continue;
      const bars = attach(scroller);
      bars.hovered = true;
      place(bars);
      refresh(bars);
    }
  };

  const onOver = (event: PointerEvent) => {
    const path = event.composedPath();
    listenIn(path);
    // On a thumb: its area stays hovered.
    if (path.includes(layer)) return;
    hover(new Set(path));
  };
  const onOut = (event: PointerEvent) => {
    // Out of the window.
    if (!event.relatedTarget) hover(new Set());
  };
  const onFocus = (event: FocusEvent) => {
    listenIn(event.composedPath());
  };

  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('scroll', onScroll, true);
  return () => {
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('scroll', onScroll, true);
    for (const root of roots) root.removeEventListener('scroll', onScroll, true);
    for (const bars of [...shown.values()]) detach(bars);
    layer.remove();
  };
}
