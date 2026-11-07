// The Log's User and Date filters, as IntelliJ's (UserFilterPopupComponent, DateFilterPopupComponent,
// MultipleValueFilterPopupComponent, VcsLogBundle):
// - User: Select… (names typed, between bars), me, then the recent choices; typing searches me and
//   every author. A choice is remembered, the latest first, ten of them per filter and repository.
// - Date: Select… (a period: after a day, before one, or both), Last 24 hours, Last 7 days.
// Claims: Select… for users is a line of text, where IntelliJ's is a multi-line field with
// completion; a day chosen in Select Period is its start, in local time.

import { signal } from '@cerebro-ide/reactive';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker, type PickerItem } from '@cerebro-ide/ui-popup';
import { displayable, ME, ME_LABEL, read, shown, userNames, type Author } from './log-users.js';

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
  /** The authors and "me", once they're read. */
  authors: () => { authors: Author[]; me: Author | undefined } | undefined;
  current: () => readonly string[] | undefined;
  choose: (values: string[]) => void;
}

/** Asks for users by name, between bars, starting with those chosen. */
async function selectUsers(source: UserSource): Promise<void> {
  const typed = await prompt({
    title: 'Select Users',
    label: 'Users, separated with |:',
    value: shown(source.current() ?? []).join('|'),
  });
  if (typed === undefined) return;
  const values = read(
    typed
      .split(/[|\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  // The prompt takes no blank text: there's always one.
  source.choose(values);
  rememberChoice(source.worktree, 'User', values);
}

/** The User filter's popup, below its button. */
export function pickUser(button: HTMLElement, source: UserSource) {
  const handle = openPicker<UserChoice>({
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
  });
  void handle.result.then((choice) => {
    if (!choice) return;
    if (!choice.values) {
      void selectUsers(source);
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

/** The Date filter's popup, below its button. */
export function pickDate(
  button: HTMLElement,
  current: () => Period | undefined,
  choose: (period: Period) => void,
  now = Date.now,
) {
  const daysAgo = (days: number) => {
    const date = new Date(now());
    date.setDate(date.getDate() - days);
    return date.getTime();
  };
  const handle = openPicker<DateChoice>({
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
  });
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
