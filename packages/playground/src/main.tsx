import { render } from '@cerebro-ide/jsx';
import { PluginRegistry, ViewRegistry } from '@cerebro-ide/plugin-api';
import { notesPlugin } from './notes-plugin.js';
import { prettierPlugin } from './prettier-plugin.js';
import { addPlugins } from './plugins-page.js';
import { target } from './edit.js';
import { PluginView } from './plugin-view.js';
import { Layout, type Tab, type ToolWindowSpec } from '@cerebro-ide/layout';
import '@cerebro-ide/theme/fonts.css';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import {
  EditorAreaView,
  EnvironmentEditors,
  EnvironmentTabs,
  ShellLayout,
  ToolTabs,
} from '@cerebro-ide/ui-layout';
import './bridge.js';
import { MenuBar, openContextMenu, syncNativeMenu } from '@cerebro-ide/ui-menu';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '@cerebro-ide/ui-popup/styles.css';
import '@cerebro-ide/ui-settings/styles.css';
import '@cerebro-ide/ui-keymap/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { installScrollbars } from '@cerebro-ide/ui-scrollbar';
import '@cerebro-ide/ui-scrollbar/styles.css';
import { StatusBar, StatusBarView, type Progress } from '@cerebro-ide/ui-statusbar';
import '@cerebro-ide/ui-statusbar/styles.css';
import '@cerebro-ide/ui-tree/styles.css';
import '@cerebro-ide/ui-editor/styles.css';
import {
  CodeEditor,
  DiffEditor,
  fileIn,
  formatIn,
  formatLineColumn,
  languageName,
  parseLineColumn,
  type AskFormat,
  type CompletionItem,
  type EditorDocument,
  type Mark,
  type Place,
} from '@cerebro-ide/ui-editor';
import { ProjectTree, selectInTree } from './project.js';
import { askProblems, hasErrors, ProblemsView, setupProblems } from './problems.js';
import { fileManagerLabel, setupSelectIn } from './select-in.js';
import { CommitTabs, CommitWindow, setupShelf, showCommitTab } from './shelf.js';
import { setupHistory } from './history.js';
import { GitLogView } from './git-log.js';
import { setupSwitcher } from './switcher.js';
import { AgentChangesView, diffPath, diffRange, setupChanges, type Range } from './changes.js';
import { AgentBadge, agentText, setupAgents } from './agents.js';
import {
  carets,
  focusing,
  history,
  recentTabs,
  reveals,
  setupNavigation,
  tops,
} from './navigation.js';
import { progress, setupIndexing } from './indexing.js';
import { MainToolbar, ToolbarButton, ToolbarDropdown } from '@cerebro-ide/ui-toolbar';
import '@cerebro-ide/ui-toolbar/styles.css';
import {
  active,
  activeProject,
  currentHost,
  existingWorktree,
  firstWorktree,
  hostFor,
  loadProject,
  projectOf,
  projects,
  seedFiles,
  setupEnvironments,
  gitRepository,
  useProjects,
  workspace,
  worktreeHolding,
  type Host,
  type ProjectState,
} from './environments.js';
import { openMenu } from '@cerebro-ide/ui-menu';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker } from '@cerebro-ide/ui-popup';
import { computed, effect, signal, untracked } from '@cerebro-ide/reactive';
import { restoreLayout, saveLayout } from './persist.js';
import { applyTheme } from './theme.js';
import { documentFor, onBeforeSave, saveAll, saveFiles, setupSaving } from './documents.js';
import { resolveConflict } from './conflict.js';
import { findInFiles } from './find.js';
import { FindView, showOccurrences, type Occurrences } from './find-window.js';
import {
  closeProject,
  openProject,
  projectAdded,
  projectRemoved,
  setActiveProject,
  setupProjects,
  windowProjects,
} from './projects.js';
import type { RecentProject } from './bridge.js';
import { globalSettings, registry as settingsRegistry, settingsFor } from './settings.js';
import { chordFromEvent, formatSequence } from '@cerebro-ide/commands';
import { dark, menuVisible, setupCommands, type TabContext } from './commands.js';
import '@cerebro-ide/ui-layout/styles.css';
import { icon } from './icons.js';
import { editorKeys } from './keymaps.js';
import { agentTerminal, setLastShellClosed, setTerminalKeys, shellsFor } from './terminals.js';
import '@cerebro-ide/ui-terminal/styles.css';
import './playground.css';

// In the desktop app the toolbar is the title bar: tag the page so its CSS leaves room for the
// window controls.
if (window.cerebro?.app) {
  document.documentElement.classList.add(
    'cerebro-app',
    `cerebro-platform-${window.cerebro.platform}`,
  );
}

// In the desktop app, each project's host lists its real worktrees; a folder that isn't a git
// repository is one environment. Without the hosts (in a browser), the samples stay.
const initial = windowProjects();
/** A project's host, through the app. */
const hostOf = (path: string): Host => ({
  request: (method, params) =>
    (window.cerebro as NonNullable<Window['cerebro']>).host.request(path, method, params),
});
if (window.cerebro && initial.length > 0) {
  useProjects(await Promise.all(initial.map((p) => loadProject(p, hostOf(p.path)))));
}

const layout = new Layout();

