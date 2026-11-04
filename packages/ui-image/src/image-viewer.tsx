// An image, as IntelliJ's image editor shows it (images/src/org/intellij/images: ImageEditorUI,
// ImageComponentUI, ImageZoomModel, ZoomOptions):
// - centred, 2px in from its edges, on the editor's background;
// - zoomed to fit as it opens and as its area is resized, until the zoom is changed: a small image
//   (under 128x128) enlarged to about that size, a large one shrunk to the area, else at 1:1;
// - zoomed in by 2 above 1:1 and by 1.5 below, up to 32 and down to one pixel's width or 1.5⁻⁸;
//   Ctrl and the wheel zoom about the pointer;
// - pixels drawn as squares when enlarged, smoothed when shrunk;
// - a transparency chessboard under it (5px cells, white and light grey) and a grid over it
//   between its pixels from a zoom of 3, each when turned on.

import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { makeObservable } from '@cerebro-ide/reactive';

/** Zoom steps and limits, IntelliJ's ImageZoomModel. */
const MACRO_RATIO = 2;
const MICRO_RATIO = 1.5;
const MACRO_LIMIT = MACRO_RATIO ** 5;
const MICRO_LIMIT = (1 / MICRO_RATIO) ** 8;
/** The size a small image is enlarged to, about (ZoomOptions' preferred size). */
const PREFERRED = 128;
/** The space around the image, IntelliJ's ImageComponent.IMAGE_INSETS. */
export const INSET = 2;
/** The grid shows from this zoom on, IntelliJ's default. */
export const GRID_FROM = 3;

/** The zoom that fits the image to an area as IntelliJ's smart zoom does; undefined if none. */
export function fitZoom(
  image: { width: number; height: number },
  area: { width: number; height: number },
): number | undefined {
  const { width, height } = image;
  if (width === 0 || height === 0) return undefined;
  if (width < PREFERRED && height < PREFERRED) {
    return Math.ceil((PREFERRED / width + PREFERRED / height) / 2);
  }
  const room = { width: area.width - INSET * 2, height: area.height - INSET * 2 };
  if (room.width <= 0 || room.height <= 0) return undefined;
  if (room.width < width || room.height < height) {
    return Math.min(room.height / height, room.width / width);
  }
  return 1;
}

/** What an image viewer shows: the zoom, the chessboard and the grid; what commands change. */
export class ImageView {
  /** The image's own size; 0 until it has loaded. */
  width = 0;
  height = 0;
  /** It couldn't be shown: not an image, or one the browser can't read. */
  failed = false;
  zoom = 1;
  /** Zoomed by hand: it's no longer fitted to its area as that changes. */
  zoomChanged = false;
  chessboard: boolean;
  grid: boolean;
  /** The area it's shown in. */
  area = { width: 0, height: 0 };

  constructor(options: { chessboard?: boolean; grid?: boolean } = {}) {
    this.chessboard = options.chessboard ?? false;
    this.grid = options.grid ?? false;
    makeObservable(this);
  }

  get loaded(): boolean {
    return this.width > 0;
  }

  /** The image drawn: its size zoomed, in whole pixels. */
  get canvas(): { width: number; height: number } {
    return { width: Math.ceil(this.width * this.zoom), height: Math.ceil(this.height * this.zoom) };
  }

  private get minimum(): number {
    // One pixel wide, at least; before it has loaded, 1:1.
    return Math.max(1 / Math.max(this.width, 1), MICRO_LIMIT);
  }

  get canZoomIn(): boolean {
    return this.loaded && this.zoom < MACRO_LIMIT;
  }

  get canZoomOut(): boolean {
    // Floating point's small differences aside, as IntelliJ's.
    return this.loaded && this.zoom - 1e-14 > this.minimum;
  }

  /** It has loaded at this size: fitted to its area. */
  load(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.zoom = fitZoom(this, this.area) ?? 1;
  }

  fail(): void {
    this.failed = true;
  }

  /** Its area is this size now: fitted again, unless zoomed by hand. */
  resize(width: number, height: number): void {
    this.area = { width, height };
    if (!this.loaded || this.zoomChanged) return;
    const fit = fitZoom(this, this.area);
    if (fit !== undefined) this.zoom = fit;
  }

