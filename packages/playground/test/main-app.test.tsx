import { Environments } from '@cerebro-ide/layout';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffSource, type EditorDocument } from '@cerebro-ide/ui-editor';
import { bookmarkedLines, toggleBookmark } from '../src/bookmarks.js';
import { diffTab, revisionTab } from '../src/changes.js';
import { compareTab } from '../src/compare-branches.js';
import { icon } from '../src/icons.js';
import { documentRead } from '../src/documents.js';
import { workspace } from '../src/environments.js';
import { carets, reveals } from '../src/navigation.js';
import { loadProjects } from '../src/projects.js';
import { globalSettings } from '../src/settings.js';
import { EMPTY_TREE } from '../src/git-log.js';
import {
  added,
  answers,
  calls,
  host,
  installBridge,
  jumped,
  notify,
  shownAgain,
  tabbed,
  askedDocument,
} from './app-bridge.js';
import { closeAll, dialog, dialogText, menuItem, menuItems, popupItems, press } from './fakes.js';

// The page, as the desktop app shows it: a window with a project, its host answering through the
// app's bridge. It's made once, as it's imported: each test goes on from where the last left it.

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  installBridge('linux');
  // The layout the window was left with: the main worktree, a file open.
  const saved = new Environments();
  saved.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  saved.active?.editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
  localStorage.setItem('cerebro.layout:/r', JSON.stringify({ environments: saved.state() }));
  await loadProjects();
  const app = document.createElement('div');
  app.id = 'app';
  document.body.append(app);
  await import('../src/main.js');
});

afterEach(async () => {
  await closeAll();
  answers.clear();
  vi.restoreAllMocks();
});

const q = (selector: string) => document.querySelector(selector) as HTMLElement;
/** The status bar's texts, of the items shown. */
const status = () =>
  [
    ...document.querySelectorAll('.cerebro-statusbar__item:not([hidden]) .cerebro-statusbar__text'),
  ].map((t) => t.textContent);
const stripe = (id: string) => q(`.cerebro-stripe-button[data-id="${id}"]`);
const tooltipText = () => document.querySelector('.cerebro-tooltip')?.textContent;
const env = () => workspace.active as NonNullable<typeof workspace.active>;
const editorRoot = () =>
  document.querySelector('.cerebro-editor-group--active .cerebro-editor-code')?.shadowRoot;
const code = () => editorRoot()?.querySelector<HTMLElement>('.cm-content');
const row = (key: string) =>
  [...document.querySelectorAll('.cerebro-tree-row')].find((r) =>
    r.getAttribute('data-key')?.endsWith(key),
  ) as HTMLElement;

describe('the page in the app', () => {
  it('opens the window’s project as it was left, named after it, in the app’s look', async () => {
    expect(document.documentElement.classList).toContain('cerebro-app');
    expect(document.documentElement.classList).toContain('cerebro-platform-linux');
    expect(document.title).toBe('r');
    expect(env().id).toBe('/r');
    expect(env().editor.activeGroup.active).toBe('/r/src/a.ts');
    await expect.poll(() => code()?.textContent).toContain('// /r/src/a.ts');
    expect(calls).toContainEqual(['scale', expect.any(String)]);
    expect(status()[0]).toBe('r · main');
  });

  it('shows the index’s progress in the status bar, from the host', async () => {
    notify('/r', 'index.progress', { worktree: '/r', done: 1, total: 4 });
    await expect.poll(() => status()[2]).toBe('Indexing… 1 / 4');
    const item = document.querySelectorAll('.cerebro-statusbar__item')[2] as HTMLElement;
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('The worktree’s sources, indexed for navigation by name');
    await userEvent.unhover(item);
    notify('/r', 'index.progress', { worktree: '/r', done: 4, total: 4 });
    await expect.poll(() => status()[2]).toBe('Indexed');
  });
});

describe('a comparison’s tab', () => {
  it('opens from the branches popup, comparing in the worktree, its icon Diff’s', async () => {
    answers.set('git.branches', [
      { ref: 'refs/heads/main', current: true },
      { ref: 'refs/heads/feature', current: false },
    ]);
    answers.set('git.tags', []);
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Branches');
    await expect.poll(popupItems).toContain('Branches…');
    await userEvent.keyboard('{Enter}');
    await expect.poll(popupItems).toContain('feature');
    await userEvent.click(
      [...document.querySelectorAll('.cerebro-popup-item')].find((item) =>
        item.textContent.includes('feature'),
      ) as Element,
    );
    await userEvent.click(menuItem("Compare with 'main'"));
    await expect
      .poll(() => document.querySelector('.playground-compare__explanation')?.textContent)
      .toBe("Commits that exist in feature but don't exist in main");
    expect(env().editor.activeGroup.active).toBe(compareTab('main', 'feature').id);
    expect(host('/r').params('git.log')).toContainEqual(
      expect.objectContaining({ worktree: '/r', branches: ['main..feature'] }),
    );
    expect(
      document.querySelector('.cerebro-editor-tab--active .cerebro-editor-tab__icon path')
        ?.outerHTML,
    ).toBe((icon('diff') as Element).querySelector('path')?.outerHTML);
    // It shows no file: none in the status bar, nor in Recent Files.
    expect(status().join(' ')).not.toContain('compare:');
    await userEvent.keyboard('{Control>}e{/Control}');
    await popupItems();
    expect(document.querySelector('.cerebro-popup')?.textContent).not.toContain('Compare');
    await userEvent.keyboard('{Escape}');
    env().editor.close(env().editor.activeGroup.id, compareTab('main', 'feature').id);
  });
});

describe('Show Diff with Working Tree', () => {
  it('shows the files that differ in a Changes tool window on the left, there from then on', async () => {
    answers.set('git.branches', [
      { ref: 'refs/heads/main', current: true },
      { ref: 'refs/heads/feature', current: false },
    ]);
    answers.set('git.tags', []);
    answers.set('git.changes', [{ path: 'src/a.ts', status: 'modified' }]);
    const showDiff = async (branch: string) => {
      await userEvent.keyboard('{Shift}{Shift}');
      await popupItems();
      await userEvent.keyboard('Branches');
      await expect.poll(popupItems).toContain('Branches…');
      await userEvent.keyboard('{Enter}');
      await expect.poll(popupItems).toContain(branch);
      await userEvent.click(
        [...document.querySelectorAll('.cerebro-popup-item')].find(
          (item) => item.querySelector('.cerebro-popup-item__label')?.textContent === branch,
        ) as Element,
      );
      await userEvent.click(menuItem('Show Diff with Working Tree'));
    };
    const window = '.cerebro-tool-window[data-id="vcsChanges"]';
    const words = () =>
      document.querySelector(`${window} .playground-compare__explanation`)?.textContent;
    expect(q('.cerebro-stripe-button[data-id="vcsChanges"]')).toBeNull();
    await showDiff('feature');
    await expect
      .poll(words)
      .toBe('Difference between current working tree on main and files in feature:');
    // Under its folder, as IntelliJ's changes trees group them.
    await expect
      .poll(() =>
        [...document.querySelectorAll(`${window} .cerebro-tree-row`)].map((r) => r.textContent),
      )
      .toContain('a.ts');
    // Again: in the same window, in place of the one before.
    await showDiff('main');
    await expect
      .poll(words)
      .toBe('Difference between current working tree on main and files in main:');
    expect(document.querySelectorAll('.cerebro-stripe-button[data-id="vcsChanges"]')).toHaveLength(
      1,
    );
    answers.delete('git.changes');
  });
});

describe('a repository version’s tab', () => {
  it('shows the file as it was at the commit, as Open Repository Version opens it', async () => {
    answers.set('git.fileAt', { text: 'then\n' });
    env().editor.open(revisionTab('src/a.ts', 'c0ffee'));
    await expect
      .poll(
        () =>
          document
            .querySelector('.cerebro-editor-group--active .cerebro-editor-code')
            ?.shadowRoot?.querySelector('.cm-content')?.textContent,
      )
      .toBe('then');
    expect(host('/r').params('git.fileAt')).toEqual([
      { path: '/r', hash: 'c0ffee', file: 'src/a.ts' },
    ]);
    expect(
      document.querySelector('.cerebro-editor-group--active .cerebro-editor-tab--active')
        ?.textContent,
    ).toContain('a.ts (c0ffee)');
    // Its gutter's menu: Annotate with Git Blame, blamed at its commit; none in its text.
    const root = () =>
      document.querySelector('.cerebro-editor-group--active .cerebro-editor-code')?.shadowRoot;
    await userEvent.click(root()?.querySelector('.cm-content') as HTMLElement, { button: 'right' });
    expect(document.querySelector('.cerebro-menu')).toBeNull();
    const hash = 'a'.repeat(40);
    answers.set('git.blame', {
      lines: [hash],
      commits: [{ hash, author: 'Ada Lovelace', email: '', time: 0, committed: 0, message: 'M' }],
    });
    await userEvent.click(root()?.querySelector('.cm-gutters') as HTMLElement, { button: 'right' });
    expect(await menuItems()).toEqual(['Annotate with Git Blame']);
    await userEvent.click(menuItem('Annotate with Git Blame'));
    const annotations = () =>
      [...(root()?.querySelectorAll('.cerebro-annotation') ?? [])]
        .map((a) => a.textContent)
        .join('');
    await expect.poll(annotations).toContain('Lovelace');
    expect(host('/r').params('git.blame').at(-1)).toMatchObject({
      file: 'src/a.ts',
      hash: 'c0ffee',
    });
    // Again: closed.
    await userEvent.click(root()?.querySelector('.cm-gutters') as HTMLElement, { button: 'right' });
    await menuItems();
    await userEvent.click(menuItem('Annotate with Git Blame'));
    await expect.poll(annotations).toBe('');
    answers.delete('git.blame');
    env().editor.close(env().editor.activeGroup.id, revisionTab('src/a.ts', 'c0ffee').id);
    answers.delete('git.fileAt');
  });
});

