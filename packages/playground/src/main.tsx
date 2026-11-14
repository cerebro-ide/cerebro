import { render } from '@cerebro-ide/jsx';
import { PluginRegistry, ViewRegistry } from '@cerebro-ide/plugin-api';
import { notesPlugin } from './notes-plugin.js';
import { prettierPlugin } from './prettier-plugin.js';
import { addPlugins } from './plugins-page.js';
import { target } from './edit.js';
import { PluginView } from './plugin-view.js';
import {
  type ChangePlaces,
  Layout,
  type NavigationHistory,
  type Tab,
  type ToolWindow,
  type ToolWindowSpec,
} from '@cerebro-ide/layout';
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
import { MenuBar, openContextMenu, syncNativeMenu, visibleEntries } from '@cerebro-ide/ui-menu';
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
import { NotificationBalloons, NotificationsTimeline } from '@cerebro-ide/ui-notifications';
import '@cerebro-ide/ui-notifications/styles.css';
import { notifications } from './notifications.js';
import '@cerebro-ide/ui-tree/styles.css';
import '@cerebro-ide/ui-editor/styles.css';
import {
  CodeEditor,
  fileIn,
  formatIn,
  formatLineColumn,
  indentText,
  languageName,
  parseLineColumn,
  positionText,
  reindentIn,
  type AskFormat,
  type CompletionItem,
  type EditorDocument,
  type FileFormat,
  type Indent,
  type LineSeparator,
  type Mark,
  type Place,
} from '@cerebro-ide/ui-editor';
import { ProjectTree, selectInTree } from './project.js';
import { askProblems, hasErrors, ProblemsView, setupProblems } from './problems.js';
import { fileManagerLabel, setupSelectIn } from './select-in.js';
import { CommitTabs, CommitWindow, setupShelf, showCommitTab } from './shelf.js';
import { fetchingRemote, pushing, setupPush } from './push.js';
import { setupUpdate, updating } from './update.js';
import { fetching, pullingFrom, setupFetchPull } from './fetch-pull.js';
import { setupFontSize } from './font-size.js';
import { setupOptimizeImports } from './optimize-imports.js';
import { annotationFor, setupBlame } from './blame.js';
import { setupConflicts } from './conflicts.js';
import { setupMergeRebase } from './merge-rebase.js';
import { setupBranches } from './branches.js';
import { CompareBranches, compareRefs, setupCompare } from './compare-branches.js';
import { DiffWithWorkingTree, setupDiffWithWorkingTree } from './diff-with-working-tree.js';
import { setupTag } from './tag.js';
import { resetting, setupReset } from './reset.js';
import { setupCommitEditing } from './commit-editing.js';
import { setupApplyChanges } from './apply-changes.js';
import { setupRemotes } from './remotes.js';
import { watchState } from './repository-state.js';
import { setupHistory } from './history.js';
import { setupEditorGitMenu } from './editor-git-menu.js';
import { currentBranch } from './git-fields.js';
import { GitLogView, setupLog, showHistory, showInLog } from './git-log.js';
import { setupSwitcher } from './switcher.js';
import {
  AgentChangesView,
  diffPath,
  tabPath,
  diffRange,
  diffTab,
  revisionOf,
  setupChanges,
  type Range,
} from './changes.js';
import { RepositoryVersion } from './repository-version.js';
import { setupCredentials } from './credentials.js';
import { AgentBadge, agentText, setupAgents } from './agents.js';
import {
  carets,
  focusing,
  changePlaces,
  history,
  recentTabs,
  reveals,
  selections,
  setupNavigation,
  tops,
  type Asked,
} from './navigation.js';
import { progress, setupIndexing } from './indexing.js';
import { MainToolbar, ToolbarButton, ToolbarDropdown } from '@cerebro-ide/ui-toolbar';
import '@cerebro-ide/ui-toolbar/styles.css';
import '@cerebro-ide/ui-image/styles.css';
import {
  diffsInTabs,
  FileDiff,
  setupDiffViewer,
  sideTitles,
  type DiffSides,
} from './diff-viewer.js';
import { ImageTab, isImage, setupImages } from './images.js';
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
import { computed, effect, ObservableMap, signal, untracked } from '@cerebro-ide/reactive';
import { restoreLayout, saveLayout } from './persist.js';
import { applyTheme } from './theme.js';
import {
  documentFor,
  documentRead,
  onBeforeSave,
  saveAll,
  saveFiles,
  setupSaving,
} from './documents.js';
import { resolveConflict } from './conflict.js';
import { findInFiles } from './find.js';
import { FindView, showOccurrences, type Occurrences } from './find-window.js';
import {
  bookmarkMarks,
  BookmarksView,
  bookmarkWith,
  MNEMONICS,
  moveBookmarks,
  nextBookmark,
  rewriteAsked,
  showBookmarks,
  toggleBookmark,
  toggleMnemonic,
  type LineBookmark,
} from './bookmarks.js';
import { HierarchyView, showHierarchy } from './call-hierarchy.js';
import {
  closeProject,
  openProject,
  projectAdded,
  projectRemoved,
  setActiveProject,
  setupProjects,
  windowProjects,
} from './projects.js';
import type { DiffSpec, RecentProject } from './bridge.js';
import {
  globalSettings,
  registry as settingsRegistry,
  save as saveSettings,
  settingsFor,
} from './settings.js';
import { chordFromEvent, formatSequence, type CommandSpec } from '@cerebro-ide/commands';
import type { Settings } from '@cerebro-ide/settings';
import { dark, menuVisible, setupCommands, type TabContext } from './commands.js';
import '@cerebro-ide/ui-layout/styles.css';
import { icon } from './icons.js';
import {
  isMarkdown,
  isMarkdownTab,
  MarkdownEditor,
  markdownActions,
  setupMarkdown,
} from './markdown.js';
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
// Notifications, as IntelliJ's: the stripe button shows a dot while some weren't seen, and they're
// seen once the window was shown and hides again.
const notificationsWindow = layout.toolWindows.windows.get('notifications') as ToolWindow;
effect(() => {
  notificationsWindow.icon = notifications.unread.get().length > 0 ? 'bellNew' : 'bell';
  return undefined;
});
let notificationsShown = false;
effect(() => {
  const shown = layout.toolWindows.isVisible('notifications');
  if (notificationsShown && !shown) {
    untracked(() => {
      notifications.markAllRead();
    });
  }
  notificationsShown = shown;
  return undefined;
});
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

