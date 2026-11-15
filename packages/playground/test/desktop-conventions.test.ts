// The theme's base conventions (`@cerebro-ide/theme/base.css`, loaded by test/setup.ts): the arrow
// cursor, and text's only where text is typed or selected.
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
});

const cursorOf = (html: string) => {
  document.body.innerHTML = html;
  return getComputedStyle(document.body.firstElementChild as Element).cursor;
};

describe('the cursor', () => {
  it('is text over what’s typed in, and the arrow over a checkbox or a button', () => {
    for (const type of [
      '',
      ' type="text"',
      ' type="search"',
      ' type="password"',
      ' type="number"',
    ]) {
      expect(cursorOf(`<input${type}>`)).toBe('text');
    }
    expect(cursorOf('<textarea></textarea>')).toBe('text');
    expect(cursorOf('<div contenteditable="true"></div>')).toBe('text');
    for (const type of ['checkbox', 'radio', 'button', 'range']) {
      expect(cursorOf(`<input type="${type}">`)).toBe('default');
    }
    expect(cursorOf('<div></div>')).toBe('default');
  });
});