const windows: ToolWindowSpec[] = [
  { id: 'project', title: 'Project', anchor: 'left', icon: 'folder' },
  { id: 'commit', title: 'Commit', anchor: 'left', icon: 'commit' },
  { id: 'agentChanges', title: 'Agent Changes', anchor: 'left', icon: 'agent' },
  { id: 'structure', title: 'Structure', anchor: 'left', slot: 'secondary', icon: 'structure' },
  { id: 'bookmarks', title: 'Bookmarks', anchor: 'left', slot: 'secondary', icon: 'bookmark' },
  { id: 'terminal', title: 'Terminal', anchor: 'bottom', icon: 'terminal' },
  { id: 'problems', title: 'Problems', anchor: 'bottom', icon: 'problems' },
  { id: 'git', title: 'Git', anchor: 'bottom', icon: 'git' },
  { id: 'claude', title: 'Claude', anchor: 'right', icon: 'agent' },
  { id: 'notifications', title: 'Notifications', anchor: 'right', icon: 'bell' },
  { id: 'database', title: 'Database', anchor: 'right', icon: 'database' },
  { id: 'services', title: 'Services', anchor: 'bottom', slot: 'secondary', icon: 'services' },
];
for (const spec of windows) layout.toolWindows.register(spec);
layout.toolWindows.show('project');
layout.toolWindows.show('terminal');
layout.toolWindows.show('claude');
// Closing the last terminal hides the Terminal tool window, as IntelliJ's.
setLastShellClosed(() => {
  layout.toolWindows.hide('terminal');
});

const FILES = [
  'README.md',
  'package.json',
  'src/main.ts',
  'src/layout.ts',
  'src/shell.tsx',
  'src/editor.tsx',
  'src/styles.css',
];

const tabOf = (path: string) => ({ id: path, title: path.split('/').at(-1) as string });

/** The active project: a window always has one, the samples or its own. */
const shownProject = () => activeProject() as ProjectState;

/** The active environment's editor area, if an environment is open. */
const editor = () => active()?.editor;

// Navigation by name, through the host's index; Search Everywhere's commands open places with it.
const navigation = setupNavigation(editor);
const services = setupCommands(editor, layout.toolWindows, FILES, tabOf, {
  openAt: navigation.openAt,
  open: navigation.open,
  recent: () => recentTabs()?.tabs ?? [],
  available: navigation.available,
});
/**
 * Closes the active project: its tabs, then its host. The window's last closes the window, which
 * saves the files first.
 */
async function closeActiveProject(): Promise<void> {
  const project = shownProject();
  if (projects.get().length > 1) {
    await saveAll().catch(reportSaving);
    environments.removeProject(project.path);
    projectRemoved(project.path);
  }
  await closeProject(project.path);
}
await setupProjects(services.commands, services.menus, closeActiveProject);
setupChanges(services, {
  open: (tab) => editor()?.open(tab),
  activeTab: () => editor()?.activeGroup.active,
  show: () => {
    showCommitTab();
    layout.toolWindows.show('commit');
  },
  openAt: navigation.openAt,
});
setupShelf(services, {
  open: (tab) => editor()?.open(tab),
  show: () => {
    layout.toolWindows.show('commit');
  },
});
setupHistory(services, { activeTab: () => editor()?.activeGroup.active });
/** Opens a file at a place with its editor focused: from a list, as IntelliJ's Jump to Source. */
const jumpTo = (at: { path: string; line: number; column: number }) => {
  navigation.openAt(at);
  focusing.set(at.path, {});
};
setupProblems(services, { openAt: jumpTo });

// Terminals let the app's shortcuts through, except plain Ctrl+key, which programs use (Ctrl+C).
setTerminalKeys((event) => {
  const keymap = services.keymap;
  const chord = chordFromEvent(event);
  if (chord === undefined) return false;
  const bare = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  if (bare && keymap.platform !== 'mac') return false;
  return keymap.commandsFor(chord).length > 0 || keymap.isPrefix(chord);
});

// Plugins: the sample Notes plugin, and Prettier, added as any plugin would be; Settings → Plugins
// turns them off. They reach the editor that has the focus (or had it before a menu took it), and
// a file's settings and host.
const views = new ViewRegistry(layout.toolWindows);
const plugins = new PluginRegistry({
  commands: services.commands,
  menus: services.menus,
  keymap: services.keymap,
  views,
  settings: settingsRegistry,
  settingsOf: (path) => settingsFor(worktreeHolding(path)),
  hostOf: hostFor,
  editors: {
    focused: () => {
      const at = target();
      return at && fileIn(at);
    },
    // Run only while `focused` is a file: the command is enabled by it.
    format: (formatter, words) => {
      const at = target() as Element;
      formatIn(
        at,
        async (range) => {
          const path = fileIn(at) as string;
          // Shown in the editor, so read.
          const text = ((await documentFor(path)) as EditorDocument).text.peek();
          const offset = (place: Place) => text.line(place.line + 1).from + place.column;
          return formatter({
            path,
            text: text.toString(),
            ...(range ? { range: { from: offset(range.from), to: offset(range.to) } } : {}),
          });
        },
        words,
      );
    },
    beforeSave: (hook) => ({ dispose: onBeforeSave(hook) }),
  },
});
await addPlugins(plugins, [notesPlugin, prettierPlugin]);