/**
 * Opens a tab in the active environment; in the desktop app a diff opens in a window of its own,
 * as IntelliJ's (Ido: "new window instead of as a tab"), unless chosen to open as a tab.
 */
function openTab(tab: Tab, chain?: readonly string[], line?: number): void {
  const path = diffPath(tab.id);
  const env = active()?.id;
  if (path === undefined || !window.cerebro || env === undefined || diffsInTabs()) {
    // Taken as the tab's diff or file is made: Show Diff runs from the file's tab, so the diff's
    // isn't the one showing, and is made as it's opened, or activated if it's open already.
    if (line !== undefined) tabLines.set(tab.id, line);
    editor()?.open(tab);
    return;
  }
  const range = diffRange(tab.id);
  const project = shownProject().path;
  void window.cerebro.diff.open({
    project,
    env,
    path,
    ...(range ? { range } : {}),
    ...(range && range.to === undefined ? { branch: currentBranch(env) } : {}),
    ...(chain && chain.length > 1 ? { chain: [...chain] } : {}),
    ...(line === undefined ? {} : { line }),
  });
}

/**
 * An editor's context menu: the gutter's, for its tab's file, where that has items; else the text's,
 * where the editor has one.
 */
function editorMenu(event: MouseEvent, file: string, content: string | undefined): void {
  // An annotation's own menu opened.
  if (event.defaultPrevented) return;
  const inGutter = event
    .composedPath()
    .some((e) => e instanceof Element && e.classList.contains('cm-gutters'));
  if (!inGutter && content !== undefined) openContextMenu(services, content, event);
  else if (inGutter && visibleEntries(services, 'editor/gutter', { file }).length > 0) {
    openContextMenu(services, 'editor/gutter', event, { file });
  } else event.preventDefault();
}

/**
 * The line a tab opened at a line starts at, until it's made: a diff's (Show Diff's), or a
 * repository version's (Annotate Revision's).
 */
