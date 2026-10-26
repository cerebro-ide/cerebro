import { expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ serve: vi.fn() }));
vi.mock('../src/host.js', () => host);
const agents = vi.hoisted(() => ({
  sendHook: vi.fn(() => Promise.resolve()),
  parseHookInput: (text: string) => JSON.parse(text) as unknown,
}));
vi.mock('../src/agents.js', () => agents);

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

it('is an agent’s hook when asked: it tells the host what it read', async () => {
  vi.resetModules();
  host.serve.mockClear();
  const argv = process.argv;
  process.argv = [argv[0] as string, 'main.js', 'hook', 'Stop'];
  vi.stubEnv('CEREBRO_HOOK_SOCKET', '/socket');
  vi.stubEnv('CEREBRO_AGENT_KEY', 'claude:/w');
  await import('../src/main.js');
  process.stdin.emit('data', '{"session_id":');
  process.stdin.emit('data', '"s"}');
  process.stdin.emit('end');
  expect(agents.sendHook).toHaveBeenCalledWith('/socket', {
    key: 'claude:/w',
    event: 'Stop',
    input: { session_id: 's' },
  });
  // Without its environment or name: empty, for the host to ignore.
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  vi.resetModules();
  vi.stubEnv('CEREBRO_HOOK_SOCKET', undefined);
  vi.stubEnv('CEREBRO_AGENT_KEY', undefined);
  process.argv = [argv[0] as string, 'main.js', 'hook'];
  await import('../src/main.js');
  process.stdin.emit('data', '{}');
  process.stdin.emit('end');
  expect(agents.sendHook).toHaveBeenLastCalledWith('', { key: '', event: '', input: {} });
  process.stdin.removeAllListeners('data');
  process.stdin.removeAllListeners('end');
  process.argv = argv;
  vi.unstubAllEnvs();
  expect(host.serve).not.toHaveBeenCalled();
});
