// Notifications, as IntelliJ's (NotificationsManagerImpl, ApplicationNotificationsModel, read in
// its source): each is kept in the Notifications tool window's timeline, newest first, unread until
// the window was open, and shows as a balloon as it comes, unless it says not to. A balloon fades
// after 10 seconds, a sticky one after 5 minutes, as IntelliJ's (NotificationDisplayType), or when
// closed; a notification of a group closes the last one's balloon, as IntelliJ's
// expirePreviousAndNotify. One that no longer applies is expired: gone, balloon and all.

import {
  computed,
  ObservableArray,
  signal,
  type Computed,
  type Signal,
} from '@cerebro-ide/reactive';

/** How much it matters: IntelliJ's information, warning and error. */
export type NotificationType = 'information' | 'warning' | 'error';

/** A link under its text, as IntelliJ's notification actions. */
export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface NotificationSpec {
  /** Its first line, in bold. */
  title?: string;
  content?: string;
  /** Default: information. */
  type?: NotificationType;
  actions?: readonly NotificationAction[];
  /**
   * How it shows as it comes, as IntelliJ's display types: a balloon that fades (the default), one
   * that stays a while (sticky), or none, only in the tool window.
   */
  display?: 'balloon' | 'sticky' | 'none';
  /** Notifications of a group replace each other's balloons. */
  group?: string;
}

/** How long a balloon shows, in milliseconds: IntelliJ's. */
export const BALLOON_TIME = { balloon: 10_000, sticky: 300_000 } as const;

export class Notification {
  readonly title: string;
  readonly content: string;
  readonly type: NotificationType;
  readonly actions: readonly NotificationAction[];
  readonly display: 'balloon' | 'sticky' | 'none';
  readonly group: string | undefined;
  /** When it came, in milliseconds since the epoch. */
  readonly time: number;
  /** Whether it was seen in the tool window. */
  readonly read: Signal<boolean> = signal(false);
  /** Whether its balloon shows. */
  readonly balloon: Signal<boolean>;

  constructor(spec: NotificationSpec, time: number) {
    this.title = spec.title ?? '';
    this.content = spec.content ?? '';
    this.type = spec.type ?? 'information';
    this.actions = spec.actions ?? [];
    this.display = spec.display ?? 'balloon';
    this.group = spec.group;
    this.time = time;
    this.balloon = signal(this.display !== 'none');
  }
}

export class Notifications {
  /** Every notification, newest first. */
  readonly all = new ObservableArray<Notification>();
  /** The ones not seen yet; read reactively. */
  readonly unread: Computed<Notification[]> = computed(() =>
    this.all.toArray().filter((n) => !n.read.get()),
  );

  /** Adds a notification, shown as it says; `now` is when it came. */
  notify(spec: NotificationSpec, now = Date.now()): Notification {
    const notification = new Notification(spec, now);
    if (notification.group !== undefined) {
      for (const other of this.all.toArray()) {
        if (other.group === notification.group) other.balloon.set(false);
      }
    }
    this.all.unshift(notification);
    return notification;
  }

  /**
   * It no longer applies, as IntelliJ's `Notification.expire`: its balloon closes, and it leaves
   * the timeline (`ApplicationNotificationsModel.remove`), its links with it.
   */
  expire(notification: Notification): void {
    notification.balloon.set(false);
    const index = this.all.toArray().indexOf(notification);
    if (index >= 0) this.all.splice(index, 1);
  }

  /** Everything was seen: as IntelliJ's tool window when it's hidden. */
  markAllRead(): void {
    for (const notification of this.all.toArray()) notification.read.set(true);
  }

  /** IntelliJ's Clear all: the timeline empties, and the balloons close. */
  clear(): void {
    for (const notification of this.all.clear()) notification.balloon.set(false);
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * When something happened, as IntelliJ's DateFormatUtil.formatPrettyDateTime (its words from
 * UtilBundle): `Moments ago`, `A minute ago`, `5 minutes ago` and `1 hour ago` for the last hour
 * and a minute, then `Today 14:05`, `Yesterday 14:05`, or the date and time.
 */
export function formatPrettyDateTime(time: number, now: number): string {
  const delta = now - time;
  if (delta >= 0 && delta <= HOUR + MINUTE) {
    const minutes = Math.round(delta / MINUTE);
    if (minutes === 0) return 'Moments ago';
    if (minutes === 1) return 'A minute ago';
    return minutes >= 60 ? '1 hour ago' : `${String(minutes)} minutes ago`;
  }
  const date = new Date(time);
  const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  if (sameDay(date, today)) return `Today ${clock}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clock}`;
  return date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}
