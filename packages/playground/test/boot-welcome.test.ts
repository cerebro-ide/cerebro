import { expect, it, vi } from 'vitest';
import { boot, shown } from './boot.js';

vi.mock('../src/welcome.js', () => {
  shown.push('welcome');
  return {};
});
vi.mock('../src/main.js', () => {
  shown.push('main');
  return {};
});

it('shows the Welcome window in a window without projects', async () => {
  expect(await boot([])).toEqual(['welcome']);
});
