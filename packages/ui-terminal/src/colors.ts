// Terminal colours as CSS values: the 16 named ones from the theme's variables, the rest of the
// 256-colour palette computed as xterm does, and true colours as given.

/** The CSS colour of palette entry `index` (0–255). */
export function paletteColour(index: number): string {
  if (index < 16) return `var(--cerebro-terminal-ansi-${String(index)})`;
  if (index < 232) {
    // A 6×6×6 cube.
    const i = index - 16;
    const level = (n: number) => (n === 0 ? 0 : 55 + n * 40);
    return hex(level(Math.floor(i / 36)), level(Math.floor(i / 6) % 6), level(i % 6));
  }
  // 24 greys.
  const grey = 8 + (index - 232) * 10;
  return hex(grey, grey, grey);
}

/** A true colour, packed as xterm gives it (0xRRGGBB). */
export function rgbColour(packed: number): string {
  return hex((packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff);
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
