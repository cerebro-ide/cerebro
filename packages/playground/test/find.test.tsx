import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { documentFor, setupSaving } from '../src/documents.js';
import { useProjects, workspace } from '../src/environments.js';
import {
  choiceOf,
  countOf,
  findInFiles,
  folderOf,
  masksOf,
  placeOf,
  replaceHistory,
  replaceLines,
  searchHistory,
  SEARCH_DELAY,
  WHOLE_LIMIT,
  type TextMatch,
} from '../src/find.js';
import type { Occurrences } from '../src/find-window.js';
import { closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

/** The files on the host's disk. */
const disk = new Map<string, string>([
  ['/r/src/a.ts', 'const alpha = 1;\n  alpha(Alpha);\n'],
  ['/r/src/a.test.ts', 'alpha test\n'],
  ['/r/docs/c.md', 'Alphabet\n'],
]);

interface Search {
  path: string;
  masks: string[];
  query: string;
  matchCase: boolean;
  words: boolean;
  regex: boolean;
  replace?: string;
  limit?: number;
}

/** Searches the disk as the host's ripgrep does, as far as the tests need. */
function ripgrep(search: Search): { matches: TextMatch[]; limited: boolean } {
  let source = search.regex ? search.query : search.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (search.words) source = `\\b${source}\\b`;
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, search.matchCase ? 'g' : 'gi');
  } catch {
    throw new Error(`regex parse error:\n    ${search.query}\nerror: unclosed group`);
  }
  const masked = (path: string) => {
    const name = path.split('/').at(-1) as string;
    const fits = (mask: string) => name.endsWith(mask.replace(/^!?\*/, ''));
    const only = search.masks.filter((m) => !m.startsWith('!'));
    return (
      (only.length === 0 || only.some(fits)) &&
      !search.masks.filter((m) => m.startsWith('!')).some(fits)
    );
  };
  const matches: TextMatch[] = [];
  for (const [path, text] of disk) {
    if (!path.startsWith(`${search.path}/`) || !masked(path)) continue;
    text.split('\n').forEach((line, i) => {
      const ranges = [...line.matchAll(pattern)].map((m): [number, number] => [
        m.index,
        m.index + m[0].length,
      ]);
      if (ranges.length === 0) return;
      const replacements =
        search.replace === undefined
          ? {}
          : { replacements: ranges.map(() => search.replace as string) };
      matches.push({ path, line: i, text: line, ranges, ...replacements });
    });
  }
  const limit = search.limit ?? 1000;
  return { matches: matches.slice(0, limit), limited: matches.length > limit };
}

/** Searches held back until released. */
const held: (() => void)[] = [];
let holding = false;
let failing: string | undefined;
const host = new FakeHost({
  'search.text': async (search: Search) => {
    if (failing) throw new Error(failing);
    if (holding) await new Promise<void>((resolve) => held.push(resolve));
    return ripgrep(search);
  },
  'fs.read': ({ path }: { path: string }) => {
    const text = disk.get(path);
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return { text };
  },
  'fs.write': ({ path, text }: { path: string; text: string }) => {
    disk.set(path, text);
    return null;
  },
  'fs.exists': ({ path }: { path: string }) => disk.has(path),
});

const opened: { path: string; line: number; column: number }[] = [];
const shown: Occurrences[] = [];

beforeAll(() => {
  useProjects([project('/r', host)]);
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  setupSaving(
    () => undefined,
    () => Promise.resolve(),
    () => undefined,
    () => undefined,
  );
});

afterEach(async () => {
  await closeAll();
  opened.length = 0;
  shown.length = 0;
  failing = undefined;
  holding = false;
  host.asked.length = 0;
});

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
const input = (selector: string) => document.querySelector(selector) as HTMLInputElement;
const search = () => input('.cerebro-popup__search');
const labels = () =>
  [...document.querySelectorAll('.cerebro-popup-item__label')].map((l) => l.textContent);
const count = () => document.querySelector('.playground-find__count')?.textContent;
const toggle = (label: string) => q(`[aria-label="${label}"]`);
const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLElement;
const searches = () => host.params('search.text') as Search[];

