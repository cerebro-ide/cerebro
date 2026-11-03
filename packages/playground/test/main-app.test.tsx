import { Environments } from '@cerebro-ide/layout';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { diffTab } from '../src/changes.js';
import { workspace } from '../src/environments.js';
import { loadProjects } from '../src/projects.js';
import { globalSettings } from '../src/settings.js';
import { added, answers, calls, host, installBridge, notify, shownAgain } from './app-bridge.js';
import { closeAll, dialog, dialogText, menuItems, popupItems, press } from './fakes.js';

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
const status = () =>
  [...document.querySelectorAll('.cerebro-statusbar__text')].map((t) => t.textContent);
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

describe('a diff tab', () => {
  it('shows the changes the host reads, or why it can’t', async () => {
    env().editor.open(diffTab('src/a.ts'));
    await expect
      .poll(() =>
        [
          ...(document
            .querySelector('.cerebro-editor-group--active .cerebro-editor-diff')
            ?.shadowRoot?.querySelectorAll('.cm-content') ?? []),
        ].map((side) => side.textContent),
      )
      .toEqual(['a', 'b']);
    expect(host('/r').params('git.diff')).toContainEqual({ path: '/r', file: 'src/a.ts' });
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
    // Alt+1 is the Project tool window's.
    const shown = () => stripe('project').classList.contains('cerebro-stripe-button--active');
    const was = shown();
    await userEvent.keyboard('{Alt>}1{/Alt}');
    await expect.poll(shown).toBe(!was);
    await userEvent.keyboard('{Alt>}1{/Alt}');
    await expect.poll(shown).toBe(was);
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
    await expect.poll(() => env().editor.activeGroup.active).toBe(diffTab('src/a.ts').id);
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
    await expect
      .poll(() => env().editor.activeGroup.active)
      .toBe(diffTab('src/s.ts', { from: 'b', to: 'c' }).id);
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
    await userEvent.click(await vi.waitUntil(code));
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