describe('a diff tab', () => {
  it('shows the changes the host reads, or why it can’t', async () => {
    const sides = () => [
      ...(document
        .querySelector('.cerebro-editor-group--active .cerebro-editor-diff')
        ?.shadowRoot?.querySelectorAll('.cm-content') ?? []),
    ];
    env().editor.open(diffTab('src/a.ts', { from: 'a1', to: 'b2' }));
    await expect.poll(() => sides().map((side) => side.textContent)).toEqual(['a', 'b']);
    expect(host('/r').params('git.diff')).toContainEqual({
      path: '/r',
      file: 'src/a.ts',
      from: 'a1',
      to: 'b2',
    });
    // As it is: the right side is the file's document, as IntelliJ's, and edits it.
    answers.set('fs.read', { text: 'd\n' });
    env().editor.open(diffTab('src/edited.ts'));
    await expect.poll(() => sides().map((side) => side.textContent)).toEqual(['a', 'd']);
    const doc = documentRead('/r/src/edited.ts') as EditorDocument;
    await userEvent.click(sides()[1] as Element);
    await userEvent.keyboard('{Control>}{End}{/Control}// typed');
    expect(doc.text.get().toString()).toBe('d\n// typed');
    expect(doc.modified.get()).toBe(true);
    // Edited elsewhere (its tab): shown.
    doc.replace('c\n');
    await expect.poll(() => sides().map((side) => side.textContent)).toEqual(['a', 'c']);
    doc.saved();
    answers.delete('fs.read');
    env().editor.close(env().editor.activeGroup.id, diffTab('src/edited.ts').id);
    // Deleted: its document can't be read; what git has, not edited.
    answers.set('fs.read', new Error('ENOENT'));
    answers.set('git.diff', { original: 'gone\n', text: '' });
    env().editor.open(diffTab('src/deleted.ts'));
    await expect.poll(() => sides().map((side) => side.textContent)).toEqual(['gone', '']);
    await userEvent.click(sides()[1] as Element);
    await userEvent.keyboard('x');
    expect(sides()[1]?.textContent).toBe('');
    answers.delete('fs.read');
    env().editor.close(env().editor.activeGroup.id, diffTab('src/deleted.ts').id);
    answers.set('git.diff', new Error('no such file'));
    env().editor.open(diffTab('src/b.ts'));
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-editor-group--active .playground-code__note')
            ?.textContent,
      )
      .toBe('Can’t show the changes to src/b.ts: no such file');
  });

  it('shows an image’s two versions in the image diff, and says whether another binary differs', async () => {
    const active = (selector: string) =>
      [...document.querySelectorAll(`.cerebro-editor-group--active ${selector}`)].map(
        (e) => e.textContent,
      );
    // A PNG's first bytes: enough for its sides, not to show.
    const png = btoa('\x89PNG\r\n\x1a\n\0');
    answers.set('git.diff', { binary: true, original: png, text: null });
    env().editor.open(diffTab('art/logo.png', { from: 'abcdef0123', to: '9876543210' }));
    await expect.poll(() => active('.cerebro-image-diff__title')).toEqual(['abcdef01']);
    expect(active('.cerebro-image-diff__empty')).toEqual(['No image']);
    expect(active('.cerebro-image-diff__status')).toEqual(['Files contents are different']);
    env().editor.close(
      env().editor.activeGroup.id,
      diffTab('art/logo.png', { from: 'abcdef0123', to: '9876543210' }).id,
    );
    answers.set('git.diff', { binary: true, original: null, text: png });
    env().editor.open(diffTab('art/new.png'));
    await expect.poll(() => active('.cerebro-image-diff__title')).toEqual(['Your version']);
    env().editor.close(env().editor.activeGroup.id, diffTab('art/new.png').id);
    // Not an image: whether it differs, as IntelliJ's.
    answers.set('git.diff', { binary: true, original: png, text: png });
    env().editor.open(diffTab('lib/a.bin'));
    await expect
      .poll(() => active('.playground-code__note'))
      .toEqual(['Files contents are identical']);
    env().editor.close(env().editor.activeGroup.id, diffTab('lib/a.bin').id);
    answers.set('git.diff', { binary: true, original: png, text: null });
    env().editor.open(diffTab('lib/b.bin'));
    await expect
      .poll(() => active('.playground-code__note'))
      .toEqual(['Files contents are different']);
    env().editor.close(env().editor.activeGroup.id, diffTab('lib/b.bin').id);
    answers.delete('git.diff');
  });

  it('jumps to the source a diff window sends back, if the file’s still there', async () => {
    answers.set('fs.exists', false);
    jumped({ env: '/r', path: 'src/gone.ts', line: 1, column: 0 });
    await expect
      .poll(() => host('/r').params('fs.exists'))
      .toContainEqual({
        path: '/r/src/gone.ts',
      });
    answers.delete('fs.exists');
    jumped({ env: '/r', path: 'src/c.ts', line: 2, column: 3 });
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/c.ts');
    expect(env().editor.activeGroup.tabs.map((tab) => tab.id)).not.toContain('/r/src/gone.ts');
  });
});

describe('a diff window’s document', () => {
  it('is this window’s, told to its diff windows as it changes, and edited from them', async () => {
    const file = '/r/src/shared.ts';
    const told = () => calls.filter((call) => call[0] === 'documentText' && call[1] === file);
    answers.set('fs.read', { text: 'disk\n' });
    askedDocument(file, null);
    await expect.poll(told).toEqual([['documentText', file, 'disk\n']]);
    const doc = documentRead(file) as EditorDocument;
    // Edited from a diff window: the document's text, told back.
    askedDocument(file, 'edited\n');
    await expect.poll(() => doc.text.get().toString()).toBe('edited\n');
    expect(doc.modified.get()).toBe(true);
    await expect.poll(() => told().at(-1)).toEqual(['documentText', file, 'edited\n']);
    // Changed here: told.
    doc.replace('here\n');
    await expect.poll(() => told().at(-1)).toEqual(['documentText', file, 'here\n']);
    // Asked again, by another diff window: told as it is.
    const before = told().length;
    askedDocument(file, null);
    await expect.poll(() => told().length).toBe(before + 1);
    doc.saved();
    answers.delete('fs.read');
    // One that can't be read: null.
    answers.set('fs.read', new Error('ENOENT'));
    askedDocument('/r/src/none.ts', null);
    await expect.poll(() => calls.at(-1)).toEqual(['documentText', '/r/src/none.ts', null]);
    answers.delete('fs.read');
  });
});

describe('a diff moved between a window and a tab', () => {
  it('shows a diff window’s diff as a tab of its worktree, if open, and moves it back to a window', async () => {
    answers.set('git.diff', { original: 'a\n', text: 'b\n' });
    const { id: group, active: before } = env().editor.activeGroup;
    tabbed({ project: '/r', env: '/gone', path: 'src/m.ts' });
    expect(env().editor.activeGroup.active).not.toBe(diffTab('src/m.ts').id);
    tabbed({ project: '/r', env: '/r', path: 'src/n.ts' });
    tabbed({ project: '/r', env: '/r', path: 'src/m.ts' });
    expect(env().editor.activeGroup.active).toBe(diffTab('src/m.ts').id);
    const gear = await vi.waitUntil(() =>
      document.querySelector('.cerebro-editor-group--active [data-menu="diff/settings"]'),
    );
    await userEvent.click(gear);
    const item = [...document.querySelectorAll('.cerebro-menu [role^="menuitem"]')].find((i) =>
      i.textContent.includes('Show Diff in Separate Window'),
    ) as Element;
    await userEvent.click(item);
    const ids = env().editor.activeGroup.tabs.map((tab) => tab.id);
    expect(ids).not.toContain(diffTab('src/m.ts').id);
    expect(ids).not.toContain(diffTab('src/n.ts').id);
    // Every diff tab moves, as IntelliJ's, the one chosen from last, so its window is in front.
    expect(calls.filter((call) => call[0] === 'diff').slice(-2)).toEqual([
      ['diff', { project: '/r', env: '/r', path: 'src/n.ts' }],
      ['diff', { project: '/r', env: '/r', path: 'src/m.ts' }],
    ]);
    // As it was found, for the tests after.
    env().editor.activate(group, before as string);
  });
});

describe('a file that can’t be read', () => {
  it('says why', async () => {
    answers.set('fs.read', new Error('EACCES'));
    env().editor.open({ id: '/r/locked.ts', title: 'locked.ts' });
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-editor-group--active .playground-code__note')
            ?.textContent,
      )
      .toBe('Can’t open /r/locked.ts: EACCES');
    // Nothing of its own on the status bar.
    expect(status()).not.toContain('UTF-8');
  });
});

describe('a file with Windows’ line breaks', () => {
  it('says so on the status bar', async () => {
    answers.set('fs.read', { text: 'one\r\ntwo\r\n' });
    env().editor.open({ id: '/r/crlf.txt', title: 'crlf.txt' });
    // Too few lines to tell its indent: the settings', IntelliJ's 4 spaces.
    await expect.poll(status).toEqual(expect.arrayContaining(['1:1', 'CRLF', 'UTF-8', '4 spaces']));
    const item = q('.cerebro-statusbar__item[data-id="separator"]');
    await userEvent.hover(item);
    await expect.poll(tooltipText).toBe('Line Separator: \\r\\n');
    await userEvent.unhover(item);
  });

  it('converts them from the status bar, as IntelliJ’s, and saves the file', async () => {
    answers.set('fs.read', { text: 'one\r\ntwo\r\n' });
    env().editor.open({ id: '/r/convert.txt', title: 'convert.txt' });
    const item = q('.cerebro-statusbar__item[data-id="separator"]');
    await expect.poll(() => item.textContent).toBe('CRLF');
    await userEvent.click(item);
    expect(q('.cerebro-menu-heading').textContent).toBe('Line Separator');
    expect(await menuItems()).toEqual([
      'CRLF - Windows (\\r\\n)',
      'LF - Unix and macOS (\\n)',
      'CR - Classic Mac OS (\\r)',
    ]);
    // The file's own can't be chosen.
    expect(
      [...document.querySelectorAll('.cerebro-menu-item--disabled')].map((i) => i.textContent),
    ).toEqual(['CRLF - Windows (\\r\\n)']);
    await userEvent.click(menuItem('CR - Classic Mac OS (\\r)'));
    await expect
      .poll(() => host('/r').params('fs.write').at(-1))
      .toEqual({ path: '/r/convert.txt', text: 'one\rtwo\r' });
    expect(item.textContent).toBe('CR');
    await userEvent.click(item);
    await userEvent.click(menuItem('LF - Unix and macOS (\\n)'));
    await expect
      .poll(() => host('/r').params('fs.write').at(-1))
      .toEqual({ path: '/r/convert.txt', text: 'one\ntwo\n' });
    expect(item.textContent).toBe('LF');
  });
});

