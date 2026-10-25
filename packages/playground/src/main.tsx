import { render } from '@cerebro-ide/jsx';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import { EditorAreaView, ShellLayout } from '@cerebro-ide/ui-layout';
import { MenuBar, openContextMenu } from '@cerebro-ide/ui-menu';
import '@cerebro-ide/ui-menu/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import { StatusBar, StatusBarView, type Progress } from '@cerebro-ide/ui-statusbar';
import '@cerebro-ide/ui-statusbar/styles.css';
import { signal } from '@cerebro-ide/reactive';
import { formatSequence } from '@cerebro-ide/commands';
import { dark, menuVisible, setDark, setupCommands, type TabContext } from './commands.js';
import '@cerebro-ide/ui-layout/styles.css';
import { icon } from './icons.js';
import './playground.css';

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

const editor = layout.editor;
for (const path of ['README.md', 'src/main.ts', 'src/shell.tsx', 'src/styles.css']) {
  editor.open(tabOf(path));
}
editor.moveToSplit('src/styles.css', editor.activeGroupId, editor.activeGroupId, 'right');

const services = setupCommands(editor, layout.toolWindows, FILES, tabOf);

/** What tab commands from the main menu act on: the active tab. */
function activeTab(): TabContext | undefined {
  const group = editor.activeGroup;
  return group.active === undefined ? undefined : { group: group.id, tab: group.active };
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
const activePath = () => editor.activeGroup.active;
status.add({
  id: 'env',
  side: 'left',
  icon: 'git',
  text: () => 'cerebro · feat/status-bar',
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

function Header() {
  return (
    <div class="playground-header">
      <MenuBar services={services} visible={() => menuVisible.get()} context={activeTab} />
      <span class="playground-title">Cerebro playground</span>
    </div>
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
      <ul class="playground-list">
        {FILES.map((path) => (
          <li
            class="playground-file"
            on:click={() => {
              editor.open(tabOf(path));
            }}
          >
            {path}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Content(props: { id: string }) {
  if (props.id === 'project') return <Files />;
  const title = layout.toolWindows.windows.get(props.id)?.title ?? props.id;
  return (
    <ul class="playground-list">
      {Array.from({ length: 12 }, (_, i) => (
        <li>
          {title} item {i + 1}
        </li>
      ))}
    </ul>
  );
}

/** Pretend file contents: numbered lines of code-like text. */
function Code(props: { path: string }) {
  const lines = Array.from({ length: 60 }, (_, i) =>
    i === 0
      ? `// ${props.path}`
      : `const value${String(i)} = compute(${String(i)}, '${props.path}');`,
  );
  return (
    <pre
      class="playground-code cerebro-selectable"
      on:contextmenu={(event) => openContextMenu(services, 'editor/content', event)}
    >
      {lines.map((line, i) => (
        <div>
          <span class="playground-line">{i + 1}</span>
          {line}
        </div>
      ))}
    </pre>
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
        <EditorAreaView
          area={editor}
          content={(tab) => <Code path={tab.id} />}
          empty={() => <Empty />}
          onTabContextMenu={(event, group, tab) =>
            openContextMenu(services, 'editor/tab', event, { group: group.id, tab: tab.id })
          }
        />
      )}
      icon={icon}
      header={() => <Header />}
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
