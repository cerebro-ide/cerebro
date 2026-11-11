// A diff with its toolbar, as IntelliJ's diff viewer: Previous and Next Difference (Shift+F7 and
// F7), Collapse Unchanged Fragments, and the Settings gear with Synchronize Scrolling. The toggles
// are kept for every diff, as IntelliJ keeps its diff settings, and the diffs open take them at once.

import { formatSequence, type Keymap } from '@cerebro-ide/commands';
import { signal } from '@cerebro-ide/reactive';
import { DiffEditor, type DiffControl } from '@cerebro-ide/ui-editor';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { icon } from './icons.js';

/** The toggles, kept between sessions. */
const OPTIONS_KEY = 'cerebro.diff';

/**
 * Collapsed to start with, as IntelliJ's diffs from the Commit tool window, the Log and a file's
 * history, where Cerebro's open (its default elsewhere is expanded: a claim that one default fits
 * here, open to change); scrolling synchronized, as IntelliJ's default.
 */
function readOptions(): { collapse: boolean; syncScroll: boolean } {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Record<string, unknown>;
    return { collapse: stored.collapse !== false, syncScroll: stored.syncScroll !== false };
  } catch {
    return { collapse: true, syncScroll: true };
  }
}

/** The toggles, as kept: read as the commands are set up. */
const collapse = signal(true);
const syncScroll = signal(true);

function saveOptions(): void {
  try {
    localStorage.setItem(
      OPTIONS_KEY,
      JSON.stringify({ collapse: collapse.peek(), syncScroll: syncScroll.peek() }),
    );
  } catch {
    // Not kept: the next session starts as before.
  }
}

/** Each viewer's diff, by its element, for a key pressed in it. */
const diffs = new WeakMap<Element, DiffControl>();

/** The diff a command acts on: its toolbar's, or the one with the keyboard's. */
function diffOf(context: unknown): DiffControl | undefined {
  if (context && typeof context === 'object' && 'next' in context) return context as DiffControl;
  const viewer = document.activeElement?.closest('.playground-diff');
  return viewer ? diffs.get(viewer) : undefined;
}

/** The diff's commands and its Settings menu; their keys are the keymaps'. */
export function setupDiffViewer(services: MenuServices): void {
  const { commands, menus } = services;
  const options = readOptions();
  collapse.set(options.collapse);
  syncScroll.set(options.syncScroll);
  commands.register({
    id: 'diff.previousDifference',
    label: 'Previous Difference',
    icon: 'previousDiff',
    enabled: (context) => diffOf(context)?.hasPrevious() === true,
    run: (context) => {
      diffOf(context)?.previous();
    },
  });
  commands.register({
    id: 'diff.nextDifference',
    label: 'Next Difference',
    icon: 'nextDiff',
    enabled: (context) => diffOf(context)?.hasNext() === true,
    run: (context) => {
      diffOf(context)?.next();
    },
  });
  commands.register({
    id: 'diff.collapseUnchanged',
    label: 'Collapse Unchanged Fragments',
    icon: 'collapseAll',
    checked: () => collapse.get(),
    run: () => {
      collapse.set(!collapse.peek());
      saveOptions();
    },
  });
  commands.register({
    id: 'diff.syncScroll',
    label: 'Synchronize Scrolling',
    checked: () => syncScroll.get(),
    run: () => {
      syncScroll.set(!syncScroll.peek());
      saveOptions();
    },
  });
  menus.contribute({ menu: 'diff/settings', item: { command: 'diff.syncScroll' }, group: 'a' });
}

export interface DiffViewerProps {
  services: MenuServices;
  path: string;
  original: string;
  text: string;
  fontSize: () => number;
  tabSize: () => number;
}

/** A diff and its toolbar. */
export function DiffViewer(props: DiffViewerProps): Node {
  const { services } = props;
  const control = signal<DiffControl | undefined>(undefined);
  const shortcut = (command: string) => () => {
    const { keymap } = services;
    const key = keymap?.shortcutsFor(command)[0];
    // A key: there's a keymap.
    return key === undefined ? undefined : formatSequence(key, (keymap as Keymap).platform);
  };
  const button = (command: string) => (
    <ToolbarButton
      commands={services.commands}
      command={command}
      icon={icon(services.commands.get(command)?.icon as string)}
      shortcut={shortcut(command)}
      context={() => control.get()}
    />
  );
  const element = (
    <div class="playground-diff">
      <div
        class="playground-diff__toolbar"
        role="toolbar"
        aria-label="Diff"
        on:mousedown={(event) => {
          // The diff keeps the keyboard, as IntelliJ gives it back from its toolbar.
          event.preventDefault();
        }}
      >
        {button('diff.previousDifference')}
        {button('diff.nextDifference')}
        <span class="playground-diff__separator" />
        {button('diff.collapseUnchanged')}
        <button
          type="button"
          class="cerebro-toolbar-button playground-diff__settings"
          aria-label="Settings"
          data-menu="diff/settings"
          ref={tooltip({ text: () => 'Settings', placement: 'below' })}
          on:click={(event) => {
            const anchor = event.currentTarget as HTMLElement;
            openMenu(services, 'diff/settings', { anchor, placement: 'below' }, { owner: anchor });
          }}
        >
          {icon('settings')}
        </button>
      </div>
      <DiffEditor
        path={props.path}
        original={props.original}
        text={props.text}
        fontSize={props.fontSize}
        tabSize={props.tabSize}
        collapse={() => collapse.get()}
        syncScroll={() => syncScroll.get()}
        control={(diff) => {
          control.set(diff);
        }}
      />
    </div>
  ) as HTMLElement;
  // Given as the diff was made, before its element was.
  diffs.set(element, control.peek() as DiffControl);
  return element;
}
