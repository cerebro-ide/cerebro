// Tabs in a tool window's header, after its title, as IntelliJ's Terminal tool window shows its
// sessions ("Local", "Local (2)"): each with a close button, the active one filled; a + button
// after them opens another, and the chevron lists them when they don't all fit (overflow.tsx).

import { tooltip } from '@cerebro-ide/ui-tooltip';
import {
  MoreTabs,
  overflowClasses,
  TabOverflow,
  watchOverflow,
  type ListedTab,
} from './overflow.js';

export interface ToolTabsProps {
  tabs: () => ListedTab[];
  /** The + button: opens another tab. */
  add?: { label: string; run: () => void };
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

/** A tool window's tabs, for its header. */
export function ToolTabs(props: ToolTabsProps): Node {
  const overflow = new TabOverflow();
  return (
    <div class="cerebro-tool-tabs">
      <div
        class={() =>
          cls('cerebro-tool-tabs__strip', ...overflowClasses(overflow, 'cerebro-tool-tabs__strip'))
        }
        role="tablist"
        ref={watchOverflow(overflow)}
      >
        {() => props.tabs().map((tab) => <ToolTab tab={tab} />)}
      </div>
      {props.add ? <AddButton {...props.add} /> : null}
      <MoreTabs overflow={overflow} tabs={props.tabs} />
    </div>
  );
}

function ToolTab(props: { tab: ListedTab }): Node {
  const { tab } = props;
  return (
    <div
      class={cls('cerebro-tool-tab', tab.active && 'cerebro-tool-tab--active')}
      role="tab"
      aria-selected={String(tab.active)}
      tabIndex={-1}
      data-tab={tab.id}
      on:click={() => {
        tab.select();
      }}
      // The middle button closes, as an editor tab's.
      on:auxclick={(event: MouseEvent) => {
        if (event.button === 1) tab.close?.();
      }}
    >
      {tab.icon ? <span class="cerebro-tool-tab__icon">{tab.icon()}</span> : null}
      <span class="cerebro-tool-tab__title">{tab.title}</span>
      {tab.close ? (
        <button
          type="button"
          class="cerebro-tool-tab__close"
          tabIndex={-1}
          aria-label={`Close ${tab.title}`}
          ref={tooltip({ text: () => 'Close' })}
          on:click={(event: MouseEvent) => {
            event.stopPropagation();
            tab.close?.();
          }}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M4.5 4.5l7 7M11.5 4.5l-7 7"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

function AddButton(props: { label: string; run: () => void }): Node {
  return (
    <button
      type="button"
      class="cerebro-tool-tabs__add"
      aria-label={props.label}
      ref={tooltip({ text: () => props.label })}
      on:click={() => {
        props.run();
      }}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path
          d="M8 3.5v9M3.5 8h9"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
        />
      </svg>
    </button>
  );
}