// Find in Files and Replace in Files, through the host: Edit → Find, as IntelliJ's. What's found
// can go to the Find tool window, which appears the first time, as IntelliJ's.
const inFindWindow = (occurrences: Occurrences) => {
  if (!layout.toolWindows.windows.has('find')) {
    layout.toolWindows.register({ id: 'find', title: 'Find', anchor: 'bottom', icon: 'search' });
  }
  showOccurrences(occurrences);
  layout.toolWindows.show('find');
};
services.commands.register({
  id: 'find.inFiles',
  label: 'Find in &Files',
  dialog: true,
  enabled: navigation.available,
  run: () =>
    findInFiles({
      open: navigation.openAt,
      showOccurrences: inFindWindow,
      file: editor()?.activeGroup.active,
    }),
});
services.keymap.bindDefault('Mod+Shift+F', 'find.inFiles');
services.menus.contribute({
  menu: 'main/edit',
  item: { submenu: 'main/edit/find', label: '&Find' },
  group: 'f',
});
services.menus.contribute({ menu: 'main/edit/find', item: { command: 'find.inFiles' } });
services.commands.register({
  id: 'replace.inFiles',
  label: '&Replace in Files',
  dialog: true,
  enabled: navigation.available,
  run: () =>
    findInFiles({
      open: navigation.openAt,
      showOccurrences: inFindWindow,
      file: editor()?.activeGroup.active,
      replacing: true,
    }),
});
services.keymap.bindDefault('Mod+Shift+R', 'replace.inFiles');
services.menus.contribute({ menu: 'main/edit/find', item: { command: 'replace.inFiles' } });
// Back and Forward through the places the caret was, as IntelliJ's Navigate menu, its shortcuts,
// and the mouse's own back and forward buttons.
services.commands.register({
  id: 'navigate.back',
  label: '&Back',
  enabled: () => history()?.canGoBack ?? false,
  run: () => history()?.goBack(),
});
services.commands.register({
  id: 'navigate.forward',
  label: '&Forward',
  enabled: () => history()?.canGoForward ?? false,
  run: () => history()?.goForward(),
});
const mac = services.keymap.platform === 'mac';
services.keymap.bindDefault(mac ? 'Mod+[' : 'Ctrl+Alt+Left', 'navigate.back');
services.keymap.bindDefault(mac ? 'Mod+]' : 'Ctrl+Alt+Right', 'navigate.forward');
services.menus.contribute({
  menu: 'main',
  item: { submenu: 'main/navigate', label: '&Navigate' },
  order: 4,
});
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.back' },
  group: 'a',
});
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.forward' },
  group: 'a',
});
// Recent Files, as IntelliJ's: the files shown, the latest first, the one before the current
// highlighted, so Enter goes back to it. "Show edited only" lists the files edited instead; Recent
// Files' own key flips it while the popup is open, and Recently Changed Files opens with it on.
async function recentFiles(editedOnly: boolean): Promise<void> {
  const root = active()?.id;
  const recent = recentTabs();
  const edited = signal(editedOnly);
  const itemsOf = (tabs: readonly Tab[]) =>
    tabs
      .filter((tab) => diffPath(tab.id) === undefined)
      .map((tab) => {
        const path =
          root !== undefined && tab.id.startsWith(`${root}/`)
            ? tab.id.slice(root.length + 1)
            : tab.id;
        const slash = path.lastIndexOf('/');
        return {
          label: tab.title,
          ...(slash < 0 ? {} : { detail: path.slice(0, slash) }),
          icon: () => icon('file'),
          tab,
        };
      });
  // As the popup opens: the lists don't change under it.
  const shown = itemsOf(recent?.tabs ?? []);
  const changed = itemsOf(recent?.edited ?? []);
  const flip = () => {
    edited.set(!edited.peek());
  };
  const chosen = await openPicker({
    label: 'Recent Files',
    placeholder: 'Type a file name',
    position: 'top',
    empty: 'No recent files',
    initial: 1,
    header: () => [
      <span class="playground-popup__title">Recent Files</span>,
      <label
        class="playground-recent__edited"
        // Keeps the focus in the search field, as the options' toggles do.
        on:mousedown={(event) => {
          event.preventDefault();
        }}
      >
        <input type="checkbox" checked={() => edited.get()} on:change={flip} />
        Show edited only
      </label>,
    ],
    items: (query) => fuzzyFilter(edited.get() ? changed : shown, query),
    onKey: (event) => {
      const chord = chordFromEvent(event);
      if (chord === undefined || !services.keymap.commandsFor(chord).includes('view.recentFiles')) {
        return false;
      }
      flip();
      return true;
    },
  }).result;
  if (chosen) navigation.open(chosen.tab);
}
services.commands.register({
  id: 'view.recentFiles',
  label: 'Recent &Files',
  dialog: true,
  run: () => recentFiles(false),
});
services.commands.register({
  id: 'view.recentChangedFiles',
  label: 'Recently Changed Files',
  dialog: true,
  run: () => recentFiles(true),
});
services.keymap.bindDefault('Mod+E', 'view.recentFiles');
setupSwitcher(services, { editor, tools: layout.toolWindows, open: navigation.open });
services.menus.contribute({ menu: 'main/view', item: { command: 'view.recentFiles' }, group: 'c' });
// Go to Line, as IntelliJ's Navigate → Line/Column: the caret's line:column to start from.
/** The active tab's file, if it's one (not a diff). */
const activeFile = () => {
  const tab = editor()?.activeGroup.activeTab;
  return tab && diffPath(tab.id) === undefined ? tab : undefined;
};
services.commands.register({
  id: 'navigate.goToLine',
  label: '&Line/Column',
  dialog: true,
  enabled: () => activeFile() !== undefined,
  run: async () => {
    const file = activeFile() as Tab;
    const current = carets.get(file.id) ?? { line: 0, column: 0 };
    const typed = await prompt({
      title: 'Go to Line:Column',
      label: '[Line] [:column]:',
      value: formatLineColumn(current),
      validate: (text) =>
        parseLineColumn(text, current) === undefined ? 'Not a line or column' : undefined,
    });
    if (typed === undefined) return;
    // The dialog takes only what parses.
    const at = parseLineColumn(typed, current) as NonNullable<ReturnType<typeof parseLineColumn>>;
    history()?.record();
    reveals.set(file.id, at);
  },
});
services.keymap.bindDefault(mac ? 'Mod+L' : 'Ctrl+G', 'navigate.goToLine');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.goToLine' },
  group: 'b',
});
// File Structure, as IntelliJ's Navigate → File Structure: the active file's symbols, from its
// language server.
services.commands.register({
  id: 'navigate.fileStructure',
  label: 'File &Structure',
  dialog: true,
  enabled: () => navigation.available() && activeFile() !== undefined,
  run: async () => {
    const file = activeFile() as Tab;
    const caret = carets.get(file.id) ?? { line: 0, column: 0 };
    const doc = await documentFor(file.id);
    if ('error' in doc) return;
    await navigation.fileStructure(file.id, doc.text.peek().toString(), caret);
  },
});
services.keymap.bindDefault('Mod+F12', 'navigate.fileStructure');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.fileStructure' },
  group: 'b',
});
// Select Opened File, as IntelliJ's button in the Project tool window's header.
services.commands.register({
  id: 'project.selectOpenedFile',
  label: 'Select Opened File',
  icon: 'locate',
  enabled: () => activeFile() !== undefined,
  run: async () => {
    const file = activeFile() as Tab;
    layout.toolWindows.show('project');
    await selectInTree(file.id, FILES);
  },
});
/**
 * Below the focused editor's caret, for a popup shown at it, as IntelliJ shows Select In; else at the
 * window's upper middle.
 */
