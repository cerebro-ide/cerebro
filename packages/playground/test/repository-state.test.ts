import { effect } from '@cerebro-ide/reactive';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useProjects, workspace } from '../src/environments.js';
import { readState, STATE_MS, stateOf, watchState } from '../src/repository-state.js';
import { FakeHost, project } from './fakes.js';

let state: unknown = { operation: 'merge', conflicts: true, message: 'Merge' };
const host = new FakeHost({ 'git.state': () => state });
const failing = new FakeHost({});

beforeAll(() => {
  useProjects([
    project('/r', host),
    project('/s', undefined),
    { ...project('/n', host), git: false },
    project('/f', failing),
  ]);
});

afterEach(() => {
  host.asked.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the repository’s state', () => {
  it('is nothing under way until read, then what the host says, set again only if changed', async () => {
    expect(stateOf('/r')).toEqual({ conflicts: false });
    let runs = 0;
    const stop = effect(() => {
      stateOf('/r');
      runs++;
    });
    await readState('/r');
    expect(stateOf('/r')).toEqual({ operation: 'merge', conflicts: true, message: 'Merge' });
    expect(runs).toBe(2);
    await readState('/r');
    expect(runs).toBe(2);
    stop.dispose();
  });

  it('isn’t read without a host, nor outside git', async () => {
    await readState('/s');
    await readState('/n');
    expect(host.params('git.state')).toEqual([]);
  });

  it('is read for the active worktree now, every few seconds, and on the focus; failures logged', async () => {
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    state = { conflicts: false };
    watchState();
    await expect.poll(() => stateOf('/r')).toEqual({ conflicts: false });
    state = { operation: 'rebase', conflicts: false };
    vi.advanceTimersByTime(STATE_MS);
    await expect.poll(() => stateOf('/r').operation).toBe('rebase');
    state = { conflicts: false };
    window.dispatchEvent(new Event('focus'));
    await expect.poll(() => stateOf('/r').operation).toBeUndefined();
    workspace.openOrActivate({ id: '/f', name: 'f', branch: 'main' });
    vi.advanceTimersByTime(STATE_MS);
    await expect
      .poll(() => error.mock.calls[0]?.[0] as unknown)
      .toBe('Reading the repository’s state failed');
    // No environment open: nothing to read.
    for (const id of ['/r', '/f']) workspace.close(id);
    const asked = host.asked.length;
    vi.advanceTimersByTime(STATE_MS);
    expect(host.asked.length).toBe(asked);
  });
});
