import { expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ serve: vi.fn() }));
vi.mock('../src/host.js', () => host);

it('serves over stdio, for CEREBRO_REPO or the folder it started in', async () => {
  vi.stubEnv('CEREBRO_REPO', '/chosen');
  await import('../src/main.js');
  vi.unstubAllEnvs();
  expect(host.serve).toHaveBeenCalledWith(process.stdin, process.stdout, { repo: '/chosen' });
  vi.resetModules();
  vi.stubEnv('CEREBRO_REPO', undefined);
  await import('../src/main.js');
  vi.unstubAllEnvs();
  expect(host.serve).toHaveBeenLastCalledWith(process.stdin, process.stdout, {
    repo: process.cwd(),
  });
});
