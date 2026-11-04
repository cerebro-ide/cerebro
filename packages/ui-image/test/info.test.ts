import { describe, expect, it } from 'vitest';
import { formatFileSize, imageFormat, imageInfo } from '../src/index.js';

/** A PNG's first bytes: its signature and IHDR, with this bit depth and colour type. */
const png = (depth: number, type: number) => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes[24] = depth;
  bytes[25] = type;
  return bytes;
};

/** Bytes written in hexadecimal, spaces aside. */
const hex = (value: string) =>
  new Uint8Array(
    value
      .replaceAll(' ', '')
      .match(/../g)
      ?.map((pair) => parseInt(pair, 16)) ?? [],
  );

const text = (value: string, length = value.length) => {
  const bytes = new Uint8Array(length);
  bytes.set(Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)));
  return bytes;
};

describe('an image’s format and colour depth', () => {
  it('reads a PNG’s from its header: bits times channels', () => {
    expect(imageFormat(png(8, 6))).toEqual({ format: 'PNG', depth: 32 });
    expect(imageFormat(png(8, 2))).toEqual({ format: 'PNG', depth: 24 });
    expect(imageFormat(png(4, 3))).toEqual({ format: 'PNG', depth: 4 });
    expect(imageFormat(png(16, 4))).toEqual({ format: 'PNG', depth: 32 });
    expect(imageFormat(png(8, 9))).toEqual({ format: 'PNG' });
  });

  it('reads a JPEG’s from its frame, past the markers before it', () => {
    // SOI, APP0 of 16 bytes, SOF0: 8 bits, 1x1, 3 components.
    const jpeg = hex(`ffd8 ffe00010 ${'00'.repeat(14)} ffc0 0011 08 0001 0001 03 00000000`);
    expect(imageFormat(jpeg)).toEqual({ format: 'JPEG', depth: 24 });
    // A Huffman table (C4) isn't a frame; no frame found, no depth.
    const tables = hex(`ffd8 ffc40002 ${'00'.repeat(10)}`);
    expect(imageFormat(tables)).toEqual({ format: 'JPEG' });
  });

  it('reads a GIF’s from its colour table, a BMP’s from its header', () => {
    const gif = text('GIF89a', 13);
    gif[10] = 0x80 | 7;
    expect(imageFormat(gif)).toEqual({ format: 'GIF', depth: 8 });
    gif[10] = 0;
    expect(imageFormat(gif)).toEqual({ format: 'GIF' });
    const bmp = text('BM', 30);
    bmp[28] = 24;
    expect(imageFormat(bmp)).toEqual({ format: 'BMP', depth: 24 });
  });

  it('names WebP, ICO and AVIF without a depth, and nothing else', () => {
    expect(imageFormat(text('RIFF\0\0\0\0WEBP'))).toEqual({ format: 'WEBP' });
    expect(imageFormat(new Uint8Array([0, 0, 1, 0, 1, 0]))).toEqual({ format: 'ICO' });
    expect(imageFormat(text('\0\0\0\x1cftypavif'))).toEqual({ format: 'AVIF' });
    expect(imageFormat(text('plain text'))).toBeUndefined();
  });
});

describe('the image’s line', () => {
  it('gives sizes in metric units, as IntelliJ', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(999)).toBe('999 B');
    expect(formatFileSize(1000)).toBe('1 kB');
    expect(formatFileSize(41_440)).toBe('41.44 kB');
    expect(formatFileSize(1_234_567)).toBe('1.23 MB');
  });

  it('says the size, format, depth and file size', () => {
    expect(imageInfo({ width: 800, height: 600 }, { format: 'PNG', depth: 32 }, 41_440)).toBe(
      '800x600 PNG (32-bit color) 41.44 kB',
    );
    expect(imageInfo({ width: 2, height: 1 }, { format: 'WEBP' }, 50)).toBe('2x1 WEBP 50 B');
    expect(imageInfo({ width: 2, height: 1 }, undefined, 50)).toBe('2x1 Unknown Format 50 B');
  });
});