function caretPoint(): { x: number; y: number } {
  const cursor = document.activeElement?.shadowRoot?.querySelector('.cm-cursor-primary');
  if (!cursor) return { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  const { left, bottom } = cursor.getBoundingClientRect();
  return { x: left, y: bottom };
}
// Select In (select-in.ts): the Project tool window, and in the app the system's file manager.
setupSelectIn(
  services,
  [
    {
      id: 'project',
      label: 'Project',
      can: () => true,
      show: async (path) => {
        layout.toolWindows.show('project');
        await selectInTree(path, FILES);
      },
    },
    ...(window.cerebro
      ? [
          {
            id: 'fileManager',
            label: fileManagerLabel(window.cerebro.platform),
            // A project's file, on disk: not a sample.
            can: () => currentHost() !== undefined,
            show: (path: string) => {
              window.cerebro?.shell.reveal(path);
            },
          },
        ]
      : []),
  ],
  () => activeFile()?.id,
  caretPoint,
);
services.keymap.bindDefault('Alt+F1', 'navigate.selectIn');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.selectIn' },
  group: 'b',
});
// IntelliJ's Always Select Opened File, in the Project tool window's Options, under Behavior: the
// active editor's file is selected in the tree as tabs change. Off by default, as in IntelliJ; kept
// in the browser's storage.
const ALWAYS_SELECT_KEY = 'cerebro.project.alwaysSelectOpened';
const alwaysSelect = signal(
  (() => {
    try {
      return localStorage.getItem(ALWAYS_SELECT_KEY) === 'true';
    } catch {
      return false;
    }
  })(),
);
services.commands.register({
  id: 'project.alwaysSelectOpened',
  label: 'Always Select Opened File',
  checked: () => alwaysSelect.get(),
  run: () => {
    alwaysSelect.set(!alwaysSelect.peek());
    try {
      localStorage.setItem(ALWAYS_SELECT_KEY, String(alwaysSelect.peek()));
    } catch {
      // Storage may be blocked; the option holds until reload.
    }
  },
});
services.menus.contribute({ menu: 'project/options', item: { heading: 'Behavior' } });
services.menus.contribute({
  menu: 'project/options',
  item: { command: 'project.alwaysSelectOpened' },
});
effect(() => {
  const file = alwaysSelect.get() ? activeFile() : undefined;
  // The tree's own state, read as it opens folders, isn't what this follows.
  if (file) untracked(() => void selectInTree(file.id, FILES));
  return undefined;
});
window.addEventListener('mouseup', (event) => {
  const command = { 3: 'navigate.back', 4: 'navigate.forward' }[event.button];
  if (command === undefined || !services.commands.isEnabled(command)) return;
  event.preventDefault();
  services.commands.execute(command);
});
// Saving, on its own as IntelliJ's (documents.ts), and when the window closes (the app asks,
// through cerebroSaveAll, before it closes or reloads the window); Save All saves at once.
const reportSaving = (error: unknown) => {
  openDialog({
    title: 'Couldn’t Save',
    content: () => <p class="cerebro-selectable">{(error as Error).message}</p>,
  });
};
services.commands.register({
  id: 'file.saveAll',
  label: 'Save &All',
  run: () => saveAll().catch(reportSaving),
});
services.keymap.bindDefault('Mod+S', 'file.saveAll');
services.menus.contribute({ menu: 'main/file', item: { command: 'file.saveAll' }, group: 'b' });
(globalThis as { cerebroSaveAll?: () => Promise<void> }).cerebroSaveAll = () =>
  saveAll().catch((error: unknown) => {
    console.error(error);
  });
