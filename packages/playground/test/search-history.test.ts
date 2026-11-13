import { beforeEach, expect, it } from 'vitest';
import { SearchHistory } from '../src/search-history.js';

beforeEach(() => {
  localStorage.clear();
});

it('keeps texts as they are, IntelliJ’s FindInProjectSettings’ way: the same moved first, another case apart, up to its limit', () => {
  const history = new SearchHistory('test.history', { limit: 3, loose: false });
  history.remember('');
  history.remember('   ');
  expect(history.texts()).toEqual([]);
  for (const text of [' a ', 'b', 'B', 'c']) history.remember(text);
  expect(history.texts()).toEqual(['c', 'B', 'b']);
  history.remember('b');
  expect(history.texts()).toEqual(['b', 'c', 'B']);
  // First already: still first, once.
  history.remember('b');
  expect(history.texts()).toEqual(['b', 'c', 'B']);
});
