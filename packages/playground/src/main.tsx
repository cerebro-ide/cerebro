import { onCleanup, render, type Child } from '@cerebro-ide/jsx';
import { PluginRegistry, ViewRegistry } from '@cerebro-ide/plugin-api';
import type { Keymap } from '@cerebro-ide/commands';
import { notesPlugin } from './notes-plugin.js';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import {
  EditorAreaView,
  EnvironmentEditors,
  EnvironmentTabs,
  ShellLayout,
} from '@cerebro-ide/ui-layout';
import {
  MenuBar,
  openContextMenu,
  syncNativeMenu,
  type NativeMenuBridge,
} from '@cerebro-ide/ui-menu';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '@cerebro-ide/ui-popup/styles.css';
import '@cerebro-ide/ui-settings/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import { StatusBar, StatusBarView, type Progress } from '@cerebro-ide/ui-statusbar';
import '@cerebro-ide/ui-statusbar/styles.css';
import '@cerebro-ide/ui-tree/styles.css';
import '@cerebro-ide/ui-editor/styles.css';
import { CodeEditor } from '@cerebro-ide/ui-editor';
import { ProjectTree } from './project.js';
import { reveals, setupNavigation } from './navigation.js';
import { MainToolbar, ToolbarButton, ToolbarDropdown } from '@cerebro-ide/ui-toolbar';
import '@cerebro-ide/ui-toolbar/styles.css';
import {
  active,
  currentHost,
  existingWorktree,
  firstWorktree,
  seedFiles,
  setupEnvironments,
  useWorktrees,
  workspace,
  type HostWorktree,
} from './environments.js';
import { openMenu } from '@cerebro-ide/ui-menu';
import { effect, signal } from '@cerebro-ide/reactive';
import { restoreLayout, saveLayout } from './persist.js';
import { globalSettings, settingsFor } from './settings.js';
import { formatSequence } from '@cerebro-ide/commands';
import { dark, menuVisible, setDark, setupCommands, type TabContext } from './commands.js';
import '@cerebro-ide/ui-layout/styles.css';
import { icon } from './icons.js';
import './playground.css';

/** Set by the desktop app's preload script. */
declare global {
  interface Window {
    cerebro?: {
      app: boolean;
      platform: string;
      menu: NativeMenuBridge;
      display: { setScale(choice: string): void };
      host: { request(method: string, params?: unknown): Promise<unknown> };
    };
  }
}

// In the desktop app the toolbar is the title bar: tag the page so its CSS leaves room for the
// window controls.
if (window.cerebro?.app) {
  document.documentElement.classList.add(
    'cerebro-app',
    `cerebro-platform-${window.cerebro.platform}`,
  );
}

// In the desktop app, the host lists the repository's real worktrees; without it (in a browser, or
// if it fails), the samples stay.
if (window.cerebro?.host) {
  try {
    useWorktrees(
      (await window.cerebro.host.request('git.worktrees')) as HostWorktree[],
      window.cerebro.host,
    );
  } catch (error) {
    console.error('The host could not list worktrees', error);
  }
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
  { id: 'notifications', title: 'Notifications', anchor: 'right', icon: 'bell' },
  { id: 'database', title: 'Database', anchor: 'right', icon: 'database' },
  { id: 'services', title: 'Services', anchor: 'bottom', slot: 'secondary', icon: 'services' },
];
for (const spec of windows) layout.toolWindows.register(spec);
layout.toolWindows.show('project');
layout.toolWindows.show('terminal');

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

const services = setupCommands(editor, layout.toolWindows, FILES, tabOf);

// Plugins: the sample Notes plugin, added as any plugin would be.
const views = new ViewRegistry(layout.toolWindows);
const plugins = new PluginRegistry({
  commands: services.commands,
  menus: services.menus,
  keymap: services.keymap as Keymap,
  views,
});
await plugins.add(notesPlugin);