setupSaving(
  reportSaving,
  resolveConflict,
  (path) => {
    // In every environment's editor, every group.
    for (const env of workspace.open) {
      for (const group of env.editor.groups) {
        if (group.tabs.some((tab) => tab.id === path)) env.editor.close(group.id, path);
      }
    }
  },
  // Settings → System Settings, as IntelliJ's autosave.
  () =>
    globalSettings.get('system.saveWhenIdle') === true
      ? Number(globalSettings.get('system.idleSeconds')) * 1000
      : undefined,
);
// The samples open with sample files; a real project with none.
const environments = setupEnvironments(services.commands, services.menus, (env) => {
  if (initial.length === 0) seedFiles(env, tabOf);
});
// A project that joins the window shows at once; one asked to open again comes to the front.
window.cerebro?.project.onAdded(({ replaces, ...project }) => {
  projectAdded(project);
  // One opened in This Window takes the active project's place, whose files are saved first.
  if (replaces !== undefined) projectRemoved(replaces);
  void (replaces === undefined ? Promise.resolve() : saveAll().catch(reportSaving))
    .then(() => loadProject(project, hostOf(project.path)))
    .then((state) => {
      environments.addProject(state, replaces);
    });
});
// This Window replaces the active project.
setActiveProject(() => activeProject()?.path);
window.cerebro?.project.onShow((path) => {
  environments.showProject(path);
});
// The layout as it was left, else the defaults: one environment open.
const persisted = {
  // Each window keeps its own, by its first project.
  key: initial[0] ? `cerebro.layout:${initial[0].path}` : 'cerebro.layout',
  tools: layout.toolWindows,
  workspace,
  resolve: existingWorktree,
  // A repository's files are read again from disk (one that's gone says so); of the samples,
  // untitled files' contents aren't kept, so neither are their tabs.
  keepTab: (tab: { id: string }) => currentHost() !== undefined || FILES.includes(tab.id),
};
if (!restoreLayout(persisted)) environments.open(firstWorktree());
saveLayout(persisted);

/** What tab commands from the main menu act on: the active tab. */
function activeTab(): TabContext | undefined {
  const group = editor()?.activeGroup;
  return group?.active === undefined ? undefined : { group: group.id, tab: group.active };
}

/** A sample status bar: what really goes on it is still to be decided. */
const status = new StatusBar();
// The index's progress, from the host in the app; a sample task in a browser.
const indexing = signal<Progress>(0);
if (currentHost()) {
  // Indexing and agents are known by their worktree, whichever host they come from.
  // Only the app's projects have hosts.
  const app = window.cerebro as NonNullable<Window['cerebro']>;
  const notifications = (listener: (method: string, params: unknown) => void) =>
    app.host.onNotification((_project, method, params) => {
      listener(method, params);
    });
  setupIndexing(notifications);
  setupAgents(notifications);
} else {
  const timer = setInterval(() => {
    const value = indexing.get();
    if (typeof value === 'number' && value < 1) indexing.set(Math.min(1, value + 0.025));
    else {
      indexing.set(undefined);
      clearInterval(timer);
    }
  }, 200);
}
/** The active worktree's indexing, as a fraction done; undefined when it's done or not started. */
const indexProgress = (): Progress => {
  if (!currentHost()) return indexing.get();
  const env = active();
  const state = env ? progress.get(env.id) : undefined;
  return state && state.done < state.total ? state.done / state.total : undefined;
};
/** The active tab's file: a diff tab's too. */
const activePath = () => {
  const id = editor()?.activeGroup.active;
  return id === undefined ? undefined : (diffPath(id) ?? id);
};
status.add({
  id: 'env',
  side: 'left',
  icon: 'git',
  text: () => {
    const env = active();
    if (!env) return 'No environment';
    // A folder without git has no branch.
    return env.branch === '' ? env.name : `${env.name} · ${env.branch}`;
  },
  tooltip: () => 'Environment: worktree and branch (sample)',
});
status.add({
  id: 'file',
  side: 'left',
  order: 1,
  text: () => activePath() ?? 'No file open',
  tooltip: () => 'The active file',
});
status.add({
  id: 'indexing',
  side: 'left',
  order: 2,
  text: () => {
    const env = active();
    const state = env ? progress.get(env.id) : undefined;
    if (currentHost() && state && state.done < state.total) {
      return `Indexing… ${state.done.toLocaleString()} / ${state.total.toLocaleString()}`;
    }
    return indexProgress() === undefined ? 'Indexed' : 'Indexing…';
  },
  tooltip: () =>
    currentHost()
      ? 'The worktree’s sources, indexed for navigation by name'
      : 'A background task (sample)',
  progress: indexProgress,
});
status.add({
  id: 'agent',
  side: 'left',
  order: 3,
  icon: 'agent',
  text: () => agentText(active()?.id),
  tooltip: () => 'The worktree’s agent, in the Claude tool window',
  command: 'view.tool.claude',
});
status.add({
  id: 'position',
  order: 1,
  text: () => '1:1',
  tooltip: () => 'Go to File',
  command: 'file.goTo',
});
status.add({ id: 'separator', order: 2, text: () => 'LF', tooltip: () => 'Line Separator' });
status.add({ id: 'encoding', order: 3, text: () => 'UTF-8', tooltip: () => 'File Encoding' });
status.add({ id: 'indent', order: 4, text: () => '2 spaces', tooltip: () => 'Indent' });
status.add({
  id: 'type',
  order: 5,
  text: () => languageName(activePath() ?? ''),
  tooltip: () => 'File Type',
});

/**
 * An environment's name on its tab: with its project's once the window has two, unless it's the
 * project's own folder.
 */
function envName(id: string, name: string): string {
  const project = projectOf(id);
  return projects.get().length < 2 || !project || project.name === name
    ? name
    : `${project.name} · ${name}`;
}

