import { CommandRegistry, MenuRegistry } from '@cerebro-ide/commands';
import { ToolWindows, type EditorArea, type Tab } from '@cerebro-ide/layout';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  dark,
  menuVisible,
  setDark,
  setupCommands,
  tabFile,
  type TabContext,
} from '../src/commands.js';
import { keymapPlatform } from '../src/keymaps.js';
import { projects, setupEnvironments, useProjects, workspace } from '../src/environments.js';
import { userKeymaps } from '../src/keymap-page.js';
import { globalSettings } from '../src/settings.js';
import { closeAll, dialog, FakeHost, popupItems, press, project } from './fakes.js';

const FILES = ['README.md', 'src/main.ts'];
const tabOf = (path: string): Tab => ({ id: path, title: path.split('/').at(-1) as string });

const opened: string[] = [];
const recent: Tab[] = [];
let available = false;
const navigation = {
  openAt: (at: { path: string }) => void opened.push(`at ${at.path}`),
  open: (tab: Tab) => void opened.push(tab.id),
  recent: () => recent,
  available: () => available,
};

const tools = new ToolWindows();
tools.register({ id: 'project', title: 'Project', anchor: 'left', icon: 'folder' });
tools.register({ id: 'notes', title: 'Notes', anchor: 'right' });

let services: MenuServices;
const editor = (): EditorArea | undefined => workspace.active?.editor;
const commands = () => services.commands;

beforeAll(() => {
  useProjects([]);
  setupEnvironments(new CommandRegistry(), new MenuRegistry(), () => undefined);
  workspace.openOrActivate({ id: 'cerebro', name: 'cerebro', branch: 'main' });
  services = setupCommands(editor, tools, FILES, tabOf, navigation);
});

afterEach(async () => {
  await closeAll();
  opened.length = 0;
  recent.length = 0;
  delete window.cerebro;
  vi.restoreAllMocks();
});

/** A context for the active tab. */
function context(): TabContext {
  const group = (editor() as EditorArea).activeGroup;
  return { group: group.id, tab: group.active as string };
}

const tabs = () => (editor() as EditorArea).activeGroup.tabs.map((t) => t.id);
const entries = (menu: string) =>
  services.menus
    .entries(menu)
    .map((e) => ('command' in e ? e.command : 'submenu' in e ? e.submenu : '—'));

describe('a tab’s file', () => {
  it('is its absolute path, or the worktree’s file, with its name and path from the root', () => {
    expect(tabFile('/r/w/src/a.ts', '/r/w', 'linux')).toEqual({
      system: '/r/w/src/a.ts',
      name: 'a.ts',
      relative: 'src/a.ts',
    });
    expect(tabFile('src/a.ts', '/r/w', 'linux')).toEqual({
      system: '/r/w/src/a.ts',
      name: 'a.ts',
      relative: 'src/a.ts',
    });
    expect(tabFile('diff:src/a.ts', '/r/w', 'linux').system).toBe('/r/w/src/a.ts');
    // A comparison of branches shows no file.
    expect(tabFile('compare:main..feature', '/r/w', 'linux')).toEqual({
      system: undefined,
      name: undefined,
      relative: undefined,
    });
    expect(tabFile('C:/r/w/a.ts', 'C:/r/w', 'win32')).toEqual({
      system: 'C:\\r\\w\\a.ts',
      name: 'a.ts',
      relative: 'a.ts',
    });
    expect(tabFile('/elsewhere/a.ts', '/r/w', 'linux').relative).toBeUndefined();
    expect(tabFile('/r/a.ts', undefined, 'linux')).toEqual({
      system: '/r/a.ts',
      name: 'a.ts',
      relative: undefined,
    });
  });

  it('is none for a new file, or a relative one with no worktree', () => {
    const none = { system: undefined, name: undefined, relative: undefined };
    expect(tabFile('untitled-1', '/r/w', 'linux')).toEqual(none);
    // By default, the active worktree's, as the system writes it.
    expect(tabFile('a.ts').system).toBe('cerebro/a.ts');
    workspace.close('cerebro');
    expect(tabFile('a.ts')).toEqual(none);
    expect(tabFile('/r/a.ts').relative).toBeUndefined();
    workspace.openOrActivate({ id: 'cerebro', name: 'cerebro', branch: 'main' });
  });
});

