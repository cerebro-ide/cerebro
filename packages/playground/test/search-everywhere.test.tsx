import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import type { Place } from '../src/find.js';
import {
  ALL_LIMIT,
  MORE,
  searchEverywhere,
  type Result,
  type SearchSources,
  type SearchTab,
} from '../src/search-everywhere.js';
import { closeAll, FakeHost, popupItems, project } from './fakes.js';

/** The definitions the host's index has: a class, a function, and one outside the worktree. */
const DEFINITIONS = [
  { name: 'Widget', kind: 'class', path: '/r/src/widget.ts', line: 2, column: 13 },
  { name: 'makeWidget', kind: 'function', path: '/r/src/widget.ts', line: 9, column: 16 },
  { name: 'Window', kind: 'interface', path: '/lib/dom.d.ts', line: 0, column: 0 },
];
/** Index answers held back until released, by query. */
const held = new Map<string, () => void>();
let failing = false;
const host = new FakeHost({
  'index.symbols': async ({ query, kinds }: { query: string; kinds?: string[] }) => {
    if (failing) throw new Error('index gone');
    await new Promise<void>((resolve) => {
      if (query === 'held') held.set(query, resolve);
      else resolve();
    });
    return DEFINITIONS.filter(
      (d) => d.name.toLowerCase().includes(query.toLowerCase()) || query === 'held',
    ).filter((d) => !kinds || kinds.includes(d.kind));
  },
  'search.text': async ({ query }: { query: string }) => {
    if (failing) throw new Error('rg gone');
    await new Promise<void>((resolve) => {
      if (query === 'held') held.set(query, resolve);
      else resolve();
    });
    return {
      matches: [
        {
          path: '/r/src/widget.ts',
          line: 4,
          text: `  const ${query} = 1;`,
          ranges: [[8, 8 + query.length]],
        },
      ],
      limited: false,
    };
  },
  'fs.read': () => ({ text: 'line 0\nline 1\nline 2\nexport class Widget {}\n' }),
});

const opened: Place[] = [];
const ran: string[] = [];
const result = (label: string): Result => ({ label, run: () => void ran.push(label) });
let recent: Result[] = [];
let actions = ['Close Widget', 'Undo'];
const sources: SearchSources = {
  files: () => ['widget.ts', 'window.ts', 'README.md'].map(result),
  recent: () => recent,
  actions: () => actions.map(result),
  open: (at) => void opened.push(at),
};