/** Opens Find in Files, or Replace, from the active file, and types `query`. */
async function find(
  query: string,
  { replacing = false, file = '/r/src/a.ts' } = {},
): Promise<{ done: Promise<void> }> {
  const done = findInFiles({
    open: (at) => void opened.push(at),
    showOccurrences: (o) => void shown.push(o),
    file,
    replacing,
  });
  await expect.poll(() => document.querySelector('.cerebro-popup')).not.toBeNull();
  if (query !== '') await userEvent.type(search(), query);
  return { done };
}

describe('a line found', () => {
  it('is listed without its indent, its matches bold, its file and line at the right', () => {
    const choice = choiceOf({
      path: '/r/a.ts',
      line: 4,
      text: '    one two',
      ranges: [
        [2, 6],
        [8, 11],
      ],
    });
    expect(choice.label).toBe('one two');
    expect(choice.highlight).toEqual([0, 1, 4, 5, 6]);
    expect(choice.shortcut).toBe('a.ts 5');
    const long = choiceOf({ path: 'b', line: 0, text: 'x'.repeat(300), ranges: [[195, 210]] });
    expect([long.label.length, long.highlight?.length, long.shortcut]).toEqual([200, 5, 'b 1']);
  });

  it('is at its first match, or its start', () => {
    expect(placeOf({ path: 'a', line: 1, text: 'abc', ranges: [[1, 2]] })).toEqual({
      path: 'a',
      line: 1,
      column: 1,
      end: 2,
    });
    expect(placeOf({ path: 'a', line: 1, text: 'abc', ranges: [] })).toMatchObject({
      column: 0,
      end: 0,
    });
  });
});

describe('what was found', () => {
  const line = (path: string, ranges: [number, number][]): TextMatch => ({
    path,
    line: 0,
    text: '',
    ranges,
  });

  it('is counted as IntelliJ counts it', () => {
    expect(countOf(undefined)).toBe('');
    expect(countOf({ error: 'bad' })).toBe('');
    expect(countOf({ matches: [line('a', [[0, 1]])], limited: false })).toBe('1 match in 1 file');
    expect(
      countOf({
        matches: [
          line('a', [
            [0, 1],
            [2, 3],
          ]),
          line('b', [[0, 1]]),
        ],
        limited: true,
      }),
    ).toBe('3+ matches in 2+ files');
  });
});

describe('the scope', () => {
  it('takes masks separated by commas, and a folder relative to the worktree', () => {
    expect(masksOf(' *.ts, !*.test.ts ,,')).toEqual(['*.ts', '!*.test.ts']);
    expect(folderOf('/r', '')).toBe('/r');
    expect(folderOf('/r', '/src\\lib/')).toBe('/r/src/lib');
  });
});

