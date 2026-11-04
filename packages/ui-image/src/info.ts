// What IntelliJ's image editor says of an image, at its toolbar's right: "800x600 PNG (32-bit
// color) 41.44 kB" (ImagesBundle's `image.info`). The format and the colour depth are read from the
// file's header, as Java's ImageIO gives them to IntelliJ: its reader's format name, and its colour
// model's bits per pixel.

/** An image file's format, as ImageIO names it (upper-cased, as IntelliJ shows it), and its depth. */
export interface ImageFormat {
  format: string;
  /** Bits per pixel; undefined where the header doesn't say, or isn't read here. */
  depth?: number;
}

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** PNG's channels by colour type: grey, RGB, palette, grey and alpha, RGBA. */
const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A JPEG's depth: its frame's precision times its components, from the first SOF marker. */
function jpegDepth(bytes: Uint8Array): number | undefined {
  let at = 2;
  while (at + 9 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] as number;
    // SOF0 to SOF15, but DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return (bytes[at + 4] as number) * (bytes[at + 9] as number);
    }
    at += 2 + (((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number));
  }
  return undefined;
}

/** The format and depth of the image in `bytes`, by its header; undefined when it's none known. */
export function imageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47)) {
    const channels = PNG_CHANNELS[bytes[25] as number];
    return {
      format: 'PNG',
      ...(channels === undefined ? {} : { depth: (bytes[24] as number) * channels }),
    };
  }
  if (startsWith(bytes, 0xff, 0xd8)) {
    const depth = jpegDepth(bytes);
    return { format: 'JPEG', ...(depth === undefined ? {} : { depth }) };
  }
  if (ascii(bytes, 0, 4) === 'GIF8') {
    // The global colour table's size, when it has one.
    const packed = bytes[10] as number;
    return { format: 'GIF', ...(packed & 0x80 ? { depth: (packed & 7) + 1 } : {}) };
  }
  if (ascii(bytes, 0, 2) === 'BM') {
    return { format: 'BMP', depth: (bytes[28] as number) | ((bytes[29] as number) << 8) };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { format: 'WEBP' };
  if (startsWith(bytes, 0, 0, 1, 0)) return { format: 'ICO' };
  if (ascii(bytes, 4, 12) === 'ftypavif') return { format: 'AVIF' };
  return undefined;
}

/** A size in bytes as IntelliJ writes it: metric units, two decimals at most ("41.44 kB"). */
export function formatFileSize(size: number): string {
  if (size === 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  // IntelliJ's rank: 999.995 bytes and up are kilobytes, as they round to 1000.
  const rank = Math.min(Math.floor((Math.log10(size) + 0.0000021714778384307465) / 3), 4);
  const value = Math.round((size / 1000 ** rank) * 100) / 100;
  return `${String(value)} ${units[rank] as string}`;
}

/** IntelliJ's line: "800x600 PNG (32-bit color) 41.44 kB". */
export function imageInfo(
  size: { width: number; height: number },
  format: ImageFormat | undefined,
  bytes: number,
): string {
  const depth = format?.depth === undefined ? '' : ` (${String(format.depth)}-bit color)`;
  return `${String(size.width)}x${String(size.height)} ${format?.format ?? 'Unknown Format'}${depth} ${formatFileSize(bytes)}`;
}
