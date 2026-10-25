// Environment tabs, the outer of the two tab layers: one tab per open environment (a worktree with
// its session), under the main toolbar. And the editor area of each open environment, kept alive
// while it's hidden so switching back finds it as it was.

import { render, onCleanup, type Child } from '@cerebro-ide/jsx';
import type { Environment, Environments } from '@cerebro-ide/layout';
import { effect, makeObservable } from '@cerebro-ide/reactive';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { dragFrom } from './drag.js';

export interface EnvironmentTabsProps {
  environments: Environments;
  /** Leads each tab: the environment's badge, for example. */
  badge?: (env: Environment) => Child;
  /** The + button: open another environment, typically from a menu anchored to the button. */
  onAdd?: (button: HTMLElement) => void;
  onContextMenu?: (event: MouseEvent, env: Environment) => void;
}

class TabDrag {
  id: string | undefined = undefined;
  /** Where the dragged tab would land, among the others. */
  index: number | undefined = undefined;

  constructor() {
    makeObservable(this);
  }
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function EnvironmentTabs(props: EnvironmentTabsProps): Node {
  const { environments } = props;
  const drag = new TabDrag();
  let strip: HTMLElement | undefined;
  let suppressClick = false;

  /** The index among the other tabs where a drop at `x` would land. */
  const indexAt = (x: number) => {
    let index = 0;
    for (const tab of (strip as HTMLElement).querySelectorAll(
      '.cerebro-env-tab:not(.cerebro-env-tab--dragged)',
    )) {
      const rect = tab.getBoundingClientRect();
      if (x > rect.left + rect.width / 2) index++;
    }
    return index;
  };

  const Tab = (p: { env: Environment }) => {
    const { env } = p;
    const others = () => environments.open.filter((e) => e.id !== drag.id);
    const dropBefore = () =>
      drag.index !== undefined && drag.id !== env.id && others().indexOf(env) === drag.index;
    return (
      <div
        class={() =>
          cls(
            'cerebro-env-tab',
            environments.activeId === env.id && 'cerebro-env-tab--active',
            drag.id === env.id && 'cerebro-env-tab--dragged',
            dropBefore() && 'cerebro-env-tab--drop-before',
          )
        }
        role="tab"
        tabIndex={0}
        aria-selected={() => String(environments.activeId === env.id)}
        data-env={env.id}
        ref={tooltip({ text: () => `${env.name} · ${env.branch}`, placement: 'below' })}
        on:click={() => {
          if (!suppressClick) environments.activate(env.id);
        }}
        on:keydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            environments.activate(env.id);
          }
        }}
        on:auxclick={(event) => {
          if (event.button === 1) environments.close(env.id);
        }}
        on:contextmenu={(event) => {
          props.onContextMenu?.(event, env);
        }}
        on:pointerdown={(down) => {
          if (down.button !== 0) return;
          dragFrom(down, env.name, {
            start() {
              drag.id = env.id;
            },
            move(event) {
              drag.index = indexAt(event.clientX);
            },
            end(committed) {
              const index = drag.index;
              drag.id = undefined;
              drag.index = undefined;
              if (committed && index !== undefined) environments.move(env.id, index);
              suppressClick = true;
              setTimeout(() => {
                suppressClick = false;
              });
            },
          });
        }}
      >
        {props.badge ? <span class="cerebro-env-tab__badge">{props.badge(env)}</span> : null}
        <span class="cerebro-env-tab__name">{() => env.name}</span>
        <span class="cerebro-env-tab__branch">{() => env.branch}</span>
        <button
          type="button"
          class="cerebro-env-tab__close"
          aria-label={() => `Close ${env.name}`}
          ref={tooltip({ text: () => 'Close' })}
          on:pointerdown={(event) => {
            event.stopPropagation();
          }}
          on:click={(event) => {
            event.stopPropagation();
            environments.close(env.id);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M4.5 4.5l7 7M11.5 4.5l-7 7"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div
      class={() => cls('cerebro-env-tabs', drag.id !== undefined && 'cerebro-env-tabs--dragging')}
      role="tablist"
      aria-label="Environments"
      ref={(element) => {
        strip = element;
      }}
    >
      {() => environments.open.map((env) => <Tab env={env} />)}
      <div
        class={() =>
          cls(
            'cerebro-env-tabs__end',
            drag.index !== undefined &&
              drag.index === environments.open.length - 1 &&
              'cerebro-env-tabs__end--drop',
          )
        }
      />
      {props.onAdd ? (
        <button
          type="button"
          class="cerebro-env-tabs__add"
          aria-label="Open Environment"
          ref={tooltip({ text: () => 'Open Environment' })}
          on:click={(event) => {
            props.onAdd?.(event.currentTarget as HTMLElement);
          }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M8 3.5v9M3.5 8h9"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export interface EnvironmentEditorsProps {
  environments: Environments;
  /** Renders an environment's editor area. */
  editor: (env: Environment) => Child;
  /** Shown when no environment is open. */
  empty?: () => Child;
}

/**
 * The active environment's editor area. Each open environment's is rendered once and kept while
 * hidden, so switching back finds its splits, tabs and content as they were; closing an
 * environment disposes its view.
 */
export function EnvironmentEditors(props: EnvironmentEditorsProps): Node {
  const { environments } = props;
  const views = new Map<string, { element: HTMLElement; dispose: () => void }>();
  const container = document.createElement('div');
  container.className = 'cerebro-env-editors';

  const sync = effect(() => {
    const open = environments.open;
    const activeId = environments.activeId;
    for (const env of open) {
      let view = views.get(env.id);
      if (!view) {
        const element = document.createElement('div');
        element.className = 'cerebro-env-editor';
        element.dataset['env'] = env.id;
        const handle = render(() => props.editor(env), element);
        view = {
          element,
          dispose: () => {
            handle.dispose();
            element.remove();
          },
        };
        views.set(env.id, view);
        container.append(element);
      }
      view.element.hidden = env.id !== activeId;
    }
    for (const [id, view] of views) {
      if (!open.some((e) => e.id === id)) {
        view.dispose();
        views.delete(id);
      }
    }
    return undefined;
  });
  onCleanup(() => {
    sync.dispose();
    for (const view of views.values()) view.dispose();
    views.clear();
  });

  return (
    <div class="cerebro-env-area">
      {container}
      {() =>
        environments.open.length === 0 ? (
          <div class="cerebro-env-empty">{props.empty?.()}</div>
        ) : null
      }
    </div>
  );
}
