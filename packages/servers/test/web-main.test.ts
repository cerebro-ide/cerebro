import { expect, it, vi } from 'vitest';

const web = vi.hoisted(() => ({ serveWeb: vi.fn() }));
vi.mock('../src/web.js', () => web);

it('serves over stdio', async () => {
  await import('../src/web-main.js');
  expect(web.serveWeb).toHaveBeenCalledWith(process.stdin, process.stdout);
});
