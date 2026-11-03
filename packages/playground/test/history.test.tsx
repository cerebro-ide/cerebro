import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { useProjects, workspace } from '../src/environments.js';
import { setupHistory } from '../src/history.js';
import { answer, closeAll, dialog, dialogText, FakeHost, press, project } from './fakes.js';

/** The file's versions, the latest first, and their texts. */
const REVISIONS = [
  { commit: 'c2', time: Date.UTC(2026, 9, 2, 10), label: 'Replace in Files', put: false },
  { commit: 'c1', time: Date.UTC(2026, 9, 1, 9), label: 'Before the refactor', put: true },
  { commit: 'c0', time: Date.UTC(2026, 9, 1, 8), label: 'Created', put: false },
];
const TEXTS: Record<string, string | null> = { c2: 'two\n', c1: 'one\n', c0: null };
let revisions = REVISIONS;
let failing: string | undefined;
let recorded: () => Promise<void> = () => Promise.resolve();
/** Records held back, by `hold`, until released. */
const held: (() => void)[] = [];
const hold = () => {
  recorded = () => new Promise((resolve) => held.push(resolve));
};
const release = () => {
  for (const resolve of held.splice(0)) resolve();
};
const host = new FakeHost({
  'history.record': () => recorded(),
  'history.file': () => {
    if (failing === 'history.file') throw new Error('not a repository');
    return revisions;
  },
  'history.text': ({ commit }: { commit: string }) => {
    if (commit === 'broken') throw new Error('gone');
    return { text: TEXTS[commit] };
  },
  'history.revert': () => {
    if (failing === 'history.revert') throw new Error('locked');
    return null;
  },
  'history.label': () => {
    if (failing === 'history.label') throw new Error('full');
    return null;
  },
  'fs.read': ({ path }: { path: string }) => {
    if (path.endsWith('gone.ts')) throw new Error('ENOENT');
    return { text: 'three\n' };
  },
});

const commands = new CommandRegistry();
const menus = new MenuRegistry();
let activeTab: string | undefined = '/r/src/a.ts';

beforeAll(() => {
  // Only the interval: the dialogs' and editors' own timers run as they do.
  vi.useFakeTimers({ toFake: ['setInterval'] });
  useProjects([project('/r', host)]);
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  setupHistory({ commands, menus }, { activeTab: () => activeTab });
});

afterEach(async () => {
  release();
  await closeAll();
  host.asked.length = 0;
  revisions = REVISIONS;
  failing = undefined;
  recorded = () => Promise.resolve();
  activeTab = '/r/src/a.ts';
  useProjects([project('/r', host)]);
  vi.restoreAllMocks();
});

const when = (time: number) =>
  new Date(time).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
const versions = () =>
  [...document.querySelectorAll('.playground-history__revision')].map((v) => v.textContent);
const selected = () =>
  document.querySelector('.playground-history__revision--selected')?.getAttribute('data-commit');
const revision = (commit: string) =>
  document.querySelector(`[data-commit="${commit}"]`) as HTMLElement;
/** The diff's editors' texts, left then right. */
const diff = () =>
  [...document.querySelectorAll('.playground-history__diff *')]
    .map((e) => e.shadowRoot)
    .filter((root) => root !== null)
    .flatMap((root) => [...root.querySelectorAll('.cm-content')].map((c) => c.textContent));