describe('the keymap’s platform', () => {
  it('is macOS’s on a Mac, else the others’', () => {
    expect(keymapPlatform('MacIntel')).toBe('mac');
    expect(keymapPlatform('Win32')).toBe('other');
    expect(services.keymap?.platform).toBe(keymapPlatform(navigator.platform));
  });
});

describe('the theme', () => {
  it('is chosen, no longer following the system, and toggled by Dark Theme', () => {
    globalSettings.layers.global.set('appearance.syncWithOs', true);
    setDark(false);
    expect(globalSettings.get('appearance.syncWithOs')).toBe(false);
    expect(dark.get()).toBe(false);
    commands().execute('view.darkTheme');
    expect([dark.get(), commands().isChecked('view.darkTheme')]).toEqual([true, true]);
    expect(localStorage.getItem('cerebro.settings.global.user')).toContain('"dark"');
  });
});

describe('the tab commands', () => {
  it('close a tab, the others, or all, and want a tab', () => {
    for (const path of ['a.ts', 'b.ts', 'c.ts']) editor()?.open(tabOf(path));
    expect(commands().isEnabled('editor.close')).toBe(false);
    expect(commands().isEnabled('editor.closeAll')).toBe(false);
    expect(commands().isEnabled('file.closeTab')).toBe(false);
    commands().execute('editor.close', context());
    expect(tabs()).toEqual(['a.ts', 'b.ts']);
    commands().execute('editor.closeOthers', context());
    expect(tabs()).toEqual(['b.ts']);
    expect(commands().isEnabled('editor.closeOthers', context())).toBe(false);
    commands().execute('file.closeTab', context());
    expect(tabs()).toEqual([]);
    commands().get('file.closeTab')?.run(undefined);
    for (const path of ['a.ts', 'b.ts']) editor()?.open(tabOf(path));
    commands().execute('editor.closeAll', context());
    expect(tabs()).toEqual([]);
  });

  it('split a tab in each direction', () => {
    expect(entries('editor/tab/split')).toEqual([
      'editor.split.right',
      'editor.split.down',
      'editor.split.left',
      'editor.split.up',
    ]);
    editor()?.open(tabOf('a.ts'));
    expect(commands().isEnabled('editor.split.right')).toBe(false);
    commands().execute('editor.split.right', context());
    expect((editor() as EditorArea).groups).toHaveLength(2);
    for (const group of (editor() as EditorArea).groups)
      for (const tab of group.tabs) editor()?.close(group.id, tab.id);
  });

  it('copy a tab’s path, its name, or its path from the root, when it has them', async () => {
    const copied: string[] = [];
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation((text) => {
      copied.push(text);
      return Promise.resolve();
    });
    editor()?.open(tabOf('src/a.ts'));
    for (const id of ['editor.copyPath', 'editor.copyFileName', 'editor.copyContentRootPath'])
      commands().execute(id, context());
    await expect.poll(() => copied).toEqual(['cerebro/src/a.ts', 'a.ts', 'src/a.ts']);
    expect(commands().isEnabled('editor.copyPath')).toBe(false);
    commands().execute('file.new');
    expect(commands().isEnabled('editor.copyPath', context())).toBe(false);
    editor()?.close(context().group, 'src/a.ts');
  });
});

