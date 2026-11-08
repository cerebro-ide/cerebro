import { describe, expect, it } from 'vitest';
import { formatPrettyDateTime, Notifications } from '../src/index.js';

describe('Notifications', () => {
  it('keeps every notification, newest first, as IntelliJ’s defaults say', () => {
    const notifications = new Notifications();
    const first = notifications.notify({ content: 'one' }, 1000);
    const second = notifications.notify(
      { title: 'Two', type: 'error', display: 'sticky', actions: [{ label: 'Go', run: () => 0 }] },
      2000,
    );
    expect(notifications.all.toArray()).toEqual([second, first]);
    expect(first).toMatchObject({
      title: '',
      content: 'one',
      type: 'information',
      display: 'balloon',
      time: 1000,
      group: undefined,
    });
    expect(first.actions).toEqual([]);
    expect(second).toMatchObject({ title: 'Two', type: 'error', display: 'sticky' });
    expect(first.balloon.get()).toBe(true);
    expect(notifications.notify({ display: 'none' }).balloon.get()).toBe(false);
  });

  it('are unread until marked read', () => {
    const notifications = new Notifications();
    const one = notifications.notify({ content: 'one' });
    expect(notifications.unread.get()).toEqual([one]);
    notifications.markAllRead();
    expect(notifications.unread.get()).toEqual([]);
    expect(one.read.get()).toBe(true);
  });

  it('closes the balloon of the last of a group', () => {
    const notifications = new Notifications();
    const first = notifications.notify({ content: 'one', group: 'commit' });
    const other = notifications.notify({ content: 'other' });
    const second = notifications.notify({ content: 'two', group: 'commit' });
    expect(first.balloon.get()).toBe(false);
    expect(other.balloon.get()).toBe(true);
    expect(second.balloon.get()).toBe(true);
  });

  it('clears them all, their balloons too', () => {
    const notifications = new Notifications();
    const one = notifications.notify({ content: 'one' });
    notifications.clear();
    expect(notifications.all.length).toBe(0);
    expect(one.balloon.get()).toBe(false);
  });
});

describe('formatPrettyDateTime', () => {
  const now = new Date(2026, 10, 8, 14, 30).getTime();
  const minutes = (n: number) => now - n * 60_000;
  const clock = (time: number) =>
    new Date(time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  it('says how long ago, within the last hour and a minute, in IntelliJ’s words', () => {
    expect(formatPrettyDateTime(now, now)).toBe('Moments ago');
    expect(formatPrettyDateTime(minutes(1), now)).toBe('A minute ago');
    expect(formatPrettyDateTime(minutes(5), now)).toBe('5 minutes ago');
    expect(formatPrettyDateTime(minutes(60), now)).toBe('1 hour ago');
    expect(formatPrettyDateTime(minutes(61), now)).toBe('1 hour ago');
  });

  it('names today and yesterday, then gives the date', () => {
    expect(formatPrettyDateTime(minutes(62), now)).toBe(`Today ${clock(minutes(62))}`);
    const yesterday = new Date(2026, 10, 7, 9, 0).getTime();
    expect(formatPrettyDateTime(yesterday, now)).toBe(`Yesterday ${clock(yesterday)}`);
    const before = new Date(2026, 10, 1, 9, 0).getTime();
    expect(formatPrettyDateTime(before, now)).toBe(
      new Date(before).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }),
    );
    // Later than now (a clock that stepped back): as a date.
    expect(formatPrettyDateTime(now + 60_000, now)).toBe(`Today ${clock(now + 60_000)}`);
  });
});
