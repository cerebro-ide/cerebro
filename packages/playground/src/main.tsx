import { onCleanup, render } from '@cerebro-ide/jsx';
import { PluginRegistry, ViewRegistry } from '@cerebro-ide/plugin-api';
import type { Keymap } from '@cerebro-ide/commands';
import { notesPlugin } from './notes-plugin.js';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
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
import '@cerebro-ide/ui-tooltip/styles.css';
import { installScrollbars } from '@cerebro-ide/ui-scrollbar';
import '@cerebro-ide/ui-scrollbar/styles.css';
import { StatusBar, StatusBarView, type Progress } from '@cerebro-ide/ui-statusbar';
import '@cerebro-ide/ui-statusbar/styles.css';
import '@cerebro-ide/ui-tree/styles.css';
import '@cerebro-ide/ui-editor/styles.css';
import {
  CodeEditor,
  DiffEditor,
  formatLineColumn,
  parseLineColumn,
  type EditorDocument,
} from '@cerebro-ide/ui-editor';
import { ProjectTree, selectInTree } from './project.js';
import { ChangesView, diffPath, diffRange, setupChanges, type Range } from './changes.js';
import { AgentBadge, agentText, setupAgents } from './agents.js';
import { carets, history, recentTabs, reveals, setupNavigation, tops } from './navigation.js';
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
  type Host,
} from './environments.js';
import { openMenu } from '@cerebro-ide/ui-menu';
import { openDialog, prompt } from '@cerebro-ide/ui-dialog';
import { fuzzyFilter, openPicker } from '@cerebro-ide/ui-popup';
import { effect, signal } from '@cerebro-ide/reactive';
import { restoreLayout, saveLayout } from './persist.js';
import { applyTheme } from './theme.js';
import { documentFor, saveAll, saveFiles, setupSaving } from './documents.js';
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
import { globalSettings, settingsFor } from './settings.js';
import { chordFromEvent, formatSequence } from '@cerebro-ide/commands';
import { dark, menuVisible, setupCommands, type TabContext } from './commands.js';
import '@cerebro-ide/ui-layout/styles.css';
import { icon } from './icons.js';
import { editorKeys } from './keymaps.js';
import {
  agentTerminal,
  setLastShellClosed,
  setTerminalKeys,
  Shells,
  shellsFor,
} from './terminals.js';
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

/** The active environment's editor area, if an environment is open. */
const editor = () => active()?.editor;

// Navigation by name, through the host's index; Search Everywhere's commands open places with it.
const navigation = setupNavigation(editor);
const services = setupCommands(editor, layout.toolWindows, FILES, tabOf, {
  openAt: navigation.openAt,
  recent: () => recentTabs()?.tabs ?? [],
  available: navigation.available,
});
/**
 * Closes the active project: its tabs, then its host. The window's last closes the window, which
 * saves the files first.
 */
async function closeActiveProject(): Promise<void> {
  const project = activeProject();
  if (!project) return;
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
});

// Terminals let the app's shortcuts through, except plain Ctrl+key, which programs use (Ctrl+C).
setTerminalKeys((event) => {
  const keymap = services.keymap;
  const chord = chordFromEvent(event);
  if (!keymap || chord === undefined) return false;
  const bare = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  if (bare && keymap.platform !== 'mac') return false;
  return keymap.commandsFor(chord).length > 0 || keymap.isPrefix(chord);
});

