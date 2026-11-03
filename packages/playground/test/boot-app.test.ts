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

it('shows the IDE in a window with projects', async () => {
  expect(await boot([{ path: '/p', name: 'p' }])).toEqual(['main']);
});
