// The shared index's progress, per worktree, from the host's notifications; and warming the active
// worktree up, so its first search finds the index ready (a large repository takes a while:
// ag-charts' 5,231 source files took 14 s, measured).

import { effect, ObservableMap } from '@cerebro-ide/reactive';
import { active, currentHost } from './environments.js';

/** How far each worktree's indexing has got. */
export const progress = new ObservableMap<string, { done: number; total: number }>();

/** Listens to the host, and warms each worktree up as it becomes active. */
export function setupIndexing(
  onNotification?: (listener: (method: string, params: unknown) => void) => () => void,
): void {
  const host = currentHost();
  if (!host) return;
  onNotification?.((method, params) => {
    if (method !== 'index.progress') return;
    const { worktree, done, total } = params as { worktree: string; done: number; total: number };
    progress.set(worktree, { done, total });
  });
  effect(() => {
    const env = active();
    if (env) void host.request('index.warm', { worktree: env.id });
    return undefined;
  });
}