// The window is named after the active project.
effect(() => {
  if (window.cerebro) document.title = shownProject().name;
  return undefined;
});

/** The recent projects, read again each time the Project popup opens. */
const recentProjects = signal<RecentProject[]>([]);

/**
 * The toolbar's Project popup, as IntelliJ's project widget: Open…, the window's projects, and the
 * recent ones, which open as the "Open project in" setting says.
 */
function pickProject(button: HTMLElement) {
  void window.cerebro?.project.recent().then((recent) => {
    recentProjects.set(recent);
  });
  type Choice = { label: string; detail?: string; group?: string; run: () => void };
  const handle = openPicker<Choice & { icon?: () => Node }>({
    label: 'Projects',
    placeholder: 'Search',
    position: { below: button },
    owner: button,
    items: (query) => {
      const open = projects.get();
      return [
        ...fuzzyFilter(
          [{ label: 'Open…', run: () => services.commands.execute('file.open') }],
          query,
        ),
        ...fuzzyFilter(
          open.map((p) => ({
            label: p.name,
            ...(p.path === '' ? {} : { detail: p.path }),
            group: 'This Window',
            ...(activeProject() === p ? { icon: () => icon('check') } : {}),
            run: () => {
              environments.showProject(p.path);
            },
          })),
          query,
        ),
        ...fuzzyFilter(
          recentProjects
            .get()
            .filter((r) => r.exists && !open.some((p) => p.path === r.path))
            .map((r) => ({
              label: r.name,
              detail: r.path,
              group: 'Recent Projects',
              run: () => void openProject(r.path),
            })),
          query,
        ),
      ];
    },
  });
  void handle.result.then((choice) => choice?.run());
  return handle;
}

/** The shortcut bound to a command, formatted for this platform. */
function shortcutOf(command: string): string | undefined {
  const key = services.keymap.shortcutsFor(command)[0];
  return key === undefined ? undefined : formatSequence(key, services.keymap.platform);
}

/** On macOS the desktop app shows the menu in the system menu bar, not in the window. */
const nativeMenu = window.cerebro?.platform === 'darwin' ? window.cerebro.menu : undefined;
if (nativeMenu) syncNativeMenu(services, nativeMenu, { context: activeTab });

function Header() {
  // Changes with the active project, not with each of its worktrees.
  const git = computed(() => gitRepository.get());
  return (
    <MainToolbar
      left={() => [
        nativeMenu ? null : (
          <MenuBar services={services} visible={() => menuVisible.get()} context={activeTab} />
        ),
        <ToolbarDropdown
          services={services}
          popup={pickProject}
          label="Project"
          badge={() => shownProject().name}
          text={() => shownProject().name}
        />,
        <ToolbarDropdown
          services={services}
          popup={environments.pickWorktree}
          label="Worktree"
          icon={icon('folder')}
          text={() => active()?.name ?? 'No worktree'}
        />,
        // A folder without git has no branches.
        () =>
          git.get() ? (
            <ToolbarDropdown
              services={services}
              popup={environments.pickBranch}
              label="Branch"
              icon={icon('git')}
              text={() => active()?.branch ?? '—'}
            />
          ) : null,
      ]}
      right={() => [
        <ToolbarButton
          commands={services.commands}
          command="search.everywhere"
          icon={icon('search')}
          shortcut={() => shortcutOf('search.everywhere')}
        />,
        <ToolbarButton
          commands={services.commands}
          command="file.settings"
          icon={icon('services')}
          shortcut={() => shortcutOf('file.settings')}
        />,
      ]}
    />
  );
}

function Files() {
  return (
    <div class="playground-files">
      <ProjectTree samples={FILES} open={navigation.open} />
    </div>
  );
}

/** The active worktree's terminal of a kind: its shell (the tab shown), or its agent. */
function TerminalPane(props: { kind: 'shell' | 'claude' }) {
  return () => {
    const env = active();
    if (!env) return <p class="playground-project__empty">No environment open</p>;
    const shells = shellsFor(env.id);
    const view = props.kind === 'claude' ? agentTerminal(env.id) : shells.view(shells.active);
    if (!view) {
      return <p class="playground-project__empty">Terminals run in the desktop app.</p>;
    }
    return view.element;
  };
}

/** A Terminal tab, for its context menu's commands. */
interface ShellTab {
  worktree: string;
  number: number;
}
// The Terminal tab's context menu, as IntelliJ's: Rename Session asks for a name, as its dialog
// ("Session name:").
services.commands.register<ShellTab>({
  id: 'terminal.renameSession',
  label: 'Rename Session',
  dialog: true,
  run: async ({ worktree, number }) => {
    const shells = shellsFor(worktree);
    const name = await prompt({
      title: 'Rename Session',
      label: 'Session name:',
      value: shells.titleOf(number),
    });
    if (name !== undefined) shells.rename(number, name);
  },
});
services.commands.register<ShellTab>({
  id: 'terminal.closeTab',
  label: 'Close Tab',
  run: ({ worktree, number }) => {
    shellsFor(worktree).close(number);
  },
});
services.menus.contribute({ menu: 'terminal/tab', item: { command: 'terminal.renameSession' } });
services.menus.contribute({
  menu: 'terminal/tab',
  item: { command: 'terminal.closeTab' },
  group: 'b',
});

