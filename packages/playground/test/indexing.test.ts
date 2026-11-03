import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { describe, expect, it } from 'vitest';
import { projects, setupEnvironments, useProjects, workspace } from '../src/environments.js';
import { progress, setupIndexing } from '../src/indexing.js';
import { FakeHost, project } from './fakes.js';

describe('indexing', () => {
  it('does nothing in a browser, without a host', () => {
    setupIndexing();
    expect(progress.size).toBe(0);
  });

  it('follows the host’s progress, and warms each git worktree up as it becomes active', async () => {
    const host = new FakeHost({ 'index.warm': () => null });
    const repo = project('/r/repo', host, [
      { id: '/r/repo', branch: 'main' },
      { id: '/r/other', branch: 'x' },
    ]);
    const plain = { ...project('/r/plain', host), git: false };
    useProjects([repo, plain]);
    const envs = setupEnvironments(new CommandRegistry(), new MenuRegistry(), () => undefined);
    envs.showProject('/r/repo');
    let send: (method: string, params: unknown) => void = () => undefined;
    setupIndexing((listener) => {
      send = listener;
      return () => undefined;
    });
    send('index.progress', { worktree: '/r/repo', done: 3, total: 10 });
    send('terminal.data', { worktree: '/r/repo', done: 9, total: 9 });
    expect(progress.get('/r/repo')).toEqual({ done: 3, total: 10 });
    envs.open('/r/other');
    envs.showProject('/r/plain');
    await expect
      .poll(() => host.params('index.warm'))
      .toEqual([{ worktree: '/r/repo' }, { worktree: '/r/other' }]);
    // Without notifications to listen to, it still warms up.
    setupIndexing();
    expect(workspace.activeId).toBe('/r/plain');
    projects.set([]);
  });
});
