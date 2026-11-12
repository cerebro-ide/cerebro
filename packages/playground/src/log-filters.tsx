// The Log's User and Date filters, as IntelliJ's (UserFilterPopupComponent, DateFilterPopupComponent,
// MultipleValueFilterPopupComponent, VcsLogBundle):
// - User: Select… (names typed, between bars), me, then the recent choices; typing searches me and
//   every author. A choice is remembered, the latest first, ten of them per filter and repository.
// - Date: Select… (a period: after a day, before one, or both), Last 24 hours, Last 7 days.
// Select… for users, and for paths (log-paths.tsx), is IntelliJ's multi-line field of values.
// Claims: the field for users has no completion, where IntelliJ's completes the authors' names; a
// day chosen in Select Period is its start, in local time.

import { chordFromEvent, formatChord, normalizeChord, type Platform } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { openDialog } from '@cerebro-ide/ui-dialog';
import {
  fuzzyFilter,
  openPicker,
  type PickerHandle,
  type PickerItem,
  type PickerOptions,
} from '@cerebro-ide/ui-popup';
import { displayable, ME, ME_LABEL, read, shown, userNames, type Author } from './log-users.js';

/**
 * A Log filter's popup, as IntelliJ's (VcsLogPopupComponent): it says "Press Delete to clear the
 * filter" (the Delete action's first shortcut), and Delete clears the filter and closes it.
 */
export function openFilterPicker<T extends PickerItem>(
  options: PickerOptions<T>,
  platform: Platform,
  clear: () => void,
): PickerHandle<T> {
  const handle = openPicker<T>({
    ...options,
    ad: `Press ${formatChord('Delete', platform)} to clear the filter`,
    onKey: (event) => {
      if (chordFromEvent(event) !== 'Delete') return false;
      clear();
      handle.close();
      return true;
    },
  });
  return handle;
}

/** How many choices a filter remembers, IntelliJ's RECENTLY_FILTERED_VALUES_LIMIT. */
const RECENT_LIMIT = 10;

const recentKey = (worktree: string, filter: string) => `cerebro.log.recent.${filter}:${worktree}`;

