// Scrollbars as IntelliJ's: a rounded thumb drawn over the content, which shows through it, taking no
// room. The browser's own scrollbars are hidden (styles.css; a shadow root needs
// `scrollbar-width: none` of its own), and thumbs are drawn for the areas under the pointer, and for
// an area while it scrolls, fading out after. Each is stacked at its area's level, so what's over the
// area (a popup) covers its thumbs too. A thumb is less transparent under the pointer, and can be
// dragged.
//
// Thumbs avoid what's in their way, as IntelliJ's (Ido, with its screenshots): a thumb moves along a
// track that stops short of the other bar, so the two never meet in the corner, and of anything in
// the area marked `data-scrollbar-obstacle` that overlaps the bar (an editor's gutter, which the
// horizontal bar starts after; a toolbar over the area's top, which the vertical one starts below).

/** How long an area's thumbs stay after it scrolled, the pointer elsewhere, in milliseconds. */
export const HIDE_AFTER = 1000;
/** How long thumbs take to fade out (styles.css), after which they're removed, in milliseconds. */
export const FADE = 200;
/** The shortest a thumb gets, in pixels. */
const MIN_LENGTH = 24;
/** How far a bar is drawn from its area's edge: 10px wide, 2px in (styles.css). */
const FROM_EDGE = 12;
const WIDTH = 10;
/** How far a track stops from the edge where the other bar is: before it, with 2px between. */
const CORNER = FROM_EDGE + 2;
/** What a thumb's track avoids, in the area. */
const OBSTACLE = '[data-scrollbar-obstacle]';

type Axis = 'x' | 'y';

/** An area whose thumbs are shown, or fading out. */
interface Bars {
  scroller: HTMLElement;
  thumbs: Record<Axis, HTMLElement>;
  /** The axes it scrolls along: overflow auto or scroll. */
  axes: Record<Axis, boolean>;
  /** How long each thumb's track is, as last placed. */
  tracks: Record<Axis, number>;
  observer: ResizeObserver;
  hovered: boolean;
  dragging: boolean;
  /** Set while it shows after scrolling. */
  scrolled?: ReturnType<typeof setTimeout> | undefined;
  /** Set while it fades out. */
  removing?: ReturnType<typeof setTimeout> | undefined;
}

const SCROLLS = /auto|scroll/;

/**
 * Whether an element is an area that scrolls, with more content than it shows, and wants thumbs:
 * one marked `data-scrollbar="none"` (a strip of tabs) scrolls without them.
 */
function scrollable(target: EventTarget): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target === document.body || target === document.documentElement) return false;
  if (target.dataset['scrollbar'] === 'none') return false;
  if (target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth) {
    return false;
  }
  const { overflowX, overflowY } = getComputedStyle(target);
  return SCROLLS.test(overflowX) || SCROLLS.test(overflowY);
}

/**
 * Where a thumb starts along its track and how long it is, or nothing when all is shown or there's
 * no track.
 */
function measure(size: number, view: number, offset: number, track: number) {
  if (size <= view || track <= 0) return undefined;
  const length = Math.min(track, Math.max(MIN_LENGTH, (track * view) / size));
  return { start: ((track - length) * offset) / (size - view), length };
}

/** A span along one axis. */
interface Span {
  from: number;
  to: number;
}

/**
 * A bar's track from `from` to `to`, shortened by the obstacles across it (spans along the bar):
 * each takes the track's end nearer to it.
 */
function avoid({ from, to }: Span, obstacles: readonly Span[]): Span {
  for (const o of obstacles) {
    if (o.to <= from || o.from >= to) continue;
    if (o.from - from < to - o.to) from = Math.max(from, o.to);
    else to = Math.min(to, o.from);
  }
  return { from, to };
}

/**
 * The level an element is drawn at among the page's: the z-index of its outermost ancestor that
 * has one (through shadow roots' hosts); 1, just over the page, when none has.
 */
function levelOf(element: Element): number {
  let level = 1;
  for (let node: Element | null = element; node;) {
    const z = Number.parseInt(getComputedStyle(node).zIndex, 10);
    if (!Number.isNaN(z)) level = z;
    const parent: Node | null = node.parentNode;
    node = parent instanceof ShadowRoot ? parent.host : node.parentElement;
  }
  return level;
}

/** Puts an area's thumbs over its edges, as it's scrolled, their tracks clear of what's in the way. */
function place(bars: Bars): void {
  const { scroller: s, thumbs, axes } = bars;
  const rect = s.getBoundingClientRect();
  const left = rect.left + s.clientLeft;
  const top = rect.top + s.clientTop;
  const width = s.clientWidth;
  const height = s.clientHeight;
  const scrollsY = axes.y && s.scrollHeight > height;
  const scrollsX = axes.x && s.scrollWidth > width;
  // The obstacles in the area, from its top left corner.
  const obstacles = [...s.querySelectorAll(OBSTACLE)].map((o) => {
    const r = o.getBoundingClientRect();
    return {
      x: { from: r.left - left, to: r.right - left },
      y: { from: r.top - top, to: r.bottom - top },
    };
  });
  /** The obstacles across a bar drawn in `band` across it, as spans along it. */
  const across = (along: Axis, band: Span) => {
    const other: Axis = along === 'x' ? 'y' : 'x';
    return obstacles
      .filter((o) => o[other].from < band.to && o[other].to > band.from)
      .map((o) => o[along]);
  };
  const trackY = avoid(
    { from: 0, to: height - (scrollsX ? CORNER : 0) },
    across('y', { from: width - FROM_EDGE, to: width - FROM_EDGE + WIDTH }),
  );
  const trackX = avoid(
    { from: 0, to: width - (scrollsY ? CORNER : 0) },
    across('x', { from: height - FROM_EDGE, to: height - FROM_EDGE + WIDTH }),
  );
  bars.tracks = { x: trackX.to - trackX.from, y: trackY.to - trackY.from };
  const y = scrollsY ? measure(s.scrollHeight, height, s.scrollTop, bars.tracks.y) : undefined;
  thumbs.y.hidden = !y;
  if (y) {
    thumbs.y.style.left = `${String(left + width)}px`;
    thumbs.y.style.top = `${String(top + trackY.from + y.start)}px`;
    thumbs.y.style.height = `${String(y.length)}px`;
  }
  const x = scrollsX ? measure(s.scrollWidth, width, s.scrollLeft, bars.tracks.x) : undefined;
  thumbs.x.hidden = !x;
  if (x) {
    thumbs.x.style.top = `${String(top + height)}px`;
    thumbs.x.style.left = `${String(left + trackX.from + x.start)}px`;
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
    const track = bars.tracks[axis] - (vertical ? thumb.offsetHeight : thumb.offsetWidth);
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
    // At the area's level, and after what's over it at the same level (a popup opened since).
    const level = levelOf(scroller);
    document.body.append(layer);
    const thumb = (axis: Axis) => {
      const element = document.createElement('div');
      element.className = `cerebro-scrollbar cerebro-scrollbar--${axis}`;
      element.addEventListener('pointerdown', (event) => {
        drag(bars, axis, event);
      });
      element.style.zIndex = String(level);
      layer.append(element);
      return element;
    };
    const { overflowX, overflowY } = getComputedStyle(scroller);
    const bars: Bars = {
      scroller,
      thumbs: { x: thumb('x'), y: thumb('y') },
      axes: { x: SCROLLS.test(overflowX), y: SCROLLS.test(overflowY) },
      tracks: { x: 0, y: 0 },
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
