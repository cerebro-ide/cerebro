// The balloons, in the window's bottom right corner above the status bar, newest lowest, and the
// Notifications tool window's Timeline, as IntelliJ's (NotificationsManagerImpl, NotificationsPanel,
// read in its source). A balloon's time starts once the window is active, as IntelliJ's
// (frameActivateBalloonListener), so one that comes while the user is away waits for them; it
// starts again when the pointer leaves it (a claim: IntelliJ's "smart fadeout" holds it while the
// pointer is over it).

import { onCleanup, render } from '@cerebro-ide/jsx';
import { effect, signal } from '@cerebro-ide/reactive';
import {
  BALLOON_TIME,
  formatPrettyDateTime,
  type Notification,
  type NotificationType,
  type Notifications,
} from './notifications.js';

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/**
 * IntelliJ's icons (`expui/status/info`, `warning`, `error`; Apache 2.0, © JetBrains s.r.o. and
 * contributors), coloured by the theme through their classes.
 */
const MARK_DOWN =
  'M9 5C9 4.44772 8.55228 4 8 4C7.44772 4 7 4.44772 7 5V7.5C7 8.05229 7.44772 8.5 8 8.5C8.55229 8.5 9 8.05228 9 7.5L9 5Z M8 12C8.55228 12 9 11.5523 9 11C9 10.4477 8.55228 10 8 10C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12Z';
const MARK_UP =
  'M7 11C7 11.5523 7.44772 12 8 12C8.55228 12 9 11.5523 9 11L9 8.5C9 7.94771 8.55228 7.5 8 7.5C7.44771 7.5 7 7.94772 7 8.5L7 11Z M8 4C7.44771 4 7 4.44772 7 5C7 5.55228 7.44771 6 8 6C8.55228 6 9 5.55228 9 5C9 4.44772 8.55228 4 8 4Z';
const TRIANGLE =
  'M1.27603 10.8634L6.3028 1.98903C7.04977 0.670323 8.94893 0.670326 9.69589 1.98903L14.7227 10.8634C15.516 12.2639 14.5047 14 12.8956 14H3.10308C1.494 14 0.482737 12.2639 1.27603 10.8634Z';

/** A notification's icon, by its type. */
export function notificationIcon(type: NotificationType): Node {
  return (
    <svg
      class={`cerebro-notification-icon cerebro-notification-icon--${type}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
    >
      {type === 'warning' ? (
        <path class="cerebro-notification-icon__shape" d={TRIANGLE} />
      ) : (
        <circle class="cerebro-notification-icon__shape" cx="8" cy="8" r="7" />
      )}
      <path
        class="cerebro-notification-icon__mark"
        d={type === 'information' ? MARK_UP : MARK_DOWN}
      />
    </svg>
  );
}

/** Its text and links, as a balloon and the timeline show it. */
function Body(props: { notification: Notification; done?: () => void; aside?: Node }): Node {
  const { notification } = props;
  return (
    <div class="cerebro-notification__body">
      {notification.title === '' ? null : (
        <div class="cerebro-notification__header">
          <span class="cerebro-notification__title">{notification.title}</span>
          {props.aside ?? null}
        </div>
      )}
      {notification.content === '' ? null : (
        <div class="cerebro-notification__content">{notification.content}</div>
      )}
      {notification.actions.length === 0 ? null : (
        <div class="cerebro-notification__actions">
          {notification.actions.map((action) => (
            <button
              type="button"
              class="cerebro-notification__action"
              on:click={() => {
                action.run();
                props.done?.();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Balloon(props: { notification: Notification }): Node {
  const { notification } = props;
  const hide = () => {
    notification.balloon.set(false);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(hide, BALLOON_TIME[notification.display as 'balloon' | 'sticky']);
  };
  if (document.hasFocus()) start();
  else window.addEventListener('focus', start, { once: true });
  onCleanup(() => {
    clearTimeout(timer);
    window.removeEventListener('focus', start);
  });
  return (
    <div
      class="cerebro-balloon"
      role="status"
      data-type={notification.type}
      on:pointerenter={() => {
        clearTimeout(timer);
      }}
      on:pointerleave={start}
    >
      {notificationIcon(notification.type)}
      <Body notification={notification} done={hide} />
      <button type="button" class="cerebro-balloon__close" aria-label="Close" on:click={hide}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}

/** The balloons of `notifications` that show. */
export function NotificationBalloons(props: { notifications: Notifications }): Node {
  const views = new Map<Notification, { element: HTMLElement; dispose: () => void }>();
  const viewOf = (notification: Notification): HTMLElement => {
    let view = views.get(notification);
    if (!view) {
      const element = document.createElement('div');
      element.className = 'cerebro-balloons__holder';
      const handle = render(() => <Balloon notification={notification} />, element);
      view = {
        element,
        dispose: () => {
          handle.dispose();
        },
      };
      views.set(notification, view);
    }
    return view.element;
  };
  const shown = () =>
    props.notifications.all
      .toArray()
      .filter((n) => n.balloon.get())
      .reverse();
  // The balloons that closed are gone.
  const pruning = effect(() => {
    const live = new Set(shown());
    for (const [notification, view] of views) {
      if (!live.has(notification)) {
        view.dispose();
        views.delete(notification);
      }
    }
    return undefined;
  });
  onCleanup(() => {
    pruning.dispose();
    for (const view of views.values()) view.dispose();
  });
  return <div class="cerebro-balloons">{() => shown().map(viewOf)}</div>;
}

/**
 * The Notifications tool window's Timeline: every notification, newest first, when it came (kept
 * up to date each minute), the ones not seen yet marked, and Clear all.
 */
export function NotificationsTimeline(props: { notifications: Notifications }): Node {
  const now = signal(Date.now());
  const ticking = setInterval(() => {
    now.set(Date.now());
  }, 60_000);
  onCleanup(() => {
    clearInterval(ticking);
  });
  const { notifications } = props;
  return (
    <div class="cerebro-notifications">
      {() =>
        notifications.all.length === 0 ? (
          <div class="cerebro-notifications__empty">
            <span>Suggestions, events,</span>
            <span>and errors will appear here</span>
          </div>
        ) : (
          [
            <div class="cerebro-notifications__header">
              <span class="cerebro-notifications__heading">Timeline</span>
              <button
                type="button"
                class="cerebro-notification__action"
                on:click={() => {
                  notifications.clear();
                }}
              >
                Clear all
              </button>
            </div>,
            <div class="cerebro-notifications__list">
              {notifications.all.toArray().map((notification) => {
                const time = (
                  <span
                    class="cerebro-notification__time"
                    title={new Date(notification.time).toLocaleString()}
                  >
                    {() => formatPrettyDateTime(notification.time, now.get())}
                  </span>
                );
                return (
                  <div
                    class={() =>
                      cls(
                        'cerebro-notification',
                        !notification.read.get() && 'cerebro-notification--new',
                      )
                    }
                    data-type={notification.type}
                  >
                    {notificationIcon(notification.type)}
                    <Body notification={notification} aside={time} />
                    {notification.title === '' ? time : null}
                  </div>
                );
              })}
            </div>,
          ]
        )
      }
    </div>
  );
}
