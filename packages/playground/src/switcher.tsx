// The Switcher, as IntelliJ's (Ctrl+Tab, Ctrl+Shift+Tab to start from the end): the tool windows
// and the open tabs, the one shown before the current one selected, so a press and a release go
// back to it. Ctrl held, Tab moves on; letting Ctrl go opens what's selected.
//
// From IntelliJ's source (Switcher.kt, SwitcherRendering.kt):
// - the tool windows: those on a stripe, by name, each with a mnemonic: its number, as Alt+1 opens
//   the Project window, else the first capital in its name not taken, else the first of 0-9 and
//   A-Z not taken;
// - the files: the open tabs, the latest shown first; with fewer than two open, the recent files
//   instead, as many as there are tool windows; up to 30;
// - the first selected is the first that isn't the tab shown, or, going back, the last;
// - below the lists, the selected file's folder.
// Claims: a file's folder after its name when another listed file has its name, as IntelliJ, but
// from the project's folder; a tab open in two groups listed once.
//
// Recent Files is IntelliJ's Switcher too, opened as from a menu (it stays until Enter or Escape),
// as its source has it (`Switcher.kt` of recentFiles/frontend, `recent`): the tool windows on the
// left, without their mnemonics (`ide.recent.files.tool.window.mnemonics` is off); on the right
// the files shown, the latest first, closed ones too, the first not shown now selected. Typing
// narrows both lists (speed search); with nothing matched, Enter opens Go to File with what was
// typed (`tryToOpenFileSearch`). "Show edited only" lists the files edited instead, and Recent
// Files' own key flips it, shown beside it; Recently Changed Files opens with it on. Diffs are
// listed too when Include diffs in navigation history is Always
// (`DiffVirtualFileBase.isIncludedInEditorHistory`).

import { chordFromEvent, formatSequence } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import type { EditorArea, Tab, ToolWindows } from '@cerebro-ide/layout';
import { signal } from '@cerebro-ide/reactive';
import { focusToolWindow } from '@cerebro-ide/ui-layout';
import {
  openSwitcher,
  type Modifier,
  type SwitcherHandle,
  type SwitcherItem,
} from '@cerebro-ide/ui-popup';
import { diffPath, tabPath } from './changes.js';
import { active } from './environments.js';
import { icon } from './icons.js';
import { recentTabs } from './navigation.js';
import { settingsFor } from './settings.js';

/** The most files listed, as IntelliJ's. */
const LIMIT = 30;

type Entry = SwitcherItem & ({ kind: 'tool'; id: string } | { kind: 'tab'; tab: Tab });

/** A tool window's number from the shortcut that opens it: Alt+1's 1. */
const numberOf = (shortcut: string | undefined) => /^[A-Za-z]+\+(\d)$/.exec(shortcut ?? '')?.[1];

/**
 * The tool windows, each with its mnemonic if they're shown (`showMnemonics`), in IntelliJ's order
 * (`mnemonicAndMainTextComparator`), shown or not: by mnemonic, digits before letters, those
 * without last; then by name.
 */
function toolEntries(services: MenuServices, tools: ToolWindows, shown = true): Entry[] {
  const windows = [...tools.windows.values()].sort((a, b) => a.title.localeCompare(b.title));
  const taken = new Set<string>();
  const mnemonics = new Map<string, string>();
  for (const window of windows) {
    const number = numberOf(services.keymap?.shortcutsFor(`view.tool.${window.id}`)[0]);
    if (number !== undefined && !taken.has(number)) {
      taken.add(number);
      mnemonics.set(window.id, number);
    }
  }
  let next = 0;
  for (const window of windows) {
    if (mnemonics.has(window.id)) continue;
    // A to Z only: keys are matched by where they are, as Digit1 or KeyA.
    let mnemonic = window.title.match(/[A-Z]/g)?.find((c) => !taken.has(c));
    while (mnemonic === undefined && next < 36) {
      const candidate = next.toString(36).toUpperCase();
      next++;
      if (!taken.has(candidate)) mnemonic = candidate;
    }
    if (mnemonic === undefined) continue;
    taken.add(mnemonic);
    mnemonics.set(window.id, mnemonic);
  }
  const key = (id: string) => mnemonics.get(id) ?? '\uffff';
  windows.sort((a, b) => {
    const [x, y] = [key(a.id), key(b.id)];
    return x === y ? a.title.localeCompare(b.title) : x < y ? -1 : 1;
  });
  return windows.map((window) => ({
    kind: 'tool',
    id: window.id,
    label: window.title,
    ...(window.icon === undefined ? {} : { icon: () => icon(window.icon as string) }),
    ...(shown && mnemonics.has(window.id) ? { mnemonic: mnemonics.get(window.id) as string } : {}),
  }));
}