const tabLines = new Map<string, number>();

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
setupLog(services, () => {
  layout.toolWindows.show('git');
});
setupImages(services);
setupMarkdown(services.commands, () => editor()?.activeGroup.active);
// In the app, Show Diff in Separate Window from a diff tab: every diff tab closes, and opens in a
// window, as IntelliJ's `reopenDiffEditorsForFiles` moves every diff open; the one it was chosen
// in last, so its window is the one in front.
setupDiffViewer(
  services,
  undefined,
  window.cerebro && {
    to: 'window',
    // A tab's diff, not Local History's.
    moves: (button) => button instanceof Element && !!button.closest('.cerebro-editor-group'),
    move: (button) => {
      const group = (button as Element).closest<HTMLElement>(
        '.cerebro-editor-group',
      ) as HTMLElement;
      const id = group.dataset['group'] as string;
      const area = editor() as NonNullable<ReturnType<typeof editor>>;
      const chosen = area.group(id).activeTab as Tab;
      const others = area.groups.flatMap((g) =>
        g.tabs
          .filter((tab) => tab !== chosen && diffPath(tab.id) !== undefined)
          .map((tab) => ({ group: g.id, tab })),
      );
      for (const { group: from, tab } of [...others, { group: id, tab: chosen }]) {
        area.close(from, tab.id);
        openTab(tab);
      }
    },
  },
);
setupChanges(services, {
  open: openTab,
  activeTab: () => editor()?.activeGroup.active,
  show: () => {
    showCommitTab();
    layout.toolWindows.show('commit');
  },
  openAt: navigation.openAt,
  showHistory,
});
setupShelf(services, {
  open: openTab,
  show: () => {
    layout.toolWindows.show('commit');
  },
});
setupPush(services);
setupUpdate(services);
setupFetchPull(services);
setupFontSize(services.commands);
setupOptimizeImports(services.commands, async (path) =>
  navigation.organizeImports({
    path,
    // Shown in the editor, so read.
    text: ((await documentFor(path)) as EditorDocument).text.peek().toString(),
  }),
);
setupConflicts(services);
setupMergeRebase(services);
setupTag(services);
setupReset(services);
setupCommitEditing(services);
setupApplyChanges(services);
setupRemotes(services);
watchState();
setupHistory(services, { activeTab: () => editor()?.activeGroup.active });
setupEditorGitMenu(services.menus, () => {
  const env = active();
  return env !== undefined && hostFor(env.id) !== undefined && gitRepository.get();
});
setupBlame(services, {
  activeTab: () => editor()?.activeGroup.active,
  open: (tab, line) => {
    openTab(tab, undefined, line);
  },
  showInLog: (hash, path) => {
    layout.toolWindows.show('git');
    showInLog(hash, path);
  },
});
/** Opens a file at a place with its editor focused: from a list, as IntelliJ's Jump to Source. */
const jumpTo = (at: { path: string; line: number; column: number }) => {
  navigation.openAt(at);
  focusing.set(at.path, {});
};
setupProblems(services, { openAt: jumpTo });
// Show Diff in Editor Tab from a diff window: its diff as a tab of its worktree, if still open.
window.cerebro?.diff.onTab((spec) => {
  const { env, path, range } = spec as DiffSpec;
  if (!workspace.open.some((e) => e.id === env)) return;
  workspace.activate(env);
  editor()?.open(diffTab(path, range));
});
// A diff window's file as it is: this window's document, as IntelliJ's one document per file. Its
// text is told to the diff windows as it changes (null if it can't be read), and edited from them.
const told = new Set<string>();
window.cerebro?.diff.onDocumentAsked((path, text) => {
  const file = path as string;
  void documentFor(file).then((doc) => {
    const app = window.cerebro as NonNullable<Window['cerebro']>;
    if ('error' in doc) {
      void app.diff.documentText(file, null);
      return;
    }
    if (typeof text === 'string') doc.replace(text);
    // Asked again (another diff window): told as it is.
    else if (told.has(file)) void app.diff.documentText(file, doc.text.peek().toString());
    if (told.has(file)) return;
    told.add(file);
    effect(() => {
      void app.diff.documentText(file, doc.text.get().toString());
      return undefined;
    });
  });
});
// Jump to Source from a diff window: the file, if it's still there, where its caret was.
window.cerebro?.diff.onJump((at) => {
  const { env, path, line, column } = at as {
    env: string;
    path: string;
    line: number;
    column: number;
  };
  const file = `${env}/${path}`;
  void hostFor(env)
    ?.request('fs.exists', { path: file })
    .then((exists) => {
      if (exists) jumpTo({ path: file, line, column });
    });
});

// Terminals let the app's shortcuts through, except plain Ctrl+key, which programs use (Ctrl+C).
setTerminalKeys((event) => {
  const keymap = services.keymap;
  const chord = chordFromEvent(event);
  if (chord === undefined) return false;
  const bare = event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
  if (bare && keymap.platform !== 'mac') return false;
  return keymap.commandsFor(chord).length > 0 || keymap.isPrefix(chord);
});