// Navigation by name, through the host's index.
const navigation = setupNavigation(editor);
services.commands.register({
  id: 'symbol.goTo',
  label: 'Go to S&ymbol',
  dialog: true,
  enabled: navigation.available,
  run: () => navigation.goToSymbol(),
});
services.keymap?.bindDefault('Mod+Alt+Shift+N', 'symbol.goTo');
services.menus.contribute({ menu: 'main/file', item: { command: 'symbol.goTo' }, group: 'a' });
const environments = setupEnvironments(services.commands, services.menus, (env) => {
  seedFiles(env, tabOf);
});
// The layout as it was left, else the defaults: one environment open.
const persisted = {
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
const indexing = signal<Progress>(0);
const timer = setInterval(() => {
  const value = indexing.get();
  if (typeof value === 'number' && value < 1) indexing.set(Math.min(1, value + 0.025));
  else {
    indexing.set(undefined);
    clearInterval(timer);
  }
}, 200);
const fileTypes: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript JSX',
  css: 'CSS',
  md: 'Markdown',
  json: 'JSON',
};
const activePath = () => editor()?.activeGroup.active;
status.add({
  id: 'env',
  side: 'left',
  icon: 'git',
  text: () => {
    const env = active();
    return env ? `${env.name} · ${env.branch}` : 'No environment';
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
  text: () => (indexing.get() === undefined ? 'Indexed' : 'Indexing…'),
  tooltip: () => 'A background task (sample)',
  progress: () => indexing.get(),
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
          popup={environments.pickWorktree}
          label="Environment"
          badge={() => active()?.name ?? ''}
          text={() => active()?.name ?? 'No environment'}
        />,
        <ToolbarDropdown
          services={services}
          popup={environments.pickBranch}
          label="Branch"
          icon={icon('git')}
          text={() => active()?.branch ?? '—'}
        />,
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

function toggleTheme() {
  setDark(!dark.get());
}

function Files() {
  return (
    <div class="playground-files">
      <button type="button" class="playground-button" on:click={toggleTheme}>
        Toggle dark / light
      </button>
      <ProjectTree samples={FILES} open={(tab) => editor()?.open(tab)} />
    </div>
  );
}

/** A tool window's content for the active environment: switching environments switches it. */
function Content(props: { id: string }) {
  if (props.id === 'project') return <Files />;
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
  document.documentElement.dataset['cerebroTheme'] = dark.get() ? 'dark' : 'light';
  return undefined;
});

/** A file's contents in the editor, as the environment's settings say. */
function Code(props: { path: string; env: string }) {
  const settings = settingsFor(props.env);
  const editor = (text: string) => (
    <CodeEditor
      path={props.path}
      text={text}
      reveal={() => reveals.get(props.path)}
      {...(navigation.available()
        ? {
            onGoToDefinition: (name: string) => void navigation.goToDefinition(name),
            onFindUsages: (name: string) => void navigation.findUsages(name),
          }
        : {})}
      fontSize={() => settings.get('editor.fontSize') as number}
      softWrap={() => settings.get('editor.softWrap') as boolean}
      tabSize={() => settings.get('editor.tabSize') as number}
    />
  );
  const host = currentHost();
  // A file from the repository, read through the host; else the sample text.
  const content: Child = host
    ? (() => {
        const loaded = signal<{ text: string } | { error: string } | undefined>(undefined);
        host.request('fs.read', { path: props.path }).then(
          (result) => {
            loaded.set(result as { text: string });
          },
          (error: unknown) => {
            loaded.set({ error: (error as Error).message });
          },
        );
        return () => {
          const state = loaded.get();
          if (!state) return <p class="playground-code__note">Loading…</p>;
          if ('error' in state) {
            return (
              <p class="playground-code__note">
                Can’t open {props.path}: {state.error}
              </p>
            );
          }
          return editor(state.text);
        };
      })()
    : editor(sampleText(props.path));
  return (
    <div
      class="playground-code"
      on:contextmenu={(event) => openContextMenu(services, 'editor/content', event)}
    >
      {content}
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
              content={(tab) => <Code path={tab.id} env={env.id} />}
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
          label={(env) => () => {
            const file = env.editor.activeGroup.activeTab?.title;
            return file === undefined ? env.name : `${env.name} – ${file}`;
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