/** The files: the open tabs, the latest shown first; or the recent files, if fewer are open. */
function tabEntries(area: EditorArea | undefined, count: number): Entry[] {
  const open = new Map<string, Tab>();
  for (const group of area?.groups ?? []) for (const tab of group.tabs) open.set(tab.id, tab);
  const recent = recentTabs()?.tabs ?? [];
  const shown = [
    ...recent.filter((tab) => open.has(tab.id)),
    ...[...open.values()].filter((tab) => !recent.some((r) => r.id === tab.id)),
  ];
  const tabs =
    shown.length > 1
      ? shown
      : [
          ...shown,
          ...recent
            .filter((tab) => !open.has(tab.id) && tabPath(tab.id) === tab.id)
            .slice(0, count),
        ];
  const root = active()?.id;
  /** A file's folder: in full, and from the project's folder. */
  const folders = (tab: Tab) => {
    const path = tabPath(tab.id) ?? '';
    const folder = path.slice(0, Math.max(0, path.lastIndexOf('/')));
    const inProject = root !== undefined && folder.startsWith(`${root}/`);
    return { full: folder, relative: inProject ? folder.slice(root.length + 1) : folder };
  };
  return tabs.slice(0, LIMIT).map((tab) => {
    const { full, relative } = folders(tab);
    const twin = tabs.some((other) => other !== tab && other.title === tab.title);
    return {
      kind: 'tab',
      tab,
      label: tab.title,
      icon: () => icon('file'),
      ...(twin && relative !== '' ? { detail: relative } : {}),
      status: full,
    };
  });
}

/** Recent Files' files: each by its name and its folder from the project's. */
function recentEntries(tabs: readonly Tab[]): Entry[] {
  const root = active()?.id;
  const diffs = settingsFor(root).get('diff.navigationHistory') === 'always';
  return tabs
    .filter((tab) => tabPath(tab.id) === tab.id || (diffs && diffPath(tab.id) !== undefined))
    .map((tab) => {
      const file = tabPath(tab.id) as string;
      const path =
        root !== undefined && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
      const slash = path.lastIndexOf('/');
      return {
        kind: 'tab',
        tab,
        label: tab.title,
        icon: () => icon('file'),
        ...(slash < 0 ? {} : { detail: path.slice(0, slash) }),
        status: file.slice(0, Math.max(0, file.lastIndexOf('/'))),
      };
    });
}

/** The modifiers held in the key press being handled, if a key press is being handled. */
let pressed: KeyboardEvent | undefined;

export interface SwitcherSetup {
  editor: () => EditorArea | undefined;
  tools: ToolWindows;
  /** Opens a tab, focused. */
  open: (tab: Tab) => void;
}

