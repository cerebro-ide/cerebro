import { render } from '@cerebro-ide/jsx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  BALLOON_TIME,
  NotificationBalloons,
  Notifications,
  NotificationsTimeline,
  notificationIcon,
} from '../src/index.js';
import '../src/styles.css';

let disposeView: (() => void) | undefined;
afterEach(() => {
  disposeView?.();
  disposeView = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(view: () => Node): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = render(view, host);
  disposeView = () => {
    handle.dispose();
    host.remove();
  };
  return host;
}

const texts = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll(selector)].map((e) => e.textContent);

describe('notificationIcon', () => {
  it('is IntelliJ’s, by type', () => {
    for (const type of ['information', 'warning', 'error'] as const) {
      const icon = notificationIcon(type) as SVGElement;
      expect(icon.classList).toContain(`cerebro-notification-icon--${type}`);
    }
    expect((notificationIcon('warning') as SVGElement).querySelector('circle')).toBeNull();
  });
});

describe('NotificationBalloons', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  it('shows the balloons, newest lowest, until they fade', () => {
    const notifications = new Notifications();
    const root = mount(() => <NotificationBalloons notifications={notifications} />);
    notifications.notify({ title: 'First', content: 'one' });
    vi.advanceTimersByTime(4000);
    notifications.notify({ content: 'two', type: 'warning' });
    notifications.notify({ content: 'hidden', display: 'none' });
    expect(texts(root, '.cerebro-notification__content')).toEqual(['one', 'two']);
    expect(texts(root, '.cerebro-notification__title')).toEqual(['First']);
    // The first's time isn't started again by the second.
    vi.advanceTimersByTime(BALLOON_TIME.balloon - 4000);
    expect(texts(root, '.cerebro-notification__content')).toEqual(['two']);
    vi.advanceTimersByTime(4000);
    expect(root.querySelector('.cerebro-balloon')).toBeNull();
  });

  it('keeps a sticky one five minutes', () => {
    const notifications = new Notifications();
    const root = mount(() => <NotificationBalloons notifications={notifications} />);
    notifications.notify({ content: 'sticky', display: 'sticky' });
    vi.advanceTimersByTime(BALLOON_TIME.balloon);
    expect(root.querySelector('.cerebro-balloon')).not.toBeNull();
    vi.advanceTimersByTime(BALLOON_TIME.sticky - BALLOON_TIME.balloon);
    expect(root.querySelector('.cerebro-balloon')).toBeNull();
  });

  it('starts their time once the window is active', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const notifications = new Notifications();
    const root = mount(() => <NotificationBalloons notifications={notifications} />);
    notifications.notify({ content: 'away' });
    vi.advanceTimersByTime(BALLOON_TIME.balloon * 2);
    expect(root.querySelector('.cerebro-balloon')).not.toBeNull();
    window.dispatchEvent(new FocusEvent('focus'));
    vi.advanceTimersByTime(BALLOON_TIME.balloon);
    expect(root.querySelector('.cerebro-balloon')).toBeNull();
  });

  it('holds one while the pointer is over it', () => {
    const notifications = new Notifications();
    const root = mount(() => <NotificationBalloons notifications={notifications} />);
    notifications.notify({ content: 'held' });
    const balloon = root.querySelector('.cerebro-balloon') as HTMLElement;
    balloon.dispatchEvent(new PointerEvent('pointerenter'));
    vi.advanceTimersByTime(BALLOON_TIME.balloon * 2);
    expect(balloon.isConnected).toBe(true);
    balloon.dispatchEvent(new PointerEvent('pointerleave'));
    vi.advanceTimersByTime(BALLOON_TIME.balloon);
    expect(balloon.isConnected).toBe(false);
  });

  it('closes one with its button or a link, which runs its action', async () => {
    vi.useRealTimers();
    const notifications = new Notifications();
    const root = mount(() => <NotificationBalloons notifications={notifications} />);
    const run = vi.fn();
    notifications.notify({ content: 'one' });
    notifications.notify({ content: 'two', actions: [{ label: 'Show', run }] });
    await userEvent.click(root.querySelector('.cerebro-notification__action') as HTMLElement);
    expect(run).toHaveBeenCalledOnce();
    expect(texts(root, '.cerebro-notification__content')).toEqual(['one']);
    const balloon = root.querySelector('.cerebro-balloon') as HTMLElement;
    await userEvent.hover(balloon);
    await userEvent.click(root.querySelector('.cerebro-balloon__close') as HTMLElement);
    expect(root.querySelector('.cerebro-balloon')).toBeNull();
  });

  it('closes them when it goes', () => {
    const notifications = new Notifications();
    mount(() => <NotificationBalloons notifications={notifications} />);
    const one = notifications.notify({ content: 'one' });
    disposeView?.();
    disposeView = undefined;
    vi.advanceTimersByTime(BALLOON_TIME.balloon);
    // Its time stopped with it.
    expect(one.balloon.get()).toBe(true);
  });
});

describe('NotificationsTimeline', () => {
  it('says what will show while there’s nothing, as IntelliJ’s', () => {
    const root = mount(() => <NotificationsTimeline notifications={new Notifications()} />);
    expect(texts(root, '.cerebro-notifications__empty span')).toEqual([
      'Suggestions, events,',
      'and errors will appear here',
    ]);
  });

  it('lists them, newest first, with when they came, the new ones marked', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 8, 14, 0));
    const notifications = new Notifications();
    notifications.notify({ title: '2 files committed', content: 'Fix it' });
    notifications.markAllRead();
    const root = mount(() => <NotificationsTimeline notifications={notifications} />);
    notifications.notify({ content: 'No title', type: 'error' });
    expect(texts(root, '.cerebro-notifications__heading')).toEqual(['Timeline']);
    expect(texts(root, '.cerebro-notification__content')).toEqual(['No title', 'Fix it']);
    expect(texts(root, '.cerebro-notification__time')).toEqual(['Moments ago', 'Moments ago']);
    const rows = [...root.querySelectorAll('.cerebro-notification')];
    expect(rows.map((r) => r.classList.contains('cerebro-notification--new'))).toEqual([
      true,
      false,
    ]);
    vi.advanceTimersByTime(5 * 60_000);
    expect(texts(root, '.cerebro-notification__time')).toEqual(['5 minutes ago', '5 minutes ago']);
    notifications.markAllRead();
    expect(root.querySelector('.cerebro-notification--new')).toBeNull();
  });

  it('shows a title alone', () => {
    const notifications = new Notifications();
    notifications.notify({ title: 'Commit canceled' });
    const root = mount(() => <NotificationsTimeline notifications={notifications} />);
    expect(texts(root, '.cerebro-notification__title')).toEqual(['Commit canceled']);
    expect(root.querySelector('.cerebro-notification__content')).toBeNull();
  });

  it('clears them all', async () => {
    const notifications = new Notifications();
    notifications.notify({ content: 'one' });
    const root = mount(() => <NotificationsTimeline notifications={notifications} />);
    await userEvent.click(
      root.querySelector('.cerebro-notifications__header button') as HTMLElement,
    );
    expect(notifications.all.length).toBe(0);
    expect(root.querySelector('.cerebro-notifications__empty')).not.toBeNull();
  });
});
