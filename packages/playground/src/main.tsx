import { render } from '@cerebro-ide/jsx';
import { Layout, type ToolWindowSpec } from '@cerebro-ide/layout';
import '@cerebro-ide/theme/themes.css';
import { ShellLayout } from '@cerebro-ide/ui-layout';
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

function toggleTheme() {
  const root = document.documentElement;
  root.dataset['cerebroTheme'] = root.dataset['cerebroTheme'] === 'light' ? 'dark' : 'light';
}

function Content(props: { id: string }) {
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

function Editor() {
  return (
    <div class="playground-editor">
      <h1>Editor area</h1>
      <p>
        Click a stripe button to open or close its tool window. Drag a button to another group or
        position; Escape cancels. Drag the lines between panels to resize.
      </p>
      <button type="button" class="playground-button" on:click={toggleTheme}>
        Toggle dark / light
      </button>
    </div>
  );
}

render(
  () => (
    <ShellLayout
      layout={layout}
      content={(id) => <Content id={id} />}
      editor={() => <Editor />}
      icon={icon}
    />
  ),
  document.getElementById('app') as HTMLElement,
);