describe('the main menu', () => {
  it('has File, Edit, View and Help', () => {
    expect(entries('main')).toEqual(['main/file', 'main/edit', 'main/view', 'main/help']);
    expect(entries('main/file')).toEqual([
      'file.new',
      'file.open',
      'main/file/recent',
      'symbol.goTo',
      '—',
      'file.closeTab',
      '—',
      'file.settings',
      '—',
      'file.exit',
    ]);
    expect(entries('main/edit')).toEqual([
      'edit.undo',
      'edit.redo',
      '—',
      'edit.cut',
      'edit.copy',
      'edit.paste',
      '—',
      'edit.duplicate',
    ]);
    expect(entries('main/view/tools')).toEqual(['view.tool.project', 'view.tool.notes']);
    expect(commands().get('view.tool.project')?.icon).toBe('folder');
    expect(commands().isEnabled('file.exit')).toBe(false);
    commands().get('file.exit')?.run(undefined);
  });

  it('makes new files, numbered', () => {
    commands().execute('file.new');
    commands().execute('file.new');
    expect(tabs().slice(-2)).toEqual(['untitled-2', 'untitled-3']);
    commands().execute('editor.closeAll', context());
  });

  it('opens a sample file in a browser, from the recent ones or Go to File', async () => {
    expect(entries('main/file/recent')).toEqual(['file.recent.0', 'file.recent.1']);
    expect(commands().get('file.recent.1')?.label).toBe('&2 src/main.ts');
    commands().execute('file.recent.1');
    expect(opened).toEqual(['src/main.ts']);
    commands().execute('file.open');
    expect(await popupItems()).toEqual([]);
    await userEvent.keyboard('read{Enter}');
    await expect.poll(() => opened).toEqual(['src/main.ts', 'README.md']);
  });

  it('opens a folder as a project in the app', async () => {
    const picked = vi.fn(() => Promise.resolve(null));
    window.cerebro = { project: { pick: picked } } as unknown as NonNullable<Window['cerebro']>;
    commands().execute('file.open');
    await expect.poll(() => picked.mock.calls.length).toBe(1);
  });

  it('shows and hides the menu bar', () => {
    expect(menuVisible.get()).toBe(false);
    commands().execute('view.mainMenu');
    expect([menuVisible.get(), commands().isChecked('view.mainMenu')]).toEqual([true, true]);
    commands().execute('view.mainMenu');
    expect(menuVisible.get()).toBe(false);
  });

  it('activates a tool window, as IntelliJ’s: shown and focused, or hidden if it has the focus', async () => {
    // The window, as the layout draws it.
    const window = document.createElement('section');
    window.className = 'cerebro-tool-window';
    window.dataset['id'] = 'project';
    const body = document.createElement('div');
    body.className = 'cerebro-tool-window__body';
    const tree = document.createElement('div');
    tree.tabIndex = 0;
    body.append(tree);
    window.append(body);
    document.body.append(window);
    commands().execute('view.tool.project');
    expect(commands().isChecked('view.tool.project')).toBe(true);
    await expect.poll(() => document.activeElement).toBe(tree);
    // Shown but without the focus: it takes it, and stays.
    tree.blur();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    commands().execute('view.tool.project');
    expect(tools.isVisible('project')).toBe(true);
    await expect.poll(() => document.activeElement).toBe(tree);
    // With the focus: hidden, the editor's tab taking it back.
    editor()?.open({ id: 'cerebro/a.ts', title: 'a.ts' });
    commands().execute('view.tool.project');
    expect(tools.isVisible('project')).toBe(false);
    expect(opened).toEqual(['cerebro/a.ts']);
    // No tab open: hidden alone.
    tools.show('project');
    tree.focus();
    editor()?.close(editor()?.activeGroup.id as string, 'cerebro/a.ts');
    commands().execute('view.tool.project');
    expect(tools.isVisible('project')).toBe(false);
    expect(opened).toEqual(['cerebro/a.ts']);
    window.remove();
    field.remove();
  });

  it('says what Cerebro is', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    commands().execute('help.about');
    expect(alert).toHaveBeenCalledWith(
      'Cerebro: an IDE for inspecting code and managing AI agents’ work.',
    );
  });

  it('opens Settings for the worktree, and for the global settings alone without one', async () => {
    commands().execute('file.settings');
    await dialog();
    expect(document.body.textContent).toContain('Worktree: cerebro');
    await press('Cancel');
    const env = workspace.active;
    workspace.close('cerebro');
    commands().execute('file.settings');
    await dialog();
    expect(document.body.textContent).not.toContain('Worktree:');
    // A change, applied: saved.
    await userEvent.click(
      document.querySelector('.cerebro-dialog input[type="checkbox"]') as Element,
    );
    await press('OK');
    expect(localStorage.getItem('cerebro.settings.global.user')).toContain('syncWithOs');
    workspace.openOrActivate({ id: 'cerebro', name: 'cerebro', branch: 'main' });
    expect(env).toBeDefined();
  });
});

