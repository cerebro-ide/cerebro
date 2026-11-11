import { expect, it, vi } from 'vitest';
import { boot, shown } from './boot.js';

vi.mock('../src/diff-window.js', () => {
  shown.push('diff');
  return {};
});
vi.mock('../src/welcome.js', () => {
  shown.push('welcome');
  return {};
});
vi.mock('../src/main.js', () => {
  shown.push('main');
  return {};
});

it('shows a diff in a diff window, its hash naming it', async () => {
  location.hash = '#diff=x';
  expect(await boot([])).toEqual(['diff']);
});