/** The Switcher's and Recent Files' commands, and their keys. */
export function setupSwitcher(services: MenuServices, setup: SwitcherSetup): void {
  /** Opens what was chosen: a tab, or a tool window, focused. */
  const go = (entry: Entry | undefined) => {
    if (entry?.kind === 'tab') setup.open(entry.tab);
    else if (entry) {
      setup.tools.show(entry.id);
      void focusToolWindow(entry.id);
    }
  };
  // The press that runs the command, read as it does: which modifiers are held, and Shift.
  window.addEventListener(
    'keydown',
    (event) => {
      pressed = event;
      setTimeout(() => {
        if (pressed === event) pressed = undefined;
      });
    },
    true,
  );
  services.commands.register({
    id: 'view.switcher',
    label: '&Switcher',
    run: () => {
      const event = pressed;
      const held: Modifier[] = [];
      if (event?.ctrlKey) held.push('Control');
      if (event?.altKey) held.push('Alt');
      if (event?.metaKey) held.push('Meta');
      const forward = event?.shiftKey !== true;
      const area = setup.editor();
      const left = toolEntries(services, setup.tools);
      const right = tabEntries(area, left.length);
      const current = area?.activeGroup.active;
      const others = right
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.kind === 'tab' && entry.tab.id !== current);
      const first = forward ? others[0] : others.at(-1);
      const switcher = openSwitcher<Entry>({
        title: 'Switcher',
        left,
        right,
        initial:
          right.length === 0
            ? { side: 'left', index: 0 }
            : { side: 'right', index: first?.index ?? 0 },
        held,
        close: (entry) => {
          if (entry.kind === 'tool') {
            setup.tools.hide(entry.id);
            return false;
          }
          // Listed from the area: there's one.
          const tabs = area as EditorArea;
          for (const group of tabs.groups) {
            if (group.tabs.some((tab) => tab.id === entry.tab.id))
              tabs.close(group.id, entry.tab.id);
          }
          return true;
        },
      });
      void switcher.result.then(go);
    },
  });
  // IntelliJ's, in all its keymaps: Shift starts from the end.
  services.keymap?.bindDefault('Ctrl+Tab', 'view.switcher');
  services.keymap?.bindDefault('Ctrl+Shift+Tab', 'view.switcher');

  const recentFiles = (editedOnly: boolean) => {
    const recent = recentTabs();
    // As the popup opens: the lists don't change under it.
    const shown = recentEntries(recent?.tabs ?? []);
    const changed = recentEntries(recent?.edited ?? []);
    const current = setup.editor()?.activeGroup.active;
    const first = (entries: readonly Entry[]) =>
      Math.max(
        0,
        entries.findIndex((entry) => entry.kind === 'tab' && entry.tab.id !== current),
      );
    const edited = signal(editedOnly);
    const files = () => (edited.peek() ? changed : shown);
    const flip = () => {
      edited.set(!edited.peek());
      switcher.replace(files(), first(files()));
    };
    const { keymap } = services;
    const key = keymap?.shortcutsFor('view.recentFiles')[0];
    const switcher: SwitcherHandle<Entry> = openSwitcher<Entry>({
      title: 'Recent Files',
      // Without mnemonics, as IntelliJ's when speed search is on.
      left: toolEntries(services, setup.tools, false),
      right: files(),
      initial: { side: 'right', index: first(files()) },
      empty: { left: 'No tool windows', right: 'No recent files' },
      search: {
        nothing: "Press 'Enter' to search in Project",
        none: (query) => {
          void services.commands.execute('file.goTo', { text: query });
        },
      },
      header: () => [
        <label
          class="playground-recent__edited"
          // Keeps the focus in the popup.
          on:mousedown={(event) => {
            event.preventDefault();
          }}
        >
          <input type="checkbox" tabIndex={-1} checked={() => edited.get()} on:change={flip} />
          Show edited only
        </label>,
        key === undefined || !keymap ? null : (
          <span class="playground-recent__key">{formatSequence(key, keymap.platform)}</span>
        ),
      ],
      onKey: (event) => {
        const chord = chordFromEvent(event);
        if (chord === undefined || !keymap?.commandsFor(chord).includes('view.recentFiles')) {
          return false;
        }
        flip();
        return true;
      },
    });
    void switcher.result.then(go);
  };
  services.commands.register({
    id: 'view.recentFiles',
    label: 'Recent &Files',
    dialog: true,
    run: () => {
      recentFiles(false);
    },
  });
  services.commands.register({
    id: 'view.recentChangedFiles',
    label: 'Recently Changed Files',
    dialog: true,
    run: () => {
      recentFiles(true);
    },
  });
  services.keymap?.bindDefault('Mod+E', 'view.recentFiles');
  services.menus.contribute({
    menu: 'main/view',
    item: { command: 'view.recentFiles' },
    group: 'c',
  });
}