/** The file of the editor that has the focus, or had it before a menu took it: IntelliJ's EDITOR. */
function focusedFile(): string | undefined {
  const at = target();
  return at && fileIn(at);
}
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
    focused: focusedFile,
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
// Last and Next Edit Location, as IntelliJ's: back through the places of the latest changes, from
// where the caret is, and on again.
services.commands.register({
  id: 'navigate.lastEdit',
  label: 'Last Edit L&ocation',
  enabled: () => changePlaces()?.canGoBack ?? false,
  // Run only while enabled: there's an environment.
  run: () => {
    (changePlaces() as ChangePlaces).goBack((history() as NavigationHistory).current());
  },
});
services.commands.register({
  id: 'navigate.nextEdit',
  label: 'Next Edit Location',
  enabled: () => changePlaces()?.canGoForward ?? false,
  run: () => {
    (changePlaces() as ChangePlaces).goForward((history() as NavigationHistory).current());
  },
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
for (const command of ['navigate.lastEdit', 'navigate.nextEdit']) {
  services.menus.contribute({ menu: 'main/navigate', item: { command }, group: 'a' });
}
// Recent Files, as IntelliJ's: the files shown, the latest first, the one before the current
// highlighted, so Enter goes back to it. "Show edited only" lists the files edited instead; Recent
// Files' own key flips it while the popup is open, and Recently Changed Files opens with it on.
async function recentFiles(editedOnly: boolean): Promise<void> {
  const root = active()?.id;
  const recent = recentTabs();
  const edited = signal(editedOnly);
  const itemsOf = (tabs: readonly Tab[]) =>
    tabs
      .filter((tab) => tabPath(tab.id) === tab.id)
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
/** The active tab's file, if it's one (not a diff or a comparison). */
const activeFile = () => {
  const tab = editor()?.activeGroup.activeTab;
  return tab && tabPath(tab.id) === tab.id ? tab : undefined;
};
// It needs an editor with the focus, or its find bar, as IntelliJ's GotoLineAction
// (EDITOR_EVEN_IF_INACTIVE): elsewhere, as in the Log, its key is free for others (Cmd+L there is
// Focus Text Filter). The status bar's position runs it on the active editor's file, given as its
// context, focused or not, as IntelliJ's PositionPanel.
const lineFile = (context: unknown) => (typeof context === 'string' ? context : focusedFile());
services.commands.register({
  id: 'navigate.goToLine',
  label: '&Line/Column',
  dialog: true,
  enabled: (context) => lineFile(context) !== undefined,
  run: async (context) => {
    const file = lineFile(context) as string;
    // An editor says where its caret is as it opens.
    const current = carets.get(file) as { line: number; column: number };
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
    reveals.set(file, at);
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
/** Where a file's caret is: at its start until its editor says (a file just opened). */
const caretOf = (path: string) => carets.get(path) ?? { line: 0, column: 0 };
/** The active file at its caret, as it's asked about; none unread. */
async function atCaret(): Promise<Asked | undefined> {
  const file = activeFile() as Tab;
  // Where it is when asked: a file just opened says where its caret is while it's read.
  const caret = caretOf(file.id);
  const doc = await documentFor(file.id);
  if ('error' in doc) return undefined;
  return { path: file.id, text: doc.text.peek().toString(), ...caret };
}
services.commands.register({
  id: 'navigate.fileStructure',
  label: 'File &Structure',
  dialog: true,
  enabled: () => navigation.available() && activeFile() !== undefined,
  run: async () => {
    const asked = await atCaret();
    if (asked) await navigation.fileStructure(asked.path, asked.text, asked);
  },
});
services.keymap.bindDefault('Mod+F12', 'navigate.fileStructure');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.fileStructure' },
  group: 'b',
});
// Call Hierarchy, as IntelliJ's: the Hierarchy tool window, which appears the first time, on the
// right (a claim: where IntelliJ's opens), shows what calls the function or method at the caret.
services.commands.register({
  id: 'navigate.callHierarchy',
  label: 'Call Hierarch&y',
  enabled: () => navigation.available() && activeFile() !== undefined,
  run: async () => {
    const asked = await atCaret();
    const hierarchy = asked && (await navigation.callHierarchy(asked));
    if (!hierarchy) return;
    if (!layout.toolWindows.windows.has('hierarchy')) {
      layout.toolWindows.register({
        id: 'hierarchy',
        title: 'Hierarchy',
        anchor: 'right',
        icon: 'hierarchy',
      });
    }
    showHierarchy(hierarchy);
    layout.toolWindows.show('hierarchy');
  },
});
services.keymap.bindDefault('Ctrl+Alt+H', 'navigate.callHierarchy');
services.menus.contribute({
  menu: 'main/navigate',
  item: { command: 'navigate.callHierarchy' },
  group: 'b',
});
// Toggle Bookmark, as IntelliJ's (F11): a bookmark on the caret's line, or none there.
services.commands.register({
  id: 'bookmarks.toggle',
  label: 'Toggle &Bookmark',
  enabled: () => active() !== undefined && activeFile() !== undefined,
  run: () => {
    const file = activeFile() as Tab;
    toggleBookmark(active()?.id as string, file.id, caretOf(file.id).line);
  },
});
services.keymap.bindDefault('F11', 'bookmarks.toggle');
// In IntelliJ's Edit menu, after Macros (`EditBookmarksGroup`), which Cerebro hasn't: after Find.
services.menus.contribute({
  menu: 'main/edit',
  item: { submenu: 'main/edit/bookmarks', label: 'Book&marks' },
  group: 'g',
});
services.menus.contribute({
  menu: 'main/edit/bookmarks',
  item: { command: 'bookmarks.toggle' },
  group: 'a',
});
// Next and Previous Line Bookmark, as IntelliJ's: through all the worktree's, from the caret's line.
// IntelliJ's own keymap gives them no keys.
for (const forward of [false, true]) {
  const next = () => {
    const env = active();
    const file = activeFile();
    return (
      env && nextBookmark(env.id, file && { path: file.id, line: caretOf(file.id).line }, forward)
    );
  };
  services.commands.register({
    id: forward ? 'bookmarks.next' : 'bookmarks.previous',
    label: forward ? 'Next Line Bookmark' : 'Previous Line Bookmark',
    enabled: () => next() !== undefined,
    run: () => {
      navigation.openAt({ ...(next() as LineBookmark), column: 0 });
    },
  });
  services.menus.contribute({
    menu: 'main/edit/bookmarks',
    item: { command: forward ? 'bookmarks.next' : 'bookmarks.previous' },
    group: 'b',
  });
}
// Show Bookmarks, as IntelliJ's: a popup of the worktree's bookmarks.
services.commands.register({
  id: 'bookmarks.show',
  label: 'Show Bookmarks',
  dialog: true,
  enabled: () => active() !== undefined,
  run: () => showBookmarks(active() as { id: string; name: string }, navigation.openAt),
});
services.keymap.bindDefault('Shift+F11', 'bookmarks.show');
services.menus.contribute({
  menu: 'main/edit/bookmarks',
  item: { command: 'bookmarks.show' },
  group: 'c',
});
// Mnemonic bookmarks, as IntelliJ's Toggle Bookmark and Go to Bookmark 0 to 9 and A to Z: the
// digits' on Ctrl+Shift and Ctrl, the letters' with no keys.
for (const mnemonic of MNEMONICS) {
  services.commands.register({
    id: `bookmarks.toggle.${mnemonic}`,
    label: `Toggle Bookmark ${mnemonic}`,
    enabled: () => active() !== undefined && activeFile() !== undefined,
    run: () => {
      const file = activeFile() as Tab;
      const at = { path: file.id, line: caretOf(file.id).line };
      return toggleMnemonic(active()?.id as string, at, mnemonic, rewriteAsked);
    },
  });
  services.commands.register({
    id: `bookmarks.goTo.${mnemonic}`,
    label: `Go to Bookmark ${mnemonic}`,
    enabled: () => {
      const env = active();
      return env !== undefined && bookmarkWith(env.id, mnemonic) !== undefined;
    },
    run: () => {
      const bookmark = bookmarkWith(active()?.id as string, mnemonic) as LineBookmark;
      navigation.openAt({ ...bookmark, column: 0 });
    },
  });
  if (mnemonic <= '9') {
    services.keymap.bindDefault(`Ctrl+Shift+${mnemonic}`, `bookmarks.toggle.${mnemonic}`);
    services.keymap.bindDefault(`Ctrl+${mnemonic}`, `bookmarks.goTo.${mnemonic}`);
  }
}
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
const branches = setupBranches(services, { ...environments, openTab });
setupCompare(services, (tab) => editor()?.open(tab));
// Show Diff with Working Tree's Changes tool window, on the left, which appears the first time, as
// IntelliJ's `ChangesBrowserToolWindow`.
setupDiffWithWorkingTree(services, () => {
  if (!layout.toolWindows.windows.has('vcsChanges')) {
    layout.toolWindows.register({
      id: 'vcsChanges',
      title: 'Changes',
      anchor: 'left',
      icon: 'diff',
    });
  }
  layout.toolWindows.show('vcsChanges');
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
  setupCredentials(app);
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
  return id === undefined ? undefined : tabPath(id);
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
// A push under way, as IntelliJ's background task "Pushing…".
status.add({
  id: 'push',
  side: 'left',
  order: 2,
  text: () => 'Pushing…',
  tooltip: () => 'Pushing the branch',
  hidden: () => !pushing.get(),
  progress: () => 'indeterminate',
});
// An update under way, as IntelliJ's "Updating…".
status.add({
  id: 'update',
  side: 'left',
  order: 2,
  text: () => 'Updating…',
  tooltip: () => 'Updating the project',
  hidden: () => !updating.get(),
  progress: () => 'indeterminate',
});
// Git → Fetch under way, as IntelliJ's "Fetching…".
status.add({
  id: 'fetch',
  side: 'left',
  order: 2,
  text: () => 'Fetching…',
  tooltip: () => 'Fetching every remote',
  hidden: () => !fetching.get(),
  progress: () => 'indeterminate',
});
// Git → Reset HEAD… under way, as IntelliJ's "Resetting HEAD…"; the Log's, "Git Reset".
status.add({
  id: 'reset',
  side: 'left',
  order: 2,
  text: () => resetting.get() ?? '',
  tooltip: () => 'Resetting the branch',
  hidden: () => resetting.get() === undefined,
  progress: () => 'indeterminate',
});
// A pull under way, as IntelliJ's "Pulling changes from origin".
status.add({
  id: 'pull',
  side: 'left',
  order: 2,
  text: () => `Pulling changes from ${pullingFrom.get() ?? ''}`,
  tooltip: () => 'Pulling the branch',
  hidden: () => pullingFrom.get() === undefined,
  progress: () => 'indeterminate',
});
// The Push dialog's Fetch, as IntelliJ's "Fetching Remote Commits…".
status.add({
  id: 'push-fetch',
  side: 'left',
  order: 2,
  text: () => 'Fetching Remote Commits…',
  tooltip: () => 'Fetching the remote’s commits, to count what a push replaces',
  hidden: () => !fetchingRemote.get(),
  progress: () => 'indeterminate',
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
// The active editor's file, as IntelliJ's widgets for it: shown for a text editor's file once it's
// read (PositionPanel, LineSeparatorPanel, EncodingPanel, the indent's CodeStyleStatusBarWidget),
// not for a diff's or an image's. Files are read as UTF-8, and indented as their editor says.
/** The active tab's file, when it's shown as text. */
const activeText = () => {
  const tab = activeFile();
  return tab && !isImage(tab.id) ? tab.id : undefined;
};
const activeDocument = () => {
  const path = activeText();
  return path === undefined ? undefined : documentRead(path);
};
/** The indent each open file's editor uses, by path, and whether it's the file's own. */
const indents = new ObservableMap<string, { indent: Indent; detected: boolean }>();
status.add({
  id: 'position',
  order: 1,
  text: () => {
    const path = activeText();
    const at = path === undefined ? undefined : carets.get(path);
    return at ? positionText(at, selections.get(path as string)) : '';
  },
  tooltip: () => 'Go to Line',
  command: 'navigate.goToLine',
  context: activeText,
  // Until its editor says where its caret is, as it opens.
  hidden: () => {
    const path = activeText();
    return path === undefined || carets.get(path) === undefined;
  },
});
status.add({
  id: 'separator',
  order: 2,
  // Read while it's hidden too, before a file is; its tooltip only while it's shown.
  text: () => SEPARATORS[activeDocument()?.lineSeparator ?? '\n'].name,
  tooltip: () =>
    `Line Separator: ${SEPARATORS[(activeDocument() as EditorDocument).lineSeparator].escaped}`,
  menu: 'status/separator',
  context: activeText,
  hidden: () => activeDocument() === undefined,
});
status.add({
  id: 'encoding',
  order: 3,
  text: () => 'UTF-8',
  tooltip: () => 'File Encoding: UTF-8',
  menu: 'status/encoding',
  context: activeText,
  hidden: () => activeDocument() === undefined,
});
status.add({
  id: 'indent',
  order: 4,
  text: () => {
    const used = indents.get(activeText() as string);
    return used ? indentText(used.indent) : '';
  },
  // Asked while it's shown. IntelliJ's hint, Detected, is grey beside it.
  tooltip: () => {
    const used = indents.get(activeText() as string) as { indent: Indent; detected: boolean };
    return `Indent: ${indentText(used.indent)}${used.detected ? ' (detected)' : ''}`;
  },
  menu: 'status/indent',
  context: activeText,
  hidden: () => activeDocument() === undefined || indents.get(activeText() as string) === undefined,
});
status.add({
  id: 'type',
  order: 5,
  text: () => languageName(activePath() ?? ''),
  tooltip: () => 'File Type',
});

// The status bar's menus, as IntelliJ's widgets' popups, for the active editor's file, given as
// their context. The line separator and the byte order mark change as IntelliJ's
// (AbstractConvertLineSeparatorsAction, RemoveBomAction): the file is saved with them at once.
/** IntelliJ's names for line separators, and how its tooltip writes them. */
const SEPARATORS: Record<LineSeparator, { name: string; label: string; escaped: string }> = {
  '\r\n': { name: 'CRLF', label: 'CRLF - Windows (\\r\\n)', escaped: '\\r\\n' },
  '\n': { name: 'LF', label: 'LF - Unix and macOS (\\n)', escaped: '\\n' },
  '\r': { name: 'CR', label: 'CR - Classic Mac OS (\\r)', escaped: '\\r' },
};
/** The file a status bar menu acts on: its context, when that's a file that's been read. */
const formatted = (context: unknown) =>
  typeof context === 'string' ? documentRead(context) : undefined;
/** Writes the file `context` names, as `format` says. */
const reformat = (context: unknown, format: Partial<FileFormat>) => {
  const doc = formatted(context) as EditorDocument;
  doc.format.set({ ...doc.format.peek(), ...format });
  saveFiles([context as string]).catch(reportSaving);
};
services.menus.contribute({ menu: 'status/separator', item: { heading: 'Line Separator' } });
for (const [separator, { name, label }] of Object.entries(SEPARATORS)) {
  services.commands.register({
    id: `file.lineSeparator.${name}`,
    label,
    enabled: (context) => {
      const doc = formatted(context);
      return doc !== undefined && doc.lineSeparator !== separator;
    },
    run: (context) => {
      reformat(context, { lineSeparator: separator as LineSeparator });
    },
  });
  services.menus.contribute({
    menu: 'status/separator',
    item: { command: `file.lineSeparator.${name}` },
  });
}
services.menus.contribute({ menu: 'status/encoding', item: { heading: 'File Encoding' } });
for (const [id, label, bom] of [
  ['file.removeBom', 'Remove BOM', false],
  ['file.addBom', 'Add BOM', true],
] as const) {
  services.commands.register({
    id,
    label,
    // Shown where it applies, as IntelliJ's.
    enabled: (context) => formatted(context) !== undefined,
    visible: (context) => formatted(context)?.bom !== bom,
    run: (context) => {
      reformat(context, { bom });
    },
  });
  services.menus.contribute({ menu: 'status/encoding', item: { command: id } });
}

// The indent's menu, as IntelliJ's IndentStatusBarUIContributor's: while a file's own indent is
// used, new lines can be indented as the settings say instead, for that file until the window is
// reloaded, or the file reindented that way; while it's not, its own is offered again. Detection
// is turned off or on for every file, and Configure Indents opens Code Style in Settings.
/** Files whose own indent was turned down, by path, with that indent. */
const declined = new ObservableMap<string, Indent>();
/** The settings of the file at `path`: its worktree's. */
const fileSettings = (path: string) => settingsFor(worktreeHolding(path));
/** The indent `settings` say. */
const settingsIndent = (settings: Settings): Indent => ({
  tabs: settings.get('editor.useTabCharacter') as boolean,
  size: settings.get('editor.indent') as number,
});
/** An indent in a menu item, as IntelliJ's: `4 Spaces`, `Tab`. */
const indentTitle = (indent: Indent) =>
  indentText(indent).replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
/** The indent the file `context` names uses, when its editor has said. */
const usedIndent = (context: unknown) =>
  typeof context === 'string' ? indents.get(context) : undefined;
/** Whether the file `context` names has an indent of its own, used or turned down. */
const hasOwnIndent = (context: unknown) =>
  usedIndent(context)?.detected === true || declined.has(context as string);
/** The editing area of the editor showing `path`, when one does. */
const editorShowing = (path: string) =>
  [...document.querySelectorAll('.cerebro-editor-code')]
    .map((host) => (host.shadowRoot as ShadowRoot).querySelector('.cm-content') as Element)
    .find((content) => fileIn(content) === path);
services.menus.contribute({
  menu: 'status/indent',
  group: 'a',
  order: -1,
  item: {
    heading: (context) =>
      hasOwnIndent(context) ? 'Indents Detection' : `${languageName(context as string)} Code Style`,
  },
});
/** An item on the indent's menu, shown once the file's editor has said how it indents. */
const indentItem = (command: CommandSpec, group: string) => {
  services.commands.register({
    ...command,
    enabled: (context) => usedIndent(context) !== undefined,
  });
  services.menus.contribute({ menu: 'status/indent', item: { command: command.id }, group });
};
indentItem(
  {
    id: 'codeStyle.indentNewLines',
    label: 'Indent New Lines with Settings',
    text: (context) =>
      `Indent New Lines with ${indentTitle(settingsIndent(fileSettings(context as string)))}`,
    visible: (context) => usedIndent(context)?.detected === true,
    run: (context) => {
      const path = context as string;
      declined.set(path, (indents.get(path) as { indent: Indent }).indent);
    },
  },
  'a',
);
indentItem(
  {
    id: 'codeStyle.reindentFile',
    label: 'Reindent File with Settings',
    text: (context) =>
      `Reindent File with ${indentTitle(settingsIndent(fileSettings(context as string)))}`,
    visible: (context) => usedIndent(context)?.detected === true,
    run: (context) => {
      const path = context as string;
      // Its editor indents as the settings say while it's reindented, then looks again.
      declined.set(path, (indents.get(path) as { indent: Indent }).indent);
      // The active editor's file: it's showing.
      reindentIn(editorShowing(path) as Element, 'Reindent File');
      declined.delete(path);
    },
  },
  'a',
);
indentItem(
  {
    id: 'codeStyle.indentDetected',
    label: 'Indent New Lines as Detected',
    text: (context) =>
      `Indent New Lines with ${indentTitle(declined.get(context as string) as Indent)} (detected)`,
    visible: (context) => declined.has(context as string),
    run: (context) => {
      declined.delete(context as string);
    },
  },
  'a',
);
// Below a line, as IntelliJ's.
indentItem(
  {
    id: 'codeStyle.configureIndents',
    label: 'Configure Indents…',
    text: (context) => `Configure Indents for ${languageName(context as string)}…`,
    run: () => services.commands.execute('file.settings', { page: 'editor/codeStyle' }),
  },
  'b',
);
indentItem(
  {
    id: 'codeStyle.detectIndents',
    label: 'Indents Detection',
    text: (context) =>
      `${detecting(fileSettings(context as string)) ? 'Disable' : 'Enable'} Indents Detection`,
    // Turned off only while it's done something, as IntelliJ's.
    visible: (context) => !detecting(fileSettings(context as string)) || hasOwnIndent(context),
    run: (context) => {
      const settings = fileSettings(context as string);
      const scope = settings.scopeOf('editor.detectIndent') ?? 'global';
      settings.layers[scope].set('editor.detectIndent', !detecting(settings));
      saveSettings(settings, [scope]);
    },
  },
  'b',
);
/** Whether files' own indents are used, as `settings` say. */
function detecting(settings: Settings): boolean {
  return settings.get('editor.detectIndent') as boolean;
}

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
              // The samples' branches are pretend.
              popup={currentHost() ? branches.pick : environments.pickBranch}
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
  if (props.id === 'commit') return <CommitWindow services={services} open={openTab} />;
  if (props.id === 'agentChanges') return <AgentChangesView services={services} open={openTab} />;
  if (props.id === 'git') return <GitLogView services={services} open={openTab} />;
  if (props.id === 'terminal') return <TerminalPane kind="shell" />;
  if (props.id === 'find') return <FindView open={navigation.openAt} />;
  if (props.id === 'hierarchy') return <HierarchyView open={navigation.openAt} />;
  if (props.id === 'bookmarks') {
    return <BookmarksView open={navigation.open} openAt={navigation.openAt} />;
  }
  if (props.id === 'vcsChanges') return <DiffWithWorkingTree services={services} open={openTab} />;
  if (props.id === 'claude') return <TerminalPane kind="claude" />;
  if (props.id === 'notifications') return <NotificationsTimeline notifications={notifications} />;
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
  const indent = () => settingsIndent(settings);
  const loaded = signal<EditorDocument | { error: string } | undefined>(undefined);
  /** The editor's top line, which a Markdown file's preview follows. */
  const topLine = signal(0);
  void documentFor(props.path, () => sampleText(props.path)).then((result) => {
    loaded.set(result);
    if (!('error' in result) && navigation.available()) {
      navigation.opened(props.path, result.text.peek().toString());
    }
  });
  return (
    <div
      class="playground-code"
      on:contextmenu={(event) => {
        editorMenu(event, props.path, 'editor/content');
      }}
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
        const code = (
          <CodeEditor
            path={props.path}
            document={state}
            reveal={() => reveals.get(props.path)}
            focus={() => focusing.get(props.path)}
            onCaret={(at, selected) => {
              carets.set(props.path, at);
              if (selected) selections.set(props.path, selected);
              else selections.delete(props.path);
            }}
            onScroll={(top) => {
              tops.set(props.path, top);
              topLine.set(top);
            }}
            annotate={() => annotationFor(props.path)}
            bookmarks={() => bookmarkMarks(props.env, props.path)}
            onBookmarksMoved={(lines) => {
              moveBookmarks(props.env, props.path, lines);
            }}
            {...(navigation.available()
              ? {
                  onGoToDefinition: (name: string, at: { line: number; column: number }) =>
                    void navigation.goToDefinition(name, asked(state, at)),
                  onGoToImplementation: (name: string, at: { line: number; column: number }) =>
                    void navigation.goToImplementation(name, asked(state, at)),
                  onGoToTypeDeclaration: (name: string, at: { line: number; column: number }) =>
                    void navigation.goToTypeDeclaration(name, asked(state, at)),
                  onGoToSuperMethod: (at: { line: number; column: number }) =>
                    void navigation.goToSuperMethod(asked(state, at)),
                  onMethod: (at: { line: number; column: number }, down: boolean) =>
                    void navigation.goToMethod(asked(state, at), down),
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
                  quickDefinition: (at: { line: number; column: number }) =>
                    navigation.quickDefinition(asked(state, at)),
                  parameterInfo: (at: { line: number; column: number }) =>
                    navigation.signatures(asked(state, at)),
                  renaming: (at: { line: number; column: number }) =>
                    navigation.renaming(asked(state, at)),
                  onRename: (at: { line: number; column: number }, name: string) =>
                    navigation.rename(asked(state, at), name),
                  // The whole file as the settings say, a part as the file's indent, as IntelliJ's
                  // (DetectableIndentOptionsProvider.useOnFullReformat); its editor says which as
                  // it opens.
                  format: (range?: Parameters<AskFormat>[0]) =>
                    navigation.format(
                      { path: props.path, text: state.text.peek().toString() },
                      range ? (indents.get(props.path) as { indent: Indent }).indent : indent(),
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
            indent={indent}
            detectIndent={() => detecting(settings) && !declined.has(props.path)}
            onIndent={(used, detected) => indents.set(props.path, { indent: used, detected })}
            keys={() => editorKeys(services.keymap)}
          />
        );
        return isMarkdown(props.path) ? (
          <MarkdownEditor
            path={props.path}
            editor={code}
            text={() => state.text.get().toString()}
            line={() => topLine.get()}
            open={navigation.open}
          />
        ) : (
          code
        );
      }}
    </div>
  );
}

/**
 * A changed file's diff, read through the host: as last committed against as it is, or at two
 * commits (an agent's turn's snapshots). As it is, its right side is the file's document, as
 * IntelliJ's: its edits, unsaved too, and edited there.
 */
function Diff(props: {
  path: string;
  env: string;
  range: Range | undefined;
  /** The line of the file as it is the caret starts at, if not the first change. */
  line: number | undefined;
}) {
  const settings = settingsFor(props.env);
  const host = hostFor(props.env);
  if (!host) return <p class="playground-code__note">Diffs show in the desktop app.</p>;
  const file = `${props.env}/${props.path}`;
  // The file as it is, but for a diff between two commits.
  const document =
    props.range?.to !== undefined
      ? undefined
      : {
          text: () => documentRead(file)?.text.get().toString(),
          edit: (text: string) => {
            documentRead(file)?.replace(text);
          },
        };
  return (
    <FileDiff
      services={services}
      path={props.path}
      read={async () => {
        const diff = host.request('git.diff', {
          path: props.env,
          file: props.path,
          ...props.range,
        });
        // The document read first, if it can be.
        if (document) await documentFor(file);
        return (await diff) as DiffSides;
      }}
      titles={sideTitles(props.range, currentBranch(props.env))}
      {...(props.line === undefined ? {} : { scrollTo: { line: props.line } })}
      {...(document ? { document } : {})}
      fontSize={() => settings.get('editor.fontSize') as number}
      tabSize={() => settings.get('editor.tabSize') as number}
    />
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
                const compared = compareRefs(tab.id);
                if (compared) {
                  return (
                    <CompareBranches
                      worktree={env.id}
                      {...compared}
                      services={services}
                      open={openTab}
                    />
                  );
                }
                const diff = diffPath(tab.id);
                if (diff !== undefined) {
                  const line = tabLines.get(tab.id);
                  tabLines.delete(tab.id);
                  return <Diff path={diff} env={env.id} range={diffRange(tab.id)} line={line} />;
                }
                const version = revisionOf(tab.id);
                if (version) {
                  const settings = settingsFor(env.id);
                  const line = tabLines.get(tab.id);
                  tabLines.delete(tab.id);
                  return (
                    <RepositoryVersion
                      host={hostFor(env.id)}
                      worktree={env.id}
                      {...version}
                      line={line}
                      annotate={() => annotationFor(tab.id)}
                      onContextMenu={(event) => {
                        editorMenu(event, tab.id, undefined);
                      }}
                      fontSize={() => settings.get('editor.fontSize') as number}
                      tabSize={() => settings.get('editor.tabSize') as number}
                    />
                  );
                }
                return isImage(tab.id) ? (
                  <ImageTab path={tab.id} services={services} />
                ) : (
                  <Code path={tab.id} env={env.id} />
                );
              }}
              icon={(tab) =>
                icon(
                  diffPath(tab.id) !== undefined || compareRefs(tab.id)
                    ? 'diff'
                    : isImage(tab.id)
                      ? 'image'
                      : 'file',
                )
              }
              hasErrors={(tab) => hasErrors(tab.id)}
              tabActions={(tab, group) =>
                isMarkdownTab(tab.id)
                  ? markdownActions(services.commands, { group: group.id, tab: tab.id })
                  : null
              }
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
          openMenu={(menu, anchor, context) => {
            openMenu(services, menu, { anchor, placement: 'below' }, { context });
          }}
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
// Balloons show over the window, in its bottom right corner.
render(() => <NotificationBalloons notifications={notifications} />, document.body);