/** A filter's recent choices in a repository, the latest first. */
export function recentChoices(worktree: string, filter: string): string[][] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(recentKey(worktree, filter)) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter(
          (group): group is string[] =>
            Array.isArray(group) && group.every((value) => typeof value === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

/** Remembers a choice, first; the same one before goes. */
export function rememberChoice(worktree: string, filter: string, values: readonly string[]): void {
  const same = (group: readonly string[]) =>
    group.length === values.length && group.every((value, i) => value === values[i]);
  const recent = [[...values], ...recentChoices(worktree, filter).filter((g) => !same(g))];
  try {
    localStorage.setItem(
      recentKey(worktree, filter),
      JSON.stringify(recent.slice(0, RECENT_LIMIT)),
    );
  } catch {
    // Not remembered: the popup lists what it had.
  }
}

/** The User filter's text: its values, "me" for the user, between bars, cut short. */
export const usersText = (values: readonly string[]): string => displayable(shown(values));

type UserChoice = PickerItem & { values?: string[] };

/** What the User popup needs: the authors, and what to do with a choice. */
export interface UserSource {
  worktree: string;
  /** For the shortcut that finishes Select…. */
  platform: Platform;
  /** The authors and "me", once they're read. */
  authors: () => { authors: Author[]; me: Author | undefined } | undefined;
  current: () => readonly string[] | undefined;
  /** The names chosen, or undefined for anyone's. */
  choose: (values: string[] | undefined) => void;
}

/** What `selectValues` asks for. */
export interface ValuesOptions {
  /** The filter's button: the field opens below it. */
  below: HTMLElement;
  /** For screen readers: the filter's name. */
  label: string;
  value: string;
  /** What separates the values: `|`, a new line. */
  separators: readonly string[];
  /** Whose shortcut finishes: Cmd+Enter on macOS, else Ctrl+Enter. */
  platform: Platform;
}

/**
 * IntelliJ's MultilinePopupBuilder: a field of values below a filter's button, which Ctrl+Enter
 * (Cmd+Enter on macOS) takes, and Escape or a click outside cancels. Resolves with the values,
 * trimmed, the blank ones left out (none: the filter goes); or undefined, cancelled.
 */
export function selectValues(options: ValuesOptions): Promise<string[] | undefined> {
  const { platform } = options;
  const finish = normalizeChord('Mod+Enter', platform);
  const separated = options.separators
    .map((separator) => (separator === '\n' ? 'new lines' : separator))
    .join(' or ');
  const element = document.createElement('div');
  element.className = 'playground-values';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', options.label);
  document.body.append(element);
  return new Promise((resolve) => {
    const done = (values: string[] | undefined) => {
      window.removeEventListener('pointerdown', outside, true);
      handle.dispose();
      element.remove();
      options.below.focus();
      resolve(values);
    };
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) done(undefined);
    };
    const split = (text: string) =>
      options.separators
        .reduce<string[]>(
          (parts, separator) => parts.flatMap((part) => part.split(separator)),
          [text],
        )
        .map((value) => value.trim())
        .filter(Boolean);
    const handle = render(
      () => (
        <>
          <textarea
            class="playground-values__field"
            aria-label={options.label}
            rows={4}
            value={options.value}
            ref={(field) => {
              requestAnimationFrame(() => {
                field.focus();
              });
            }}
            on:keydown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                done(undefined);
              } else if (chordFromEvent(event) === finish) {
                event.preventDefault();
                done(split((event.currentTarget as HTMLTextAreaElement).value));
              }
            }}
          />
          <p class="playground-values__hint">
            {`Select one or more values separated with ${separated}, use ${formatChord(finish, platform)} to finish`}
          </p>
        </>
      ),
      element,
    );
    const at = options.below.getBoundingClientRect();
    element.style.left = `${String(Math.max(0, Math.min(at.left, window.innerWidth - element.offsetWidth)))}px`;
    element.style.top = `${String(at.bottom + 2)}px`;
    window.addEventListener('pointerdown', outside, true);
  });
}

/** Asks for users by name, between bars or a line each, starting with those chosen. */
async function selectUsers(button: HTMLElement, source: UserSource): Promise<void> {
  const typed = await selectValues({
    below: button,
    label: 'User',
    value: shown(source.current() ?? []).join('|'),
    separators: ['|', '\n'],
    platform: source.platform,
  });
  if (typed === undefined) return;
  if (typed.length === 0) {
    source.choose(undefined);
    return;
  }
  const values = read(typed);
  source.choose(values);
  rememberChoice(source.worktree, 'User', values);
}

/** The User filter's popup, below its button. */
export function pickUser(button: HTMLElement, source: UserSource) {
  const handle = openFilterPicker<UserChoice>(
    {
      label: 'User',
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      items: (query) => {
        const known = source.authors();
        const me: UserChoice[] = known?.me ? [{ label: ME_LABEL, values: [ME] }] : [];
        if (query === '') {
          return [
            { label: 'Select…' },
            ...me,
            ...recentChoices(source.worktree, 'User').map((values) => ({
              label: displayable(shown(values), 40),
              values,
              group: 'Recent',
            })),
          ];
        }
        const users = userNames(known?.authors ?? []).map((name) => ({
          label: name,
          values: [name],
        }));
        return fuzzyFilter([...me, ...users], query);
      },
    },
    source.platform,
    () => {
      source.choose(undefined);
    },
  );
  void handle.result.then((choice) => {
    if (!choice) return;
    if (!choice.values) {
      void selectUsers(button, source);
      return;
    }
    source.choose(choice.values);
    rememberChoice(source.worktree, 'User', choice.values);
  });
  return handle;
}

