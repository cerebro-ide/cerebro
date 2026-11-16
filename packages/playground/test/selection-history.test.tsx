import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { formatCommitDate } from '../src/dates.js';
import type { LogCommit } from '../src/git-log.js';
import { changedRevisions, showSelectionHistory } from '../src/selection-history.js';
import { closeAll, dialog, FakeHost } from './fakes.js';

const commit = (hash: string, subject: string, body = ''): LogCommit => ({
  hash: hash.repeat(40),
  parents: [],
  author: `Author ${hash}`,
  email: 'a@x.org',
  time: 1000,
  subject,
  body,
  refs: [],
});
/** The latest first: c3 (HEAD) has the lines as c2 had them, lower down; c1 hadn't them. */
const COMMITS = [commit('3', 'Third'), commit('2', 'Second', 'Why'), commit('1', 'First')];
const TEXTS: Record<string, string | null> = {
  [COMMITS[0]?.hash as string]: 'x\nA\nB\nz\n',
  [COMMITS[1]?.hash as string]: 'p\nx\nA\nB\nz\n',
  [COMMITS[2]?.hash as string]: 'x\nz\n',
};
let commits = COMMITS;
let failing: string | undefined;
const host = new FakeHost({
  'git.log': ({ skip }: { skip: number }) => {
    if (failing === 'git.log') throw new Error('not a repository');
    return skip === 0 ? commits : [];
  },
  'git.fileAt': ({ hash }: { hash: string }) => {
    if (failing === 'git.fileAt') throw new Error('bad object');
    const text = TEXTS[hash];
    return text === null || text === undefined ? null : { text };
  },
});
const services = { commands: new CommandRegistry(), menus: new MenuRegistry() };
/** The lines a line lower than in c3, and changed. */
const open = (text = 'y\nx\nA2\nB\nz\n', first = 2, last = 3) =>
  void showSelectionHistory(services, {
    host,
    worktree: '/r',
    path: 'src/a.ts',
    text,
    first,
    last,
  });

afterEach(async () => {
  await closeAll();
  host.asked.length = 0;
  commits = COMMITS;
  failing = undefined;
});

const rows = () =>
  [...document.querySelectorAll('.playground-selection-history__row[aria-selected]')].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  );
const selected = () =>
  document.querySelector('.playground-selection-history__row--selected')?.children[0]?.textContent;
const status = () => document.querySelector('.playground-selection-history__status')?.textContent;
const note = () =>
  document.querySelector('.playground-selection-history__diff .playground-code__note')?.textContent;
const roots = () =>
  [...document.querySelectorAll('.playground-selection-history__diff *')]
    .map((e) => e.shadowRoot)
    .filter((root) => root !== null);
/** The diff's sides' texts, left then right. */
const diff = () =>
  roots().flatMap((root) =>
    [...root.querySelectorAll('.cm-content')].map((c) =>
      [...c.querySelectorAll('.cm-line')].map((line) => line.textContent).join('\n'),
    ),
  );
/** Each side's line numbers. */
const numbers = () =>
  roots().flatMap((root) =>
    [...root.querySelectorAll('.cm-lineNumbers')].map((gutter) =>
      [...gutter.querySelectorAll('.cm-gutterElement')]
        // Not the spacer, which only sizes the gutter.
        .filter((e) => (e as HTMLElement).style.visibility !== 'hidden')
        .map((e) => e.textContent),
    ),
  );
const message = () => document.querySelector('.playground-selection-history__text')?.textContent;

describe('the versions shown with Changes only', () => {
  it('are those whose lines differ from the one before, and the first to have them', () => {
    const lines = (text: string) => ({ lines: [text], start: 0 });
    expect(changedRevisions(['now', 'a', 'b'], [lines('x'), lines('x'), lines('y')])).toEqual([
      'a',
      'b',
    ]);
    // Not read yet: not known.
    expect(changedRevisions(['now', 'a', 'b'], [lines('x'), lines('y')])).toEqual(['now']);
    // Gone: the first without them isn't shown, nor any before it.
    expect(changedRevisions(['now', 'a', 'b'], [lines('x'), null, null])).toEqual(['now']);
    expect(changedRevisions(['now'], [lines('x')])).toEqual([]);
  });
});

