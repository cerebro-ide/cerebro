import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a build script, in JavaScript, with no types.
import { sourcesHash } from '../scripts/icons.mjs';

const ICONS = fileURLToPath(new URL('../icons/', import.meta.url));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's width and height, from its header. */
const sizeOf = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('the app’s icons', () => {
  it('are made from the SVGs as they are: run `npm run icons -w @cerebro-ide/app` after changing one', () => {
    expect(readFileSync(`${ICONS}sources.sha256`, 'utf8').trim()).toBe(
      (sourcesHash as () => string)(),
    );
  });

  it('are PNGs of their sizes, the ICO holding one for each size Windows draws', () => {
    expect(sizeOf(readFileSync(`${ICONS}cerebro.png`))).toEqual([256, 256]);
    expect(sizeOf(readFileSync(`${ICONS}cerebro-macos.png`))).toEqual([512, 512]);
    const ico = readFileSync(`${ICONS}cerebro.ico`);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
      const at = 6 + 16 * i;
      const png = ico.subarray(
        ico.readUInt32LE(at + 12),
        ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8),
      );
      expect(png.subarray(0, 8)).toEqual(PNG);
      // 256 is written as 0.
      expect(sizeOf(png)).toEqual([ico.readUInt8(at) || 256, ico.readUInt8(at + 1) || 256]);
      return sizeOf(png)[0];
    });
    expect(sizes).toEqual([16, 24, 32, 48, 64, 256]);
  });
});
