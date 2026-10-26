import { describe, expect, it } from 'vitest';
import { paletteColour, rgbColour } from '../src/colors.js';

describe('colours', () => {
  it('takes the 16 named colours from the theme, and computes the rest as xterm', () => {
    expect(paletteColour(1)).toBe('var(--cerebro-terminal-ansi-1)');
    expect(paletteColour(16)).toBe('#000000');
    expect(paletteColour(196)).toBe('#ff0000');
    expect(paletteColour(110)).toBe('#87afd7');
    expect(paletteColour(232)).toBe('#080808');
    expect(paletteColour(255)).toBe('#eeeeee');
  });

  it('unpacks true colours', () => {
    expect(rgbColour(0x12ab0f)).toBe('#12ab0f');
  });
});