describe('History for Selection', () => {
  it('follows the lines back, showing the commits that changed them, as IntelliJ’s', async () => {
    open();
    expect((await dialog()).querySelector('.cerebro-dialog__title')?.textContent).toBe(
      'History for Selection',
    );
    await expect.poll(status).toBe('');
    // c3 had them as c2 did; c1 hadn't them.
    expect(rows()).toEqual([
      ['Local Changes', '', '', ''],
      ['22222222', formatCommitDate(1000), 'Author 2', 'Second'],
    ]);
    expect(selected()).toBe('Local Changes');
    // The file as it is against c3, each numbered as in its version.
    await expect.poll(diff).toEqual(['A\nB', 'A2\nB']);
    expect(numbers()).toEqual([
      ['2', '3'],
      ['3', '4'],
    ]);
    expect(message()).toBe('');
    // c2 against c1, which hadn't them.
    await userEvent.click(
      document.querySelectorAll('.playground-selection-history__row[aria-selected]')[1] as Element,
    );
    await expect.poll(diff).toEqual(['', 'A\nB']);
    expect(message()).toBe('Second\n\nWhy');
    expect(host.params('git.log')).toEqual([
      { worktree: '/r', skip: 0, max: 500, filter: { paths: ['src/a.ts'] } },
    ]);
    // c1 isn't read: the lines were gone already.
    expect(host.params('git.fileAt')).toHaveLength(3);
  });

  it('shows every commit without Changes only, kept for the next time; keys move the selection', async () => {
    open();
    await expect.poll(status).toBe('');
    await userEvent.click(
      document.querySelector('.playground-selection-history__bar input') as Element,
    );
    expect(rows().map((row) => row[0])).toEqual([
      'Local Changes',
      '33333333',
      '22222222',
      '11111111',
    ]);
    (document.querySelector('.playground-selection-history__revisions') as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(selected()).toBe('33333333');
    expect(message()).toBe('Third');
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{x}');
    expect(selected()).toBe('Local Changes');
    // The last commit has none before it: shown against nothing.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(selected()).toBe('11111111');
    await closeAll();
    open();
    await expect.poll(status).toBe('');
    expect(rows()).toHaveLength(4);
    await userEvent.click(
      document.querySelector('.playground-selection-history__bar input') as Element,
    );
    expect(rows()).toHaveLength(2);
  });

  it('says what it’s loading, and why it can’t', async () => {
    failing = 'git.log';
    open();
    await expect.poll(note).toBe('Cannot load revision contents: not a repository');
    // Nothing to move through.
    (document.querySelector('.playground-selection-history__revisions') as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}');
    await closeAll();
    failing = 'git.fileAt';
    open();
    await expect.poll(note).toBe('Cannot load revision contents: bad object');
    expect(status()).toBe('');
  });

  it('shows the revision it’s reading, and how far it’s got', async () => {
    const releases: (() => void)[] = [];
    const held = new Promise<void>((resolve) => releases.push(resolve));
    const release = () => {
      for (const resolve of releases) resolve();
    };
    const answer = host.answers['git.fileAt'] as (p: { hash: string }) => unknown;
    host.answers['git.fileAt'] = async (p: { hash: string }) => {
      await held;
      return answer(p);
    };
    try {
      open();
      await expect.poll(status).toBe('Loading revision 33333333… (1/4)');
      // No commit known to have changed the lines yet.
      expect(note()).toBe('Loading affected revisions…');
      // Without Changes only, every commit: the one being read isn't shown yet.
      await userEvent.click(
        document.querySelector('.playground-selection-history__bar input') as Element,
      );
      await userEvent.click(
        document.querySelectorAll(
          '.playground-selection-history__row[aria-selected]',
        )[1] as Element,
      );
      expect(note()).toBe('Loading…');
      await userEvent.click(
        document.querySelector('.playground-selection-history__bar input') as Element,
      );
      release();
      await expect.poll(status).toBe('');
    } finally {
      host.answers['git.fileAt'] = answer;
    }
  });

  it('reads the commits a page at a time', async () => {
    commits = Array.from({ length: 500 }, () => commit('4', 'Many'));
    open('only\n', 0, 0);
    await expect.poll(status).toBe('');
    expect(host.params('git.log').map((p) => (p as { skip: number }).skip)).toEqual([0, 500]);
  });
});
