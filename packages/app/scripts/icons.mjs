// Makes the app's icons from the SVGs in packages/playground/public/icons, which are their source:
// Electron takes a window's icon as PNG (or ICO on Windows), not SVG (its `BrowserWindow` typings).
// Run after changing an SVG: `npm run icons -w @cerebro-ide/app`; a test fails until it's run.
// - cerebro.png: Linux's window icon, the full icon at 256 px (shown at 64);
// - cerebro.ico: Windows' window icon, the small icon (the C alone) at 16, 24 and 32 px, the full one
//   at 48, 64 and 256: an ICO holding PNGs, each picked by the size Windows draws;
// - cerebro-macos.png: the Dock's, the full icon on macOS's grid, at 512 px;
// - sources.sha256: the SVGs' hash, which the test checks.
// Drawn by Playwright's Chromium (the e2e tests'), so no other dependency.

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SOURCES = fileURLToPath(new URL('../../playground/public/icons/', import.meta.url));
const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
export const SVGS = ['cerebro.svg', 'cerebro-small.svg', 'cerebro-macos.svg'];

/** The SVGs' hash, as the test computes it: their lines' ends aside, as git on Windows may change them. */
export function sourcesHash(dir = SOURCES) {
  const hash = createHash('sha256');
  for (const name of SVGS) {
    hash.update(name).update(readFileSync(`${dir}${name}`, 'utf8').replaceAll('\r\n', '\n'));
  }
  return hash.digest('hex');
}

/** An ICO file holding PNG images, each `{ size, png }`; 256 is written as 0, as the format says. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size % 256, at);
    header.writeUInt8(size % 256, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  /** The SVG drawn at `size` px square, with what's around it transparent. */
  const png = async (name, size) => {
    const svg = readFileSync(`${SOURCES}${name}`, 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}</style><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    return page.screenshot({ omitBackground: true });
  };
  writeFileSync(`${OUT}cerebro.png`, await png('cerebro.svg', 256));
  writeFileSync(`${OUT}cerebro-macos.png`, await png('cerebro-macos.svg', 512));
  const sizes = [16, 24, 32, 48, 64, 256];
  const images = [];
  for (const size of sizes) {
    images.push({ size, png: await png(size <= 32 ? 'cerebro-small.svg' : 'cerebro.svg', size) });
  }
  writeFileSync(`${OUT}cerebro.ico`, ico(images));
  writeFileSync(`${OUT}sources.sha256`, `${sourcesHash()}\n`);
  await browser.close();
}
