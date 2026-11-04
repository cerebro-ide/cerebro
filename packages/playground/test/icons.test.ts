import { describe, expect, it } from 'vitest';
import { icon, symbolIcon } from '../src/icons.js';

describe('icons', () => {
  it('draw their glyph, or a square for a name they don’t have', () => {
    const path = (name: string) => (icon(name) as Element).querySelector('path')?.getAttribute('d');
    expect(path('check')).toBe('M3.5 8.5l3 3 6-7');
    expect(path('nothing')).toBe('M4 4h8v8H4z');
    expect((icon('check') as Element).getAttribute('aria-hidden')).toBe('true');
  });

  it('draw a symbol’s letter by its kind, or the structure’s icon for one without', () => {
    const letter = (kind?: string) =>
      (symbolIcon(kind) as Element).querySelector('text')?.textContent;
    expect(letter('class')).toBe('C');
    expect(letter('method')).toBe('m');
    const path = (node: Node) => (node as Element).querySelector('path')?.getAttribute('d');
    expect(path(symbolIcon('file'))).toBe(path(icon('structure')));
    expect(path(symbolIcon(undefined))).toBe(path(icon('structure')));
  });
});
