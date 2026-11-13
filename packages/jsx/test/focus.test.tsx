import { afterEach, expect, it, vi } from 'vitest';
import { focusedElement } from '../src/index.js';

afterEach(() => {
  document.body.replaceChildren();
});

it('finds the focus inside shadow roots, nested too, and is the body with nothing focused', () => {
  expect(focusedElement()).toBe(document.body);
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  outer.attachShadow({ mode: 'open' }).append(inner);
  const field = document.createElement('input');
  inner.attachShadow({ mode: 'open' }).append(field);
  document.body.append(outer);
  field.focus();
  expect(document.activeElement).toBe(outer);
  expect(focusedElement()).toBe(field);
  // Plain, outside any.
  const plain = document.createElement('input');
  document.body.append(plain);
  plain.focus();
  expect(focusedElement()).toBe(plain);
  // None at all.
  const none = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
  expect(focusedElement()).toBe(document.body);
  none.mockRestore();
});
