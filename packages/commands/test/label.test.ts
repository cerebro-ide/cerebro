import { describe, expect, it } from 'vitest';
import { displayText, parseLabel } from '../src/index.js';

describe('parseLabel', () => {
  it('finds the mnemonic after &', () => {
    expect(parseLabel('&File')).toEqual({ text: 'File', mnemonic: 'F', index: 0 });
    expect(parseLabel('Open &recent')).toEqual({ text: 'Open recent', mnemonic: 'R', index: 5 });
  });

  it('has no mnemonic without &', () => {
    expect(parseLabel('Close')).toEqual({ text: 'Close', mnemonic: undefined, index: -1 });
  });

  it('reads && as a literal &, and keeps only the first mnemonic', () => {
    expect(parseLabel('Find && &Replace')).toEqual({
      text: 'Find & Replace',
      mnemonic: 'R',
      index: 7,
    });
    expect(parseLabel('&A &B')).toEqual({ text: 'A B', mnemonic: 'A', index: 0 });
  });

  it('drops a trailing &', () => {
    expect(parseLabel('Odd&')).toEqual({ text: 'Odd', mnemonic: undefined, index: -1 });
  });
});

describe('displayText', () => {
  it('adds an ellipsis for dialogs', () => {
    expect(displayText('&Open')).toBe('Open');
    expect(displayText('&Open', true)).toBe('Open…');
  });
});
