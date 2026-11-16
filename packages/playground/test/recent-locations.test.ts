import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { LIMIT, linesAround, locations, setupRecentLocations } from '../src/recent-locations.js';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${String(i)}`);
const place = (id: string, line?: number) => ({
  tab: { id, title: id },
  ...(line === undefined ? {} : { at: { line, column: 0 } }),
});

describe('linesAround', () => {
  it('gives 2 lines before and after, more on the other side near either end, as IntelliJ’s', () => {
    expect(linesAround(lines(20), 10)).toEqual([8, 12]);
    expect(linesAround(lines(20), 0)).toEqual([0, 4]);
    expect(linesAround(lines(20), 1)).toEqual([0, 4]);
    // IntelliJ's `lineCount - line`: the last line has 3 before it.
    expect(linesAround(lines(20), 19)).toEqual([16, 19]);
    expect(linesAround(lines(3), 1)).toEqual([0, 2]);
  });

  it('leaves out blank lines at either end, and gives nothing when all are', () => {
    expect(linesAround(['', '  ', 'a', 'b', '', 'c', ''], 3)).toEqual([2, 5]);
    expect(linesAround(['a', 'b', 'c', '', ' '], 1)).toEqual([0, 2]);
    expect(linesAround(['', ' ', '', '', ''], 2)).toBeUndefined();
    expect(linesAround([''], 0)).toBeUndefined();
  });
});

describe('locations', () => {
  it('lists the latest first, a place near one listed once, without those with no caret', () => {
    const listed = locations([place('a', 10), place('b', 1), place('a', 12), place('d')]);
    expect(listed.map((p) => `${p.tab.id}:${String(p.at?.line)}`)).toEqual(['a:12', 'b:1']);
  });

  it('lists up to 25, as IntelliJ’s', () => {
    const many = Array.from({ length: 40 }, (_, i) => place(`f${String(i)}`, 0));
    expect(locations(many)).toHaveLength(LIMIT);
    expect(LIMIT).toBe(25);
    expect(locations(many)[0]?.tab.id).toBe('f39');
  });
});

describe('Recent Locations’ command', () => {
  it('lists none with no environment, without a key, and closes with nothing chosen', async () => {
    const commands = new CommandRegistry();
    setupRecentLocations({ commands, menus: new MenuRegistry() });
    void commands.execute('view.recentLocations');
    const popup = await vi.waitUntil(() => document.querySelector('.cerebro-popup'));
    expect(popup.textContent).toContain('No recent locations found');
    // No keymap: no key beside Show edited only.
    expect(document.querySelector('.playground-locations__header')?.textContent).toBe(
      'Recent Locations(0)Show edited only',
    );
    // Delete with nothing listed does nothing.
    await userEvent.keyboard('{Delete}');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
  });
});
