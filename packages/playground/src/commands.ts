// The playground's commands, menus and shortcuts.

import {
  chordFromEvent,
  displayText,
  formatSequence,
  ModifierTaps,
  CommandRegistry,
  KeyDispatcher,
  Keymap,
  MenuRegistry,
} from '@cerebro-ide/commands';
import type { EditorArea, Tab, ToolWindows } from '@cerebro-ide/layout';
import { computed, effect, signal, type Signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { focusToolWindow } from '@cerebro-ide/ui-layout';
import { openSettings } from '@cerebro-ide/ui-settings';
import { tabPath } from './changes.js';
import { active, activeProject, currentHost, hostFor, type ProjectState } from './environments.js';
import type { Place } from './find.js';
import { openFolder } from './projects.js';
import { searchEverywhere, type Result, type SearchTab } from './search-everywhere.js';
import { isTextField, setupEdit, target } from './edit.js';
import { projectNode } from './project.js';
import { icon } from './icons.js';
import { keymapPage, userKeymaps } from './keymap-page.js';
import { pluginsPage } from './plugins-page.js';
import { keymapPlatform, PRESETS } from './keymaps.js';
import { globalSettings, save, settingsFor } from './settings.js';
import { themeIsDark } from './theme.js';

/** What tab commands act on: the tab a context menu was opened on, or the active one. */
export interface TabContext {
  group: string;
  tab: string;
  /** Opened from the tab's own menu (IntelliJ's `EDITOR_TAB_POPUP` place), not by a key. */
  tabMenu?: true;
}

/** A tab's file, its paths as Copy Path/Reference copies them; none for a tab of no file. */
interface TabFile {
  system: string | undefined;
  name: string | undefined;
  relative: string | undefined;
}

/**
 * The file a tab shows (its diff's too; none for a comparison), from its id: a path, absolute or (as the Commit window
 * opens them) the active worktree's.
 */
export function tabFile(
  tab: string,
  worktree: string | undefined = active()?.id,
  platform: string | undefined = window.cerebro?.platform,
): TabFile {
  const none = { system: undefined, name: undefined, relative: undefined };
  const path = tabPath(tab);
  if (path === undefined) return none;
  const absolute = /^(\/|[A-Za-z]:\/)/.test(path);
  const full = absolute ? path : worktree === undefined ? undefined : `${worktree}/${path}`;
  if (full === undefined || (!absolute && path.startsWith('untitled-'))) return none;
  const root = worktree === undefined ? undefined : `${worktree}/`;
  return {
    system: platform === 'win32' ? full.replaceAll('/', '\\') : full,
    name: full.split('/').at(-1),
    relative: root !== undefined && full.startsWith(root) ? full.slice(root.length) : undefined,
  };
}

/** The theme, from the global settings: chosen, or the system's. */
export const dark = computed(() => themeIsDark(globalSettings));

/** IntelliJ's shortcuts for its tool windows. */
const TOOL_SHORTCUTS: Readonly<Record<string, string>> = {
  project: 'Alt+1',
  bookmarks: 'Alt+2',
  problems: 'Alt+6',
  structure: 'Alt+7',
  services: 'Alt+8',
  git: 'Alt+9',
  commit: 'Alt+0',
  terminal: 'Alt+F12',
};

/** The menu bar is hidden by default, as in IntelliJ's new UI. */
/** The Edit commands a text field's keys run. */
const EDIT_COMMANDS = ['edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste'];

export const menuVisible = signal(false);

export function setDark(value: boolean): void {
  // Chosen here, it no longer follows the system.
  globalSettings.layers.global.set('appearance.theme', value ? 'dark' : 'light');
  globalSettings.layers.global.reset('appearance.syncWithOs');
  save(globalSettings, ['global']);
}

/** Search Everywhere's commands: not listed among its own actions. */
const EVERYWHERE = new Set([
  'search.everywhere',
  'class.goTo',
  'file.goTo',
  'symbol.goTo',
  'action.find',
]);

export function setupCommands(
  activeEditor: () => EditorArea | undefined,
  tools: ToolWindows,
  files: readonly string[],
  tabOf: (path: string) => Tab,
  navigation: {
    /** Opens a file at a place, as a step Back can return from. */
    openAt: (at: Place) => void;
    /** Opens a file with its editor focused, as after choosing it from a list. */
    open: (tab: Tab) => void;
    /** The active environment's Recent Files, most recent first. */
    recent: () => readonly Tab[];
    /** Whether the host's index can be searched. */
    available: () => boolean;
  },
): MenuServices & { keymap: Keymap } {
  const platform = keymapPlatform(navigator.platform);
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap(platform);
  const ed = activeEditor;
  const group = (c: TabContext) => (ed() as EditorArea).group(c.group);

  /**
   * Files as popup items: the name, with its directory after it; `open` opens the path. With
   * `absolute`, the file's own path, for a preview.
   */
  const toItems = (
    paths: readonly string[],
    open: (path: string) => void,
    absolute?: (path: string) => string,
  ) =>
    paths.map((path): Result => {
      const slash = path.lastIndexOf('/');
      return {
        label: path.slice(slash + 1),
        ...(slash < 0 ? {} : { detail: path.slice(0, slash) }),
        group: 'Files',
        icon: () => icon('file'),
        ...(absolute ? { at: { path: absolute(path), line: 0, column: 0 } } : {}),
        run: () => {
          open(path);
        },
      };
    });
  const sampleItems = toItems(files, (path) => {
    navigation.open(tabOf(path));
  });
  /** Each worktree's files from the host, as items; refreshed each time a popup opens. */
  const worktreeItems = new Map<string, Signal<Result[]>>();
  const refreshFiles = () => {
    const env = active();
    if (!env) return;
    const host = hostFor(env.id);
    if (!host) return;
    let items = worktreeItems.get(env.id);
    if (!items) {
      items = signal<Result[]>([]);
      worktreeItems.set(env.id, items);
    }
    const target = items;
    host.request('git.files', { path: env.id }).then(
      (paths) => {
        target.set(
          toItems(
            paths as string[],
            (path) => {
              navigation.open({ id: `${env.id}/${path}`, title: path.split('/').at(-1) as string });
            },
            (path) => `${env.id}/${path}`,
          ),
        );
      },
      () => undefined,
    );
  };
  /** The files to search: the active worktree's in the app (none with none open), the samples in a browser. */
  const fileItems = () => {
    if (!currentHost()) return sampleItems;
    const env = active();
    return (env && worktreeItems.get(env.id)?.get()) ?? [];
  };
  /** Enabled commands as popup items, with their shortcuts. */
  const actionItems = () =>
    [...commands.commands.values()]
      .filter((c) => !EVERYWHERE.has(c.id) && commands.isEnabled(c.id))
      .map((c): Result => {
        const key = keymap.shortcutsFor(c.id)[0];
        return {
          label: displayText(c.label, c.dialog),
          group: 'Actions',
          ...(key === undefined ? {} : { shortcut: formatSequence(key, platform) }),
          ...(c.icon === undefined ? {} : { icon: () => icon(c.icon as string) }),
          run: () => commands.execute(c.id),
        };
      });

  commands.register<TabContext>({
    id: 'editor.close',
    label: '&Close',
    enabled: (c?: TabContext) => c !== undefined,
    run: (c) => {
      ed()?.close(c.group, c.tab);
    },
  });
  commands.register<TabContext>({
    id: 'editor.closeOthers',
    label: 'Close &Others',
    enabled: (c?: TabContext) => c !== undefined && group(c).tabs.length > 1,
    run: (c) => {
      for (const t of group(c).tabs) if (t.id !== c.tab) ed()?.close(c.group, t.id);
    },
  });
  commands.register<TabContext>({
    id: 'editor.closeAll',
    label: 'Close &All Tabs',
    enabled: (c?: TabContext) => c !== undefined,
    run: (c) => {
      for (const t of group(c).tabs) ed()?.close(c.group, t.id);
    },
  });
  for (const [direction, label] of [
    ['right', '&Right'],
    ['down', '&Down'],
    ['left', '&Left'],
    ['up', '&Up'],
  ] as const) {
    commands.register<TabContext>({
      id: `editor.split.${direction}`,
      label,
      enabled: (c?: TabContext) => c !== undefined,
      run: (c) => {
        ed()?.split(c.group, direction, c.tab);
      },
    });
    menus.contribute({ menu: 'editor/tab/split', item: { command: `editor.split.${direction}` } });
  }
  // Copy Path/Reference, as IntelliJ's (CopyReferencePopupGroup): the file's absolute path, as the
  // system writes it (`presentableUrl`), its name, or its path from the worktree's root, with `/`
  // (`VfsUtilCore.getRelativePath`). Absolute Path has the keys Copy Path had, as IntelliJ's takes
  // CopyPaths' (`use-shortcut-of`).
  const copies = [
    ['editor.copyPath', '&Absolute Path', (file: TabFile) => file.system],
    ['editor.copyFileName', '&File Name', (file: TabFile) => file.name],
    ['editor.copyContentRootPath', 'Path from &Content Root', (file: TabFile) => file.relative],
  ] as const;
  // Of the tab its menu's opened on; else, while the Project view has the focus, of the file or
  // folder selected there, as IntelliJ's actions take the focused view's (its menu's included);
  // else of the tab a key's for.
  const copied = (c?: TabContext): TabFile | undefined => {
    if (c?.tabMenu) return tabFile(c.tab);
    const node = projectNode();
    if (node !== undefined) return node === null ? undefined : tabFile(node.path);
    return c && tabFile(c.tab);
  };
  for (const [id, label, text] of copies) {
    commands.register<TabContext | undefined>({
      id,
      label,
      enabled: (c?: TabContext) => {
        const file = copied(c);
        return file !== undefined && text(file) !== undefined;
      },
      run: (c) => navigator.clipboard.writeText(text(copied(c) as TabFile) as string),
    });
  }
  commands.register({
    id: 'view.darkTheme',
    label: 'Dark &Theme',
    checked: () => dark.get(),
    run: () => {
      setDark(!dark.get());
    },
  });

  // The main menu.
  let untitled = 0;
  commands.register({
    id: 'file.new',
    label: '&New File',
    run: () => {
      untitled++;
      ed()?.open({ id: `untitled-${String(untitled)}`, title: `untitled-${String(untitled)}` });
    },
  });
  commands.register({
    id: 'file.open',
    label: '&Open',
    dialog: true,
    icon: 'folder',
    // In the app, a folder to open as a project, as IntelliJ's; in a browser, a sample file.
    run: () => (window.cerebro ? openFolder() : commands.execute('file.goTo')),
  });
  // The app lists recent projects there instead (projects.tsx).
  if (!window.cerebro)
    files.forEach((path, i) => {
      commands.register({
        id: `file.recent.${String(i)}`,
        label: `&${String(i + 1)} ${path}`,
        run: () => {
          navigation.open(tabOf(path));
        },
      });
      menus.contribute({ menu: 'main/file/recent', item: { command: `file.recent.${String(i)}` } });
    });
  commands.register<TabContext | undefined>({
    id: 'file.closeTab',
    label: '&Close Tab',
    enabled: (c?: TabContext) => c !== undefined,
    run: (c) => {
      if (c) ed()?.close(c.group, c.tab);
    },
  });
  commands.register({
    id: 'file.settings',
    label: 'Se&ttings',
    dialog: true,
    icon: 'services',
    // At a page when one's given, as the status bar's Configure Indents opens Code Style.
    run: (context?: { page?: string }) => {
      const env = active();
      const settings = settingsFor(env?.id);
      openSettings({
        settings,
        ...(context?.page === undefined ? {} : { page: context.page }),
        ...(env
          ? {
              scopeLabels: {
                // There's always a project: the samples, without the window's own.
                repo: `Repository: ${(activeProject() as ProjectState).name}`,
                worktree: `Worktree: ${env.name}`,
              },
            }
          : { scopes: ['global'] }),
        onApply: (scopes) => {
          save(settings, scopes);
        },
        pages: { keymap: keymapPage(keymap, commands, menus), plugins: pluginsPage() },
      });
    },
  });
  commands.register({
    id: 'file.exit',
    label: 'E&xit',
    enabled: () => false,
    run: () => undefined,
  });
  setupEdit(commands);
  for (const id of ['undo', 'redo', 'cut', 'copy', 'paste']) {
    menus.contribute({
      menu: 'main/edit',
      item: { command: `edit.${id}` },
      group: id === 'undo' || id === 'redo' ? 'a' : 'b',
    });
  }
  // In IntelliJ's EditSmartGroup, after Find.
  menus.contribute({ menu: 'main/edit', item: { command: 'edit.duplicate' }, group: 's' });
  commands.register({
    id: 'view.mainMenu',
    label: 'Show Main &Menu',
    checked: () => menuVisible.get(),
    run: () => {
      menuVisible.set(!menuVisible.get());
    },
  });
  for (const tool of tools.windows.values()) {
    commands.register({
      id: `view.tool.${tool.id}`,
      label: tool.title,
      ...(tool.icon === undefined ? {} : { icon: tool.icon }),
      checked: () => tools.isVisible(tool.id),
      // IntelliJ's ActivateToolWindowAction: shown, its content taking the keyboard; hidden if it
      // has the keyboard already, the editor taking it back.
      run: () => {
        if (target()?.closest(`.cerebro-tool-window[data-id="${tool.id}"]`)) {
          tools.hide(tool.id);
          const group = ed()?.activeGroup;
          const tab = group?.tabs.find((t) => t.id === group.active);
          if (tab) navigation.open(tab);
        } else {
          tools.show(tool.id);
          void focusToolWindow(tool.id);
        }
      },
    });
    menus.contribute({ menu: 'main/view/tools', item: { command: `view.tool.${tool.id}` } });
    const key = TOOL_SHORTCUTS[tool.id];
    if (key) keymap.bindDefault(key, `view.tool.${tool.id}`);
  }
  // Search Everywhere, and the commands that open it on one of its tabs, as IntelliJ's.
  /** The active environment's Recent Files, as results. */
  const recentItems = () => {
    const env = active();
    const tabs = navigation.recent();
    if (!env || !currentHost())
      return toItems(
        tabs.map((tab) => tab.id),
        (path) => {
          navigation.open(tabOf(path));
        },
      );
    const prefix = `${env.id}/`;
    return toItems(
      tabs.filter((tab) => tab.id.startsWith(prefix)).map((tab) => tab.id.slice(prefix.length)),
      (path) => {
        navigation.open({ id: `${prefix}${path}`, title: path.split('/').at(-1) as string });
      },
      (path) => `${prefix}${path}`,
    );
  };
  const everywhere = (tab: SearchTab) => {
    refreshFiles();
    return searchEverywhere(
      {
        files: fileItems,
        recent: recentItems,
        actions: actionItems,
        open: navigation.openAt,
      },
      tab,
    );
  };
  const entries: { id: string; label: string; tab: SearchTab; index?: boolean; icon?: string }[] = [
    { id: 'search.everywhere', label: '&Search Everywhere', tab: 'all', icon: 'search' },
    { id: 'class.goTo', label: 'Go to &Class', tab: 'classes', index: true },
    { id: 'file.goTo', label: '&Go to File', tab: 'files' },
    { id: 'symbol.goTo', label: 'Go to S&ymbol', tab: 'symbols', index: true },
    { id: 'action.find', label: 'Find &Action', tab: 'actions' },
  ];
  for (const entry of entries) {
    commands.register({
      id: entry.id,
      label: entry.label,
      dialog: true,
      ...(entry.icon === undefined ? {} : { icon: entry.icon }),
      // Classes and Symbols are the host's index's: the app's only.
      ...(entry.index ? { enabled: navigation.available } : {}),
      run: () => everywhere(entry.tab),
    });
  }
  commands.register({
    id: 'help.about',
    label: '&About Cerebro',
    dialog: true,
    run: () => {
      window.alert('Cerebro: an IDE for inspecting code and managing AI agents’ work.');
    },
  });

  const main = (label: string, submenu: string, order: number) =>
    menus.contribute({ menu: 'main', item: { submenu, label }, order });
  main('&File', 'main/file', 1);
  main('&Edit', 'main/edit', 2);
  main('&View', 'main/view', 3);
  main('&Help', 'main/help', 9);
  const add = (menu: string, command: string, group: string) =>
    menus.contribute({ menu, item: { command }, group });
  add('main/file', 'file.new', 'a');
  add('main/file', 'file.open', 'a');
  menus.contribute({
    menu: 'main/file',
    item: { submenu: 'main/file/recent', label: 'Open &Recent' },
    group: 'a',
  });
  add('main/file', 'file.closeTab', 'b');
  add('main/file', 'file.settings', 'c');
  add('main/file', 'file.exit', 'd');
  add('main/view', 'view.mainMenu', 'a');
  add('main/view', 'view.darkTheme', 'a');
  menus.contribute({
    menu: 'main/view',
    item: { submenu: 'main/view/tools', label: '&Tool Windows' },
    group: 'b',
  });
  add('main/help', 'help.about', 'a');

  menus.contribute({ menu: 'editor/tab', item: { command: 'editor.close' }, group: 'a-close' });
  menus.contribute({
    menu: 'editor/tab',
    item: { command: 'editor.closeOthers' },
    group: 'a-close',
  });
  menus.contribute({ menu: 'editor/tab', item: { command: 'editor.closeAll' }, group: 'a-close' });
  menus.contribute({
    menu: 'editor/tab',
    item: { submenu: 'editor/tab/split', label: '&Split' },
    group: 'b-split',
  });
  menus.contribute({
    menu: 'editor/tab',
    item: { submenu: 'editor/tab/copyPath', label: 'Copy Path/Reference…' },
    group: 'c-path',
  });
  // And in the Project view's, after where its Cut, Copy and Paste go (IntelliJ's
  // `CutCopyPasteGroup`).
  menus.contribute({
    menu: 'project/node',
    item: { submenu: 'editor/tab/copyPath', label: 'Copy Path/Reference…' },
    group: 'b-copy',
  });
  menus.contribute({
    menu: 'editor/tab/copyPath',
    item: { command: 'editor.copyPath' },
    group: 'a',
  });
  menus.contribute({
    menu: 'editor/tab/copyPath',
    item: { command: 'editor.copyFileName' },
    group: 'a',
  });
  menus.contribute({
    menu: 'editor/tab/copyPath',
    item: { command: 'editor.copyContentRootPath' },
    group: 'b',
  });
  menus.contribute({ menu: 'editor/content', item: { command: 'file.goTo' }, group: 'a' });
  menus.contribute({ menu: 'main/file', item: { command: 'symbol.goTo' }, group: 'a' });

  keymap.bindDefault('Ctrl+F4', 'editor.close');
  keymap.bindDefault('Mod+Alt+N', 'file.new');
  keymap.bindDefault('Mod+Alt+S', 'file.settings');
  keymap.bindDefault('Shift Shift', 'search.everywhere');
  keymap.bindDefault('Mod+Shift+A', 'action.find');
  keymap.bindDefault('Mod+N', 'class.goTo');
  keymap.bindDefault('Mod+Alt+Shift+N', 'symbol.goTo');
  keymap.bindDefault('Mod+Z', 'edit.undo');
  keymap.bindDefault('Mod+Shift+Z', 'edit.redo');
  keymap.bindDefault('Mod+X', 'edit.cut');
  keymap.bindDefault('Mod+C', 'edit.copy');
  keymap.bindDefault('Mod+V', 'edit.paste');
  // Before Show Diff's Mod+D: in a code editor, its key, as IntelliJ's editor actions come first.
  keymap.bindDefault('Mod+D', 'edit.duplicate');
  keymap.bindDefault('Mod+Shift+N', 'file.goTo');
  keymap.bindDefault('Ctrl+K Ctrl+T', 'view.darkTheme');
  keymap.bindDefault('Ctrl+Shift+C', 'editor.copyPath');
  // The keymap chosen in Settings → Keymap, with the user's changes to it, as they change.
  effect(() => {
    const id = globalSettings.get('keymap') as string;
    keymap.setPreset(PRESETS.find((preset) => preset.id === id));
    keymap.setUser(userKeymaps.get()[id] ?? []);
    return undefined;
  });

  // Shortcuts act on the active tab. Keys an open menu handles never get here.
  const dispatcher = new KeyDispatcher(keymap, commands);
  // A modifier tapped twice on its own: IntelliJ's double Shift.
  const taps = new ModifierTaps();
  window.addEventListener('keyup', (event) => {
    const sequence = taps.keyup(event);
    if (sequence !== undefined) dispatcher.press(sequence);
  });
  // A text field's editing keys (Undo, Cut, Copy, Paste…) are the Edit commands', in any field, as
  // a field's own are in IntelliJ: before popups, dialogs and the find bar, which keep the app's
  // other shortcuts from their fields. On macOS a field has no editing keys of its own without an
  // Edit menu of Electron's roles, which the app doesn't have (Ido: Cmd+V didn't paste in the
  // search popup).
  window.addEventListener(
    'keydown',
    (event) => {
      const chord = chordFromEvent(event);
      if (chord === undefined || dispatcher.waiting || !isTextField(event.composedPath()[0])) {
        return;
      }
      const edit = keymap.commandsFor(chord).filter((id) => EDIT_COMMANDS.includes(id));
      if (edit.some((id) => commands.execute(id))) {
        event.preventDefault();
        event.stopPropagation();
        taps.reset();
      }
    },
    true,
  );
  window.addEventListener('keydown', (event) => {
    taps.keydown(event);
    const chord = chordFromEvent(event);
    if (chord === undefined) return;
    const active = ed()?.activeGroup;
    const context: TabContext | undefined =
      active?.active === undefined ? undefined : { group: active.id, tab: active.active };
    if (dispatcher.press(chord, context) !== 'unhandled') event.preventDefault();
  });
  // Leaving the window abandons a started sequence.
  window.addEventListener('blur', () => {
    taps.reset();
    dispatcher.cancel();
  });

  return { commands, menus, keymap, icon };
}
