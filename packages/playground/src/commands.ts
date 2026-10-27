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
  type Platform,
} from '@cerebro-ide/commands';
import type { EditorArea, Tab, ToolWindows } from '@cerebro-ide/layout';
import { computed, effect, signal, type Signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { openSettings } from '@cerebro-ide/ui-settings';
import { active, currentHost, hostFor } from './environments.js';
import type { Place } from './find.js';
import { openFolder } from './projects.js';
import { searchEverywhere, type Result, type SearchTab } from './search-everywhere.js';
import { setupEdit } from './edit.js';
import { icon } from './icons.js';
import { PRESETS } from './keymaps.js';
import { globalSettings, save, settingsFor } from './settings.js';
import { themeIsDark } from './theme.js';

/** What tab commands act on: the tab a context menu was opened on, or the active one. */
export interface TabContext {
  group: string;
  tab: string;
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
    /** The active environment's Recent Files, most recent first. */
    recent: () => readonly Tab[];
    /** Whether the host's index can be searched. */
    available: () => boolean;
  },
): MenuServices {
  const platform: Platform = navigator.platform.includes('Mac') ? 'mac' : 'other';
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
  const sampleItems = toItems(files, (path) => ed()?.open(tabOf(path)));
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
            (path) =>
              ed()?.open({ id: `${env.id}/${path}`, title: path.split('/').at(-1) as string }),
            (path) => `${env.id}/${path}`,
          ),
        );
      },
      () => undefined,
    );
  };
  /** The files to search: the active worktree's in the app, the samples in a browser. */
  const fileItems = () => {
    const env = active();
    if (!currentHost() || !env) return sampleItems;
    return worktreeItems.get(env.id)?.get() ?? [];
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
  commands.register<TabContext>({
    id: 'editor.copyPath',
    label: 'Copy &Path',
    enabled: (c?: TabContext) => c !== undefined,
    run: (c) => navigator.clipboard.writeText(c.tab),
  });
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
          ed()?.open(tabOf(path));
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
    run: () => {
      const env = active();
      const settings = settingsFor(env?.id);
      openSettings({
        settings,
        ...(env
          ? { scopeLabels: { repo: 'Repository: cerebro', worktree: `Worktree: ${env.name}` } }
          : { scopes: ['global'] }),
        onApply: (scopes) => {
          save(settings, scopes);
        },
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
      run: () => {
        tools.toggle(tool.id);
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
        (path) => ed()?.open(tabOf(path)),
      );
    const prefix = `${env.id}/`;
    return toItems(
      tabs.filter((tab) => tab.id.startsWith(prefix)).map((tab) => tab.id.slice(prefix.length)),
      (path) => ed()?.open({ id: `${prefix}${path}`, title: path.split('/').at(-1) as string }),
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
  menus.contribute({ menu: 'editor/tab', item: { command: 'editor.copyPath' }, group: 'c-path' });
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
  keymap.bindDefault('Mod+Shift+N', 'file.goTo');
  keymap.bindDefault('Ctrl+K Ctrl+T', 'view.darkTheme');
  keymap.bindDefault('Ctrl+Shift+C', 'editor.copyPath');
  // The keymap chosen in Settings → Keymap, as it changes.
  effect(() => {
    const id = globalSettings.get('keymap');
    keymap.setPreset(PRESETS.find((preset) => preset.id === id));
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