beforeAll(() => {
  useProjects([project('/r', host)]);
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(async () => {
  await closeAll();
  opened.length = 0;
  ran.length = 0;
  recent = [];
  actions = ['Close Widget', 'Undo'];
  failing = false;
  host.asked.length = 0;
});

const search = () => document.querySelector('.cerebro-popup__search') as HTMLInputElement;
/** The list's rows: group headers in brackets, then items' labels and details. */
const rows = () =>
  [...document.querySelectorAll('.cerebro-popup__group, .cerebro-popup-item')].map((row) =>
    row.classList.contains('cerebro-popup__group')
      ? `[${row.textContent}]`
      : [
          row.querySelector('.cerebro-popup-item__label')?.textContent,
          row.querySelector('.cerebro-popup-item__detail')?.textContent,
        ]
          .filter(Boolean)
          .join(' '),
  );
/** The preview's text: its editor is in a shadow root, as CodeMirror's styles need. */
const previewText = () =>
  [...document.querySelectorAll('.playground-find__preview *')]
    .map((e) => e.shadowRoot?.querySelector('.cm-content')?.textContent)
    .find((text) => text !== undefined);
const selectedTab = () =>
  document.querySelector('.cerebro-popup__header [aria-selected="true"]')?.textContent;

/** Opens Search Everywhere on a tab, and types `query`. */
async function open(tab: SearchTab, query = ''): Promise<{ done: Promise<void> }> {
  const done = searchEverywhere(sources, tab);
  await popupItems();
  if (query !== '') await userEvent.type(search(), query);
  return { done };
}

describe('Search Everywhere', () => {
  it('lists the files opened lately before anything’s typed, the first few and “… more”', async () => {
    recent = Array.from({ length: ALL_LIMIT + MORE + 1 }, (_, i) => result(`f${String(i)}.ts`));
    await open('all');
    expect(rows()).toEqual([
      '[Recent Files]',
      ...recent.slice(0, ALL_LIMIT).map((r) => r.label),
      '… more',
    ]);
    // Nothing to ask the index for yet.
    expect(host.params('index.symbols')).toEqual([]);
    await userEvent.click(document.querySelector('.cerebro-popup-item--more') as HTMLElement);
    await expect.poll(() => rows().length).toBe(1 + ALL_LIMIT + MORE + 1);
    await userEvent.click(document.querySelector('.cerebro-popup-item--more') as HTMLElement);
    await expect.poll(() => rows().at(-1)).toBe(`f${String(ALL_LIMIT + MORE)}.ts`);
  });

  it('lists each kind under its header, classes once, and the place each is at', async () => {
    await open('all', 'wi');
    await expect
      .poll(rows)
      .toEqual([
        '[Classes]',
        'Widget src/widget.ts:3',
        'Window /lib/dom.d.ts:1',
        '[Files]',
        'widget.ts',
        'window.ts',
        '[Symbols]',
        'makeWidget src/widget.ts:10',
        '[Actions]',
        'Close Widget',
      ]);
    expect(host.params('index.symbols').at(-2)).toEqual({
      worktree: '/r',
      query: 'wi',
      kinds: ['class', 'interface', 'enum', 'type'],
    });
    expect(host.params('index.symbols').at(-1)).toEqual({ worktree: '/r', query: 'wi' });
  });

  it('shows the highlighted definition’s file, and opens it there', async () => {
    const { done } = await open('classes', 'Widget');
    await expect.poll(rows).toEqual(['Widget src/widget.ts:3']);
    await expect.poll(() => previewText()).toContain('export class Widget');
    await userEvent.keyboard('{Enter}');
    await done;
    expect(opened).toEqual([{ path: '/r/src/widget.ts', line: 2, column: 13, end: 19 }]);
  });

  it('moves between the tabs with Tab and Shift+Tab, or a click, each listing its kind', async () => {
    const { done } = await open('symbols', 'wi');
    await expect
      .poll(rows)
      .toEqual(['Widget src/widget.ts:3', 'makeWidget src/widget.ts:10', 'Window /lib/dom.d.ts:1']);
    await userEvent.keyboard('{Tab}');
    expect(selectedTab()).toBe('Actions');
    expect(rows()).toEqual(['Close Widget']);
    await userEvent.keyboard('{Shift>}{Tab}{Tab}{/Shift}');
    expect(selectedTab()).toBe('Files');
    expect(rows()).toEqual(['widget.ts', 'window.ts']);
    // Ctrl+Tab is not the popup's.
    await userEvent.keyboard('{Control>}{Tab}{/Control}');
    expect(selectedTab()).toBe('Files');
    await userEvent.keyboard('{Shift>}{Tab}{Tab}{/Shift}{Shift>}{Tab}{/Shift}');
    expect(selectedTab()).toBe('Text');
    const tab = (label: string) =>
      [...document.querySelectorAll('.cerebro-popup__header button')].find(
        (b) => b.textContent === label,
      ) as HTMLElement;
    await userEvent.click(tab('Files'));
    expect(selectedTab()).toBe('Files');
    expect(document.activeElement).toBe(search());
    await userEvent.keyboard('{Enter}');
    await done;
    expect(ran).toEqual(['widget.ts']);
  });

  it('searches the text after typing pauses, and opens a line at its match', async () => {
    const { done } = await open('text', 'wid');
    await expect.poll(rows).toEqual(['const wid = 1;']);
    expect(host.params('search.text')).toEqual([{ path: '/r', query: 'wid' }]);
    await userEvent.keyboard('{Enter}');
    await done;
    expect(opened).toEqual([{ path: '/r/src/widget.ts', line: 4, column: 8, end: 11 }]);
  });

  it('takes only the latest answer, and none after it’s closed', async () => {
    await open('classes', 'held');
    await expect.poll(() => held.size).toBe(1);
    await userEvent.type(search(), 'x');
    await expect.poll(() => host.params('index.symbols').length).toBe(5);
    (held.get('held') as () => void)();
    held.clear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows()).toEqual([]);
    // Text typed then closed before the search runs asks for nothing.
    await userEvent.click(
      [...document.querySelectorAll('.cerebro-popup__header button')].find(
        (b) => b.textContent === 'Text',
      ) as HTMLElement,
    );
    await userEvent.keyboard('{Escape}');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(host.params('search.text')).toEqual([]);
  });

  it('ignores a text answer for a query since changed', async () => {
    const { done } = await open('text', 'held');
    await expect.poll(() => held.size).toBe(1);
    await userEvent.type(search(), 'x');
    await expect.poll(rows).toEqual(['const heldx = 1;']);
    (held.get('held') as () => void)();
    held.clear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows()).toEqual(['const heldx = 1;']);
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('lists nothing from the host when it fails', async () => {
    failing = true;
    const { done } = await open('all', 'wi');
    await expect.poll(() => host.params('index.symbols').length).toBe(4);
    expect(rows()).toEqual(['[Files]', 'widget.ts', 'window.ts', '[Actions]', 'Close Widget']);
    await userEvent.click(
      [...document.querySelectorAll('.cerebro-popup__header button')].find(
        (b) => b.textContent === 'Text',
      ) as HTMLElement,
    );
    await expect.poll(() => host.params('search.text').length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe('Nothing found');
    await userEvent.keyboard('{Escape}');
    await done;
    expect(ran).toEqual([]);
  });

  it('lists the actions as they were when it opened, not as its own field changes them', async () => {
    const { done } = await open('actions');
    // As the Edit commands, which are off once the focus is in the popup's field.
    actions = [];
    await userEvent.type(search(), 'o');
    expect(rows()).toEqual(['Undo', 'Close Widget']);
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('lists only files and actions with no worktree open', async () => {
    workspace.close('/r');
    try {
      await open('all', 'wi');
      expect(rows()).toEqual(['[Files]', 'widget.ts', 'window.ts', '[Actions]', 'Close Widget']);
      expect(host.asked).toEqual([]);
    } finally {
      workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    }
  });
});
