import { describe, expect, it } from 'vitest';
import { encodeKey, type KeyLike } from '../src/keys.js';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
const normal = { applicationCursorKeys: false };
const app = { applicationCursorKeys: true };

describe('encoding keys', () => {
  it('sends the arrows, Home and End as CSI, or SS3 in application cursor mode', () => {
    expect(encodeKey(key('ArrowUp'), normal)).toBe('\x1b[A');
    expect(encodeKey(key('ArrowLeft'), app)).toBe('\x1bOD');
    expect(encodeKey(key('Home'), normal)).toBe('\x1b[H');
    expect(encodeKey(key('End'), app)).toBe('\x1bOF');
  });

  it('adds the modifiers as xterm does', () => {
    expect(encodeKey(key('ArrowRight', { ctrlKey: true }), app)).toBe('\x1b[1;5C');
    expect(encodeKey(key('ArrowUp', { shiftKey: true, altKey: true }), normal)).toBe('\x1b[1;4A');
    expect(encodeKey(key('Delete', { ctrlKey: true }), normal)).toBe('\x1b[3;5~');
    expect(encodeKey(key('F1', { shiftKey: true }), normal)).toBe('\x1b[1;2P');
  });

  it('sends the editing and function keys', () => {
    expect(encodeKey(key('Insert'), normal)).toBe('\x1b[2~');
    expect(encodeKey(key('PageDown'), normal)).toBe('\x1b[6~');
    expect(encodeKey(key('F4'), normal)).toBe('\x1bOS');
    expect(encodeKey(key('F12'), normal)).toBe('\x1b[24~');
  });

  it('sends Enter, Backspace, Tab and Escape, with Alt as an Escape before them', () => {
    expect(encodeKey(key('Enter'), normal)).toBe('\r');
    expect(encodeKey(key('Enter', { altKey: true }), normal)).toBe('\x1b\r');
    expect(encodeKey(key('Backspace'), normal)).toBe('\x7f');
    expect(encodeKey(key('Backspace', { ctrlKey: true }), normal)).toBe('\x08');
    expect(encodeKey(key('Tab'), normal)).toBe('\t');
    expect(encodeKey(key('Tab', { shiftKey: true }), normal)).toBe('\x1b[Z');
    expect(encodeKey(key('Escape'), normal)).toBe('\x1b');
  });

  it('sends control characters for Ctrl with a letter or punctuation', () => {
    expect(encodeKey(key('c', { ctrlKey: true }), normal)).toBe('\x03');
    expect(encodeKey(key('A', { ctrlKey: true, shiftKey: true }), normal)).toBe('\x01');
    expect(encodeKey(key(' ', { ctrlKey: true }), normal)).toBe('\x00');
    expect(encodeKey(key('[', { ctrlKey: true }), normal)).toBe('\x1b');
    expect(encodeKey(key('\\', { ctrlKey: true }), normal)).toBe('\x1c');
    expect(encodeKey(key('d', { ctrlKey: true, altKey: true }), normal)).toBe('\x1b\x04');
    expect(encodeKey(key('.', { ctrlKey: true }), normal)).toBeUndefined();
  });

  it('sends Alt with a character as Escape then the character, except Option on macOS', () => {
    expect(encodeKey(key('b', { altKey: true }), normal)).toBe('\x1bb');
    expect(encodeKey(key('b', { altKey: true }), { ...normal, mac: true })).toBeUndefined();
  });

  it('leaves text, Cmd combinations and unknown keys alone', () => {
    expect(encodeKey(key('a'), normal)).toBeUndefined();
    expect(encodeKey(key('c', { metaKey: true }), normal)).toBeUndefined();
    expect(encodeKey(key('Shift', { shiftKey: true }), normal)).toBeUndefined();
  });
});