describe('a text field’s editing keys', () => {
  /** The app's menu bridge, with the edit actions it was asked for. */
  function app(): string[] {
    const asked: string[] = [];
    window.cerebro = {
      menu: { edit: (action: string) => asked.push(action) },
    } as unknown as NonNullable<Window['cerebro']>;
    return asked;
  }

  it('run the Edit commands in a popup’s field, which keeps the app’s other keys', async () => {
    commands().execute('file.goTo');
    await popupItems();
    const asked = app();
    await userEvent.keyboard('{Control>}v{/Control}{Control>}c{/Control}{Control>}z{/Control}');
    expect(asked).toEqual(['paste', 'copy', 'undo']);
    await userEvent.keyboard('{Escape}');
  });

  it('run them once in a field elsewhere', async () => {
    const field = document.body.appendChild(document.createElement('input'));
    await userEvent.click(field);
    const asked = app();
    await userEvent.keyboard('{Control>}v{/Control}');
    expect(asked).toEqual(['paste']);
    field.remove();
  });

  it('are left to a terminal’s field, and to what isn’t one', async () => {
    const terminal = document.body.appendChild(document.createElement('div'));
    terminal.className = 'cerebro-terminal';
    const area = terminal.appendChild(document.createElement('textarea'));
    await userEvent.click(area);
    const asked = app();
    const pressed = vi.fn();
    area.addEventListener('keydown', pressed);
    await userEvent.keyboard('{Control>}v{/Control}');
    expect(pressed).toHaveBeenCalled();
    terminal.remove();
    const button = document.body.appendChild(document.createElement('button'));
    button.focus();
    button.addEventListener('keydown', pressed);
    pressed.mockClear();
    await userEvent.keyboard('{Control>}x{/Control}');
    expect(pressed).toHaveBeenCalled();
    button.remove();
    expect(asked).not.toContain('cut');
  });
});

describe('Search Everywhere', () => {
  it('lists the sample files and the recent ones in a browser', async () => {
    recent.push(tabOf('src/main.ts'));
    commands().execute('file.goTo');
    expect(await popupItems()).toEqual(['main.ts']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => opened).toEqual(['src/main.ts']);
    commands().execute('file.goTo');
    await popupItems();
    await userEvent.keyboard('read');
    await expect.poll(popupItems).toEqual(['README.md']);
    await userEvent.keyboard('{Escape}');
  });

  it('lists the actions that can run, with their keys, but its own', async () => {
    commands().execute('action.find');
    await popupItems();
    await userEvent.keyboard('new file');
    await expect.poll(popupItems).toEqual(['New File']);
    expect(document.querySelector('.cerebro-popup-item__shortcut')?.textContent).not.toBe('');
    await userEvent.keyboard('{Enter}');
    expect(tabs()).toContain('untitled-4');
    commands().execute('action.find');
    await popupItems();
    await userEvent.keyboard('go to file');
    await expect.poll(popupItems).toEqual([]);
    await userEvent.keyboard('{Escape}');
    commands().execute('editor.closeAll', context());
  });

  it('offers Classes and Symbols only with the host’s index', () => {
    expect(commands().isEnabled('class.goTo')).toBe(false);
    available = true;
    expect(commands().isEnabled('symbol.goTo')).toBe(true);
    available = false;
  });

  it('lists the worktree’s files from its host in the app, and its recent ones', async () => {
    const host = new FakeHost({ 'git.files': () => ['src/app.ts', 'top.ts'] });
    const list = projects.get();
    useProjects([project('/r/w', host)]);
    workspace.openOrActivate({ id: '/r/w', name: 'w', branch: 'main' });
    recent.push(tabOf('/r/w/src/app.ts'), tabOf('/elsewhere/x.ts'));
    commands().execute('file.goTo');
    expect(await popupItems()).toEqual(['app.ts']);
    await userEvent.keyboard('top');
    await expect.poll(popupItems).toEqual(['top.ts']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => opened).toEqual(['/r/w/top.ts']);
    expect(host.params('git.files')).toEqual([{ path: '/r/w' }]);
    recent.length = 0;
    // The recent ones, before anything's typed.
    recent.push(tabOf('/r/w/src/app.ts'));
    commands().execute('file.goTo');
    await expect.poll(popupItems).toEqual(['app.ts']);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => opened.at(-1)).toBe('/r/w/src/app.ts');
    // Its files again, from the host; none while it doesn't answer.
    host.answers['git.files'] = () => {
      throw new Error('gone');
    };
    commands().execute('file.goTo');
    await popupItems();
    await userEvent.keyboard('{Escape}');
    workspace.close('/r/w');
    projects.set(list);
  });

  it('names the repository Settings are for: the active worktree’s project', async () => {
    const list = projects.get();
    useProjects([project('/r/charts', new FakeHost())]);
    workspace.openOrActivate({ id: '/r/charts', name: 'charts', branch: 'main' });
    commands().execute('file.settings');
    await dialog();
    expect(document.body.textContent).toContain('Repository: charts');
    expect(document.body.textContent).toContain('Worktree: charts');
    await press('Cancel');
    workspace.close('/r/charts');
    projects.set(list);
  });

  it('lists no files in the app with no worktree open', async () => {
    const list = projects.get();
    useProjects([project('/r/w', new FakeHost())]);
    workspace.close('cerebro');
    commands().execute('file.goTo');
    await popupItems();
    await userEvent.keyboard('read');
    await expect.poll(popupItems).toEqual([]);
    await userEvent.keyboard('{Escape}');
    projects.set(list);
    workspace.openOrActivate({ id: 'cerebro', name: 'cerebro', branch: 'main' });
  });

  it('lists no files of a worktree whose project has no host', async () => {
    const list = projects.get();
    useProjects([project('/r/w', undefined), project('/r/x', new FakeHost())]);
    workspace.openOrActivate({ id: '/r/w', name: 'w', branch: 'main' });
    commands().execute('file.goTo');
    await popupItems();
    await userEvent.keyboard('read');
    await expect.poll(popupItems).toEqual(['README.md']);
    await userEvent.keyboard('{Escape}');
    workspace.close('/r/w');
    projects.set(list);
    workspace.activate('cerebro');
  });
});

