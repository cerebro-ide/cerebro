// Two versions of an image, compared. Side by Side is IntelliJ's (`TwosideBinaryDiffViewer`: each
// side in its image editor, and "Files contents are identical" or "different" under them, from its
// `DiffBundle`). Swipe, Onion Skin and Difference are Ido's, from GitHub's image diff: one over the
// other, the later one shown from a slider's place on, or faded in by it; or the pixels that
// changed, marked, over the later one faded.

import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { computed, effect, signal } from '@cerebro-ide/reactive';
import { fitZoom, ImageView, ImageViewer } from './image-viewer.js';
import { imageFormat, imageInfo } from './info.js';

/** One version of the image. */
export interface ImageSide {
  /** Its bytes. */
  bytes: Uint8Array;
  /** Its name above it: the revision, or "Your version". */
  title: string;
}

export const IMAGE_DIFF_MODES = [
  { mode: 'sideBySide', label: 'Side by Side' },
  { mode: 'swipe', label: 'Swipe' },
  { mode: 'onion', label: 'Onion Skin' },
  { mode: 'difference', label: 'Difference' },
] as const;
export type ImageDiffMode = (typeof IMAGE_DIFF_MODES)[number]['mode'];

export interface ImageDiffProps {
  /** The earlier version; undefined when the file was added. */
  before: ImageSide | undefined;
  /** The later one; undefined when it was deleted. */
  after: ImageSide | undefined;
  /** The file's media type, for its `data:` URLs. */
  type: string;
  /** For screen readers: the file's name. */
  label: string;
  /** How it's shown at first. */
  mode?: ImageDiffMode;
}

/** A side's `data:` URL. */
function dataUrl(bytes: Uint8Array, type: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/** The image decoded; undefined if the browser can't read it. */
async function decoded(src: string): Promise<HTMLImageElement | undefined> {
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
    return image;
  } catch {
    return undefined;
  }
}

