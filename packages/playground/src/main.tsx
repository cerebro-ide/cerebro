import { render } from '@cerebro-ide/jsx';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
import '@cerebro-ide/theme/themes.css';
import { EditorAreaView, ShellLayout } from '@cerebro-ide/ui-layout';
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

function toggleTheme() {
  const root = document.documentElement;
  root.dataset['cerebroTheme'] = root.dataset['cerebroTheme'] === 'light' ? 'dark' : 'light';
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
    <pre class="playground-code">
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
        />
      )}
      icon={icon}
    />
  ),
  document.getElementById('app') as HTMLElement,
);
