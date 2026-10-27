import { describe, expect, it } from 'vitest';
import { EditorArea, MAX_RECENT, RecentTabs } from '../src/index.js';

const tab = (id: string) => ({ id, title: id });

describe('RecentTabs', () => {
  it('lists the tabs shown, the latest first, closed ones too', () => {
    const area = new EditorArea();
    const recent = new RecentTabs(area);
    const ids = () => recent.tabs.map((t) => t.id);
    expect(ids()).toEqual([]);
    area.open(tab('a'));
    area.open(tab('b'));
    area.open(tab('a'));
    expect(ids()).toEqual(['a', 'b']);
    area.close(area.activeGroupId, 'a');
    expect(ids()).toEqual(['b', 'a']);
    area.close(area.activeGroupId, 'b');
    expect(ids()).toEqual(['b', 'a']);
    recent.forget('a');
    expect(ids()).toEqual(['b']);
    recent.dispose();
    area.open(tab('c'));
    expect(ids()).toEqual(['b']);
  });

  it('keeps the latest only', () => {
    const area = new EditorArea();
    const recent = new RecentTabs(area);
    for (let i = 0; i < MAX_RECENT + 3; i++) area.open(tab(String(i)));
    expect(recent.tabs).toHaveLength(MAX_RECENT);
    expect(recent.tabs[0]?.id).toBe(String(MAX_RECENT + 2));
  });
});
