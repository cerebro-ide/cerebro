import { Environments, ToolWindows } from '@cerebro-ide/layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreLayout, saveLayout } from '../src/persist.js';

const KEY = 'cerebro.test.layout';

function parts() {
  const tools = new ToolWindows();
  tools.register({ id: 'project', title: 'Project', anchor: 'left' });
  const workspace = new Environments();
  return {
    key: KEY,
    tools,
    workspace,
    resolve: (spec: { id: string; name: string; branch: string }) =>
      spec.id === 'gone' ? undefined : spec,
    keepTab: (tab: { id: string }) => tab.id !== 'deleted.ts',
  };
}

afterEach(() => {
  localStorage.removeItem(KEY);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the layout between runs', () => {
  it('is saved shortly after a change, and restored with what still exists', async () => {
    vi.useFakeTimers();
    const before = parts();
    saveLayout(before);
    const env = before.workspace.openOrActivate({ id: 'main', name: 'main', branch: 'main' });
    before.workspace.openOrActivate({ id: 'gone', name: 'gone', branch: 'gone' });
    env.editor.open({ id: 'kept.ts', title: 'kept.ts' });
    env.editor.open({ id: 'deleted.ts', title: 'deleted.ts' });
    before.tools.show('project');
    await vi.advanceTimersByTimeAsync(199);
    expect(localStorage.getItem(KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();

    const after = parts();
    expect(restoreLayout(after)).toBe(true);
    expect(after.workspace.open.map((e) => e.id)).toEqual(['main']);
    const tabs = after.workspace.open[0]?.editor.activeGroup.tabs.map((t) => t.id);
    expect(tabs).toEqual(['kept.ts']);
    expect(after.tools.isVisible('project')).toBe(true);
  });

  it('is saved at once when the page goes away', () => {
    vi.useFakeTimers();
    const layout = parts();
    saveLayout(layout);
    layout.tools.show('project');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    // Nothing more to write: the timer's write finds nothing pending.
    const set = vi.spyOn(Storage.prototype, 'setItem');
    vi.advanceTimersByTime(200);
    expect(set).not.toHaveBeenCalled();
  });

  it('is just not kept when the storage refuses it', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    const layout = parts();
    saveLayout(layout);
    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the defaults with nothing saved, or what was saved unreadable', () => {
    expect(restoreLayout(parts())).toBe(false);
    localStorage.setItem(KEY, '{not json');
    expect(restoreLayout(parts())).toBe(false);
  });
});