/** The Terminal tool window's tabs: the active worktree's shells. */
function TerminalTabs() {
  return () => {
    const env = active();
    // In a plain browser there are no terminals to show tabs for.
    if (!env || !window.cerebro) return null;
    const shells = shellsFor(env.id);
    // At once, not a frame later: keys typed meanwhile went to the + button, whose Space opened
    // yet another tab.
    const focus = () => {
      shells.view(shells.active)?.focus();
    };
    return (
      <ToolTabs
        tabs={() =>
          shells.numbers.map((number) => ({
            id: String(number),
            title: shells.titleOf(number),
            active: shells.active === number,
            select: () => {
              shells.select(number);
              focus();
            },
            close: () => {
              shells.close(number);
            },
            contextMenu: (event: MouseEvent) => {
              openContextMenu(services, 'terminal/tab', event, { worktree: env.id, number });
            },
          }))
        }
        add={{
          label: 'New Tab',
          run: () => {
            shells.add();
            focus();
          },
        }}
      />
    );
  };
}

/** A tool window's content for the active environment: switching environments switches it. */
function Content(props: { id: string }) {
  if (props.id === 'project') return <Files />;
  if (props.id === 'commit')
    return <CommitWindow services={services} open={(tab) => editor()?.open(tab)} />;
  if (props.id === 'agentChanges')
    return <AgentChangesView services={services} open={(tab) => editor()?.open(tab)} />;
  if (props.id === 'git') return <GitLogView open={(tab) => editor()?.open(tab)} />;
  if (props.id === 'terminal') return <TerminalPane kind="shell" />;
  if (props.id === 'find') return <FindView open={navigation.openAt} />;
  if (props.id === 'claude') return <TerminalPane kind="claude" />;
  if (props.id === 'problems') {
    return (
      <ProblemsView services={services} file={() => editor()?.activeGroup.active} openAt={jumpTo} />
    );
  }
  const view = views.get(props.id);
  if (view) return <PluginView view={view} />;
  // Content is drawn only for the windows registered.
  const { title } = layout.toolWindows.windows.get(props.id) as ToolWindowSpec;
  return () => (
    <ul class="playground-list">
      {Array.from({ length: 12 }, (_, i) => (
        <li>
          {active()?.name ?? 'none'} · {title} item {i + 1}
        </li>
      ))}
    </ul>
  );
}

// The desktop app keeps the display scale chosen, for its next start.
effect(() => {
  window.cerebro?.display.setScale(String(globalSettings.get('appearance.displayScale')));
  return undefined;
});

// The theme follows its setting.
effect(() => {
  applyTheme(dark.get());
  return undefined;
});

installScrollbars();

/** A file's document in the editor, as the environment's settings say. */
function Code(props: { path: string; env: string }) {
  const settings = settingsFor(props.env);
  const loaded = signal<EditorDocument | { error: string } | undefined>(undefined);
  void documentFor(props.path, () => sampleText(props.path)).then((result) => {
    loaded.set(result);
    if (!('error' in result) && navigation.available()) {
      navigation.opened(props.path, result.text.peek().toString());
    }
  });
  return (
    <div
      class="playground-code"
      on:contextmenu={(event) => openContextMenu(services, 'editor/content', event)}
      on:focusout={() => {
        // The editor's file is saved when the focus leaves it, for the window or somewhere else in
        // it. A move inside the editor stays in its shadow root: it doesn't come out as a focusout.
        saveFiles([props.path]).catch(reportSaving);
      }}
    >
      {() => {
        const state = loaded.get();
        if (!state) return <p class="playground-code__note">Loading…</p>;
        if ('error' in state) {
          return (
            <p class="playground-code__note">
              Can’t open {props.path}: {state.error}
            </p>
          );
        }
        const asked = (doc: EditorDocument, at: { line: number; column: number }) => ({
          path: props.path,
          text: doc.text.peek().toString(),
          ...at,
        });
        return (
          <CodeEditor
            path={props.path}
            document={state}
            reveal={() => reveals.get(props.path)}
            focus={() => focusing.get(props.path)}
            onCaret={(at) => carets.set(props.path, at)}
            onScroll={(top) => tops.set(props.path, top)}
            {...(navigation.available()
              ? {
                  onGoToDefinition: (name: string, at: { line: number; column: number }) =>
                    void navigation.goToDefinition(name, asked(state, at)),
                  onFindUsages: (name: string, at: { line: number; column: number }) =>
                    void navigation.findUsages(name, asked(state, at)),
                  onContextActions: (
                    at: { line: number; column: number },
                    caret: Pick<Element, 'getBoundingClientRect'>,
                  ) => void navigation.contextActions(asked(state, at), caret, state),
                  usages: (at: { line: number; column: number }) =>
                    navigation.usages(asked(state, at)),
                  documentation: (at: { line: number; column: number }) =>
                    navigation.documentation(asked(state, at)),
                  parameterInfo: (at: { line: number; column: number }) =>
                    navigation.signatures(asked(state, at)),
                  renaming: (at: { line: number; column: number }) =>
                    navigation.renaming(asked(state, at)),
                  onRename: (at: { line: number; column: number }, name: string) =>
                    navigation.rename(asked(state, at), name),
                  format: (range?: Parameters<AskFormat>[0]) =>
                    navigation.format(
                      { path: props.path, text: state.text.peek().toString() },
                      settings.get('editor.tabSize') as number,
                      range,
                    ),
                  completions: (text: string, at: { line: number; column: number }) =>
                    navigation.completions({ path: props.path, text, ...at }),
                  resolveCompletion: (item: CompletionItem) =>
                    navigation.completionEdits(props.path, item),
                  canGoToDefinition: (name: string, at: { line: number; column: number }) =>
                    navigation.hasDefinition(name, asked(state, at)),
                  marks: (text: string) => navigation.markers(props.path, text),
                  folds: (text: string) => navigation.folds(props.path, text),
                  onMark: (mark: Mark) => void navigation.goToMarked(mark),
                  problems: (text: string) =>
                    askProblems(props.path, () => navigation.problems(props.path, text)),
                  onShowProblems: () => {
                    layout.toolWindows.show('problems');
                  },
                }
              : {})}
            fontSize={() => settings.get('editor.fontSize') as number}
            softWrap={() => settings.get('editor.softWrap') as boolean}
            tabSize={() => settings.get('editor.tabSize') as number}
            keys={() => editorKeys(services.keymap)}
          />
        );
      }}
    </div>
  );
}

