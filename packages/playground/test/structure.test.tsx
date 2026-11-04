import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { openStructure, structureItems, type FileSymbol } from '../src/structure.js';
import { closeAll, popupItems } from './fakes.js';

afterEach(async () => {
  await closeAll();
});

const place = (line: number, column = 0) => ({ line, column });

/** A symbol on lines `from` to `to`, its name at the start of `from`. */
const symbol = (
  name: string,
  kind: string | undefined,
  from: number,
  to: number,
  children: FileSymbol[] = [],
): FileSymbol => ({
  name,
  ...(kind === undefined ? {} : { kind }),
  from: place(from),
  to: place(to, 1),
  at: place(from, 6),
  children,
});

const SYMBOLS = [
  symbol('Square', 'class', 0, 4, [
    symbol('side', 'property', 1, 1),
    symbol('area', 'method', 2, 3),
  ]),
  symbol('make', 'function', 5, 5),
];

const highlighted = () =>
  document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
    ?.textContent;

describe('File Structure', () => {
  it('lists the symbols as a tree, in the file’s order', () => {
    expect(structureItems(SYMBOLS, '').map((i) => [i.label, i.depth])).toEqual([
      ['Square', undefined],
      ['side', 1],
      ['area', 1],
      ['make', undefined],
    ]);
  });

  it('narrows to the names that match and what they’re in', () => {
    const items = structureItems(SYMBOLS, 'ar');
    expect(items.map((i) => [i.label, i.matches, i.highlight])).toEqual([
      ['Square', true, [3, 4]],
      ['area', true, [0, 1]],
    ]);
    expect(structureItems(SYMBOLS, 'rea').map((i) => [i.label, i.matches])).toEqual([
      ['Square', false],
      ['area', true],
    ]);
    expect(structureItems(SYMBOLS, 'zz')).toEqual([]);
  });

  it('opens titled with the file, at the symbol at the caret; typing goes to the first match', async () => {
    const chosen = openStructure('shapes.ts', SYMBOLS, place(2, 3));
    expect(await popupItems()).toEqual(['Square', 'side', 'area', 'make']);
    expect(document.querySelector('.cerebro-popup__header')?.textContent).toBe('shapes.ts');
    expect(highlighted()).toBe('area');
    await userEvent.keyboard('rea');
    expect(highlighted()).toBe('area');
    await userEvent.keyboard('{Backspace}{Backspace}{Backspace}mak');
    expect(highlighted()).toBe('make');
    await userEvent.keyboard('{Enter}');
    expect((await chosen)?.name).toBe('make');
  });

  it('highlights the first symbol with the caret in none, and says why there are none', async () => {
    void openStructure('shapes.ts', SYMBOLS, place(9));
    await popupItems();
    expect(highlighted()).toBe('Square');
    await closeAll();
    void openStructure('a.txt', [], place(0));
    await expect
      .poll(() => document.querySelector('.cerebro-popup__empty')?.textContent)
      .toBe('Nothing to show');
    await userEvent.keyboard('{Escape}');
    const none = openStructure('a.txt', null, place(0));
    await expect
      .poll(() => document.querySelector('.cerebro-popup__empty')?.textContent)
      .toBe('No language server answered');
    await userEvent.keyboard('{Escape}');
    expect(await none).toBeUndefined();
  });
});
