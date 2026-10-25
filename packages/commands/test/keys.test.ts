import { describe, expect, it } from 'vitest';
import {
  chordFromEvent,
  formatChord,
  formatSequence,
  normalizeChord,
  normalizeSequence,
} from '../src/index.js';

const event = (overrides: Partial<Parameters<typeof chordFromEvent>[0]>) => ({
  key: 'a',
  code: 'KeyA',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

describe('normalizeChord', () => {
  it('orders modifiers and uppercases letters', () => {
    expect(normalizeChord('shift+ctrl+o', 'other')).toBe('Ctrl+Shift+O');
    expect(normalizeChord('Meta+Alt+Shift+Ctrl+k', 'other')).toBe('Ctrl+Alt+Shift+Meta+K');
  });

  it('accepts aliases, and Mod per platform', () => {
    expect(normalizeChord('control+option+cmd+x', 'other')).toBe('Ctrl+Alt+Meta+X');
    expect(normalizeChord('opt+command+super+y', 'other')).toBe('Alt+Meta+Y');
    expect(normalizeChord('Mod+S', 'other')).toBe('Ctrl+S');
    expect(normalizeChord('Mod+S', 'mac')).toBe('Meta+S');
  });

  it('names keys canonically', () => {
    const cases: [string, string][] = [
      ['esc', 'Escape'],
      ['Return', 'Enter'],
      ['space', 'Space'],
      ['del', 'Delete'],
      ['up', 'ArrowUp'],
      ['arrowleft', 'ArrowLeft'],
      ['pagedown', 'PageDown'],
      ['f12', 'F12'],
      ['MediaPlay', 'MediaPlay'],
      ['/', '/'],
    ];
    for (const [written, name] of cases) expect(normalizeChord(written, 'other')).toBe(name);
  });

  it('reads the plus key', () => {
    expect(normalizeChord('Ctrl++', 'other')).toBe('Ctrl++');
  });

  it('rejects chords without exactly one key', () => {
    expect(() => normalizeChord('Ctrl+Shift', 'other')).toThrow('has no key');
    expect(() => normalizeChord('A+B', 'other')).toThrow('Invalid key chord');
    expect(() => normalizeChord('Ctrl+', 'other')).toThrow('Invalid key chord');
  });
});

describe('normalizeSequence', () => {
  it('normalizes each chord', () => {
    expect(normalizeSequence('  ctrl+k   ctrl+s ', 'other')).toBe('Ctrl+K Ctrl+S');
  });
});

describe('chordFromEvent', () => {
  it('ignores a modifier pressed on its own', () => {
    for (const key of ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']) {
      expect(chordFromEvent(event({ key, code: 'X' }))).toBeUndefined();
    }
  });

  it('takes letters and digits from the physical key, whatever the layout', () => {
    expect(chordFromEvent(event({ key: 'ש', code: 'KeyA', altKey: true }))).toBe('Alt+A');
    expect(chordFromEvent(event({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1');
  });

  it('names other keys, with all modifiers in order', () => {
    expect(
      chordFromEvent(
        event({
          key: 'Escape',
          code: 'Escape',
          ctrlKey: true,
          altKey: true,
          shiftKey: true,
          metaKey: true,
        }),
      ),
    ).toBe('Ctrl+Alt+Shift+Meta+Escape');
    expect(chordFromEvent(event({ key: ' ', code: 'Space' }))).toBe('Space');
    expect(chordFromEvent(event({ key: '/', code: 'Slash', ctrlKey: true }))).toBe('Ctrl+/');
  });
});

describe('formatting', () => {
  it('shows macOS glyphs in macOS order', () => {
    expect(formatChord('Ctrl+Alt+Shift+Meta+O', 'mac')).toBe('⌃⌥⇧⌘O');
    expect(formatChord('Meta+Enter', 'mac')).toBe('⌘↩');
    expect(formatChord('ArrowUp', 'mac')).toBe('↑');
    expect(formatChord('Meta++', 'mac')).toBe('⌘+');
  });

  it('shows words elsewhere', () => {
    expect(formatChord('Ctrl+Shift+O', 'other')).toBe('Ctrl+Shift+O');
    expect(formatChord('Escape', 'other')).toBe('Esc');
    expect(formatChord('Alt+ArrowLeft', 'other')).toBe('Alt+Left');
    expect(formatChord('+', 'other')).toBe('+');
  });

  it('separates the chords of a sequence with commas', () => {
    expect(formatSequence('Ctrl+K Ctrl+S', 'other')).toBe('Ctrl+K, Ctrl+S');
    expect(formatSequence('Meta+K Meta+S', 'mac')).toBe('⌘K, ⌘S');
  });
});
