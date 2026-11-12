import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { ImageDiff, type ImageDiffProps } from '../src/index.js';
import '../src/styles.css';
import '@cerebro-ide/theme/themes.css';

/** A PNG's bytes: `width` by `height`, black, with the pixels given painted white. */
async function png(width: number, height: number, white: [number, number][] = []) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#ffffff';
  for (const [x, y] of white) context.fillRect(x, y, 1, 1);
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => {
      resolve(b as Blob);
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/** A CSS colour's RGBA bytes. */
function colour(css: string): number[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d') as CanvasRenderingContext2D;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
}

let host: HTMLElement | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function show(props: Omit<ImageDiffProps, 'type' | 'label'>, size = { width: 600, height: 400 }) {
  host = document.createElement('div');
  host.style.width = `${String(size.width)}px`;
  host.style.height = `${String(size.height)}px`;
  document.body.append(host);
  const handle = render(() => <ImageDiff {...props} type="image/png" label="a.png" />, host);
  dispose = () => {
    handle.dispose();
  };
}

const q = (selector: string) => host?.querySelector<HTMLElement>(selector) ?? null;
const all = (selector: string) => [...(host?.querySelectorAll(selector) ?? [])];
const texts = (selector: string) => all(selector).map((e) => e.textContent);
const mode = (label: string) =>
  all('.cerebro-image-diff__mode').find((b) => b.textContent === label) as HTMLButtonElement;
const slide = (value: number) => {
  const slider = q('.cerebro-image-diff__slider') as HTMLInputElement;
  slider.value = String(value);
  slider.dispatchEvent(new Event('input'));
};

describe('the image diff', () => {
  it('shows the two side by side at first, as IntelliJ’s, each with its title and line', async () => {
    const before = await png(2, 2);
    const after = await png(3, 2, [[0, 0]]);
    show({
      before: { bytes: before, title: 'HEAD' },
      after: { bytes: after, title: 'Your version' },
    });
    expect(texts('.cerebro-image-diff__mode')).toEqual([
      'Side by Side',
      'Swipe',
      'Onion Skin',
      'Difference',
    ]);
    expect(mode('Side by Side').getAttribute('aria-checked')).toBe('true');
    expect(texts('.cerebro-image-diff__title')).toEqual(['HEAD', 'Your version']);
    await expect
      .poll(() => texts('.cerebro-image-diff__info'))
      .toEqual([
        `2x2 PNG (32-bit color) ${String(before.length)} B`,
        `3x2 PNG (32-bit color) ${String(after.length)} B`,
      ]);
    expect(all('.cerebro-image[role="img"]').map((e) => e.getAttribute('aria-label'))).toEqual([
      'a.png, HEAD',
      'a.png, Your version',
    ]);
    expect(q('.cerebro-image-diff__status')?.textContent).toBe('Files contents are different');
  });

  it('says when they’re the same, and an image it can’t read isn’t loaded', async () => {
    const bytes = await png(2, 2);
    show({ before: { bytes, title: 'a' }, after: { bytes: bytes.slice(), title: 'b' } });
    expect(q('.cerebro-image-diff__status')?.textContent).toBe('Files contents are identical');
    dispose?.();
    host?.remove();
    const broken = new Uint8Array([1, 2, 3]);
    show({ before: { bytes, title: 'a' }, after: { bytes: broken, title: 'b' } });
    expect(texts('.cerebro-image-diff__info')).toEqual(['Loading…', 'Loading…']);
    await expect.poll(() => texts('.cerebro-image__error')).toEqual(['Image not loaded']);
    expect(texts('.cerebro-image-diff__info')[1]).toBe('');
    await userEvent.click(mode('Swipe'));
    await expect.poll(() => q('.cerebro-image-diff__empty')?.textContent).toBe('Image not loaded');
  });

  it('shows one added or deleted beside nothing, and only side by side', async () => {
    const bytes = await png(2, 2);
    show({ before: undefined, after: { bytes, title: 'Your version' }, mode: 'swipe' });
    expect(q('.cerebro-image-diff__empty')?.textContent).toBe('No image');
    expect(mode('Side by Side').getAttribute('aria-checked')).toBe('true');
    expect(all('.cerebro-image-diff__mode').map((b) => (b as HTMLButtonElement).disabled)).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });

  it('swipes between them: the earlier left of the line, the later right of it', async () => {
    show({
      before: { bytes: await png(2, 2), title: 'a' },
      after: { bytes: await png(2, 2, [[1, 1]]), title: 'b' },
    });
    await userEvent.click(mode('Swipe'));
    expect(mode('Swipe').getAttribute('aria-checked')).toBe('true');
    await expect.poll(() => all('.cerebro-image-diff__layer')).toHaveLength(2);
    const [, top] = all('.cerebro-image-diff__layer') as HTMLElement[];
    const line = q('.cerebro-image-diff__swipe-line') as HTMLElement;
    expect(top?.style.clipPath).toBe('inset(0px 0px 0px 50%)');
    expect(line.style.left).toBe('50%');
    expect(q('.cerebro-image-diff__slider')?.getAttribute('aria-label')).toBe('Swipe');
    slide(20);
    expect(top?.style.clipPath).toBe('inset(0px 0px 0px 20%)');
    expect(line.style.left).toBe('20%');
    // Small, enlarged to fit, about 128 pixels, as the image viewer does: drawn as squares.
    expect(top?.style.width).toBe('128px');
    expect(top?.classList).toContain('cerebro-image-diff__layer--pixels');
  });

  it('fades the later one in over the earlier, in Onion Skin', async () => {
    show(
      {
        before: { bytes: await png(300, 300), title: 'a' },
        after: { bytes: await png(300, 300, [[1, 1]]), title: 'b' },
        mode: 'onion',
      },
      { width: 200, height: 200 },
    );
    // Until both are read.
    expect(q('.cerebro-image-diff__empty')?.textContent).toBe('Loading…');
    await expect.poll(() => all('.cerebro-image-diff__layer')).toHaveLength(2);
    const [, top] = all('.cerebro-image-diff__layer') as HTMLElement[];
    expect(top?.style.opacity).toBe('0.5');
    expect(q('.cerebro-image-diff__slider')?.getAttribute('aria-label')).toBe('Opacity');
    expect(q('.cerebro-image-diff__swipe-line')).toBeNull();
    slide(100);
    expect(top?.style.opacity).toBe('1');
    // Larger than its area: shrunk, smoothed.
    await expect.poll(() => parseFloat(top?.style.width ?? '')).toBeLessThan(300);
    expect(top?.classList).not.toContain('cerebro-image-diff__layer--pixels');
  });

  it('shows them at 1:1 in an area of no size, where there’s nothing to fit to', async () => {
    show(
      {
        before: { bytes: await png(300, 300), title: 'a' },
        after: { bytes: await png(300, 300, [[1, 1]]), title: 'b' },
        mode: 'onion',
      },
      { width: 0, height: 0 },
    );
    await expect.poll(() => all('.cerebro-image-diff__layer')).toHaveLength(2);
    expect((all('.cerebro-image-diff__layer')[1] as HTMLElement).style.width).toBe('300px');
  });

  it('marks the pixels that changed, in Difference, and counts them', async () => {
    show({
      before: { bytes: await png(2, 2), title: 'a' },
      after: { bytes: await png(3, 2, [[1, 0]]), title: 'b' },
      mode: 'difference',
    });
    await expect
      .poll(() => q('.cerebro-image-diff__caption')?.textContent)
      .toBe('3 of 6 pixels changed');
    const canvas = q('canvas.cerebro-image-diff__layer') as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([3, 2]);
    const pixel = (x: number, y: number) => [
      ...(canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(x, y, 1, 1).data,
    ];
    // Changed: the theme's colour; beyond the earlier one's frame, too.
    const style = getComputedStyle(canvas);
    const changed = colour(style.getPropertyValue('--cerebro-image-diff-changed'));
    expect(pixel(1, 0)).toEqual(changed);
    expect(pixel(2, 1)).toEqual(changed);
    // The rest: black, a quarter of the way from the faded colour to it.
    const faded = colour(style.getPropertyValue('--cerebro-image-diff-unchanged'));
    expect(pixel(0, 0)).toEqual([
      ...Uint8ClampedArray.from(faded.slice(0, 3), (c) => c * 0.75),
      255,
    ]);
  });

  it('stops reading the images once it’s gone', async () => {
    show({
      before: { bytes: await png(2, 2), title: 'a' },
      after: { bytes: await png(2, 2, [[0, 0]]), title: 'b' },
      mode: 'swipe',
    });
    dispose?.();
    dispose = undefined;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(host?.textContent).toBe('');
  });
});
