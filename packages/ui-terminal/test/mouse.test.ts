import { describe, expect, it } from 'vitest';
import { encodeMouse, type MouseReport } from '../src/mouse.js';

const report = (kind: MouseReport['kind'], extra: Partial<MouseReport> = {}): MouseReport => ({
  kind,
  button: 0,
  col: 4,
  row: 2,
  shift: false,
  alt: false,
  ctrl: false,
  ...extra,
});

describe('encoding mouse reports', () => {
  it('reports nothing without tracking', () => {
    expect(encodeMouse(report('press'), 'none', true)).toBeUndefined();
  });

  it('uses SGR when asked: one-based positions, M for presses, m for releases', () => {
    expect(encodeMouse(report('press'), 'vt200', true)).toBe('\x1b[<0;5;3M');
    expect(encodeMouse(report('release', { button: 2 }), 'vt200', true)).toBe('\x1b[<2;5;3m');
    expect(encodeMouse(report('wheel-up'), 'vt200', true)).toBe('\x1b[<64;5;3M');
    expect(encodeMouse(report('wheel-down', { ctrl: true }), 'vt200', true)).toBe('\x1b[<81;5;3M');
  });

  it('uses the original encoding otherwise, which can’t reach past column 223', () => {
    expect(encodeMouse(report('press', { shift: true, alt: true }), 'vt200', false)).toBe(
      `\x1b[M${String.fromCharCode(32 + 12, 37, 35)}`,
    );
    expect(encodeMouse(report('release'), 'vt200', false)).toBe(
      `\x1b[M${String.fromCharCode(35, 37, 35)}`,
    );
    expect(encodeMouse(report('press', { col: 300 }), 'vt200', false)).toBeUndefined();
    expect(encodeMouse(report('press', { row: 300 }), 'vt200', false)).toBeUndefined();
  });

  it('reports only presses in X10 mode, without modifiers', () => {
    expect(encodeMouse(report('press', { ctrl: true }), 'x10', true)).toBe('\x1b[<0;5;3M');
    expect(encodeMouse(report('release'), 'x10', true)).toBeUndefined();
  });

  it('reports moves while dragging in drag mode, and any moves in any mode', () => {
    expect(encodeMouse(report('move'), 'vt200', true)).toBeUndefined();
    expect(encodeMouse(report('move', { button: -1 }), 'drag', true)).toBeUndefined();
    expect(encodeMouse(report('move'), 'drag', true)).toBe('\x1b[<32;5;3M');
    expect(encodeMouse(report('move', { button: -1 }), 'any', true)).toBe('\x1b[<35;5;3M');
  });
});