  zoomIn(): void {
    const zoom = this.zoom >= 1 ? this.zoom * MACRO_RATIO : Math.min(this.zoom * MICRO_RATIO, 1);
    this.zoom = Math.min(zoom, MACRO_LIMIT);
    this.zoomChanged = true;
  }

  zoomOut(): void {
    const zoom = this.zoom > 1 ? Math.max(this.zoom / MACRO_RATIO, 1) : this.zoom / MICRO_RATIO;
    this.zoom = Math.max(zoom, this.minimum);
    this.zoomChanged = true;
  }

  /** 1:1, as IntelliJ's Actual Size. */
  actualSize(): void {
    this.zoom = 1;
    this.zoomChanged = true;
  }

  /** Fitted to its area again, as IntelliJ's Fit Zoom to Window. */
  fit(): void {
    this.zoom = fitZoom(this, this.area) ?? 1;
    this.zoomChanged = false;
  }

  toggleChessboard(): void {
    this.chessboard = !this.chessboard;
  }

  toggleGrid(): void {
    this.grid = !this.grid;
  }
}

export interface ImageViewerProps {
  view: ImageView;
  /** The image's URL: a `data:` URL of its bytes. */
  src: string;
  /** For screen readers: the file's name. */
  label: string;
}

/** The image in a scrolling area, focusable, as IntelliJ's editor; Ctrl and the wheel zoom. */
export function ImageViewer(props: ImageViewerProps): Child {
  const { view } = props;
  const element = (
    <div class="cerebro-image" tabIndex={0} role="img" aria-label={props.label}>
      {() =>
        view.failed ? (
          <p class="cerebro-image__error">Image not loaded</p>
        ) : (
          <div class="cerebro-image__pane">
            <div
              class={() =>
                view.chessboard
                  ? 'cerebro-image__canvas cerebro-image__canvas--chessboard'
                  : 'cerebro-image__canvas'
              }
            >
              <img
                class={() =>
                  view.zoom > 1
                    ? 'cerebro-image__img cerebro-image__img--pixels'
                    : 'cerebro-image__img'
                }
                src={props.src}
                alt=""
                draggable={false}
                ref={(img: HTMLImageElement) => {
                  img.addEventListener('load', () => {
                    view.load(img.naturalWidth, img.naturalHeight);
                  });
                  img.addEventListener('error', () => {
                    view.fail();
                  });
                }}
                width={() => view.canvas.width}
                height={() => view.canvas.height}
              />
              {() => (view.grid && view.zoom >= GRID_FROM ? <Grid view={view} /> : null)}
            </div>
          </div>
        )
      }
    </div>
  ) as HTMLElement;
  const resized = new ResizeObserver(() => {
    view.resize(element.clientWidth, element.clientHeight);
  });
  resized.observe(element);
  onCleanup(() => {
    resized.disconnect();
  });
  element.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey || event.deltaY === 0 || !view.loaded) return;
      event.preventDefault();
      // About the pointer: the point under it stays there, as IntelliJ's.
      const before = view.zoom;
      const box = element.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      const scroll = { left: element.scrollLeft, top: element.scrollTop };
      if (event.deltaY > 0) view.zoomOut();
      else view.zoomIn();
      const change = view.zoom / before;
      element.scrollLeft = Math.max(0, (scroll.left + x) * change - x);
      element.scrollTop = Math.max(0, (scroll.top + y) * change - y);
    },
    { passive: false },
  );
  return element;
}

/** Lines between the pixels, from the first to the last but one, as IntelliJ draws them. */
function Grid(props: { view: ImageView }): Child {
  const { view } = props;
  return (
    <div
      class="cerebro-image__grid"
      ref={(grid: HTMLElement) => {
        // Its cells are the image's pixels: a line at each one's left and top but the first's.
        const place = () => {
          const { width, height } = view.canvas;
          const x = width / view.width;
          const y = height / view.height;
          grid.style.left = `${String(INSET + x)}px`;
          grid.style.top = `${String(INSET + y)}px`;
          grid.style.width = `${String(width - x)}px`;
          grid.style.height = `${String(height - y)}px`;
          grid.style.backgroundSize = `${String(x)}px ${String(y)}px`;
        };
        place();
      }}
    />
  );
}