// Plugins: the sample Notes plugin, added as any plugin would be.
const views = new ViewRegistry(layout.toolWindows);
const plugins = new PluginRegistry({
  commands: services.commands,
  menus: services.menus,
  keymap: services.keymap as Keymap,
  views,
});
await plugins.add(notesPlugin);

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
  label: 'Find in &Files…',
  dialog: true,
  enabled: navigation.available,
  run: () =>
    findInFiles({
      open: navigation.openAt,
      showOccurrences: inFindWindow,
      file: editor()?.activeGroup.active,
    }),
});
services.keymap?.bindDefault('Mod+Shift+F', 'find.inFiles');
services.menus.contribute({
  menu: 'main/edit',
  item: { submenu: 'main/edit/find', label: '&Find' },
  group: 'f',
});
services.menus.contribute({ menu: 'main/edit/find', item: { command: 'find.inFiles' } });
services.commands.register({
  id: 'replace.inFiles',
  label: '&Replace in Files…',
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
services.keymap?.bindDefault('Mod+Shift+R', 'replace.inFiles');
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
const mac = services.keymap?.platform === 'mac';
services.keymap?.bindDefault(mac ? 'Mod+[' : 'Ctrl+Alt+Left', 'navigate.back');
services.keymap?.bindDefault(mac ? 'Mod+]' : 'Ctrl+Alt+Right', 'navigate.forward');
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
// highlighted, so Enter goes back to it.
services.commands.register({
  id: 'view.recentFiles',
  label: 'Recent &Files',
  dialog: true,
  run: async () => {
    const root = active()?.id;
    const items = (recentTabs()?.tabs ?? [])
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
    const chosen = await openPicker({
      label: 'Recent Files',
      placeholder: 'Type a file name',
      position: 'top',
      empty: 'No recent files',
      initial: 1,
      items: (query) => fuzzyFilter(items, query),
    }).result;
    if (chosen) editor()?.open(chosen.tab);
  },
});
services.keymap?.bindDefault('Mod+E', 'view.recentFiles');
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
    const file = activeFile();
    if (!file) return;
    const current = carets.get(file.id) ?? { line: 0, column: 0 };
    const typed = await prompt({
      title: 'Go to Line:Column',
      label: '[Line] [:column]:',
      value: formatLineColumn(current),
      validate: (text) =>
        parseLineColumn(text, current) === undefined ? 'Not a line or column' : undefined,
    });
    const at = typed === undefined ? undefined : parseLineColumn(typed, current);
    if (!at) return;
    history()?.record();
    reveals.set(file.id, at);
  },
});
services.keymap?.bindDefault(mac ? 'Mod+L' : 'Ctrl+G', 'navigate.goToLine');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.goToLine' },
  group: 'b',
});
// Select Opened File, as IntelliJ's button in the Project tool window's header.
services.commands.register({
  id: 'project.selectOpenedFile',
  label: 'Select Opened File',
  icon: 'locate',
  enabled: () => activeFile() !== undefined,
  run: async () => {
    const file = activeFile();
    if (!file) return;
    layout.toolWindows.show('project');
    await selectInTree(file.id, FILES);
  },
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
services.keymap?.bindDefault('Mod+S', 'file.saveAll');
services.menus.contribute({ menu: 'main/file', item: { command: 'file.saveAll' }, group: 'b' });
(globalThis as { cerebroSaveAll?: () => Promise<void> }).cerebroSaveAll = () =>
  saveAll().catch((error: unknown) => {
    console.error(error);
  });
setupSaving(reportSaving, resolveConflict, (path) => {
  // In every environment's editor, every group.
  for (const env of workspace.open) {
    for (const group of env.editor.groups) {
      if (group.tabs.some((tab) => tab.id === path)) env.editor.close(group.id, path);
    }
  }
});
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
  const notifications = (listener: (method: string, params: unknown) => void) =>
    window.cerebro?.host.onNotification((_project, method, params) => {
      listener(method, params);
    }) ?? (() => undefined);
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
const fileTypes: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript JSX',
  css: 'CSS',
  md: 'Markdown',
  json: 'JSON',
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
  text: () => fileTypes[activePath()?.split('.').at(-1) ?? ''] ?? 'Plain Text',
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
  const project = activeProject();
  if (window.cerebro && project) document.title = project.name;
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
          services.commands.isEnabled('file.open')
            ? [{ label: 'Open…', run: () => services.commands.execute('file.open') }]
            : [],
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
  const key = services.keymap?.shortcutsFor(command)[0];
  return key === undefined ? undefined : formatSequence(key, services.keymap?.platform ?? 'other');
}

/** On macOS the desktop app shows the menu in the system menu bar, not in the window. */
const nativeMenu = window.cerebro?.platform === 'darwin' ? window.cerebro.menu : undefined;
if (nativeMenu) syncNativeMenu(services, nativeMenu, { context: activeTab });

function Header() {
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
          badge={() => activeProject()?.name ?? ''}
          text={() => activeProject()?.name ?? 'No project'}
        />,
        <ToolbarDropdown
          services={services}
          popup={environments.pickWorktree}
          label="Worktree"
          icon={icon('folder')}
          text={() => active()?.name ?? 'No worktree'}
        />,
        // A folder without git has no branches.
        gitRepository.get() ? (
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
      <ProjectTree samples={FILES} open={(tab) => editor()?.open(tab)} />
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
            title: Shells.title(number),
            active: shells.active === number,
            select: () => {
              shells.select(number);
              focus();
            },
            close: () => {
              shells.close(number);
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
    return <ChangesView services={services} open={(tab) => editor()?.open(tab)} />;
  if (props.id === 'terminal') return <TerminalPane kind="shell" />;
  if (props.id === 'find') return <FindView open={navigation.openAt} />;
  if (props.id === 'claude') return <TerminalPane kind="claude" />;
  // A plugin's view fills a container element, however it likes.
  const view = views.get(props.id);
  if (view) {
    const container = document.createElement('div');
    container.className = 'playground-view';
    const cleanup = view.mount(container);
    if (cleanup) onCleanup(cleanup);
    return container;
  }
  const title = layout.toolWindows.windows.get(props.id)?.title ?? props.id;
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
      on:focusout={(event) => {
        // The editor's file is saved when the focus leaves it, for the window or somewhere else in it.
        const to = event.relatedTarget;
        if (to instanceof Node && (event.currentTarget as HTMLElement).contains(to)) return;
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
            onCaret={(at) => carets.set(props.path, at)}
            onScroll={(top) => tops.set(props.path, top)}
            {...(navigation.available()
              ? {
                  onGoToDefinition: (name: string, at: { line: number; column: number }) =>
                    void navigation.goToDefinition(name, asked(state, at)),
                  onFindUsages: (name: string, at: { line: number; column: number }) =>
                    void navigation.findUsages(name, asked(state, at)),
                }
              : {})}
            fontSize={() => settings.get('editor.fontSize') as number}
            softWrap={() => settings.get('editor.softWrap') as boolean}
            tabSize={() => settings.get('editor.tabSize') as number}
            {...(services.keymap ? { keys: () => editorKeys(services.keymap as Keymap) } : {})}
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
          shortcut={(id) => {
            const key = services.keymap?.shortcutsFor(id)[0];
            return key === undefined
              ? undefined
              : formatSequence(key, services.keymap?.platform ?? 'other');
          }}
        />
      )}
      tabs={(id) => (id === 'terminal' ? <TerminalTabs /> : null)}
      actions={(id) =>
        id === 'project' ? (
          <ToolbarButton
            commands={services.commands}
            command="project.selectOpenedFile"
            icon={icon('locate')}
          />
        ) : null
      }
      shortcut={(id) => {
        const key = services.keymap?.shortcutsFor(`view.tool.${id}`)[0];
        return key === undefined
          ? undefined
          : formatSequence(key, services.keymap?.platform ?? 'other');
      }}
    />
  ),
  document.getElementById('app') as HTMLElement,
);
