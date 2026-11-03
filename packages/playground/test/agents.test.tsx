import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AgentBadge,
  agentArgs,
  agentEnded,
  agentKey,
  agentStates,
  agentText,
  setupAgents,
} from '../src/agents.js';

let notify: (method: string, params: unknown) => void = () => undefined;

beforeAll(() => {
  setupAgents((listener) => {
    notify = listener;
    return () => undefined;
  });
});

afterEach(() => {
  agentStates.clear();
  localStorage.clear();
  document.body.replaceChildren();
});

const status = (key: string, state: string, sessionId?: string) => {
  notify('agent.status', { key, state, ...(sessionId === undefined ? {} : { sessionId }) });
};

describe('a worktree’s agent', () => {
  it('has the Claude tool window’s terminal', () => {
    expect(agentKey('/r/w')).toBe('claude:/r/w');
  });

  it('takes its state from the host’s statuses for its terminal, and only those', () => {
    status('claude:/r/w', 'working');
    status('shell:/r/w', 'done');
    notify('terminal.exit', { key: 'claude:/r/w', state: 'done' });
    expect(agentStates.get('/r/w')).toBe('working');
    expect(agentText('/r/w')).toBe('Claude is working');
    status('claude:/r/w', 'waiting');
    expect(agentText('/r/w')).toBe('Claude is waiting for you');
    expect(agentText('/r/other')).toBe('Claude');
    expect(agentText(undefined)).toBe('Claude');
  });

  it('resumes its last session, unless it failed', () => {
    expect(agentArgs('/r/w')).toEqual([]);
    status('claude:/r/w', 'working', 's1');
    status('claude:/r/v', 'working', 'v1');
    status('claude:/r/w', 'done', 's2');
    status('claude:/r/w', 'done');
    expect(agentArgs('/r/w')).toEqual(['--resume', 's2']);
    agentEnded('/r/w', 0);
    expect(agentStates.has('/r/w')).toBe(false);
    expect(agentArgs('/r/w')).toEqual(['--resume', 's2']);
    agentEnded('/r/w', 1);
    expect(agentArgs('/r/w')).toEqual([]);
    expect(agentArgs('/r/v')).toEqual(['--resume', 'v1']);
  });

  it('starts anew where the sessions saved can’t be read', () => {
    localStorage.setItem('cerebro.agentSessions', '{unreadable');
    expect(agentArgs('/r/w')).toEqual([]);
  });

  it('shows its state as a dot on its tab, and nothing without one', () => {
    const handle = render(() => <AgentBadge worktree="/r/w" />, document.body);
    expect(document.querySelector('.playground-agent')).toBeNull();
    status('claude:/r/w', 'done');
    const dot = document.querySelector('.playground-agent') as HTMLElement;
    expect([dot.className, dot.getAttribute('aria-label')]).toEqual([
      'playground-agent playground-agent--done',
      'Claude is done',
    ]);
    handle.dispose();
  });
});