/** The two versions, in the mode chosen above them; IntelliJ's status line below. */
export function ImageDiff(props: ImageDiffProps): Child {
  const { before, after } = props;
  const sources = [before, after].map((side) => side && dataUrl(side.bytes, props.type));
  const both = before !== undefined && after !== undefined;
  // One over the other needs both.
  const mode = signal<ImageDiffMode>(both ? (props.mode ?? 'sideBySide') : 'sideBySide');
  const identical = both && same(before.bytes, after.bytes);
  return (
    <div class="cerebro-image-diff">
      <div class="cerebro-image-diff__modes" role="radiogroup" aria-label="Compare by">
        {IMAGE_DIFF_MODES.map(({ mode: each, label }) => (
          <button
            type="button"
            role="radio"
            class="cerebro-image-diff__mode"
            aria-checked={() => String(mode.get() === each)}
            disabled={!both && each !== 'sideBySide'}
            on:click={() => {
              mode.set(each);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {() => {
        const shown = mode.get();
        if (shown === 'sideBySide') {
          return (
            <div class="cerebro-image-diff__sides">
              {[before, after].map((side, i) => (
                <Side side={side} src={sources[i]} label={props.label} />
              ))}
            </div>
          );
        }
        return (
          <Stacked
            mode={shown}
            before={sources[0] as string}
            after={sources[1] as string}
            label={props.label}
          />
        );
      }}
      <p class="cerebro-image-diff__status">
        {identical ? 'Files contents are identical' : 'Files contents are different'}
      </p>
    </div>
  );
}

/** One side, as IntelliJ's: its title, the image in its viewer, and the image's line. */
function Side(props: {
  side: ImageSide | undefined;
  src: string | undefined;
  label: string;
}): Child {
  const { side, src } = props;
  if (!side || src === undefined) {
    return (
      <div class="cerebro-image-diff__side">
        <p class="cerebro-image-diff__empty">No image</p>
      </div>
    );
  }
  const view = new ImageView({ chessboard: true });
  return (
    <div class="cerebro-image-diff__side">
      <div class="cerebro-image-diff__title">{side.title}</div>
      <ImageViewer view={view} src={src} label={`${props.label}, ${side.title}`} />
      <div class="cerebro-image-diff__info">
        {() =>
          view.loaded
            ? imageInfo(view, imageFormat(side.bytes), side.bytes.length)
            : view.failed
              ? ''
              : 'Loading…'
        }
      </div>
    </div>
  );
}

/** The two images one over the other, fitted to the area together: Swipe, Onion Skin, Difference. */
function Stacked(props: {
  mode: Exclude<ImageDiffMode, 'sideBySide'>;
  before: string;
  after: string;
  label: string;
}): Child {
  const { mode } = props;
  const images = signal<[HTMLImageElement, HTMLImageElement] | 'failed' | undefined>(undefined);
  let live = true;
  onCleanup(() => {
    live = false;
  });
  void Promise.all([decoded(props.before), decoded(props.after)]).then(([a, b]) => {
    if (live) images.set(a && b ? [a, b] : 'failed');
  });
  /** Where the slider is, from 0 to 100: Swipe's line, Onion Skin's fade. */
  const slider = signal(50);
  const size = signal({ width: 0, height: 0 });
  const area = (
    <div class="cerebro-image-diff__area" role="img" aria-label={props.label}>
      {() => stage()}
    </div>
  ) as HTMLElement;
  const resized = new ResizeObserver(() => {
    size.set({ width: area.clientWidth, height: area.clientHeight });
  });
  resized.observe(area);
  onCleanup(() => {
    resized.disconnect();
  });
  /** Both from the top left, in the larger's frame. */
  const frame = computed(() => {
    const loaded = images.get();
    if (!Array.isArray(loaded)) return undefined;
    const [a, b] = loaded;
    return {
      width: Math.max(a.naturalWidth, b.naturalWidth),
      height: Math.max(a.naturalHeight, b.naturalHeight),
    };
  });
  const changes = computed(() => {
    const loaded = images.get();
    const box = frame.get();
    return mode === 'difference' && Array.isArray(loaded) && box
      ? difference(loaded[0], loaded[1], box, area)
      : undefined;
  });
  function stage(): Child {
    const loaded = images.get();
    if (loaded === undefined) return <p class="cerebro-image-diff__empty">Loading…</p>;
    if (loaded === 'failed') return <p class="cerebro-image-diff__empty">Image not loaded</p>;
    const box = frame.get() as { width: number; height: number };
    const zoom = fitZoom(box, size.get()) ?? 1;
    const place = (element: HTMLElement, width: number, height: number) => {
      element.style.width = `${String(width * zoom)}px`;
      element.style.height = `${String(height * zoom)}px`;
    };
    // Enlarged, a pixel is a square, as the image viewer draws it.
    const layer =
      zoom > 1
        ? 'cerebro-image-diff__layer cerebro-image-diff__layer--pixels'
        : 'cerebro-image-diff__layer';
    const image = (decoded: HTMLImageElement) => {
      const img = (<img class={layer} src={decoded.src} alt="" draggable={false} />) as HTMLElement;
      place(img, decoded.naturalWidth, decoded.naturalHeight);
      return img;
    };
    const stage = (<div class="cerebro-image-diff__stage" />) as HTMLElement;
    place(stage, box.width, box.height);
    const found = changes.get();
    if (found) {
      found.canvas.className = layer;
      place(found.canvas, box.width, box.height);
      stage.append(found.canvas);
      return stage;
    }
    const [a, b] = loaded;
    const top = image(b);
    const line = (<div class="cerebro-image-diff__swipe-line" />) as HTMLElement;
    stage.append(image(a), top, ...(mode === 'swipe' ? [line] : []));
    const follow = effect(() => {
      const at = slider.get();
      if (mode === 'swipe') {
        top.style.clipPath = `inset(0 0 0 ${String(at)}%)`;
        line.style.left = `${String(at)}%`;
      } else top.style.opacity = String(at / 100);
      return undefined;
    });
    onCleanup(() => {
      follow.dispose();
    });
    return stage;
  }
  return (
    <div class="cerebro-image-diff__stacked">
      {area}
      {mode === 'difference' ? (
        <p class="cerebro-image-diff__caption">
          {() => {
            const found = changes.get();
            const box = frame.get();
            return found && box
              ? `${found.changed.toLocaleString('en')} of ${(box.width * box.height).toLocaleString('en')} pixels changed`
              : '';
          }}
        </p>
      ) : (
        <input
          type="range"
          class="cerebro-image-diff__slider"
          min="0"
          max="100"
          value="50"
          aria-label={mode === 'swipe' ? 'Swipe' : 'Opacity'}
          on:input={(event) => {
            slider.set(Number((event.currentTarget as HTMLInputElement).value));
          }}
        />
      )}
    </div>
  );
}

/** The colour, as RGBA bytes, of a CSS colour: a theme token's value. */
function rgba(colour: string): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data;
}

/** An image's pixels, in `frame` from its top left; transparent beyond it. */
function pixelsOf(image: HTMLImageElement, frame: { width: number; height: number }) {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, frame.width, frame.height).data;
}

/**
 * The pixels that differ, in the theme's colour for them, over the later image in grey and faded:
 * a pixel differs if any of its channels does, or it's in one image's frame alone.
 */
function difference(
  a: HTMLImageElement,
  b: HTMLImageElement,
  frame: { width: number; height: number },
  themed: Element,
): { canvas: HTMLCanvasElement; changed: number } {
  const before = pixelsOf(a, frame);
  const after = pixelsOf(b, frame);
  const style = getComputedStyle(themed);
  const mark = rgba(style.getPropertyValue('--cerebro-image-diff-changed'));
  const faded = rgba(style.getPropertyValue('--cerebro-image-diff-unchanged'));
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  const out = context.createImageData(frame.width, frame.height);
  let changed = 0;
  const [fr, fg, fb] = faded as unknown as [number, number, number];
  const data = out.data;
  for (let i = 0; i < data.length; i += 4) {
    let differs = false;
    for (let c = i; c < i + 4; c++) if (before[c] !== after[c]) differs = true;
    if (differs) {
      changed++;
      data.set(mark, i);
      continue;
    }
    // Grey, a quarter of the way from the faded colour to the pixel's lightness.
    const grey =
      0.299 * (after[i] as number) +
      0.587 * (after[i + 1] as number) +
      0.114 * (after[i + 2] as number);
    data[i] = fr + (grey - fr) / 4;
    data[i + 1] = fg + (grey - fg) / 4;
    data[i + 2] = fb + (grey - fb) / 4;
    data[i + 3] = after[i + 3] as number;
  }
  context.putImageData(out, 0, 0);
  return { canvas, changed };
}
