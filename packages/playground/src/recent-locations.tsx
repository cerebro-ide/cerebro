// Recent Locations, as IntelliJ's (Ctrl+Shift+E; RecentLocationsAction, RecentLocationsDataModel and
// RecentLocationsRenderer, read from its source): the places behind, the latest first, each with
// the lines around it, as code. From its source:
// - the places: Back's (`backPlaces`), or with Show edited only, those of the changes
//   (`changePlaces`); the latest first, a place within a few lines of one listed left out
//   (`isSame`), and one without a caret (a diff's) too; up to 25 (`recentLocationsLimit`);
// - each row: the file's name, in bold (Cerebro has no breadcrumbs, and IntelliJ shows the name
//   alone without them), then its lines: 2 before and after the place's, more on the other side
//   near the file's start or end, blank ones at either end left out (`getTrimmedRange`); "Empty
//   lines" when they're all blank;
// - the title, "Recent Locations" or "Recently Edited Locations", and how many are listed; Show
//   edited only at the right, its key (Recent Locations' own, which flips it) beside it;
// - typing filters by the name and the lines (`getSpeedSearchText`); Enter goes to the place; Delete
//   or Backspace forgets it (`removeItems`); "No recent locations found" for none.
// Claude's choices, open to change: the search field shows from the start (the pickers'); Delete
// and Backspace edit what's typed when there is some; Delete with Show edited only forgets the
// changes at that place, not all of them (IntelliJ's `removeItems` removes every change place).

import { chordFromEvent, formatSequence } from '@cerebro-ide/commands';
import { samePlace, type Place } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { codeSnippet } from '@cerebro-ide/ui-editor';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { match, openPicker, type PickerHandle, type PickerItem } from '@cerebro-ide/ui-popup';
import { documentFor } from './documents.js';
import { changePlaces, goToPlace, history } from './navigation.js';

/** The most places listed, as IntelliJ's (`recentLocationsLimit`). */
export const LIMIT = 25;

/** Lines shown before and after a place's (`recent.locations.lines.before.and.after`). */
const AROUND = 2;

/**
 * The lines shown around line `line` of a file's: as IntelliJ's `getLinesRange`, then without the
 * blank ones at either end (`getTrimmedRange`); undefined when they're all blank.
 */
export function linesAround(lines: readonly string[], line: number): [number, number] | undefined {
  const before = Math.min(AROUND, line);
  const after = Math.min(AROUND, lines.length - line);
  let first = Math.max(line - (before + AROUND - after), 0);
  let last = Math.min(line + after + AROUND - before, lines.length - 1);
  while (first <= last && (lines[first] as string).trim() === '') first++;
  while (last >= first && (lines[last] as string).trim() === '') last--;
  return first <= last ? [first, last] : undefined;
}

/** The places listed: the latest first, each once, those with a caret, up to the limit. */
export function locations(places: readonly Place[]): Place[] {
  const listed: Place[] = [];
  for (const place of [...places].reverse()) {
    if (!place.at || listed.some((p) => samePlace(p, place))) continue;
    listed.push(place);
    if (listed.length === LIMIT) break;
  }
  return listed;
}

/**
 * Whether a place's row is found by what's typed, and the name's characters matched: its name as
 * the pickers match it, or its lines holding what's typed (IntelliJ's speed search matches
 * fragments, `NameUtil.buildMatcher`: matching letters scattered through the lines found nearly
 * every row, seen in the app).
 */
export function found(
  typed: string,
  name: string,
  shown: string,
): { highlight?: readonly number[] } | undefined {
  if (typed === '') return {};
  const named = match(typed, name);
  if (named) return { highlight: named.indices };
  return shown.toLowerCase().includes(typed.toLowerCase()) ? {} : undefined;
}

interface Location extends PickerItem {
  place: Place;
}

