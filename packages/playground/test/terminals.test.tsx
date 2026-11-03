import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { agentArgs, agentStates } from '../src/agents.js';
import { useProjects } from '../src/environments.js';
import {
  agentTerminal,
  closeTerminals,
  Shells,
  setLastShellClosed,
  setTerminalKeys,
  shellsFor,
} from '../src/terminals.js';
import { FakeHost, project } from './fakes.js';

type Bridge = NonNullable<Window['cerebro']>;
type Notify = (project: string, method: string, params: unknown) => void;

/** The desktop app's hosts, by project: each answers as its FakeHost says. */
const hosts = new Map<string, FakeHost>();
const listeners = new Set<Notify>();
let ids = 0;
const terminalHost = () =>
  new FakeHost({
    'terminal.open': () => ({ id: ++ids, buffer: 'started\r\n' }),
    'terminal.write': () => null,
    'terminal.resize': () => null,
    'terminal.close': () => null,
  });
const bridge = {
  platform: 'linux',
  host: {
    request: (path: string, method: string, params?: unknown) =>
      (hosts.get(path) as FakeHost).request(method, params),
    onNotification: (listener: Notify) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
} as unknown as Bridge;
const notify: Notify = (from, method, params) => {
  for (const listener of listeners) listener(from, method, params);
};

beforeAll(() => {
  hosts.set('/r', terminalHost());
  hosts.set('/s', terminalHost());
  useProjects([
    project('/r', undefined, [
      { id: '/r', branch: 'main' },
      { id: '/r/w', branch: 'w' },
    ]),
    project('/s', undefined),
  ]);
});

afterEach(() => {
  document.body.replaceChildren();
  delete window.cerebro;
  localStorage.clear();
  vi.restoreAllMocks();
});

const host = (path: string) => hosts.get(path) as FakeHost;

/** A terminal's view, shown so it opens its process; the params it opened with. */
async function shown(element: HTMLElement, path = '/r'): Promise<unknown> {
  const box = document.createElement('div');
  box.style.width = '600px';
  box.style.height = '300px';
  box.style.display = 'flex';
  element.style.flex = '1';
  box.append(element);
  document.body.append(box);
  const before = host(path).params('terminal.open').length;
  await expect.poll(() => host(path).params('terminal.open').length).toBe(before + 1);
  return host(path).params('terminal.open').at(-1);
}

describe('the agent’s terminal', () => {
  it('is only in the desktop app, for a worktree of a project open', () => {
    expect(agentTerminal('/r')).toBeUndefined();
    window.cerebro = bridge;
    expect(agentTerminal('/elsewhere')).toBeUndefined();
  });

  it('runs claude in the worktree, resuming its session, the same view each time', async () => {
    window.cerebro = bridge;
    localStorage.setItem('cerebro.agentSessions', JSON.stringify({ '/r/w': 's1' }));
    const view = agentTerminal('/r/w');
    expect(agentTerminal('/r/w')).toBe(view);
    expect(await shown(view?.element as HTMLElement)).toMatchObject({
      key: 'claude:/r/w',
      cwd: '/r/w',
      command: 'claude',
      args: ['--resume', 's1'],
      agent: true,
    });
    const id = ids;
    // Output of the same id from another project's host is that project's terminal's.
    notify('/s', 'terminal.data', { id, data: 'not mine' });
    notify('/r', 'terminal.data', { id, data: 'hello' });
    await expect.poll(() => view?.text()).toBe('started\nhello');
    agentStates.set('/r/w', 'working');
    notify('/s', 'terminal.exit', { id, exitCode: 1 });
    expect(agentStates.get('/r/w')).toBe('working');
    // A failed agent starts a new session next time.
    notify('/r', 'terminal.exit', { id, exitCode: 1 });
    expect(agentStates.has('/r/w')).toBe(false);
    expect(agentArgs('/r/w')).toEqual([]);
    closeTerminals('/r/w');
    expect(agentTerminal('/r/w')).not.toBe(view);
    closeTerminals('/r/w');
  });

  it('sends what’s typed and its size to the host, and lets the app’s shortcuts through', async () => {
    window.cerebro = bridge;
    const passed: string[] = [];
    setTerminalKeys((event) => {
      if (event.key === 'F12') passed.push(event.key);
      return event.key === 'F12';
    });
    const view = agentTerminal('/r') as NonNullable<ReturnType<typeof agentTerminal>>;
    await shown(view.element);
    view.focus();
    await userEvent.keyboard('{F12}x');
    expect(passed).toEqual(['F12']);
    await expect
      .poll(() =>
        host('/r')
          .params('terminal.write')
          .map((p) => (p as { data: string }).data),
      )
      .toEqual(['x']);
    // A size of its own once it's open.
    (view.element.parentElement as HTMLElement).style.width = '400px';
    await expect.poll(() => host('/r').params('terminal.resize').length).toBe(1);
    // A request that fails is logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hosts.set('/r', new FakeHost({}));
    await userEvent.keyboard('y');
    await expect.poll(() => logged.mock.calls[0]?.[0] as unknown).toBe('terminal.write failed');
    hosts.set('/r', terminalHost());
    closeTerminals('/r');
  });
});

describe('a worktree’s shells', () => {
  it('are numbered with the lowest number free, titled as IntelliJ titles them', () => {
    const shells = new Shells('/t1', () => undefined);
    expect([shells.numbers, shells.active]).toEqual([[1], 1]);
    shells.add();
    shells.add();
    shells.close(2);
    shells.add();
    expect([shells.numbers, shells.active]).toEqual([[1, 3, 2], 2]);
    expect(shells.numbers.map((n) => shells.titleOf(n))).toEqual([
      'Local',
      'Local (3)',
      'Local (2)',
    ]);
    shells.rename(3, 'build');
    expect(shells.titleOf(3)).toBe('build');
    // A number closed and opened again is a new tab, with its number's title.
    shells.close(3);
    shells.add();
    expect(shells.titleOf(3)).toBe('Local (3)');
    shells.close(9);
    expect(shells.numbers).toEqual([1, 2, 3]);
  });

  it('show the next tab when the active one closes, or the one before at the end', () => {
    const shells = new Shells('/t2', () => undefined);
    shells.add();
    shells.add();
    shells.select(2);
    shells.close(2);
    expect(shells.active).toBe(3);
    shells.close(3);
    expect(shells.active).toBe(1);
    shells.add();
    shells.select(1);
    shells.close(2);
    expect(shells.active).toBe(1);
  });

  it('open a new one when the last closes, and say so', () => {
    let closed = 0;
    const shells = new Shells('/t3', () => closed++);
    shells.rename(1, 'mine');
    shells.close(1);
    expect([shells.numbers, shells.active, closed, shells.titleOf(1)]).toEqual([
      [1],
      1,
      1,
      'Local',
    ]);
    let hidden = 0;
    setLastShellClosed(() => hidden++);
    const kept = shellsFor('/t3');
    expect(shellsFor('/t3')).toBe(kept);
    kept.close(1);
    expect(hidden).toBe(1);
  });

  it('are kept between runs, unless storage can’t be read or written', () => {
    const shells = new Shells('/t4', () => undefined);
    shells.add();
    shells.rename(2, 'tests');
    new Shells('/t5', () => undefined).add();
    const again = new Shells('/t4', () => undefined);
    expect([again.numbers, again.active, again.titleOf(2)]).toEqual([[1, 2], 2, 'tests']);
    // An active tab that isn't there is the first.
    localStorage.setItem(
      'cerebro.terminals',
      JSON.stringify({ '/t4': { numbers: [4, 5], active: 9 }, '/t6': { numbers: [], active: 1 } }),
    );
    expect(new Shells('/t4', () => undefined).active).toBe(4);
    expect(new Shells('/t6', () => undefined).numbers).toEqual([1]);
    localStorage.setItem('cerebro.terminals', '{unreadable');
    expect(new Shells('/t4', () => undefined).numbers).toEqual([1]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const unsaved = new Shells('/t7', () => undefined);
    unsaved.add();
    expect(unsaved.numbers).toEqual([1, 2]);
  });

  it('run each tab’s shell, which closes its tab when it ends, and end them all', async () => {
    window.cerebro = bridge;
    const shells = shellsFor('/s');
    shells.add();
    expect(shells.view(1)).toBe(shells.view(1));
    expect(await shown(shells.view(1)?.element as HTMLElement, '/s')).toMatchObject({
      key: 'shell:/s:1',
      cwd: '/s',
    });
    const first = ids;
    await shown(shells.view(2)?.element as HTMLElement, '/s');
    notify('/s', 'terminal.exit', { id: first, exitCode: 0 });
    expect(shells.numbers).toEqual([2]);
    localStorage.setItem(
      'cerebro.terminals',
      JSON.stringify({ '/s': { numbers: [2], active: 2 } }),
    );
    closeTerminals('/s');
    expect(host('/s').params('terminal.close')).toEqual([{ id: ids }]);
    expect(localStorage.getItem('cerebro.terminals')).toBe('{}');
    expect(shellsFor('/s')).not.toBe(shells);
  });
});
