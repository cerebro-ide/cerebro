import { describe, expect, it, vi } from 'vitest';
import { EditorArea, MAX_PLACES, NavigationHistory, type Position } from '../src/index.js';

const tab = (id: string) => ({ id, title: id });

/** An area with a history, carets set by hand, and the places revealed. */
function setup() {
  const area = new EditorArea();
  const carets = new Map<string, Position>();
  const reveal = vi.fn();
  const history = new NavigationHistory(area, (id) => carets.get(id), reveal);
  const at = (id: string, line: number) => {
    carets.set(id, { line, column: 0 });
  };
  const back = () => history.back.map((p) => `${p.tab.id}:${String(p.at?.line)}`);
  const forward = () => history.forward.map((p) => `${p.tab.id}:${String(p.at?.line)}`);
  return { area, history, reveal, at, back, forward };
}

describe('NavigationHistory', () => {
  it('remembers the place left as another tab becomes active, with its caret', () => {
    const { area, history, at, back } = setup();
    area.open(tab('a'));
    at('a', 3);
    area.open(tab('b'));
    expect(back()).toEqual(['a:3']);
    expect(history.canGoBack).toBe(true);
    expect(history.canGoForward).toBe(false);
  });

  it('goes back to the place left, and forward again', () => {
    const { area, history, reveal, at, back, forward } = setup();
    area.open(tab('a'));
    at('a', 3);
    area.open(tab('b'));
    at('b', 7);
    history.goBack();
    expect(area.activeGroup.active).toBe('a');
    expect(reveal).toHaveBeenLastCalledWith({ tab: tab('a'), at: { line: 3, column: 0 } });
    // Going back isn't leaving a place.
    expect(back()).toEqual([]);
    expect(forward()).toEqual(['b:7']);
    history.goForward();
    expect(area.activeGroup.active).toBe('b');
    expect(reveal).toHaveBeenLastCalledWith({ tab: tab('b'), at: { line: 7, column: 0 } });
    expect(back()).toEqual(['a:3']);
    expect(forward()).toEqual([]);
  });

  it('remembers jumps within a file, as the caller records them', () => {
    const { area, history, reveal, at, back, forward } = setup();
    area.open(tab('a'));
    at('a', 3);
    history.record();
    at('a', 40);
    history.goBack();
    expect(reveal).toHaveBeenLastCalledWith({ tab: tab('a'), at: { line: 3, column: 0 } });
    expect(forward()).toEqual(['a:40']);
    // Going somewhere new forgets what was ahead.
    history.record();
    expect(forward()).toEqual([]);
    expect(back()).toEqual(['a:40']);
  });

  it('remembers a place once, however often it’s left', () => {
    const { area, history, at, back } = setup();
    area.open(tab('a'));
    at('a', 3);
    history.record();
    area.open(tab('b'));
    expect(back()).toEqual(['a:3']);
  });

  it('keeps the latest places only', () => {
    const { area, history, at } = setup();
    area.open(tab('a'));
    for (let line = 0; line < MAX_PLACES + 5; line++) {
      at('a', line);
      history.record();
    }
    expect(history.back).toHaveLength(MAX_PLACES);
    expect(history.back[0]?.at?.line).toBe(5);
  });

  it('does nothing with nowhere to go, or nothing open', () => {
    const { area, history, reveal, at, back, forward } = setup();
    history.goBack();
    history.goForward();
    history.record();
    expect(history.current()).toBeUndefined();
    expect(reveal).not.toHaveBeenCalled();
    // Back from no tab: nothing to come forward to.
    area.open(tab('a'));
    at('a', 1);
    history.record();
    area.close(area.activeGroupId, 'a');
    history.goBack();
    expect(area.activeGroup.active).toBe('a');
    expect(back()).toEqual([]);
    expect(forward()).toEqual([]);
    // Forward with no tab: nothing to go back to.
    area.open(tab('b'));
    history.goBack();
    area.close(area.activeGroupId, 'b');
    area.close(area.activeGroupId, 'a');
    history.goForward();
    expect(area.activeGroup.active).toBe('b');
    expect(back()).toEqual([]);
  });

  it('stops following the area once disposed', () => {
    const { area, history, back } = setup();
    area.open(tab('a'));
    history.dispose();
    area.open(tab('b'));
    expect(back()).toEqual([]);
  });

  it('remembers a diff, which has no caret', () => {
    const { area, history, reveal } = setup();
    area.open(tab('diff'));
    area.open(tab('a'));
    history.goBack();
    expect(reveal).toHaveBeenLastCalledWith({ tab: tab('diff'), at: undefined });
  });
});