describe('the keys', () => {
  it('follow the keymap chosen in Settings, with the user’s changes to it', () => {
    globalSettings.layers.global.set('keymap', 'vscode');
    userKeymaps.set({ vscode: [{ key: 'Alt+N', command: 'file.new' }] });
    expect(services.keymap?.shortcutsFor('file.goTo')).toEqual(['Ctrl+P']);
    expect(services.keymap?.shortcutsFor('file.new')).toEqual(['Alt+N', 'Ctrl+N']);
    userKeymaps.set({});
    globalSettings.layers.global.reset('keymap');
  });

  it('run the command bound to them, on the active tab', async () => {
    editor()?.open(tabOf('a.ts'));
    await userEvent.keyboard('{Control>}{F4}{/Control}');
    expect(tabs()).toEqual([]);
    // A key bound to nothing does nothing.
    await userEvent.keyboard('{Control>}{F11}{/Control}');
    // A modifier alone isn't a key.
    await userEvent.keyboard('{Alt}');
  });

  it('open Search Everywhere with Shift tapped twice', async () => {
    await userEvent.keyboard('{Shift}{Shift}');
    expect(await popupItems()).toBeDefined();
    expect(document.querySelector('.cerebro-popup')?.getAttribute('aria-label')).toBe(
      'Search Everywhere',
    );
  });

  it('abandon a started sequence when the window loses the focus', async () => {
    globalSettings.layers.global.set('keymap', 'vscode');
    const theme = dark.get();
    await userEvent.keyboard('{Control>}k{/Control}');
    window.dispatchEvent(new Event('blur'));
    await userEvent.keyboard('{Control>}t{/Control}');
    expect(dark.get()).toBe(theme);
    await closeAll();
    await userEvent.keyboard('{Control>}k{/Control}{Control>}t{/Control}');
    expect(dark.get()).toBe(!theme);
    globalSettings.layers.global.reset('keymap');
  });
});

describe('in the app', () => {
  it('lists no sample files among the recent ones: the app lists recent projects there', () => {
    window.cerebro = {} as NonNullable<Window['cerebro']>;
    const app = setupCommands(editor, new ToolWindows(), FILES, tabOf, navigation);
    expect(app.menus.entries('main/file/recent')).toEqual([]);
    expect(app.commands.get('file.recent.0')).toBeUndefined();
  });
});
