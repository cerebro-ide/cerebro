import { effect } from '@cerebro-ide/reactive';
import { describe, expect, it } from 'vitest';
import { Layout, MAX_SPLIT, MIN_AREA_SIZE, MIN_SPLIT, ToolWindows } from '../src/index.js';

function setup() {
  const tools = new ToolWindows();
  tools.register({ id: 'project', title: 'Project', anchor: 'left', icon: 'folder' });
  tools.register({ id: 'structure', title: 'Structure', anchor: 'left', slot: 'secondary' });
  tools.register({ id: 'commit', title: 'Commit', anchor: 'left' });
  tools.register({ id: 'terminal', title: 'Terminal', anchor: 'bottom' });
  return tools;
}

describe('ToolWindows', () => {
  it('registers windows, primary slot by default', () => {
    const tools = setup();
    const project = tools.windows.get('project');
    expect(project?.slot).toBe('primary');
    expect(project?.icon).toBe('folder');
    expect(tools.windows.get('terminal')?.icon).toBeUndefined();
    expect(() => tools.register({ id: 'project', title: 'x', anchor: 'right' })).toThrow(
      'already registered',
    );
  });

  it('lists a stripe: primary slot first, then secondary, in registration order', () => {
    const tools = setup();
    expect(tools.stripe('left').map((w) => w.id)).toEqual(['project', 'commit', 'structure']);
    expect(tools.stripe('right')).toEqual([]);
  });

  it('shows one window per slot, replacing the one there', () => {
    const tools = setup();
    tools.show('project');
    tools.show('structure');
    expect(tools.areas.left.primary).toBe('project');
    expect(tools.areas.left.secondary).toBe('structure');
    tools.show('commit');
    expect(tools.isVisible('project')).toBe(false);
    expect(tools.isVisible('commit')).toBe(true);
    expect(tools.isVisible('structure')).toBe(true);
  });

  it('hides and toggles', () => {
    const tools = setup();
    tools.toggle('terminal');
    expect(tools.areas.bottom.open).toBe(true);
    tools.toggle('terminal');
    expect(tools.areas.bottom.open).toBe(false);
    tools.show('project');
    tools.hide('commit');
    expect(tools.isVisible('project')).toBe(true);
  });

  it('treats unknown windows as hidden, and rejects showing them', () => {
    const tools = setup();
    expect(tools.isVisible('nope')).toBe(false);
    tools.hide('nope');
    expect(() => {
      tools.show('nope');
    }).toThrow('Unknown tool window');
  });

  it('moves windows, keeping visibility', () => {
    const tools = setup();
    tools.show('project');
    tools.move('project', 'right', 'secondary');
    expect(tools.areas.left.open).toBe(false);
    expect(tools.areas.right.secondary).toBe('project');
    tools.move('terminal', 'top');
    expect(tools.isVisible('terminal')).toBe(false);
    expect(tools.stripe('top').map((w) => w.id)).toEqual(['terminal']);
  });

  it('unregisters, hiding first', () => {
    const tools = setup();
    tools.show('terminal');
    tools.unregister('terminal');
    expect(tools.areas.bottom.open).toBe(false);
    expect(tools.windows.has('terminal')).toBe(false);
  });

  it('clamps area sizes and splits', () => {
    const { left } = setup().areas;
    left.resize(10);
    expect(left.size).toBe(MIN_AREA_SIZE);
    left.resize(300.6);
    expect(left.size).toBe(301);
    left.setSplit(0);
    expect(left.split).toBe(MIN_SPLIT);
    left.setSplit(1);
    expect(left.split).toBe(MAX_SPLIT);
    left.setSplit(0.3);
    expect(left.split).toBe(0.3);
  });

  it('has four areas', () => {
    expect(Object.keys(new Layout().toolWindows.areas)).toEqual(['left', 'right', 'top', 'bottom']);
  });

  it('is reactive: queries update in effects', () => {
    const tools = setup();
    const seen: string[] = [];
    effect(() => {
      seen.push(
        `${String(tools.isVisible('project'))}:${tools
          .stripe('right')
          .map((w) => w.id)
          .join(',')}`,
      );
      return undefined;
    });
    tools.show('project');
    tools.move('commit', 'right');
    expect(seen).toEqual(['false:', 'true:', 'true:commit']);
  });
});