describe('a file’s byte order mark', () => {
  it('is added or removed from the status bar’s encoding, as IntelliJ’s, and the file saved', async () => {
    answers.set('fs.read', { text: '\uFEFFone\n' });
    env().editor.open({ id: '/r/bom.txt', title: 'bom.txt' });
    const item = q('.cerebro-statusbar__item[data-id="encoding"]');
    await expect.poll(() => item.hidden).toBe(false);
    await userEvent.click(item);
    expect(q('.cerebro-menu-heading').textContent).toBe('File Encoding');
    expect(await menuItems()).toEqual(['Remove BOM']);
    await userEvent.click(menuItem('Remove BOM'));
    await expect
      .poll(() => host('/r').params('fs.write').at(-1))
      .toEqual({ path: '/r/bom.txt', text: 'one\n' });
    await userEvent.click(item);
    expect(await menuItems()).toEqual(['Add BOM']);
    await userEvent.click(menuItem('Add BOM'));
    await expect
      .poll(() => host('/r').params('fs.write').at(-1))
      .toEqual({ path: '/r/bom.txt', text: '\uFEFFone\n' });
  });
});

describe('the terminals', () => {
  const terminal = () => q('.cerebro-tool-window[data-id="terminal"]');
  const tabs = () =>
    [...terminal().querySelectorAll('.cerebro-tool-tab')].map((t) => t.textContent.trim());
  const writes = () =>
    host('/r')
      .params('terminal.write')
      .map((p) => (p as { data: string }).data)
      .join('');

  it('run the worktree’s agent and its shells, a tab each', async () => {
    await expect.poll(() => host('/r').params('terminal.open').length).toBe(2);
    expect(q('.cerebro-tool-window[data-id="claude"] .cerebro-terminal')).not.toBeNull();
    expect(tabs()).toHaveLength(1);
    await userEvent.click(q('.cerebro-tool-tabs__add[aria-label="New Tab"]'));
    await expect.poll(tabs).toHaveLength(2);
    expect(document.activeElement?.closest('.cerebro-terminal')).not.toBeNull();
    await userEvent.click(terminal().querySelectorAll('.cerebro-tool-tab')[0] as HTMLElement);
    await expect
      .poll(() => terminal().querySelector('.cerebro-tool-tab--active'))
      .toBe(terminal().querySelectorAll('.cerebro-tool-tab')[0]);
  });

  it('let the app’s shortcuts through, but not plain Ctrl+key, which programs use', async () => {
    await userEvent.click(terminal().querySelector('.cerebro-terminal') as HTMLElement);
    const before = writes();
    await userEvent.keyboard('{Control>}c{/Control}');
    await expect.poll(writes).toBe(`${before}\u0003`);
    // A modifier alone, and a key bound to nothing, are the program's too.
    await userEvent.keyboard('{Shift}{Alt>}q{/Alt}');
    // Alt+1 is the Project tool window's: it takes the keyboard from the terminal, as IntelliJ
    // activates a window, and Alt+1 again hides it.
    const shown = () => stripe('project').classList.contains('cerebro-stripe-button--active');
    const was = shown();
    await userEvent.keyboard('{Alt>}1{/Alt}');
    await expect
      .poll(() => document.activeElement?.closest('.cerebro-tool-window')?.getAttribute('data-id'))
      .toBe('project');
    await userEvent.keyboard('{Alt>}1{/Alt}');
    await expect.poll(shown).toBe(false);
    if (was) await userEvent.click(stripe('project'));
  });

  it('are renamed and closed from a tab’s menu; the last one closed hides the window', async () => {
    const tab = (i: number) => terminal().querySelectorAll('.cerebro-tool-tab')[i] as HTMLElement;
    await userEvent.click(tab(1), { button: 'right' });
    expect(await menuItems()).toEqual(['Rename Session…', 'Close Tab']);
    await userEvent.click(q('.cerebro-menu-item'));
    expect(await dialogText()).toContain('Session name:');
    await press('Cancel');
    await userEvent.click(tab(1), { button: 'right' });
    await userEvent.click(q('.cerebro-menu-item'));
    const field = (await dialog()).querySelector('input') as HTMLInputElement;
    await userEvent.clear(field);
    await userEvent.type(field, 'build{Enter}');
    await expect.poll(tabs).toContain('build');
    await userEvent.click(tab(1), { button: 'right' });
    await userEvent.click(document.querySelectorAll('.cerebro-menu-item')[1] as HTMLElement);
    await expect.poll(tabs).toHaveLength(1);
    await userEvent.click(q('.cerebro-tool-window[data-id="terminal"] [aria-label^="Close "]'));
    await expect
      .poll(() => document.querySelector('.cerebro-tool-window[data-id="terminal"]'))
      .toBeNull();
  });
});

describe('Find in Files', () => {
  const button = (label: string) =>
    [...document.querySelectorAll('.cerebro-popup button')].find(
      (b) => b.textContent === label,
    ) as HTMLElement;
  const found = () => ({
    matches: [{ path: '/r/src/a.ts', line: 1, text: 'const a = 1;', ranges: [[0, 5]] }],
    limited: false,
  });

  it('shows what it finds in the Find window, which appears the first time', async () => {
    answers.set('search.text', found);
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Shift>}f{/Shift}{/Control}');
    await popupItems().catch(() => undefined);
    await userEvent.keyboard('const');
    await expect.poll(() => button('Open in Find Window')).toBeDefined();
    await userEvent.click(button('Open in Find Window'));
    await expect
      .poll(() => document.querySelector('.cerebro-tool-window[data-id="find"]')?.textContent)
      .toContain('const');
    // Replace in Files, from Search Everywhere's actions: the window's there already.
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Replace in Files');
    await expect.poll(popupItems).toContain('Replace in Files…');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => button('Open in Find Window')).toBeDefined();
    await userEvent.keyboard('const');
    await userEvent.click(button('Open in Find Window'));
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
    expect(document.querySelector('.cerebro-tool-window[data-id="find"]')).not.toBeNull();
  });
});

describe('the Git window', () => {
  it('shows the Log, on Alt+9', async () => {
    answers.set('git.log', [
      {
        hash: 'c0',
        parents: [],
        author: 'Ada',
        email: 'ada@example.com',
        time: 0,
        subject: 'First',
        refs: ['HEAD -> refs/heads/main'],
      },
    ]);
    // A commit's files, for below.
    answers.set('git.changes', [
      { path: 'src/a.ts', status: 'added' },
      { path: 'src/b.ts', status: 'added' },
    ]);
    answers.set('git.diff', { original: '', text: 'const a = 1;\n' });
    await userEvent.keyboard('{Alt>}9{/Alt}');
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-tool-window[data-id="git"] .playground-log__message')
            ?.textContent,
      )
      .toBe('First');
    expect(host('/r').params('git.log')).toContainEqual({ worktree: '/r', skip: 0, max: 1000 });
    // The commits take the keyboard, as IntelliJ's commits table does.
    await expect
      .poll(() => document.activeElement?.closest('.playground-log__list'))
      .not.toBeNull();
    // A commit's file opens its diff in a window of its own, which goes through its files.
    const window = '.cerebro-tool-window[data-id="git"]';
    await userEvent.click(
      document.querySelector(`${window} .playground-log__commits .cerebro-tree-row`) as Element,
    );
    // Under its folder, as IntelliJ's changes trees group them.
    const file = await vi.waitUntil(() =>
      [...document.querySelectorAll(`${window} .playground-log__files .cerebro-tree-row`)].find(
        (row) => row.textContent === 'a.ts',
      ),
    );
    await userEvent.dblClick(file);
    expect(calls.at(-1)).toEqual([
      'diff',
      {
        project: '/r',
        env: '/r',
        path: 'src/a.ts',
        range: { from: EMPTY_TREE, to: 'c0' },
        chain: ['src/a.ts', 'src/b.ts'],
      },
    ]);
    // Chosen in a diff's Settings, in this window or another: as a tab.
    localStorage.setItem('cerebro.diff', JSON.stringify({ inTab: true }));
    const opened = calls.length;
    const { id: group, active: before } = env().editor.activeGroup;
    await userEvent.dblClick(file);
    expect(env().editor.activeGroup.active).toBe(
      diffTab('src/a.ts', { from: EMPTY_TREE, to: 'c0' }).id,
    );
    expect(calls.length).toBe(opened);
    localStorage.removeItem('cerebro.diff');
    env().editor.close(group, env().editor.activeGroup.active as string);
    env().editor.activate(group, before as string);
    await userEvent.keyboard('{Alt>}9{/Alt}');
  });
});

describe('Git → Current File → Show Diff', () => {
  it('opens the editor’s file at its caret line, in a tab or a window of its own', async () => {
    const run = async () => {
      await userEvent.click(await vi.waitUntil(code));
      carets.set('/r/src/a.ts', { line: 1, column: 0 });
      await userEvent.keyboard('{Shift}{Shift}');
      await popupItems();
      await userEvent.keyboard('Show Diff');
      await expect.poll(popupItems).toContain('Show Diff');
      await userEvent.keyboard('{Enter}');
    };
    await run();
    expect(calls.at(-1)).toEqual(['diff', { project: '/r', env: '/r', path: 'src/a.ts', line: 1 }]);
    localStorage.setItem('cerebro.diff', JSON.stringify({ inTab: true }));
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await run();
    const diff = () =>
      document.querySelector('.cerebro-editor-group--active .cerebro-editor-diff') ?? undefined;
    await expect.poll(diff).toBeDefined();
    expect(diffSource(diff() as Element)?.line).toBe(1);
    env().editor.close(env().editor.activeGroup.id, diffTab('src/a.ts').id);
    // Open already, behind the file's tab: made again as it's shown, at the line, which isn't kept
    // for its next opening.
    env().editor.open(diffTab('src/a.ts'));
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await run();
    expect(env().editor.activeGroup.active).toBe(diffTab('src/a.ts').id);
    await expect.poll(diff).toBeDefined();
    expect(diffSource(diff() as Element)?.line).toBe(1);
    env().editor.close(env().editor.activeGroup.id, diffTab('src/a.ts').id);
    env().editor.open(diffTab('src/a.ts'));
    await expect.poll(diff).toBeDefined();
    expect(diffSource(diff() as Element)?.line).toBe(0);
    env().editor.close(env().editor.activeGroup.id, diffTab('src/a.ts').id);
    localStorage.removeItem('cerebro.diff');
  });
});