describe('Find in Files', () => {
  it('does nothing with no worktree open', async () => {
    workspace.close('/r');
    try {
      await findInFiles({ open: () => undefined, showOccurrences: () => undefined });
      expect(document.querySelector('.cerebro-popup')).toBeNull();
    } finally {
      workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    }
  });

  it('searches as the user types, and opens a line at its match', async () => {
    const { done } = await find('');
    // When each key's text came: a pause as long as the delay is a search (one came in CI).
    const typed: { query: string; at: number }[] = [];
    search().addEventListener('input', () => {
      typed.push({ query: search().value, at: performance.now() });
    });
    await userEvent.type(search(), 'alpha');
    await expect.poll(() => searches().at(-1)?.query).toBe('alpha');
    await expect
      .poll(labels)
      .toEqual(['const alpha = 1;', 'alpha(Alpha);', 'alpha test', 'Alphabet']);
    expect(count()).toBe('5 matches in 3 files');
    // Once typing paused, not for each key: a search for less only after a pause.
    for (const { query } of searches().slice(0, -1)) {
      const i = typed.findIndex((t) => t.query === query);
      const pause = (typed[i + 1]?.at ?? Infinity) - (typed[i]?.at ?? 0);
      expect(pause).toBeGreaterThanOrEqual(SEARCH_DELAY);
    }
    expect(searches().at(-1)).toEqual({
      path: '/r',
      masks: [],
      query: 'alpha',
      matchCase: false,
      words: false,
      regex: false,
    });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await done;
    expect(opened).toEqual([{ path: '/r/src/a.ts', line: 1, column: 2 }]);
  });

  it('opens a line whose matches the host dropped at its start', async () => {
    // As the host drops a match past the end of its line.
    const request = host.request.bind(host);
    const spy = vi.spyOn(host, 'request').mockImplementation(async (method, params) => {
      const answer = await request(method, params);
      if (method !== 'search.text') return answer;
      const { matches, limited } = answer as { matches: TextMatch[]; limited: boolean };
      return { matches: matches.map((m) => ({ ...m, ranges: [] })), limited };
    });
    const { done } = await find('alpha');
    await expect.poll(labels).toContain('const alpha = 1;');
    await userEvent.keyboard('{Enter}');
    await done;
    expect(opened[0]).toMatchObject({ column: 0 });
    spy.mockRestore();
  });

  it('lists nothing, and counts nothing, when the field is emptied', async () => {
    await find('alpha');
    await expect.poll(count).toBe('5 matches in 3 files');
    await userEvent.clear(search());
    await expect.poll(count).toBe('');
    expect(labels()).toEqual([]);
  });

  it('toggles Match Case, Words and Regex by Alt and their key, or a click', async () => {
    await find('alpha');
    await expect.poll(count).toBe('5 matches in 3 files');
    await userEvent.keyboard('{Alt>}c{/Alt}');
    expect(toggle('Match Case (Alt+C)').getAttribute('aria-pressed')).toBe('true');
    await expect.poll(count).toBe('3 matches in 2 files');
    await userEvent.click(toggle('Words (Alt+W)'));
    expect(document.activeElement).toBe(search());
    await expect.poll(count).toBe('3 matches in 2 files');
    await userEvent.keyboard('{Alt>}w{/Alt}{Alt>}c{/Alt}');
    // With Ctrl, not the option's key.
    await userEvent.keyboard('{Control>}{Alt>}x{/Alt}{/Control}');
    expect(toggle('Regex (Alt+X)').getAttribute('aria-pressed')).toBe('false');
    await userEvent.keyboard('{Alt>}x{/Alt}');
    await userEvent.clear(search());
    await userEvent.type(search(), 'alpha(');
    // ripgrep's last line says what's wrong with the pattern.
    await expect
      .poll(() => document.querySelector('.playground-find__error')?.textContent)
      .toBe('error: unclosed group');
    expect(labels()).toEqual([]);
    await userEvent.keyboard('{Alt>}x{/Alt}');
    await expect.poll(labels).toEqual(['alpha(Alpha);']);
    expect(searches().at(-1)).toMatchObject({ matchCase: false, words: false, regex: false });
    // Each says what it is, and its key, in a tooltip.
    await userEvent.hover(toggle('Regex (Alt+X)'));
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('Regex (Alt+X)');
  });

  it('takes only the latest search’s answer', async () => {
    holding = true;
    await find('alpha');
    await expect.poll(() => held.length).toBe(1);
    await userEvent.type(search(), 'b');
    await expect.poll(() => held.length).toBe(2);
    (held.pop() as () => void)();
    await expect.poll(labels).toEqual(['Alphabet']);
    (held.pop() as () => void)();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(labels()).toEqual(['Alphabet']);
  });

  it('searches the active file’s folder, or another, as the Directory', async () => {
    await find('alpha');
    await userEvent.click(button('Directory'));
    const directory = input('.playground-find__directory');
    expect(directory.value).toBe('src');
    await expect.poll(count).toBe('4 matches in 2 files');
    expect(searches().at(-1)?.path).toBe('/r/src');
    await userEvent.clear(directory);
    await userEvent.type(directory, 'docs');
    await expect.poll(count).toBe('1 match in 1 file');
    // Kept for the next search, as IntelliJ keeps it; the folder starts at the active file's.
    await closeAll();
    await find('alpha', { file: '/elsewhere/x.ts' });
    expect(input('.playground-find__directory').value).toBe('');
    await expect.poll(count).toBe('5 matches in 3 files');
    await userEvent.click(button('In Project'));
    expect(document.querySelector('.playground-find__directory')).toBeNull();
  });

  it('searches only files the File mask takes, when it’s on', async () => {
    await find('alpha');
    const field = input('.playground-find__mask-field');
    expect(field.disabled).toBe(true);
    await userEvent.click(q('.playground-find__mask input'));
    expect(field.disabled).toBe(false);
    await userEvent.type(field, '*.ts, !*.test.ts');
    await expect.poll(count).toBe('3 matches in 1 file');
    expect(searches().at(-1)?.masks).toEqual(['*.ts', '!*.test.ts']);
    // The fields keep their keys from the app's: Alt+C still toggles, Enter searches again.
    const before = searches().length;
    await userEvent.keyboard('{Alt>}c{/Alt}');
    expect(toggle('Match Case (Alt+C)').getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Alt>}c{/Alt}{Enter}');
    // Each search waits for the keys to pause: one, for the three.
    await expect.poll(() => searches().length).toBe(before + 1);
    await userEvent.click(q('.playground-find__mask input'));
    await expect.poll(count).toBe('5 matches in 3 files');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
  });

  it('opens what it finds in the Find window, saying what and where', async () => {
    const { done } = await find('alpha');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await done;
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      worktree: '/r',
      title: "Occurrences of 'alpha' in Project",
      limited: false,
    });
    expect(shown[0]?.matches).toHaveLength(4);
    expect(searches().at(-1)?.limit).toBe(WHOLE_LIMIT);
    await find('alpha');
    await userEvent.click(button('Directory'));
    await userEvent.click(q('.playground-find__mask input'));
    const field = input('.playground-find__mask-field');
    await userEvent.clear(field);
    await userEvent.type(field, '*.ts, !*.test.ts');
    await userEvent.click(button('Open in Find Window'));
    expect(shown[1]?.title).toBe(
      "Occurrences of 'alpha' in Directory src with mask '*.ts, !*.test.ts'",
    );
    await find('');
    await userEvent.click(q('.playground-find__mask input'));
    await userEvent.click(button('In Project'));
    // Nothing to search for: nothing opens, and Ctrl+Alt+Enter isn't Find's.
    await userEvent.keyboard('{Control>}{Enter}{/Control}{Control>}{Alt>}{Enter}{/Alt}{/Control}');
    expect(shown).toHaveLength(2);
    expect(document.querySelector('.cerebro-popup')).not.toBeNull();
  });

  it('says why the Find window can’t show what was searched for', async () => {
    await find('alpha');
    failing = 'rg: something\nrg: broke';
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(await dialogText()).toBe('rg: broke');
    expect(shown).toEqual([]);
  });
});