/** A period the Log shows the commits of: after a time, before one, or between (milliseconds). */
export interface Period {
  after?: number;
  before?: number;
}

/** A day as the system writes it, short: IntelliJ's DateFormatUtil.formatDate. */
const day = (time: number) => new Date(time).toLocaleDateString(undefined, { dateStyle: 'short' });

/** The Date filter's text, as IntelliJ's: since a day, until one, or from one to the other. */
export function periodText(period: Period): string {
  const { after, before } = period;
  if (after !== undefined && before !== undefined) return `${day(after)}-${day(before)}`;
  if (after !== undefined) return `Since ${day(after)}`;
  return `Until ${day(before as number)}`;
}

/** The start of a day, from a date field's value (`2026-11-07`). */
const startOf = (value: string) => {
  const [year, month, date] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date).getTime();
};

/** A date field's value for a time: its day, in local time. */
const fieldValue = (time: number) => {
  const date = new Date(time);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
};

/** IntelliJ's Select Period: After and Before, each a day, each on when checked. */
async function selectPeriod(current: Period | undefined): Promise<Period | undefined> {
  const today = fieldValue(Date.now());
  const side = (label: string, time: number | undefined) => ({
    label,
    on: signal(time !== undefined),
    value: signal(time === undefined ? today : fieldValue(time)),
  });
  const after = side('After', current?.after);
  const before = side('Before', current?.before);
  const row = (part: typeof after) => (
    <label class="playground-period__side">
      <input
        type="checkbox"
        checked={part.on.peek()}
        on:change={(event) => {
          part.on.set((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{part.label}</span>
      <input
        class="cerebro-dialog-field__input"
        type="date"
        aria-label={part.label}
        value={part.value.peek()}
        disabled={() => !part.on.get()}
        on:change={(event) => {
          part.value.set((event.currentTarget as HTMLInputElement).value);
        }}
      />
    </label>
  );
  const time = (part: typeof after) =>
    part.on.peek() && part.value.peek() !== '' ? startOf(part.value.peek()) : undefined;
  const handle = openDialog<Period>({
    title: 'Select Period',
    content: () => (
      <div class="playground-period">
        {row(after)}
        {row(before)}
      </div>
    ),
    ok: {
      accept: () => {
        const period: Period = {};
        const from = time(after);
        const to = time(before);
        if (from !== undefined) period.after = from;
        if (to !== undefined) period.before = to;
        return period;
      },
    },
  });
  const period = await handle.result;
  // Neither side on: the filter stays as it was, as IntelliJ's.
  return period && (period.after !== undefined || period.before !== undefined) ? period : undefined;
}

type DateChoice = PickerItem & { since?: number };

/** What the Date filter's popup reads and sets. */
export interface DateSource {
  platform: Platform;
  current: () => Period | undefined;
  /** The period chosen, or undefined for any time. */
  choose: (period: Period | undefined) => void;
}

/** The Date filter's popup, below its button. */
export function pickDate(button: HTMLElement, source: DateSource, now = Date.now) {
  const { current, choose } = source;
  const daysAgo = (days: number) => {
    const date = new Date(now());
    date.setDate(date.getDate() - days);
    return date.getTime();
  };
  const handle = openFilterPicker<DateChoice>(
    {
      label: 'Date',
      placeholder: 'Search',
      position: { below: button },
      owner: button,
      items: (query) =>
        fuzzyFilter<DateChoice>(
          [
            { label: 'Select…' },
            { label: 'Last 24 hours', since: daysAgo(1) },
            { label: 'Last 7 days', since: daysAgo(7) },
          ],
          query,
        ),
    },
    source.platform,
    () => {
      choose(undefined);
    },
  );
  void handle.result.then(async (choice) => {
    if (!choice) return;
    if (choice.since !== undefined) {
      choose({ after: choice.since });
      return;
    }
    const period = await selectPeriod(current());
    if (period) choose(period);
  });
  return handle;
}
