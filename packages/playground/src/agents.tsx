// Each worktree's agent (the Claude tool window's `claude`): its status, from the host's
// `agent.status` notifications (Claude Code's hooks), shown on the environment tabs and in the
// status bar; and its session, kept so the agent resumes it after the app restarts.

import { ObservableMap } from '@cerebro-ide/reactive';

export type AgentState = 'working' | 'waiting' | 'done';

/** The agent's terminal key for a worktree. */
export const agentKey = (worktree: string) => `claude:${worktree}`;

/** Each worktree's agent's state, while it has one. */
export const agentStates = new ObservableMap<string, AgentState>();

const LABELS: Record<AgentState, string> = {
  working: 'Claude is working',
  waiting: 'Claude is waiting for you',
  done: 'Claude is done',
};

/** Where each worktree's agent session is kept, for resuming. */
const SESSIONS = 'cerebro.agentSessions';

function sessions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSession(worktree: string, id: string | undefined): void {
  const all = Object.entries(sessions()).filter(([w]) => w !== worktree);
  if (id !== undefined) all.push([worktree, id]);
  localStorage.setItem(SESSIONS, JSON.stringify(Object.fromEntries(all)));
}

/** Listens to the host's agent statuses. */
export function setupAgents(
  onNotification: (listener: (method: string, params: unknown) => void) => () => void,
): void {
  onNotification((method, params) => {
    if (method !== 'agent.status') return;
    const { key, state, sessionId } = params as {
      key: string;
      state: AgentState;
      sessionId?: string;
    };
    if (!key.startsWith('claude:')) return;
    const worktree = key.slice('claude:'.length);
    agentStates.set(worktree, state);
    if (sessionId !== undefined) saveSession(worktree, sessionId);
  });
}

/** The agent's arguments: resuming its last session, if it had one. */
export function agentArgs(worktree: string): string[] {
  const id = sessions()[worktree];
  return id === undefined ? [] : ['--resume', id];
}

/**
 * The agent's process ended: it has no state. If it failed (say, its session was gone), it starts
 * a new session next time rather than failing again.
 */
export function agentEnded(worktree: string, exitCode: number): void {
  agentStates.delete(worktree);
  if (exitCode !== 0) saveSession(worktree, undefined);
}

/** A dot for the worktree's agent's state, on its environment tab; nothing without one. */
export function AgentBadge(props: { worktree: string }): () => Node | null {
  return () => {
    const state = agentStates.get(props.worktree);
    if (state === undefined) return null;
    return (
      <span
        class={`playground-agent playground-agent--${state}`}
        role="img"
        aria-label={LABELS[state]}
      />
    );
  };
}

/** The active worktree's agent's state, in words, for the status bar. */
export function agentText(worktree: string | undefined): string {
  const state = worktree === undefined ? undefined : agentStates.get(worktree);
  return state === undefined ? 'Claude' : LABELS[state];
}