describe('the search history', () => {
  const historyButton = (label: string) => q(`.cerebro-popup__history[aria-label="${label}"]`);
  const historyItems = () =>
    [...document.querySelectorAll('.cerebro-popup')]
      .at(-1)
      ?.querySelectorAll('.cerebro-popup-item__label');

  it('keeps what was searched for as the popup closes, and offers it, as IntelliJ’s Find in Files', async () => {
    localStorage.clear();
    let { done } = await find('beta');
    await userEvent.keyboard('{Escape}');
    await done;
    ({ done } = await find('alpha'));
    await userEvent.keyboard('{Escape}');
    await done;
    expect(searchHistory.texts()).toEqual(['alpha', 'beta']);
    // Nothing typed: nothing kept.
    ({ done } = await find(''));
    await userEvent.click(historyButton('Search History'));
    expect([...(historyItems() ?? [])].map((l) => l.textContent)).toEqual(['alpha', 'beta']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(search().value).toBe('beta');
    await expect.poll(() => searches().at(-1)?.query).toBe('beta');
    // Alt+Down in the field, too.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(historyItems()).toHaveLength(2);
    await userEvent.keyboard('{Escape}{Escape}');
    await done;
    expect(searchHistory.texts()).toEqual(['beta', 'alpha']);
  });

  it('keeps what was replaced with, with its own history at the Replace field', async () => {
    localStorage.clear();
    disk.set('/r/r7/x.ts', 'omega\n');
    let { done } = await find('omega', { replacing: true, file: '/r/r7/x.ts' });
    await userEvent.type(input('.playground-find__replace'), 'psi');
    await expect.poll(labels).toEqual(['omega']);
    await userEvent.click(button('Replace'));
    await expect.poll(() => disk.get('/r/r7/x.ts')).toBe('psi\n');
    // Kept at Replace, the popup still open.
    expect(replaceHistory.texts()).toEqual(['psi']);
    expect(searchHistory.texts()).toEqual(['omega']);
    await userEvent.clear(input('.playground-find__replace'));
    await userEvent.type(input('.playground-find__replace'), 'chi');
    await userEvent.keyboard('{Escape}');
    await done;
    expect(replaceHistory.texts()).toEqual(['chi', 'psi']);
    ({ done } = await find('psi', { replacing: true, file: '/r/r7/x.ts' }));
    await userEvent.click(historyButton('Replace History'));
    expect([...(historyItems() ?? [])].map((l) => l.textContent)).toEqual(['chi', 'psi']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(input('.playground-find__replace').value).toBe('psi');
    await expect.poll(() => searches().at(-1)?.replace).toBe('psi');
    expect(document.activeElement).toBe(input('.playground-find__replace'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(historyItems()).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    // The field's own keys still: Escape closes. The replacement is kept: none for the next test.
    await userEvent.clear(input('.playground-find__replace'));
    await userEvent.keyboard('{Escape}');
    await done;
  });
});

describe('Replace in Files', () => {
  /** A file of its own, read into its document. */
  async function file(path: string, text: string): Promise<EditorDocument> {
    disk.set(path, text);
    return (await documentFor(path, () => '')) as EditorDocument;
  }

  it('replaces the highlighted line’s matches, saves the file, and searches again', async () => {
    await file('/r/r1/x.ts', 'beta beta\nbeta\n');
    const { done } = await find('beta', { replacing: true });
    // At once, not with an earlier answer: the typed search's timer held, as typing then a
    // press quicker than its delay would (taking longer, under a loaded run's, left this untested).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await userEvent.type(q('.playground-find__replace'), 'Gamma');
      await userEvent.click(button('Replace'));
      await expect.poll(() => disk.get('/r/r1/x.ts')).toBe('Gamma Gamma\nbeta\n');
      // The search again, after.
      vi.runOnlyPendingTimers();
    } finally {
      vi.useRealTimers();
    }
    expect(host.params('fs.write').at(-1)).toMatchObject({ label: 'Replace in Files' });
    await expect.poll(labels).toEqual(['beta']);
    await userEvent.click(toggle('Preserve case (Alt+E)'));
    await userEvent.keyboard('{Alt>}e{/Alt}{Alt>}e{/Alt}');
    expect(toggle('Preserve case (Alt+E)').getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(button('Replace'));
    await expect.poll(() => disk.get('/r/r1/x.ts')).toBe('Gamma Gamma\ngamma\n');
    await expect.poll(labels).toEqual([]);
    // Nothing left to replace.
    await userEvent.click(button('Replace'));
    await userEvent.keyboard('{Alt>}e{/Alt}{Escape}');
    await done;
  });

  it('replaces with the search that ran, when nothing was typed since', async () => {
    await file('/r/r6/x.ts', 'iota\n');
    const { done } = await find('iota', { replacing: true });
    const asked = host.params('search.text').length;
    await userEvent.clear(q('.playground-find__replace'));
    await userEvent.type(q('.playground-find__replace'), 'kappa');
    // The search for what was typed has run: none is waiting.
    await expect.poll(() => host.params('search.text').at(-1)).toMatchObject({ replace: 'kappa' });
    expect(host.params('search.text').length).toBeGreaterThan(asked);
    await expect.poll(labels).toEqual(['iota']);
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY * 2));
    await userEvent.click(button('Replace'));
    await expect.poll(() => disk.get('/r/r6/x.ts')).toBe('kappa\n');
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('leaves a line changed since the search, and says so', async () => {
    const doc = await file('/r/r2/x.ts', 'delta\n');
    await find('delta', { replacing: true });
    await expect.poll(labels).toEqual(['delta']);
    doc.edit([{ from: 0, to: 0, insert: '// ' }]);
    await userEvent.click(button('Replace'));
    expect(await dialogText()).toBe('1 line wasn’t replaced: changed since the search.');
    // Over the popup that opened it, so it takes the pointer.
    const close = (await dialog()).querySelector('.cerebro-dialog__button') as HTMLElement;
    const { x, y } = close.getBoundingClientRect();
    expect(document.elementFromPoint(x + 5, y + 5)).toBe(close);
    await press('Close');
    expect(doc.content()).toBe('// delta\n');
  });

  it('replaces every match after asking, with the popup closed', async () => {
    await file('/r/r3/x.ts', 'eps\neps eps\n');
    await file('/r/r3/y.ts', 'eps\n');
    const { done } = await find('eps', { replacing: true });
    await userEvent.clear(q('.playground-find__replace'));
    await userEvent.type(q('.playground-find__replace'), 'zeta');
    await userEvent.keyboard('{Control>}{Alt>}{Enter}{/Alt}{/Control}');
    await done;
    expect(await dialogText()).toBe('Replace 4 matches in 2 files with “zeta”?');
    await press('Cancel');
    expect(disk.get('/r/r3/x.ts')).toBe('eps\neps eps\n');
    await find('eps', { replacing: true });
    await userEvent.click(button('Replace All'));
    await press('Replace');
    await expect.poll(() => disk.get('/r/r3/x.ts')).toBe('zeta\nzeta zeta\n');
    expect(disk.get('/r/r3/y.ts')).toBe('zeta\n');
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
  });

  it('says why it replaces nothing: nothing found, too much, or the search failed', async () => {
    await find('nowhere', { replacing: true });
    await userEvent.click(button('Replace All'));
    expect(await dialogText()).toBe('Nothing found.');
    await press('Close');
    await find('', { replacing: true });
    await userEvent.click(button('Replace All'));
    expect(document.querySelector('.cerebro-dialog')).toBeNull();
    await closeAll();
    await find('a', { replacing: true });
    failing = 'rg: bad';
    await userEvent.click(button('Replace All'));
    expect(await dialogText()).toBe('rg: bad');
    await press('Close');
    failing = undefined;
    const many = Array.from({ length: WHOLE_LIMIT + 1 }, () => 'omega').join('\n');
    disk.set('/r/r4/many.ts', many);
    try {
      await find('omega', { replacing: true });
      await userEvent.click(button('Replace All'));
      expect(await dialogText()).toBe(
        `More than ${String(WHOLE_LIMIT)} lines match: narrow the search first.`,
      );
    } finally {
      disk.delete('/r/r4/many.ts');
    }
  });
});

describe('replacing lines', () => {
  it('leaves lines it can’t read, that aren’t there, or with nothing to replace with', async () => {
    disk.set('/r/r5/x.ts', 'one\n');
    const line = (path: string, n: number, replacements?: string[]): TextMatch => ({
      path,
      line: n,
      text: 'one',
      ranges: [[0, 3]],
      ...(replacements ? { replacements } : {}),
    });
    expect(
      await replaceLines([
        line('/r/r5/missing.ts', 0, ['x']),
        line('/r/r5/x.ts', 7, ['x']),
        line('/r/r5/x.ts', 0),
      ]),
    ).toEqual({ replaced: 0, skipped: 3 });
    // A match with no replacement of its own is replaced with nothing.
    expect(await replaceLines([{ ...line('/r/r5/x.ts', 0, []) }])).toEqual({
      replaced: 1,
      skipped: 0,
    });
    await expect.poll(() => disk.get('/r/r5/x.ts')).toBe('\n');
  });

  it('says how many lines weren’t replaced', async () => {
    disk.set('/r/r6/x.ts', 'kappa\nkappa\n');
    await find('kappa', { replacing: true });
    await expect.poll(labels).toEqual(['kappa', 'kappa']);
    const doc = (await documentFor('/r/r6/x.ts', () => '')) as EditorDocument;
    doc.edit([{ from: 0, to: doc.text.peek().length, insert: 'changed\n' }]);
    await userEvent.keyboard('{Control>}{Alt>}{Enter}{/Alt}{/Control}');
    await press('Replace');
    expect(await dialogText()).toBe('2 lines weren’t replaced: changed since the search.');
  });
});
