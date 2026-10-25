// The playground's commands, menus and shortcuts.

import {
  chordFromEvent,
  CommandRegistry,
  KeyDispatcher,
  Keymap,
  MenuRegistry,
  type Platform,
} from '@cerebro-ide/commands';
import type { EditorArea, Tab } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import type { MenuServices } from '@cerebro-ide/ui-menu';

/** What tab commands act on: the tab a context menu was opened on, or the active one. */
export interface TabContext {
  group: string;
  tab: string;
}

export const dark = signal(true);

export function setDark(value: boolean): void {
  dark.set(value);
  document.documentElement.dataset['cerebroTheme'] = value ? 'dark' : 'light';
}

export function setupCommands(
  editor: EditorArea,
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