describe('Local History', () => {
  it('is in the File menu, and the editor’s and its tabs’, with Show History and Put Label', () => {
    for (const menu of ['main/file', 'editor/content', 'editor/tab']) {
      expect(menus.entries(menu)).toContainEqual(
        expect.objectContaining({ submenu: 'localHistory', label: 'Local &History' }),
      );
    }
    expect(menus.entries('localHistory').map((e) => 'command' in e && e.command)).toEqual([
      'history.show',
      'history.putLabel',
    ]);
  });

  it('shows a file’s history: its tab’s, a diff tab’s, or the active editor’s, in the worktree', () => {
    expect(commands.isEnabled('history.show')).toBe(true);
    expect(commands.isEnabled('history.show', { group: 'g', tab: 'diff:src/b.ts' })).toBe(true);
    expect(commands.isEnabled('history.show', { group: 'g', tab: '/elsewhere/b.ts' })).toBe(false);
    activeTab = undefined;
    expect(commands.isEnabled('history.show')).toBe(false);
    // Not without a host, or git.
    useProjects([project('/r', undefined)]);
    expect(commands.isEnabled('history.show', { group: 'g', tab: '/r/a.ts' })).toBe(false);
    expect(commands.isEnabled('history.putLabel')).toBe(false);
    useProjects([{ ...project('/r', host), git: false }]);
    expect(commands.isEnabled('history.show', { group: 'g', tab: '/r/a.ts' })).toBe(false);
    expect(commands.isEnabled('history.putLabel')).toBe(false);
  });

  it('lists the versions, the latest first and selected, each compared with the file now', async () => {
    hold();
    commands.execute('history.show');
    // What changed outside Cerebro is recorded first, so it's listed.
    await expect.poll(() => host.params('history.record')).toEqual([{ path: '/r' }]);
    expect(host.params('history.file')).toEqual([]);
    release();
    await dialog();
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toContain(
      'Local History: a.ts',
    );
    expect(host.params('history.file')).toEqual([{ path: '/r', file: 'src/a.ts' }]);
    expect(versions()).toEqual(REVISIONS.map((r) => `${when(r.time)}${r.label}`));
    expect(document.querySelector('.playground-history__label--put')?.textContent).toBe(
      'Before the refactor',
    );
    expect(selected()).toBe('c2');
    await expect.poll(diff).toEqual(['two', 'three']);
    await userEvent.click(revision('c1'));
    expect(selected()).toBe('c1');
    await expect.poll(diff).toEqual(['one', 'three']);
    // A version where the file wasn't is empty; each version is read once.
    await userEvent.click(revision('c0'));
    await expect.poll(diff).toEqual(['', 'three']);
    await userEvent.click(revision('c1'));
    await expect.poll(diff).toEqual(['one', 'three']);
    expect(host.params('history.text')).toEqual(
      ['c2', 'c1', 'c0'].map((commit) => ({ path: '/r', file: 'src/a.ts', commit })),
    );
    await press('Close');
    expect(host.params('history.revert')).toEqual([]);
  });

  it('says there’s no history yet, and compares a deleted file, or a version unread, as empty', async () => {
    revisions = [];
    commands.execute('history.show', { group: 'g', tab: '/r/gone.ts' });
    expect(await dialogText()).toBe('No local history yet');
    const revert = [...(await dialog()).querySelectorAll('button')].find(
      (b) => b.textContent === 'Revert',
    ) as HTMLButtonElement;
    expect(revert.disabled).toBe(true);
    await press('Close');
    revisions = [{ commit: 'broken', time: 0, label: 'x', put: false }];
    commands.execute('history.show', { group: 'g', tab: '/r/gone.ts' });
    await dialog();
    await expect.poll(diff).toEqual(['', '']);
  });

  it('reverts the file to the version selected, and reads the files again', async () => {
    commands.execute('history.show', { group: 'g', tab: 'diff:src/b.ts' });
    await dialog();
    await userEvent.click(revision('c1'));
    await press('Revert');
    await expect
      .poll(() => host.params('history.revert'))
      .toEqual([{ path: '/r', file: 'src/b.ts', commit: 'c1' }]);
  });

  it('says why it couldn’t read the history, or revert', async () => {
    failing = 'history.file';
    commands.execute('history.show');
    expect(await dialogText()).toBe('not a repository');
    expect(document.querySelector('.cerebro-dialog__title')?.textContent).toContain(
      'Couldn’t Read the History',
    );
    await press('Close');
    failing = 'history.revert';
    commands.execute('history.show');
    await dialog();
    await press('Revert');
    expect(await dialogText()).toBe('locked');
  });

  it('puts a label on the files, by a name typed', async () => {
    commands.execute('history.putLabel');
    const field = await answer('');
    await expect.poll(() => document.activeElement).toBe(field);
    const ok = [...(await dialog()).querySelectorAll('button')].find(
      (b) => b.textContent === 'OK',
    ) as HTMLButtonElement;
    await userEvent.type(field, '   ');
    expect(ok.disabled).toBe(true);
    await userEvent.type(field, ' Before release ');
    await press('OK');
    await expect
      .poll(() => host.params('history.label'))
      .toEqual([{ path: '/r', label: 'Before release' }]);
    commands.execute('history.putLabel');
    await answer('x');
    await press('Cancel');
    failing = 'history.label';
    commands.execute('history.putLabel');
    await answer('x');
    await press('OK');
    expect(await dialogText()).toBe('full');
    expect(host.params('history.label')).toHaveLength(2);
  });

  it('records changes made outside Cerebro when the window gets the focus, and now and then', async () => {
    hold();
    window.dispatchEvent(new Event('focus'));
    // Not again while it's under way.
    window.dispatchEvent(new Event('focus'));
    expect(host.params('history.record')).toEqual([{ path: '/r' }]);
    await expect.poll(() => held.length).toBe(1);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.advanceTimersByTime(30_000);
    expect(host.params('history.record')).toHaveLength(1);
    focused.mockReturnValue(true);
    recorded = () => Promise.reject(new Error('busy'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.advanceTimersByTime(30_000);
    expect(host.params('history.record')).toHaveLength(2);
    await expect
      .poll(() => logged.mock.calls[0]?.[0] as unknown)
      .toBe('Recording the Local History failed');
    // Not without a host.
    useProjects([project('/r', undefined)]);
    window.dispatchEvent(new Event('focus'));
    expect(host.params('history.record')).toHaveLength(2);
  });
});