/** Recent Locations' popup; `edited` starts it with Show edited only on. */
async function recentLocations(services: MenuServices, edited: boolean): Promise<void> {
  const editedOnly = signal(edited);
  const places = () =>
    locations((editedOnly.get() ? changePlaces()?.places : history()?.back) ?? []);
  // The files' texts, read before it opens: a file that can't be read is left out, as IntelliJ
  // leaves out a place no longer valid.
  const texts = new Map<string, string>();
  // Both lists' files, so Show edited only flips at once.
  const paths = new Set(
    [...locations(history()?.back ?? []), ...locations(changePlaces()?.places ?? [])].map(pathOf),
  );
  await Promise.all(
    [...paths].map(async (path) => {
      const doc = await documentFor(path);
      if (!('error' in doc)) texts.set(path, doc.content());
    }),
  );
  const listed = () => places().filter((place) => texts.has(pathOf(place)));
  /** Each place's lines, as searched and as drawn: drawn once, as its row is. */
  const rows = new WeakMap<Place, { shown: string; body: () => Node }>();
  const rowOf = (place: Place) => {
    let row = rows.get(place);
    if (!row) {
      const path = pathOf(place);
      const text = texts.get(path) as string;
      const lines = text.split('\n');
      const around = linesAround(lines, (place.at as { line: number }).line);
      const body = around ? (
        codeSnippet(path, text, around[0], around[1])
      ) : (
        <div class="cerebro-snippet playground-locations__empty">Empty lines</div>
      );
      row = {
        shown: around ? lines.slice(around[0], around[1] + 1).join('\n') : 'Empty lines',
        body: () => body,
      };
      rows.set(place, row);
    }
    return row;
  };
  /** Show edited only flipped: the other list, the first selected, what's typed cleared. */
  const flip = () => {
    editedOnly.set(!editedOnly.peek());
    handle.setQuery('');
  };
  let query = '';
  const { keymap } = services;
  const key = keymap?.shortcutsFor('view.recentLocations')[0];
  const handle: PickerHandle<Location> = openPicker<Location>({
    label: 'Recent Locations',
    position: 'top',
    width: 700,
    empty: 'No recent locations found',
    header: () => (
      <div class="playground-locations__header">
        <b>{() => (editedOnly.get() ? 'Recently Edited Locations' : 'Recent Locations')}</b>
        <span class="playground-locations__count">{() => `(${String(listed().length)})`}</span>
        <label
          class="playground-recent__edited"
          // Keeps the focus in the popup.
          on:mousedown={(event) => {
            event.preventDefault();
          }}
        >
          <input type="checkbox" tabIndex={-1} checked={() => editedOnly.get()} on:change={flip} />
          Show edited only
        </label>
        {key === undefined || !keymap ? null : (
          <span class="playground-recent__key">{formatSequence(key, keymap.platform)}</span>
        )}
      </div>
    ),
    items: (typed) =>
      listed().flatMap((place) => {
        const name = place.tab.title;
        const { shown, body } = rowOf(place);
        const matched = found(typed, name, shown);
        if (!matched) return [];
        return [
          {
            label: name,
            ...matched,
            place,
            body,
          },
        ];
      }),
    onQueryChange: (typed) => {
      query = typed;
    },
    onKey: (event) => {
      const chord = chordFromEvent(event);
      if (chord !== undefined && keymap?.commandsFor(chord).includes('view.recentLocations')) {
        flip();
        return true;
      }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || query !== '') return false;
      // The row at its index is highlighted then, or the last (`removeItems`): the picker's.
      const location = handle.highlighted();
      if (location) {
        if (editedOnly.peek()) changePlaces()?.forget(location.place);
        else history()?.forget(location.place);
      }
      return true;
    },
  });
  const chosen = await handle.result;
  if (chosen) goToPlace(chosen.place);
}

/** A place's file: its tab's id, as Last Edit Location's. */
const pathOf = (place: Place) => place.tab.id;

/** Recent Locations, in the View menu after Recent Files, on IntelliJ's key. */
export function setupRecentLocations(services: MenuServices): void {
  services.commands.register({
    id: 'view.recentLocations',
    label: 'Recent &Locations',
    dialog: true,
    // Recent Files' Recent Locations item opens it with Show edited only as Recent Files has it.
    run: (context?: { edited?: boolean }) => {
      void recentLocations(services, context?.edited ?? false);
    },
  });
  services.keymap?.bindDefault('Mod+Shift+E', 'view.recentLocations');
  services.menus.contribute({
    menu: 'main/view',
    item: { command: 'view.recentLocations' },
    group: 'c',
  });
}
