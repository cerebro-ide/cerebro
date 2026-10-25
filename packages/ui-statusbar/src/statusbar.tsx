// The status bar: items contributed by the app and plugins, on the left or the right, ordered. An
// item shows text (and optionally an icon or a progress bar), has a tooltip, and can run a command
// when clicked. What goes on it is the contributors' business; the bar only lays items out.

import type { CommandRegistry } from '@cerebro-ide/commands';
import type { Child } from '@cerebro-ide/jsx';
import { makeObservable, ObservableArray, type Disposable } from '@cerebro-ide/reactive';
import { tooltip } from '@cerebro-ide/ui-tooltip';

/** A progress value from 0 to 1, or indeterminate; undefined for no progress bar. */
export type Progress = number | 'indeterminate' | undefined;

export interface StatusItemSpec {
  id: string;
  /** Default: right, where IntelliJ keeps most of its widgets. */
  side?: 'left' | 'right';
  /** Position on its side; lower comes first. Default: 0, then contribution order. */
  order?: number;
  text: () => string;
  tooltip?: () => string;
  /** Run when the item is clicked; the item is a button only with one. */
  command?: string;
  /** An icon name; how it's drawn is up to the bar's `icon` prop. */
  icon?: string;
  progress?: () => Progress;
}

export class StatusBar {
  readonly items = new ObservableArray<StatusItemSpec>();

  constructor() {
    makeObservable(this);
  }

  add(spec: StatusItemSpec): Disposable {
    if (this.items.toArray().some((item) => item.id === spec.id)) {
      throw new Error(`Status item "${spec.id}" is already added`);
    }
    this.items.push(spec);
    return {
      dispose: () => {
        const index = this.items.toArray().indexOf(spec);
        if (index >= 0) this.items.splice(index, 1);
      },
    };
  }

  /** One side's items, in order. */
  side(side: 'left' | 'right'): StatusItemSpec[] {
    return this.items
      .toArray()
      .map((item, position) => ({ item, position }))
      .filter(({ item }) => (item.side ?? 'right') === side)
      .sort((a, b) => (a.item.order ?? 0) - (b.item.order ?? 0) || a.position - b.position)
      .map(({ item }) => item);
  }
}

export interface StatusBarViewProps {
  bar: StatusBar;
  /** Runs items' commands; without it, items are not clickable. */
  commands?: CommandRegistry;
  /** The shortcut for a command, shown in its item's tooltip. */
  shortcut?: (command: string) => string | undefined;
  /** Draws an item's icon. */
  icon?: (name: string) => Child;
}

export function StatusBarView(props: StatusBarViewProps): Node {
  return (
    <div class="cerebro-statusbar" role="toolbar" aria-label="Status bar">
      <div class="cerebro-statusbar__side cerebro-statusbar__side--left">
        {() => props.bar.side('left').map((item) => <Item props={props} item={item} />)}
      </div>
      <div class="cerebro-statusbar__side cerebro-statusbar__side--right">
        {() => props.bar.side('right').map((item) => <Item props={props} item={item} />)}
      </div>
    </div>
  );
}

function Item(p: { props: StatusBarViewProps; item: StatusItemSpec }): Node {
  const { props, item } = p;
  const commands = props.commands;
  const command = item.command;
  const clickable = commands !== undefined && command !== undefined;
  const content = [
    item.icon !== undefined && props.icon ? (
      <span class="cerebro-statusbar__icon">{props.icon(item.icon)}</span>
    ) : null,
    <span class="cerebro-statusbar__text">{item.text}</span>,
    item.progress ? <ProgressBar progress={item.progress} /> : null,
  ];
  const tip = tooltip({
    text: () => item.tooltip?.() ?? '',
    shortcut: () => (command === undefined ? undefined : props.shortcut?.(command)),
    placement: 'above',
  });
  return clickable ? (
    <button
      type="button"
      class="cerebro-statusbar__item cerebro-statusbar__item--action"
      data-id={item.id}
      ref={tip}
      on:click={() => {
        commands.execute(command);
      }}
    >
      {content}
    </button>
  ) : (
    <span class="cerebro-statusbar__item" data-id={item.id} ref={tip}>
      {content}
    </span>
  );
}

function ProgressBar(props: { progress: () => Progress }): Node {
  return (
    <span
      class={() =>
        props.progress() === 'indeterminate'
          ? 'cerebro-statusbar__progress cerebro-statusbar__progress--indeterminate'
          : 'cerebro-statusbar__progress'
      }
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={() => {
        const value = props.progress();
        return typeof value === 'number' ? String(Math.round(value * 100)) : undefined;
      }}
      hidden={() => props.progress() === undefined}
    >
      <span
        class="cerebro-statusbar__progress-fill"
        style={{
          width: () => {
            const value = props.progress();
            return typeof value === 'number'
              ? `${String(Math.min(1, Math.max(0, value)) * 100)}%`
              : '';
          },
        }}
      />
    </span>
  );
}