/**
 * A changed file's diff, read through the host: as last committed against as it is, or at two
 * commits (an agent's turn's snapshots).
 */
function Diff(props: { path: string; env: string; range: Range | undefined }) {
  const settings = settingsFor(props.env);
  const host = hostFor(props.env);
  if (!host) return <p class="playground-code__note">Diffs show in the desktop app.</p>;
  const loaded = signal<{ original: string; text: string } | { error: string } | undefined>(
    undefined,
  );
  host.request('git.diff', { path: props.env, file: props.path, ...props.range }).then(
    (result) => {
      loaded.set(result as { original: string; text: string });
    },
    (error: unknown) => {
      loaded.set({ error: (error as Error).message });
    },
  );
  return (
    <div class="playground-code">
      {() => {
        const state = loaded.get();
        if (!state) return <p class="playground-code__note">Loading…</p>;
        if ('error' in state) {
          return (
            <p class="playground-code__note">
              Can’t show the changes to {props.path}: {state.error}
            </p>
          );
        }
        return (
          <DiffEditor
            path={props.path}
            original={state.original}
            text={state.text}
            fontSize={() => settings.get('editor.fontSize') as number}
            tabSize={() => settings.get('editor.tabSize') as number}
          />
        );
      }}
    </div>
  );
}

/** Pretend contents for a sample file: code-like lines, long enough to show soft wrapping. */
function sampleText(path: string): string {
  return Array.from({ length: 60 }, (_, i) =>
    i === 0
      ? `// ${path}`
      : `${i % 5 === 0 ? '\t' : ''}const value${String(i)} = compute(${String(i)}, '${path}', 'a long argument that shows soft wrapping');`,
  ).join('\n');
}

function NoEnvironment() {
  return (
    <div class="playground-editor">
      <h1>No environment open</h1>
      <p>Open a worktree with the + after the environment tabs, or from the toolbar.</p>
    </div>
  );
}

function Empty() {
  return (
    <div class="playground-editor">
      <h1>No files open</h1>
      <p>
        Open one from the Project tool window. Drag tabs to reorder them, move them to another
        group, or drop them near a group's edge to split it.
      </p>
    </div>
  );
}

render(
  () => (
    <ShellLayout
      layout={layout}
      content={(id) => <Content id={id} />}
      editor={() => (
        <EnvironmentEditors
          environments={workspace}
          editor={(env) => (
            <EditorAreaView
              area={env.editor}
              content={(tab) => {
                const diff = diffPath(tab.id);
                return diff === undefined ? (
                  <Code path={tab.id} env={env.id} />
                ) : (
                  <Diff path={diff} env={env.id} range={diffRange(tab.id)} />
                );
              }}
              icon={(tab) => icon(diffPath(tab.id) === undefined ? 'file' : 'diff')}
              hasErrors={(tab) => hasErrors(tab.id)}
              empty={() => <Empty />}
              onTabContextMenu={(event, group, tab) =>
                openContextMenu(services, 'editor/tab', event, { group: group.id, tab: tab.id })
              }
            />
          )}
          empty={() => <NoEnvironment />}
        />
      )}
      icon={icon}
      header={() => [
        <Header />,
        <EnvironmentTabs
          environments={workspace}
          badge={(env) => <AgentBadge worktree={env.id} />}
          label={(env) => () => {
            const file = env.editor.activeGroup.activeTab?.title;
            const name = envName(env.id, env.name);
            return file === undefined ? name : `${name} – ${file}`;
          }}
          onAdd={(button) => {
            openMenu(
              services,
              'toolbar/environments',
              { anchor: button, placement: 'below' },
              { owner: button },
            );
          }}
          onContextMenu={(event, env) => openContextMenu(services, 'env/tab', event, env)}
        />,
      ]}
      footer={() => (
        <StatusBarView
          bar={status}
          commands={services.commands}
          icon={icon}
          shortcut={shortcutOf}
        />
      )}
      tabs={(id) =>
        id === 'terminal' ? <TerminalTabs /> : id === 'commit' ? <CommitTabs /> : null
      }
      actions={(id) =>
        id === 'project'
          ? [
              <ToolbarButton
                commands={services.commands}
                command="project.selectOpenedFile"
                icon={icon('locate')}
              />,
              <button
                type="button"
                class="cerebro-toolbar-button"
                aria-label="Options"
                data-menu="project/options"
                ref={tooltip({ text: () => 'Options', placement: 'below' })}
                on:click={(event) => {
                  const anchor = event.currentTarget as HTMLElement;
                  openMenu(
                    services,
                    'project/options',
                    { anchor, placement: 'below' },
                    { owner: anchor },
                  );
                }}
              >
                {icon('more')}
              </button>,
            ]
          : null
      }
      shortcut={(id) => shortcutOf(`view.tool.${id}`)}
    />
  ),
  document.getElementById('app') as HTMLElement,
);
