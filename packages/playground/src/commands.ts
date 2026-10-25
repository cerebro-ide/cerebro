// The playground's commands, menus and shortcuts.

import {
  chordFromEvent,
  CommandRegistry,
  KeyDispatcher,
  Keymap,
  MenuRegistry,
  type Platform,
} from '@cerebro-ide/commands';
import type { EditorArea, Tab, ToolWindows } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';

/** What tab commands act on: the tab a context menu was opened on, or the active one. */
export interface TabContext {
  group: string;
  tab: string;
}

export const dark = signal(true);

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
  dark.set(value);
  document.documentElement.dataset['cerebroTheme'] = value ? 'dark' : 'light';
}

export function setupCommands(
  editor: EditorArea,
  tools: ToolWindows,
  files: readonly string[],
  tabOf: (path: string) => Tab,
): MenuServices {
  const platform: Platform = navigator.platform.includes('Mac') ? 'mac' : 'other';
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const keymap = new Keymap(platform);
  const group = (c: TabContext) => editor.group(c.group);

  commands.register<TabContext>({
    id: 'editor.close',
    label: '&Close',
    run: (c) => {
      editor.close(c.group, c.tab);
    },
  });
  commands.register<TabContext>({
    id: 'editor.closeOthers',
    label: 'Close &Others',
    enabled: (c) => group(c).tabs.length > 1,
    run: (c) => {
      for (const t of group(c).tabs) if (t.id !== c.tab) editor.close(c.group, t.id);
    },
  });
  commands.register<TabContext>({
    id: 'editor.closeAll',
    label: 'Close &All Tabs',
    run: (c) => {
      for (const t of group(c).tabs) editor.close(c.group, t.id);
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
      run: (c) => {
        editor.split(c.group, direction, c.tab);
      },
    });
    menus.contribute({ menu: 'editor/tab/split', item: { command: `editor.split.${direction}` } });
  }
  commands.register<TabContext>({
    id: 'editor.copyPath',
    label: 'Copy &Path',
    run: (c) => navigator.clipboard.writeText(c.tab),
  });
  commands.register({
    id: 'file.goTo',
    label: '&Go to File',
    dialog: true,
    run: () => {
      const name = window.prompt(`Go to file (${files.join(', ')})`);
      const path = files.find((f) => name && f.endsWith(name));
      if (path) editor.open(tabOf(path));
    },
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
      editor.open({ id: `untitled-${String(untitled)}`, title: `untitled-${String(untitled)}` });
    },
  });
  commands.register({
    id: 'file.open',
    label: '&Open',
    dialog: true,
    run: () => commands.execute('file.goTo'),
  });
  files.forEach((path, i) => {
    commands.register({
      id: `file.recent.${String(i)}`,
      label: `&${String(i + 1)} ${path}`,
      run: () => {
        editor.open(tabOf(path));
      },
    });
    menus.contribute({ menu: 'main/file/recent', item: { command: `file.recent.${String(i)}` } });
  });
  commands.register<TabContext | undefined>({
    id: 'file.closeTab',
    label: '&Close Tab',
    enabled: (c) => c !== undefined,
    run: (c) => {
      if (c) editor.close(c.group, c.tab);
    },
  });
  commands.register({
    id: 'file.settings',
    label: 'Se&ttings',
    dialog: true,
    run: () => {
      window.alert('Settings come later.');
    },
  });
  commands.register({
    id: 'file.exit',
    label: 'E&xit',
    enabled: () => false,
    run: () => undefined,
  });
  for (const [id, label] of [
    ['undo', '&Undo'],
    ['redo', '&Redo'],
    ['cut', 'Cu&t'],
    ['copy', '&Copy'],
    ['paste', '&Paste'],
  ] as const) {
    commands.register({ id: `edit.${id}`, label, enabled: () => false, run: () => undefined });
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
      checked: () => tools.isVisible(tool.id),
      run: () => {
        tools.toggle(tool.id);
      },
    });
    menus.contribute({ menu: 'main/view/tools', item: { command: `view.tool.${tool.id}` } });
    const key = TOOL_SHORTCUTS[tool.id];
    if (key) keymap.bindDefault(key, `view.tool.${tool.id}`);
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
  menus.contribute({ menu: 'editor/content', item: { command: 'view.darkTheme' }, group: 'b' });

  keymap.bindDefault('Ctrl+F4', 'editor.close');
  keymap.bindDefault('Mod+Alt+N', 'file.new');
  keymap.bindDefault('Mod+Alt+S', 'file.settings');
  keymap.bindDefault('Mod+Z', 'edit.undo');
  keymap.bindDefault('Mod+Shift+Z', 'edit.redo');
  keymap.bindDefault('Mod+X', 'edit.cut');
  keymap.bindDefault('Mod+C', 'edit.copy');
  keymap.bindDefault('Mod+V', 'edit.paste');
  keymap.bindDefault('Mod+Shift+N', 'file.goTo');
  keymap.bindDefault('Ctrl+K Ctrl+T', 'view.darkTheme');
  keymap.bindDefault('Ctrl+Shift+C', 'editor.copyPath');

  // Shortcuts act on the active tab. Keys an open menu handles never get here.
  const dispatcher = new KeyDispatcher(keymap, commands);
  window.addEventListener('keydown', (event) => {
    const chord = chordFromEvent(event);
    if (chord === undefined) return;
    const active = editor.activeGroup;
    const context: TabContext | undefined =
      active.active === undefined ? undefined : { group: active.id, tab: active.active };
    if (dispatcher.press(chord, context) !== 'unhandled') event.preventDefault();
  });

  return { commands, menus, keymap };
}
