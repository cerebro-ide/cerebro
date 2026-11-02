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

  it('restores what an earlier run saved, after the tabs shown since', () => {
    const area = new EditorArea();
    const recent = new RecentTabs(area);
    area.open(tab('b'));
    recent.restore([tab('a'), tab('b'), { id: 'c', title: 'c', extra: 1 }, { id: 2 }, null, 'd']);
    expect(recent.tabs).toEqual([tab('b'), tab('a'), tab('c')]);
    recent.restore('not a list');
    recent.restore(Array.from({ length: MAX_RECENT + 5 }, (_, i) => tab(`x${String(i)}`)));
    expect(recent.tabs).toHaveLength(MAX_RECENT);
    expect(recent.tabs[0]).toEqual(tab('b'));
  });

  it('lists the files edited, the latest first, apart from those shown', () => {
    const area = new EditorArea();
    const recent = new RecentTabs(area);
    const ids = () => recent.edited.map((t) => t.id);
    area.open(tab('a'));
    recent.edit(tab('b'));
    recent.edit(tab('a'));
    recent.edit(tab('a'));
    expect(ids()).toEqual(['a', 'b']);
    // The same list while the first is edited again.
    const before = recent.edited;
    recent.edit(tab('a'));
    expect(recent.edited).toBe(before);
    recent.edit(tab('b'));
    expect(ids()).toEqual(['b', 'a']);
    expect(recent.tabs.map((t) => t.id)).toEqual(['a']);
    // Restored after those edited since; forgotten with the file.
    recent.restoreEdited([tab('c'), tab('b'), 'x']);
    expect(ids()).toEqual(['b', 'a', 'c']);
    recent.forget('b');
    expect(ids()).toEqual(['a', 'c']);
    for (let i = 0; i < MAX_RECENT + 3; i++) recent.edit(tab(String(i)));
    expect(recent.edited).toHaveLength(MAX_RECENT);
  });
});
