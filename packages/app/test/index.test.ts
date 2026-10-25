import { expect, it, vi } from 'vitest';

const start = vi.hoisted(() => vi.fn());
vi.mock('../src/main.js', () => ({ start }));

it('starts the app', async () => {
  await import('../src/index.js');
  expect(start).toHaveBeenCalledOnce();
});
