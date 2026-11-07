import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { periodText, pickUser, recentChoices, rememberChoice } from '../src/log-filters.js';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('a filter’s recent choices', () => {
  it('are the latest first, ten at most, each once, per filter and repository', () => {
    for (let i = 0; i < 12; i++) rememberChoice('/r', 'User', [`u${String(i)}`]);
    rememberChoice('/r', 'User', ['u5']);
    const recent = recentChoices('/r', 'User');
    expect(recent).toHaveLength(10);
    expect(recent.slice(0, 3)).toEqual([['u5'], ['u11'], ['u10']]);
    expect(recentChoices('/s', 'User')).toEqual([]);
  });

  it('are none when what’s kept can’t be read, and not kept when it can’t be written', () => {
    localStorage.setItem('cerebro.log.recent.User:/r', 'not JSON');
    expect(recentChoices('/r', 'User')).toEqual([]);
    localStorage.setItem('cerebro.log.recent.User:/r', '{"a":1}');
    expect(recentChoices('/r', 'User')).toEqual([]);
    localStorage.setItem('cerebro.log.recent.User:/r', '[["a"],[1],"b"]');
    expect(recentChoices('/r', 'User')).toEqual([['a']]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    rememberChoice('/r', 'User', ['c']);
    expect(recentChoices('/r', 'User')).toEqual([['a']]);
  });
});

describe('the Date filter’s text', () => {
  it('is since a day, until one, or from one to the other, as IntelliJ writes them', () => {
    const day = (time: number) =>
      new Date(time).toLocaleDateString(undefined, { dateStyle: 'short' });
    const a = new Date(2026, 0, 2).getTime();
    const b = new Date(2026, 0, 5).getTime();
    expect(periodText({ after: a })).toBe(`Since ${day(a)}`);
    expect(periodText({ before: b })).toBe(`Until ${day(b)}`);
    expect(periodText({ after: a, before: b })).toBe(`${day(a)}-${day(b)}`);
  });
});

describe('the User filter’s popup', () => {
  it('finds no one, and no "me", while the authors are still being read', async () => {
    const button = document.createElement('button');
    document.body.append(button);
    const handle = pickUser(button, {
      worktree: '/repo',
      authors: () => undefined,
      current: () => undefined,
      choose: () => undefined,
    });
    const labels = () =>
      [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);
    expect(labels()).toEqual(['Select…']);
    await userEvent.keyboard('m');
    expect(labels()).toEqual([]);
    handle.close();
    button.remove();
  });
});
