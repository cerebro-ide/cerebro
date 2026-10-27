// The Welcome window, as IntelliJ's: shown when no project is open. It opens a folder with the
// system's dialog, or one of the recent projects, which a search field filters; Up, Down and Enter
// work from the field. A project that's gone can only be removed from the list.

import '@cerebro-ide/theme/fonts.css';
import '@cerebro-ide/theme/themes.css';
import '@cerebro-ide/theme/base.css';
import '@cerebro-ide/ui-dialog/styles.css';
import '@cerebro-ide/ui-tooltip/styles.css';
import { installScrollbars } from '@cerebro-ide/ui-scrollbar';
import '@cerebro-ide/ui-scrollbar/styles.css';
import './bridge.js';
import { render } from '@cerebro-ide/jsx';
import { computed, effect, signal } from '@cerebro-ide/reactive';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { badgeColour, initials } from '@cerebro-ide/ui-toolbar';
import type { RecentProject } from './bridge.js';
import { openFolder, openProject } from './projects.js';
import { globalSettings } from './settings.js';
import { applyTheme } from './theme.js';
import './playground.css';

const bridge = (window.cerebro as NonNullable<Window['cerebro']>).project;

document.documentElement.classList.add(
  'cerebro-app',
  `cerebro-platform-${window.cerebro?.platform ?? ''}`,
);
document.title = 'Welcome to Cerebro';
effect(() => {
  applyTheme(globalSettings.get('appearance.theme') !== 'light');
  return undefined;
});
installScrollbars();

const recent = signal<RecentProject[]>(await bridge.recent());
const query = signal('');
/** The highlighted project, among those shown. */
const highlight = signal(0);

const shown = computed(() => {
  const text = query.get().toLowerCase();
  return recent
    .get()
    .filter((r) => r.name.toLowerCase().includes(text) || r.path.toLowerCase().includes(text));
});

function open(project: RecentProject | undefined): void {
  if (project?.exists) void openProject(project.path);
}

async function forget(project: RecentProject): Promise<void> {
  await bridge.forget(project.path);
  recent.set(recent.peek().filter((r) => r.path !== project.path));
}

function onKey(event: KeyboardEvent): void {
  const count = shown.peek().length;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (count === 0) return;
    const step = event.key === 'ArrowDown' ? 1 : -1;
    highlight.set((highlight.peek() + step + count) % count);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    open(shown.peek()[highlight.peek()]);
  }
}

function Project(props: { project: RecentProject; index: number }): Node {
  const { project, index } = props;
  return (
    <li
      class={() =>
        [
          'playground-welcome__project',
          highlight.get() === index && 'playground-welcome__project--highlighted',
          !project.exists && 'playground-welcome__project--missing',
        ]
          .filter(Boolean)
          .join(' ')
      }
      role="option"
      aria-selected={() => String(highlight.get() === index)}
      aria-disabled={String(!project.exists)}
      data-path={project.path}
      on:mouseenter={() => {
        highlight.set(index);
      }}
      on:click={() => {
        open(project);
      }}
    >
      <span
        class="playground-welcome__badge"
        style={{ background: badgeColour(project.name) }}
        aria-hidden="true"
      >
        {initials(project.name)}
      </span>
      <span class="playground-welcome__names">
        <span class="playground-welcome__name">{project.name}</span>
        <span class="playground-welcome__path">
          {project.exists ? project.path : `${project.path} (not found)`}
        </span>
      </span>
      <button
        type="button"
        class="playground-welcome__remove"
        aria-label="Remove from Recent Projects"
        ref={tooltip({ text: () => 'Remove from Recent Projects' })}
        on:click={(event) => {
          event.stopPropagation();
          void forget(project);
        }}
      >
        ×
      </button>
    </li>
  );
}

function Welcome(): Node {
  return (
    <div class="playground-welcome">
      <div class="playground-welcome__titlebar" />
      <div class="playground-welcome__body">
        <aside class="playground-welcome__side">
          <span class="playground-welcome__logo">Cerebro</span>
        </aside>
        <main class="playground-welcome__main">
          <div class="playground-welcome__actions">
            <input
              type="search"
              class="playground-welcome__search"
              placeholder="Search projects"
              aria-label="Search projects"
              autofocus
              on:input={(event) => {
                query.set((event.currentTarget as HTMLInputElement).value);
                highlight.set(0);
              }}
              on:keydown={onKey}
            />
            <button
              type="button"
              class="cerebro-dialog__button cerebro-dialog__button--primary"
              on:click={() => void openFolder()}
            >
              Open
            </button>
          </div>
          {() =>
            recent.get().length === 0 ? (
              <p class="playground-welcome__empty">
                No recent projects. Open a folder to start working in it.
              </p>
            ) : (
              <ul class="playground-welcome__projects" role="listbox" aria-label="Recent projects">
                {() =>
                  shown.get().map((project, index) => <Project project={project} index={index} />)
                }
              </ul>
            )
          }
        </main>
      </div>
    </div>
  );
}

render(() => <Welcome />, document.getElementById('app') as HTMLElement);