describe('Ctrl+D', () => {
  it('duplicates in the editor, shows the Project view’s file’s diff, and nothing elsewhere', async () => {
    const diffs = () => calls.filter((call) => call[0] === 'diff');
    answers.set('fs.list', [
      { path: '/r/src', name: 'src', kind: 'directory' },
      { path: '/r/b.ts', name: 'b.ts', kind: 'file' },
    ]);
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.click(await vi.waitUntil(code));
    const before = diffs().length;
    const lines = () => code()?.querySelectorAll('.cm-line').length ?? 0;
    const count = lines();
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(lines()).toBe(count + 1);
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(lines()).toBe(count);
    expect(diffs()).toHaveLength(before);
    // The Project view's selected file, as IntelliJ's Compare.SameVersion takes it there.
    if (!document.querySelector('.cerebro-tool-window[data-id="project"]')) {
      await userEvent.click(stripe('project'));
    }
    window.dispatchEvent(new Event('focus'));
    await userEvent.click(await vi.waitUntil(() => row('/r/b.ts')));
    await userEvent.keyboard('{Control>}d{/Control}');
    await expect
      .poll(() => diffs().at(-1))
      .toEqual(['diff', { project: '/r', env: '/r', path: 'b.ts' }]);
    // A folder: no file to show.
    await userEvent.click(row('/r/src'));
    await userEvent.keyboard('{Control>}d{/Control}');
    // Another tool window, which has no file: not the editor's.
    await userEvent.click(stripe('git'));
    await vi.waitUntil(() =>
      document.querySelector('.cerebro-tool-window[data-id="git"] .cerebro-tree'),
    );
    (
      document.querySelector('.cerebro-tool-window[data-id="git"] .cerebro-tree') as HTMLElement
    ).focus();
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(diffs()).toHaveLength(before + 1);
    await userEvent.click(stripe('git'));
    answers.delete('fs.list');
  });
});

describe('Git → Current File → Show History', () => {
  it('shows the Git window, its Log the editor file’s commits on HEAD', async () => {
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.click(await vi.waitUntil(code));
    // Once, in CI (#221, 2026-11-12), the popup didn't open: the taps' times and the window's
    // focus, to show why if it happens again (double Shift wants its taps 400 ms apart at most).
    const taps: string[] = [];
    const tapped = (event: Event) => {
      taps.push(
        `${event.type} ${String(Math.round(performance.now()))} ${String(document.hasFocus())}`,
      );
    };
    for (const type of ['keyup', 'blur']) window.addEventListener(type, tapped);
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems().catch((error: unknown) => {
      console.log('Double Shift:', taps.join(', '));
      throw error;
    });
    for (const type of ['keyup', 'blur']) window.removeEventListener(type, tapped);
    await userEvent.keyboard('Show History');
    await expect.poll(popupItems).toContain('Show History');
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => host('/r').params('git.log').at(-1))
      .toEqual({
        worktree: '/r',
        skip: 0,
        max: 1000,
        branches: ['HEAD'],
        filter: { paths: ['src/a.ts'] },
      });
    expect(document.querySelector('.cerebro-tool-window[data-id="git"]')).not.toBeNull();
    // Closed, and its filters back, for the tests after.
    await userEvent.keyboard('{Alt>}9{/Alt}');
  });
});

describe('Git → Current File → Compare with Branch or Tag…', () => {
  it('opens the file against the branch chosen, in a window named after the current branch', async () => {
    answers.set('git.branches', [
      { ref: 'refs/heads/main', current: true },
      { ref: 'refs/heads/other', current: false },
    ]);
    answers.set('git.tags', []);
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Compare with Branch');
    await expect.poll(popupItems).toContain('Compare with Branch or Tag…');
    await userEvent.keyboard('{Enter}');
    await expect.poll(popupItems).toEqual(['other']);
    await userEvent.keyboard('{Enter}');
    // Then the file's text, told to the window: its right side is the file as it is.
    await expect
      .poll(() => calls.filter((call) => call[0] === 'diff').at(-1))
      .toEqual([
        'diff',
        {
          project: '/r',
          env: '/r',
          path: 'src/a.ts',
          range: { from: 'refs/heads/other' },
          branch: 'main',
        },
      ]);
  });
});

describe('the Commit window', () => {
  it('is shown by Commit, its changes and shelved files opening their diffs', async () => {
    answers.set('git.changes', ({ from }: { from?: string }) =>
      from === undefined
        ? [{ path: 'src/a.ts', status: 'modified' }]
        : [{ path: 'src/s.ts', status: 'added' }],
    );
    answers.set('git.shelves', [{ id: 's1', commit: 'c', base: 'b', message: 'Aside', time: 0 }]);
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}k{/Control}');
    await expect.poll(() => row(':src/a.ts')).toBeDefined();
    await userEvent.dblClick(row(':src/a.ts'));
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/a.ts');
    await userEvent.click(row(':src/a.ts'));
    await userEvent.keyboard('{Control>}d{/Control}');
    // One file alone: nothing to go through.
    expect(calls.at(-1)).toEqual(['diff', { project: '/r', env: '/r', path: 'src/a.ts' }]);
    // Show Shelf, from Search Everywhere's actions.
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Show Shelf');
    await expect.poll(popupItems).toContain('Show Shelf');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => row('shelf:s1')).toBeDefined();
    await userEvent.dblClick(row('shelf:s1'));
    await expect.poll(() => row('shelf:s1:src/s.ts')).toBeDefined();
    await userEvent.click(row('shelf:s1:src/s.ts'));
    await userEvent.keyboard('{Control>}d{/Control}');
    expect(calls.at(-1)).toEqual([
      'diff',
      { project: '/r', env: '/r', path: 'src/s.ts', range: { from: 'b', to: 'c' } },
    ]);
  });
});

describe('the Agent Changes window', () => {
  it('opens a file a turn changed', async () => {
    answers.set('agent.turns', [{ id: 't2', start: 'b', end: 'c', prompt: 'Fix it', time: 0 }]);
    answers.set('git.changes', ({ from }: { from?: string }) =>
      from === undefined ? [] : [{ path: 'src/t.ts', status: 'modified' }],
    );
    await userEvent.click(stripe('agentChanges'));
    await expect.poll(() => row('turn:t2')).toBeDefined();
    await userEvent.dblClick(row('turn:t2'));
    await expect.poll(() => row('turn:t2:src/t.ts')).toBeDefined();
    await userEvent.dblClick(row('turn:t2:src/t.ts'));
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/t.ts');
    await userEvent.click(stripe('agentChanges'));
  });
});

describe('Local History', () => {
  it('shows the active file’s, from Search Everywhere', async () => {
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.keyboard('{Shift}{Shift}');
    await popupItems();
    await userEvent.keyboard('Show History');
    await expect.poll(popupItems).toContain('Show History');
    await userEvent.keyboard('{Escape}');
  });
});

describe('navigation in the editor', () => {
  const b = { path: '/r/src/b.ts', line: 0, column: 0, name: 'a' };
  const active = () => env().editor.activeGroup.active;
  /** Back to c.ts, the caret on its `a`. */
  const onA = async () => {
    env().editor.open({ id: '/r/src/c.ts', title: 'c.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{End}');
    await userEvent.keyboard('{ArrowLeft}'.repeat(6));
  };

  it('goes to a definition, finds usages, and goes where a gutter mark says', async () => {
    answers.set('index.definitions', [b]);
    answers.set('lsp.markers', [{ line: 1, kind: 'implemented', name: 'a', targets: [b] }]);
    await onA();
    await userEvent.keyboard('{Control>}b{/Control}');
    await expect.poll(active).toBe('/r/src/b.ts');
    await closeAll();
    // Go to Implementation and Go to Type Declaration, from the language server.
    answers.set('lsp.implementations', [b]);
    await onA();
    await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}');
    await expect.poll(active).toBe('/r/src/b.ts');
    await closeAll();
    answers.set('lsp.typeDefinitions', [b]);
    await onA();
    await userEvent.keyboard('{Control>}{Shift>}B{/Shift}{/Control}');
    await expect.poll(active).toBe('/r/src/b.ts');
    await onA();
    await userEvent.keyboard('{Alt>}{F7}{/Alt}');
    await expect
      .poll(() => host('/r').params('index.usages'))
      .toContainEqual({ worktree: '/r', name: 'a' });
    await closeAll();
    // Ctrl over a name asks whether it has a definition, to show it as a link.
    const asked = host('/r').params('index.definitions').length;
    const line = editorRoot()?.querySelectorAll<HTMLElement>('.cm-line')[1] as HTMLElement;
    await userEvent.keyboard('{Control>}');
    await userEvent.hover(line, { position: { x: 3, y: 3 } });
    await expect.poll(() => host('/r').params('index.definitions').length).toBeGreaterThan(asked);
    await userEvent.keyboard('{/Control}');
    const mark = await vi.waitUntil(() =>
      editorRoot()?.querySelector<HTMLElement>('.cerebro-marker'),
    );
    await userEvent.click(mark);
    await expect.poll(active).toBe('/r/src/b.ts');
    // Go to Super Method: where the up marker of the symbol around the caret goes.
    await closeAll();
    answers.set('lsp.structure', [
      {
        name: 'a',
        from: { line: 0, column: 0 },
        to: { line: 3, column: 0 },
        at: { line: 1, column: 0 },
        children: [],
      },
    ]);
    answers.set('lsp.markers', [{ line: 1, kind: 'overrides', name: 'a', targets: [b] }]);
    await onA();
    await userEvent.keyboard('{Control>}u{/Control}');
    await expect.poll(active).toBe('/r/src/b.ts');
    // Next Method: the structure's next symbol after the caret's line.
    await closeAll();
    answers.set('lsp.structure', [
      {
        name: 'z',
        from: { line: 2, column: 0 },
        to: { line: 2, column: 5 },
        at: { line: 2, column: 1 },
        children: [],
      },
    ]);
    await onA();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await expect.poll(() => reveals.get('/r/src/c.ts')).toEqual({ line: 2, column: 1 });
    // Call Hierarchy: the Hierarchy tool window, with what calls the function at the caret.
    await closeAll();
    answers.set('lsp.prepareCalls', [
      { name: 'a', kind: 'function', path: '/r/src/c.ts', at: { line: 1, column: 0 }, calls: [] },
    ]);
    answers.set('lsp.incomingCalls', [
      { name: 'z', path: '/r/src/b.ts', at: { line: 0, column: 0 }, calls: [], item: 1 },
    ]);
    await onA();
    await userEvent.keyboard('{Control>}{Alt>}h{/Alt}{/Control}');
    await expect
      .poll(() => document.querySelector('.playground-occurrences__title')?.textContent)
      .toBe('Callers of a()');
    await expect
      .poll(() => document.querySelectorAll('.cerebro-tree-row').length)
      .toBeGreaterThan(1);
    // Again, in the window there: nothing for no function at the caret.
    answers.set('lsp.prepareCalls', [
      { name: 'b', kind: 'function', path: '/r/src/c.ts', at: { line: 1, column: 0 }, calls: [] },
    ]);
    await onA();
    await userEvent.keyboard('{Control>}{Alt>}h{/Alt}{/Control}');
    await expect
      .poll(() => document.querySelector('.playground-occurrences__title')?.textContent)
      .toBe('Callers of b()');
    answers.set('lsp.prepareCalls', []);
    await onA();
    await userEvent.keyboard('{Control>}{Alt>}h{/Alt}{/Control}');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('.playground-occurrences__title')?.textContent).toBe(
      'Callers of b()',
    );
    // Quick Definition: the declaration's lines in a popup; Edit Source opens it.
    await closeAll();
    answers.set('lsp.definitionSpans', [{ ...b, first: 0, last: 0 }]);
    await onA();
    await userEvent.keyboard('{Control>}{Shift>}I{/Shift}{/Control}');
    await vi.waitUntil(() => editorRoot()?.querySelector('.cerebro-quickDef'));
    await userEvent.keyboard('{F4}');
    await expect.poll(active).toBe('/r/src/b.ts');
  });
});

describe('bookmarks', () => {
  const marked = () =>
    [...(editorRoot()?.querySelectorAll('.cerebro-bookmarks .cm-gutterElement') ?? [])].flatMap(
      (element, index) => (element.querySelector('.cerebro-bookmark') ? [index] : []),
    );

  it('are toggled on the caret’s line on F11, shown in the gutter, and listed in their window', async () => {
    // On a file just opened, before its editor has said where its caret is: its first line.
    env().editor.open({ id: '/r/src/marked.ts', title: 'marked.ts' });
    expect(carets.get('/r/src/marked.ts')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11', code: 'F11' }));
    expect(bookmarkedLines('/r', '/r/src/marked.ts')).toEqual([0]);
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{F11}');
    expect(bookmarkedLines('/r', '/r/src/marked.ts')).toEqual([0, 1]);
    await expect.poll(marked).toEqual([0, 1]);
    // Taken away on F11 again.
    await userEvent.keyboard('{F11}');
    await expect.poll(marked).toEqual([0]);
    // Moved with its line, and kept where it went.
    await userEvent.keyboard('{Control>}{Home}{/Control}{Enter}');
    expect(bookmarkedLines('/r', '/r/src/marked.ts')).toEqual([1]);
    await userEvent.click(stripe('bookmarks'));
    await expect
      .poll(() =>
        [...document.querySelectorAll('[aria-label="Bookmarks"] .cerebro-tree-row')].map(
          (r) => r.textContent,
        ),
      )
      .toEqual(['rDefault', 'marked.tssrc', '2:']);
    await userEvent.dblClick(row('/r/src/marked.ts:1'));
    await expect.poll(() => reveals.get('/r/src/marked.ts')).toEqual({ line: 1, column: 0 });
    // Opened, it's read again: the host's file is as it was, without the line added above, and
    // the bookmark goes up with its line.
    await expect.poll(() => bookmarkedLines('/r', '/r/src/marked.ts')).toEqual([0]);
    await userEvent.click(stripe('bookmarks'));
    toggleBookmark('/r', '/r/src/marked.ts', 0);
  });

  it('are gone through from the caret’s line by Next and Previous Line Bookmark', async () => {
    /** Find Action's commands named so, of those on. */
    const listed = async (name: string) => {
      await userEvent.click(q('.cerebro-statusbar'));
      await userEvent.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
      await popupItems();
      await userEvent.keyboard(name);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [...document.querySelectorAll('.cerebro-popup-item__label')]
        .map((label) => label.textContent)
        .filter((label) => label === name);
    };
    const run = async (name: string) => {
      expect(await listed(name)).toEqual([name]);
      await userEvent.keyboard('{Enter}');
    };
    // None: nothing to go to.
    expect(await listed('Next Line Bookmark')).toEqual([]);
    await userEvent.keyboard('{Escape}');
    toggleBookmark('/r', '/r/src/b.ts', 1);
    toggleBookmark('/r', '/r/src/c.ts', 0);
    // From no file: the first.
    for (const group of env().editor.groups) {
      for (const tab of group.tabs) env().editor.close(group.id, tab.id);
    }
    await run('Next Line Bookmark');
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/b.ts');
    await expect.poll(() => reveals.get('/r/src/b.ts')).toEqual({ line: 1, column: 0 });
    // From the caret's line: the one before it.
    env().editor.open({ id: '/r/src/d.ts', title: 'd.ts' });
    await run('Previous Line Bookmark');
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/c.ts');
    await expect.poll(() => carets.get('/r/src/c.ts')?.line).toBe(0);
    expect(await listed('Next Line Bookmark')).toEqual([]);
    await userEvent.keyboard('{Escape}');
    // Show Bookmarks, on Shift+F11: the popup, in the order added.
    await userEvent.keyboard('{Shift>}{F11}{/Shift}');
    expect(await popupItems()).toEqual(['b.ts :2', 'c.ts :1']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/b.ts');
    toggleBookmark('/r', '/r/src/b.ts', 1);
    toggleBookmark('/r', '/r/src/c.ts', 0);
  });
});

describe('errors and warnings', () => {
  it('mark the file’s tab, and show in the Problems tool window from the editor’s counts', async () => {
    answers.set('lsp.problems', [
      {
        from: { line: 1, column: 2 },
        to: { line: 1, column: 3 },
        severity: 'error',
        message: "Cannot find name 'z'.",
      },
    ]);
    env().editor.open({ id: '/r/src/e.ts', title: 'e.ts' });
    const count = await vi.waitUntil(() =>
      editorRoot()?.querySelector<HTMLElement>('.cerebro-problems__count'),
    );
    expect(q('[data-tab="/r/src/e.ts"] .cerebro-editor-tab__title--errors')).not.toBeNull();
    await userEvent.click(count);
    const window = () => q('.cerebro-tool-window[data-id="problems"]');
    await expect.poll(() => window().textContent).toContain("Cannot find name 'z'.:2");
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await expect.poll(() => window().textContent).not.toContain("Cannot find name 'z'.");
    env().editor.open({ id: '/r/src/e.ts', title: 'e.ts' });
    await userEvent.dblClick(await vi.waitUntil(() => row("#error:1:2:Cannot find name 'z'.")));
    // Gone to, the editor focused.
    await expect.poll(() => editorRoot()?.activeElement).toBe(code());
    expect(env().editor.activeGroup.active).toBe('/r/src/e.ts');
  });
});

describe('context actions', () => {
  it('list a fix at the caret with Alt+Enter, and make the one chosen in the editor', async () => {
    answers.set('lsp.contextActions', [
      {
        title: 'Declare z',
        edits: [{ from: { line: 1, column: 0 }, to: { line: 1, column: 0 }, text: 'let z;\n' }],
      },
    ]);
    env().editor.open({ id: '/r/src/f.ts', title: 'f.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
    expect(await popupItems()).toEqual(['Declare z']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => code()?.textContent).toContain('let z;const a = 1;');
    await expect.poll(() => editorRoot()?.activeElement).toBe(code());
    expect(host('/r').params('lsp.contextActions')).toContainEqual(
      expect.objectContaining({ worktree: '/r', path: '/r/src/f.ts' }),
    );
  });
});

describe('completion', () => {
  it('lists what can go at the caret as one types, and puts in the one chosen with its import', async () => {
    answers.set('lsp.completions', {
      incomplete: false,
      items: [{ label: 'target', kind: 'function', description: './t', resolve: { data: 1 } }],
    });
    answers.set('lsp.completionEdits', [
      {
        from: { line: 0, column: 0 },
        to: { line: 0, column: 0 },
        text: 'import { target } from "./t";\n',
      },
    ]);
    env().editor.open({ id: '/r/src/g.ts', title: 'g.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{End}{/Control}ta');
    const list = await vi.waitUntil(() =>
      editorRoot()?.querySelector<HTMLElement>('.cm-tooltip-autocomplete'),
    );
    expect(list.textContent).toBe('target./t');
    // CodeMirror's list takes no keys for its first 75 ms.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => code()?.textContent).toContain('import { target } from "./t";');
    expect(code()?.textContent).toContain('target');
    expect(host('/r').params('lsp.completions')).toContainEqual(
      expect.objectContaining({ worktree: '/r', path: '/r/src/g.ts' }),
    );
    expect(host('/r').params('lsp.completionEdits')).toEqual([
      { worktree: '/r', path: '/r/src/g.ts', item: { data: 1 } },
    ]);
  });
});

describe('quick documentation', () => {
  it('shows what the symbol at the caret is on Ctrl+Q, from its language server', async () => {
    answers.set('lsp.hover', { text: '```typescript\nconst a: 1\n```\nThe first.' });
    env().editor.open({ id: '/r/src/h.ts', title: 'h.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}{Control>}q{/Control}');
    const shown = await vi.waitUntil(() =>
      editorRoot()?.querySelector<HTMLElement>('.cerebro-quickDoc'),
    );
    expect(shown.textContent).toBe('const a: 1The first.');
    expect(host('/r').params('lsp.hover')).toContainEqual(
      expect.objectContaining({ worktree: '/r', path: '/r/src/h.ts', line: 0, column: 0 }),
    );
  });
});

describe('parameter info', () => {
  it('shows what’s called at the caret on Ctrl+P, from its language server', async () => {
    answers.set('lsp.signatures', {
      signatures: [{ label: 'f(a: number)', parameters: [{ from: 2, to: 11 }], active: 0 }],
      active: 0,
    });
    env().editor.open({ id: '/r/src/p.ts', title: 'p.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{End}{/Control}{Control>}p{/Control}');
    const shown = await vi.waitUntil(() =>
      editorRoot()?.querySelector<HTMLElement>('.cerebro-parameterInfo strong'),
    );
    expect(shown.textContent).toBe('a: number');
    expect(host('/r').params('lsp.signatures')).toContainEqual(
      expect.objectContaining({ worktree: '/r', path: '/r/src/p.ts' }),
    );
  });
});

describe('File Structure', () => {
  const caret = () => carets.get('/r/src/s.ts');

  it('lists the file’s symbols on Ctrl+F12, from its language server, and goes to the one chosen', async () => {
    // Each file's text is `// <path>` then `const a = 1;`.
    answers.set('lsp.structure', [
      {
        name: 'a',
        kind: 'constant',
        from: { line: 1, column: 0 },
        to: { line: 1, column: 12 },
        at: { line: 1, column: 6 },
        children: [],
      },
    ]);
    env().editor.open({ id: '/r/src/s.ts', title: 's.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect.poll(caret).toEqual({ line: 0, column: 0 });
    await userEvent.keyboard('{Control>}{F12}{/Control}');
    expect(await popupItems()).toEqual(['a']);
    expect(host('/r').params('lsp.structure')).toContainEqual({
      worktree: '/r',
      path: '/r/src/s.ts',
      text: '// /r/src/s.ts\nconst a = 1;\n',
    });
    await userEvent.keyboard('{Enter}');
    await expect.poll(caret).toEqual({ line: 1, column: 6 });
  });

  it('starts from the file’s start when its caret hasn’t moved, and goes nowhere when closed', async () => {
    answers.set('lsp.structure', [
      {
        name: 'a',
        kind: 'constant',
        from: { line: 1, column: 0 },
        to: { line: 1, column: 12 },
        at: { line: 1, column: 6 },
        children: [],
      },
    ]);
    // Asked as it opens, before its editor has said where its caret is.
    env().editor.open({ id: '/r/src/fresh.ts', title: 'fresh.ts' });
    expect(carets.get('/r/src/fresh.ts')).toBeUndefined();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F12', code: 'F12', ctrlKey: true }));
    expect(await popupItems()).toEqual(['a']);
    // The caret at the start is in no symbol: the first highlighted.
    expect(
      document.querySelector('.cerebro-popup-item--highlighted .cerebro-popup-item__label')
        ?.textContent,
    ).toBe('a');
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.cerebro-popup')).toBeNull();
    expect(carets.get('/r/src/fresh.ts')).toEqual({ line: 0, column: 0 });
  });

  it('isn’t shown for a file that couldn’t be read', async () => {
    answers.set('fs.read', new Error('No such file'));
    env().editor.open({ id: '/r/src/unread.ts', title: 'unread.ts' });
    await expect.poll(() => env().editor.activeGroup.active).toBe('/r/src/unread.ts');
    const asked = host('/r').params('lsp.structure').length;
    await userEvent.keyboard('{Control>}{F12}{/Control}');
    // Nothing to wait for: what it would have asked by now.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.querySelector('.cerebro-popup')).toBeNull();
    expect(host('/r').params('lsp.structure')).toHaveLength(asked);
    // Nor is Call Hierarchy asked about it.
    const calls = host('/r').params('lsp.prepareCalls').length;
    await userEvent.keyboard('{Control>}{Alt>}h{/Alt}{/Control}');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(host('/r').params('lsp.prepareCalls')).toHaveLength(calls);
  });
});

describe('folding', () => {
  it('folds where the language server says, all on the keymap’s Ctrl+Shift+-, and back on Ctrl+Shift+=', async () => {
    // Each file's text is `// <path>` then `const a = 1;`.
    answers.set('lsp.folds', [
      { from: { line: 0, column: 0 }, to: { line: 1, column: 12 }, collapsedText: 'Both lines' },
    ]);
    env().editor.open({ id: '/r/src/fold.ts', title: 'fold.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/fold.ts');
    expect(host('/r').params('lsp.folds')).toContainEqual({
      worktree: '/r',
      path: '/r/src/fold.ts',
      text: '// /r/src/fold.ts\nconst a = 1;\n',
    });
    await userEvent.click(code() as HTMLElement);
    // The keys a keyboard sends: `_` and `+`, Shift held.
    await expect
      .poll(async () => {
        await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
        return code()?.textContent;
      })
      .toContain('Both lines');
    await userEvent.keyboard('{Control>}{Shift>}{Equal}{/Shift}{/Control}');
    await expect.poll(() => code()?.textContent).toContain('const a = 1;');
  });
});

describe('Reformat Code', () => {
  it('formats the file on Ctrl+Alt+L by its language server’s edits, or says why not', async () => {
    // Each file's text is `// <path>` then `const a = 1;`.
    answers.set('lsp.format', [
      { from: { line: 1, column: 7 }, to: { line: 1, column: 8 }, text: '  ' },
    ]);
    env().editor.open({ id: '/r/src/fmt.ts', title: 'fmt.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/fmt.ts');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(() => code()?.textContent).toContain('const a  = 1;');
    expect(host('/r').params('lsp.format')).toContainEqual({
      worktree: '/r',
      path: '/r/src/fmt.ts',
      text: '// /r/src/fmt.ts\nconst a = 1;\n',
      tabSize: 4,
      insertSpaces: true,
    });
    const hint = () => editorRoot()?.querySelector('.cerebro-hint')?.textContent;
    await expect.poll(hint).toBe('Formatted 1 line');
    // The selection, and no answer.
    answers.set('lsp.format', null);
    await userEvent.keyboard('{Control>}a{/Control}{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(hint).toBe('No language server answered.');
    expect(host('/r').params('lsp.format').at(-1)).toMatchObject({
      from: { line: 0, column: 0 },
      to: { line: 2, column: 0 },
    });
  });
});

describe('Optimize Imports', () => {
  it('organizes the file’s imports on Ctrl+Alt+O by its language server’s edits, or says why not', async () => {
    // Each file's text is `// <path>` then `const a = 1;`.
    answers.set('lsp.organizeImports', [
      { from: { line: 1, column: 0 }, to: { line: 2, column: 0 }, text: '' },
    ]);
    env().editor.open({ id: '/r/src/imports.ts', title: 'imports.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/imports.ts');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}{Alt>}o{/Alt}{/Control}');
    await expect.poll(() => code()?.textContent).not.toContain('const a');
    expect(host('/r').params('lsp.organizeImports')).toContainEqual({
      worktree: '/r',
      path: '/r/src/imports.ts',
      text: '// /r/src/imports.ts\nconst a = 1;\n',
    });
    const hint = () => editorRoot()?.querySelector('.cerebro-hint')?.textContent;
    await expect.poll(hint).toBe('Imports optimized');
    answers.set('lsp.organizeImports', null);
    await userEvent.keyboard('{Control>}{Alt>}o{/Alt}{/Control}');
    await expect.poll(hint).toBe('No language server answered.');
  });
});

describe('Reformat Code’s indent', () => {
  it('is the settings’ for the whole file, the file’s own for a part, as IntelliJ’s', async () => {
    // Other files as they are, or they'd have changed on disk.
    answers.set('fs.read', ({ path }: { path: string }) => ({
      text:
        path === '/r/src/two.ts' ? 'if (a) {\n  b();\n  c();\n}\n' : `// ${path}\nconst a = 1;\n`,
    }));
    answers.set('lsp.format', []);
    env().editor.open({ id: '/r/src/two.ts', title: 'two.ts' });
    await expect.poll(() => code()?.textContent).toContain('c();');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    await expect
      .poll(() => host('/r').params('lsp.format').at(-1))
      .toMatchObject({ path: '/r/src/two.ts', tabSize: 4, insertSpaces: true });
    const asked = host('/r').params('lsp.format').length;
    await userEvent.keyboard('{Control>}a{/Control}{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(() => host('/r').params('lsp.format').length).toBe(asked + 1);
    expect(host('/r').params('lsp.format').at(-1)).toMatchObject({
      tabSize: 2,
      insertSpaces: true,
    });
    // With tabs, the tab size's.
    globalSettings.layers.global.set('editor.useTabCharacter', true);
    globalSettings.layers.global.set('editor.tabSize', 3);
    await userEvent.keyboard('{ArrowDown}{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(() => host('/r').params('lsp.format').length).toBe(asked + 2);
    expect(host('/r').params('lsp.format').at(-1)).toMatchObject({
      tabSize: 3,
      insertSpaces: false,
    });
    globalSettings.layers.global.reset('editor.useTabCharacter');
    globalSettings.layers.global.reset('editor.tabSize');
  });
});

describe('Annotate with Git Blame', () => {
  it('shows who last changed each line from the gutter’s menu, with its own menu on them', async () => {
    const hash = 'a'.repeat(40);
    const commit = { hash, author: 'Ada Lovelace', email: 'ada@x.org', time: 0, message: 'First' };
    answers.set('git.blame', { lines: [hash, null], commits: [commit] });
    env().editor.open({ id: '/r/src/blamed.ts', title: 'blamed.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/blamed.ts');
    const number = editorRoot()?.querySelector(
      '.cm-lineNumbers .cm-gutterElement:not([style*="hidden"])',
    );
    await userEvent.click(number as HTMLElement, { button: 'right' });
    expect(await menuItems()).toEqual(['Annotate with Git Blame']);
    await userEvent.click(menuItem('Annotate with Git Blame'));
    const annotation = () =>
      [...(editorRoot()?.querySelectorAll<HTMLElement>('.cerebro-annotation') ?? [])].find(
        (a) => a.textContent !== '',
      );
    await expect.poll(() => annotation()?.textContent).toContain('Lovelace');
    // Earlier tests blame other files.
    expect(
      host('/r')
        .params('git.blame')
        .filter((p) => (p as { file: string }).file === 'src/blamed.ts'),
    ).toEqual([
      {
        path: '/r',
        file: 'src/blamed.ts',
        contents: '// /r/src/blamed.ts\nconst a = 1;\n',
        ignoreWhitespace: true,
        movements: 'none',
      },
    ]);
    // On an annotation, its own menu, not the editor's.
    await userEvent.click(annotation() as HTMLElement, { button: 'right' });
    expect(await menuItems()).toEqual([
      'Close Annotations',
      'Show Diff',
      'View',
      'Copy Revision Number',
      'Annotate Revision',
      'Annotate Previous Revision',
      'Options',
    ]);
    // Annotate Previous Revision: none, where the commit added the file.
    expect(menuItem('Annotate Previous Revision').getAttribute('aria-disabled')).toBe('true');
    // Annotate Revision: the file at that commit, annotated in a tab of its own, at the line asked on.
    answers.set('git.fileAt', { text: 'then\n// /r/src/blamed.ts\n' });
    await userEvent.click(menuItem('Annotate Revision'));
    const version = revisionTab('src/blamed.ts', hash);
    await expect
      .poll(
        () =>
          document.querySelector('.cerebro-editor-group--active .cerebro-editor-tab--active')
            ?.textContent,
      )
      .toContain(`blamed.ts (${hash})`);
    await expect.poll(() => annotation()?.textContent).toContain('Lovelace');
    expect(host('/r').params('git.blame').at(-1)).toEqual({
      path: '/r',
      file: 'src/blamed.ts',
      hash,
      ignoreWhitespace: true,
      movements: 'none',
    });
    // The line asked on, the first, is the second there.
    expect(editorRoot()?.querySelector('.cm-activeLine')?.textContent).toBe('// /r/src/blamed.ts');
    env().editor.close(env().editor.activeGroup.id, version.id);
    answers.delete('git.fileAt');
    // Back to the file: earlier tests leave others open.
    env().editor.open({ id: '/r/src/blamed.ts', title: 'blamed.ts' });
    await expect.poll(() => annotation()?.textContent).toContain('Lovelace');
    await userEvent.click(annotation() as HTMLElement, { button: 'right' });
    await menuItems();
    // Show Diff: the commit's changes to the file, in a window of its own.
    await userEvent.click(menuItem('Show Diff'));
    expect(calls.at(-1)).toMatchObject(['diff', { env: '/r', path: 'src/blamed.ts' }]);
    await expect.poll(() => annotation()?.textContent).toContain('Lovelace');
    // A click: the commit in the Git tool window's Log.
    await userEvent.click(annotation() as HTMLElement);
    await expect.poll(() => document.querySelector('.playground-log')).not.toBeNull();
    await userEvent.click(annotation() as HTMLElement, { button: 'right' });
    await menuItems();
    await userEvent.click(menuItem('Close Annotations'));
    await expect.poll(annotation).toBeUndefined();
  });
});

describe('the Prettier plugin', () => {
  const hint = () => editorRoot()?.querySelector('.cerebro-hint')?.textContent;

  it('reformats the file with the project’s Prettier on Ctrl+Alt+Shift+P and from the editor’s menu', async () => {
    // Each file's text is `// <path>` then `const a = 1;`.
    answers.set('prettier.format', { text: '// /r/src/pretty.ts\nconst a = 2;\n' });
    env().editor.open({ id: '/r/src/pretty.ts', title: 'pretty.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/pretty.ts');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}{Alt>}{Shift>}P{/Shift}{/Alt}{/Control}');
    await expect.poll(() => code()?.textContent).toContain('const a = 2;');
    expect(host('/r').params('prettier.format')).toEqual([
      { path: '/r/src/pretty.ts', text: '// /r/src/pretty.ts\nconst a = 1;\n' },
    ]);
    await expect.poll(hint).toBe('Prettier: formatted 1 line');
    // The selection, from the editor's context menu, last in it as IntelliJ adds it.
    answers.set('prettier.format', { refused: 'Prettier: package is not installed' });
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(code() as HTMLElement, { button: 'right' });
    expect((await menuItems()).at(-1)).toBe('Reformat with Prettier');
    await userEvent.click(
      [...document.querySelectorAll('.cerebro-menu-item')].find((item) =>
        item.textContent.includes('Reformat with Prettier'),
      ) as HTMLElement,
    );
    await expect.poll(hint).toBe('Prettier: package is not installed');
  });

  it('formats a file as it’s saved when Run on save is on', async () => {
    answers.set('prettier.format', { text: '// /r/src/saved.ts\nconst a = 3;\n' });
    globalSettings.layers.global.set('prettier.onSave', true);
    env().editor.open({ id: '/r/src/saved.ts', title: 'saved.ts' });
    await expect.poll(() => code()?.textContent).toContain('// /r/src/saved.ts');
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('x');
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect
      .poll(() => host('/r').params('fs.write').at(-1))
      .toMatchObject({ path: '/r/src/saved.ts', text: '// /r/src/saved.ts\nconst a = 3;\n' });
    expect(host('/r').params('prettier.format').at(-1)).toMatchObject({ path: '/r/src/saved.ts' });
    expect(code()?.textContent).toContain('const a = 3;');
    globalSettings.layers.global.reset('prettier.onSave');
  });

  it('has its page in Settings, and Settings → Plugins lists it with Notes, on', async () => {
    await userEvent.keyboard('{Control>}{Alt>}s{/Alt}{/Control}');
    const settings = await dialog();
    (settings.querySelector('[data-page="languages/javascript/prettier"]') as HTMLElement).click();
    await expect
      .poll(() => settings.querySelector('.cerebro-settings__page')?.textContent)
      .toContain('Run on save');
    (settings.querySelector('[data-page="plugins"]') as HTMLElement).click();
    await expect
      .poll(() =>
        [...settings.querySelectorAll('.playground-plugins__item')].map((item) => [
          item.querySelector('.playground-plugins__name')?.textContent,
          item.querySelector('input')?.checked,
        ]),
      )
      .toEqual([
        ['Notes', true],
        ['Prettier', true],
      ]);
  });
});

describe('rename', () => {
  it('renames the name at the caret on Shift+F6 in every file its server says, saved', async () => {
    // Each file's text is `// <path>` then `const a = 1;`: `a` on line 1.
    answers.set('lsp.renaming', {
      from: { line: 1, column: 6 },
      to: { line: 1, column: 7 },
      name: 'a',
    });
    const at = (line: number, column: number) => ({ line, column });
    answers.set('lsp.rename', [
      { path: '/r/src/n.ts', edits: [{ from: at(1, 6), to: at(1, 7), text: 'b' }] },
      { path: '/r/src/m.ts', edits: [{ from: at(1, 6), to: at(1, 7), text: 'b' }] },
    ]);
    env().editor.open({ id: '/r/src/n.ts', title: 'n.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{End}');
    for (let n = 0; n < 6; n++) await userEvent.keyboard('{ArrowLeft}');
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await vi.waitUntil(() => editorRoot()?.querySelector('.cerebro-rename'));
    await userEvent.keyboard('b{Enter}');
    await expect
      .poll(() => host('/r').params('fs.write'))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: '/r/src/n.ts', text: '// /r/src/n.ts\nconst b = 1;\n' }),
          expect.objectContaining({ path: '/r/src/m.ts', text: '// /r/src/m.ts\nconst b = 1;\n' }),
        ]),
      );
    expect(host('/r').params('lsp.rename')).toContainEqual(
      expect.objectContaining({
        worktree: '/r',
        path: '/r/src/n.ts',
        text: '// /r/src/n.ts\nconst a = 1;\n',
        line: 1,
        column: 6,
        name: 'b',
      }),
    );
  });

  it('says why when its server refuses, or there’s no answer', async () => {
    answers.set('lsp.renaming', {
      from: { line: 1, column: 6 },
      to: { line: 1, column: 7 },
      name: 'a',
    });
    answers.set('lsp.rename', { refused: 'Not a name.' });
    env().editor.open({ id: '/r/src/o.ts', title: 'o.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{End}');
    for (let n = 0; n < 6; n++) await userEvent.keyboard('{ArrowLeft}');
    const hint = () => editorRoot()?.querySelector('.cerebro-hint')?.textContent;
    const rename = async () => {
      await userEvent.keyboard('{Shift>}{F6}{/Shift}');
      await vi.waitUntil(() => editorRoot()?.querySelector('.cerebro-rename'));
      await userEvent.keyboard('b{Enter}');
    };
    await rename();
    await expect.poll(hint).toBe('Not a name.');
    answers.set('lsp.rename', null);
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}');
    await rename();
    await expect.poll(hint).toBe('No language server answered the rename.');
    // A file it can't read is named; the others are renamed.
    const at = (line: number, column: number) => ({ line, column });
    const edit = { from: at(1, 6), to: at(1, 7), text: 'b' };
    answers.set('lsp.rename', [
      { path: '/r/src/o.ts', edits: [edit] },
      { path: '/r/src/gone.ts', edits: [edit] },
    ]);
    answers.set('fs.read', ({ path }: { path: string }) => {
      if (path === '/r/src/gone.ts') throw new Error('No such file');
      return { text: `// ${path}\nconst a = 1;\n` };
    });
    await userEvent.keyboard('{ArrowLeft}{ArrowRight}');
    await rename();
    await expect.poll(hint).toBe('Not renamed in src/gone.ts: No such file');
    expect(code()?.textContent).toContain('const b = 1;');
    // Not saved first: not renamed. A file not renamed before: the fake disk keeps no writes.
    answers.set('fs.write', new Error('Read-only'));
    answers.set('lsp.rename', [{ path: '/r/src/q.ts', edits: [edit] }]);
    env().editor.open({ id: '/r/src/q.ts', title: 'q.ts' });
    await userEvent.click(await vi.waitUntil(() => editorRoot()?.querySelector('.cm-content')));
    await userEvent.keyboard('{Control>}{Home}{/Control}{End}x{ArrowDown}{End}');
    for (let n = 0; n < 6; n++) await userEvent.keyboard('{ArrowLeft}');
    await rename();
    await expect.poll(hint).toBe('Not renamed: Couldn’t save /r/src/q.ts: Read-only');
    answers.delete('fs.write');
  });
});

describe('the editor’s file', () => {
  const writes = () => host('/r').params('fs.write').length;

  it('is selected in the file manager, and listed in Recent Files by its folder', async () => {
    env().editor.open({ id: '/r/src/c.ts', title: 'c.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Alt>}{F1}{/Alt}');
    expect(await menuItems()).toEqual(['1. Project', '2. Show in File Manager']);
    await userEvent.keyboard('2');
    await expect.poll(() => calls).toContainEqual(['reveal', '/r/src/c.ts']);
    await userEvent.keyboard('{Control>}e{/Control}');
    await popupItems();
    expect(q('.cerebro-popup').textContent).toContain('c.tssrc');
  });

  it('opens in the image viewer when it’s an image, its tab with a picture', async () => {
    const canvas = document.createElement('canvas');
    answers.set('fs.readBytes', { data: canvas.toDataURL('image/png').split(',')[1] });
    env().editor.open({ id: '/r/logo.png', title: 'logo.png' });
    await expect
      .poll(() => q('.playground-image__info').textContent)
      .toMatch(/^300x150 PNG \(32-bit color\) /);
    const tab = q('.cerebro-editor-tab--active .cerebro-editor-tab__icon path');
    expect(tab.getAttribute('d')).toMatch(/^M2\.5 3\.5h11v9h-11zM2\.5 10\.5/);
    env().editor.close(env().editor.activeGroupId, '/r/logo.png');
  });

  it('is saved as the focus leaves the editor, not as it moves inside it', async () => {
    globalSettings.layers.global.set('system.saveWhenIdle', false);
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('y');
    const before = writes();
    // Its find bar.
    await userEvent.keyboard('{Control>}f{/Control}');
    await expect.poll(() => editorRoot()?.activeElement?.className).toBe('cerebro-find__field');
    expect(writes()).toBe(before);
    await userEvent.click(q('.cerebro-statusbar'));
    await expect.poll(writes).toBe(before + 1);
    globalSettings.layers.global.reset('system.saveWhenIdle');
  });
});

describe('the Switcher', () => {
  const active = () => env().editor.activeGroup.active;
  const labels = (side: string) =>
    [...document.querySelectorAll(`[data-side="${side}"] .cerebro-popup-item`)].map((row) =>
      [...row.querySelectorAll('span')].map((part) => part.textContent).join('|'),
    );
  const selected = () =>
    document.querySelector(
      '.cerebro-switcher .cerebro-popup-item--highlighted .cerebro-popup-item__label',
    )?.textContent;
  const open = (path: string) => {
    env().editor.open({ id: path, title: path.split('/').at(-1) as string });
  };
  const closeTabs = () => {
    for (const group of env().editor.groups) {
      for (const tab of group.tabs) env().editor.close(group.id, tab.id);
    }
  };

  it('goes back to the tab shown before on a press and a release of Ctrl+Tab, or to the last with Shift', async () => {
    closeTabs();
    for (const path of ['/r/src/a.ts', '/r/src/b.ts', '/r/src/c.ts']) open(path);
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('{Control>}{Tab}');
    await vi.waitUntil(() => document.querySelector('.cerebro-switcher'));
    expect(labels('right')).toEqual(['|c.ts||', '|b.ts||', '|a.ts||']);
    expect(selected()).toBe('b.ts');
    expect(q('.cerebro-switcher__status').textContent).toBe('/r/src');
    // The tool windows by name, each with its number, or a capital of its name, or the next free.
    expect(labels('left')).toEqual([
      '|Agent Changes||A',
      '|Bookmarks||2',
      // Show Diff with Working Tree's window, there since it ran: by name, before Claude.
      '|Changes||C',
      '|Claude||3',
      '|Commit||0',
      '|Database||D',
      // Find in Files' window, there since it ran.
      '|Find||F',
      '|Git||9',
      // Call Hierarchy's window, there since it ran.
      '|Hierarchy||H',
      // A plugin's: its capital is free, so Notifications takes the next free of 0-9 and A-Z.
      '|Notes||N',
      '|Notifications||4',
      '|Problems||6',
      '|Project||1',
      '|Services||8',
      '|Structure||7',
      '|Terminal||T',
    ]);
    await userEvent.keyboard('{/Control}');
    await expect.poll(active).toBe('/r/src/b.ts');
    expect(document.querySelector('.cerebro-switcher')).toBeNull();
    await userEvent.keyboard('{Control>}{Shift>}{Tab}{/Shift}');
    expect(selected()).toBe('a.ts');
    await userEvent.keyboard('{/Control}');
    await expect.poll(active).toBe('/r/src/a.ts');
  });

  it('opens a tool window by its mnemonic, with Ctrl held, and closes a tab or hides a window with Delete', async () => {
    const project = () => document.querySelector('.cerebro-tool-window[data-id="project"]');
    if (project()) await userEvent.click(stripe('project'));
    await userEvent.keyboard('{Control>}{Tab}1{/Control}');
    await expect.poll(project).not.toBeNull();
    await expect
      .poll(() => document.activeElement?.closest('.cerebro-tool-window')?.getAttribute('data-id'))
      .toBe('project');
    // Delete closes the selected tab: b.ts, the one before a.ts.
    open('/r/src/a.ts');
    await userEvent.keyboard('{Control>}{Tab}');
    expect(selected()).toBe('b.ts');
    await userEvent.keyboard('{Delete}');
    expect(labels('right')).toEqual(['|a.ts||', '|c.ts||']);
    expect(env().editor.groups.flatMap((g) => g.tabs.map((t) => t.id))).not.toContain(
      '/r/src/b.ts',
    );
    // A tool window hides, and stays listed.
    await userEvent.keyboard('{ArrowLeft}');
    while (selected() !== 'Project') await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Delete}');
    expect(project()).toBeNull();
    expect(selected()).toBe('Project');
    await userEvent.keyboard('{Escape}{/Control}');
    expect(active()).toBe('/r/src/a.ts');
    await userEvent.click(stripe('project'));
  });

  it('lists the recent files with fewer than two tabs open, a name shared by its folder, and opens from Find Action', async () => {
    closeTabs();
    open('/r/lib/a.ts');
    await userEvent.click(q('.cerebro-statusbar'));
    await userEvent.keyboard('{Control>}{Shift>}a{/Shift}{/Control}');
    await popupItems();
    await userEvent.keyboard('Switcher');
    await expect
      .poll(() => document.querySelector('.cerebro-popup-item__label')?.textContent)
      .toBe('Switcher');
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.querySelector('.cerebro-switcher'));
    // Closing a.ts showed c.ts, so it comes first among the closed.
    expect(labels('right').slice(0, 3)).toEqual(['|a.ts|lib|', '|c.ts||', '|a.ts|src|']);
    // Opened without Ctrl held, it stays until Enter.
    expect(selected()).toBe('c.ts');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.poll(active).toBe('/r/src/a.ts');
  });
});

describe('saving', () => {
  const tabs = () => env().editor.groups.flatMap((group) => group.tabs.map((tab) => tab.id));

  it('says why it couldn’t, and closes the tabs of a file deleted on disk', async () => {
    // Another environment, without the file.
    workspace.openOrActivate({ id: '/r/w', name: 'w', branch: 'w' });
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    env().editor.open({ id: '/r/src/a.ts', title: 'a.ts' });
    await userEvent.click(await vi.waitUntil(code));
    await userEvent.keyboard('x');
    answers.set('fs.write', new Error('EROFS'));
    await userEvent.keyboard('{Control>}s{/Control}');
    expect(await dialogText()).toContain('EROFS');
    await closeAll();
    // Before the window closes: there's no one to tell.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await (globalThis as unknown as { cerebroSaveAll: () => Promise<void> }).cerebroSaveAll();
    expect(String(logged.mock.calls[0]?.[0])).toContain('EROFS');
    answers.set('fs.read', new Error('ENOENT'));
    answers.set('fs.exists', false);
    // Not through `vi.waitUntil`, which ticks the fake clock (50 ms a check, measured in Vitest's
    // source): a tick onto the documents' reading again (every 2 s) would close the tabs first.
    await userEvent.click(code() as HTMLElement);
    await userEvent.keyboard('{Control>}s{/Control}');
    await expect.poll(tabs).not.toContain('/r/src/a.ts');
  });
});

describe('the window’s projects', () => {
  it('take in a project that joins, named on its tabs, a folder without git showing no branch', async () => {
    added({ path: '/n', name: 'n' });
    await expect.poll(() => env().id).toBe('/n');
    expect(status()[0]).toBe('n');
    await expect.poll(() => q('[aria-label^="Branch:"]')).toBeNull();
    expect(document.querySelector('.cerebro-env-tab--active')?.textContent).toContain('n');
    shownAgain('/r');
    await expect.poll(() => env().id).toBe('/r');
    await expect.poll(() => q('[aria-label^="Branch:"]')).not.toBeNull();
  });

  it('are listed in the Project popup, with the recent ones, which open', async () => {
    await userEvent.click(q('[aria-label^="Project:"]'));
    await expect.poll(popupItems).toEqual(['Open…', 'r', 'n', 'x']);
    await userEvent.keyboard('x{Enter}');
    await press('This Window');
    await expect.poll(() => calls).toContainEqual(['open', '/x', 'this', '/r']);
  });

  it('take one opened in this window in the active one’s place', async () => {
    shownAgain('/n');
    added({ path: '/m', name: 'm', replaces: '/n' });
    await expect.poll(() => env().id).toBe('/m');
    await userEvent.click(q('[aria-label^="Project:"]'));
    await expect.poll(popupItems).toEqual(['Open…', 'r', 'm', 'x']);
  });

  it('close, the last closing the window', async () => {
    const closeProject = async () => {
      await userEvent.keyboard('{Shift}{Shift}');
      await popupItems();
      await userEvent.keyboard('Close Project');
      await expect.poll(popupItems).toContain('Close Project');
      await userEvent.keyboard('{Enter}');
    };
    await closeProject();
    // One of the project left: `/r`'s.
    await expect.poll(() => env().id).toMatch(/^\/r/);
    expect(calls).toContainEqual(['close', '/m']);
    await closeProject();
    await expect.poll(() => calls).toContainEqual(['close', '/r']);
  });
});

describe('a window with no environment open', () => {
  it('says so in the status bar, with no index to show', async () => {
    for (const open of [...workspace.open]) workspace.close(open.id);
    await expect.poll(() => status()[0]).toBe('No environment');
    expect(status()[2]).toBe('Indexed');
  });
});
