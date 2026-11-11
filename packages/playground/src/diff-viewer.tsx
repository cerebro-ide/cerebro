// A diff with its toolbar, as IntelliJ's diff viewer: Previous and Next Difference (Shift+F7 and
// F7), Collapse Unchanged Fragments, the viewer (side by side or unified), and the Settings gear
// with Synchronize Scrolling and the policies, Ignore Differences and Highlighting Differences. The settings are kept for every diff,
// as IntelliJ keeps its diff settings, and the diffs open take them at once.

import { formatSequence, type Keymap } from '@cerebro-ide/commands';
import { onCleanup } from '@cerebro-ide/jsx';
import { effect, signal, untracked, type Signal } from '@cerebro-ide/reactive';
import {
  DiffEditor,
  UnifiedDiffEditor,
  HIGHLIGHT_POLICIES,
  IGNORE_POLICIES,
  type DiffControl,
  type HighlightPolicy,
  type IgnorePolicy,
} from '@cerebro-ide/ui-editor';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { icon } from './icons.js';

/** The settings, kept between sessions. */
const OPTIONS_KEY = 'cerebro.diff';

/** IntelliJ's labels (`DiffBundle`'s `option.ignore.policy.*` and `option.highlighting.policy.*`). */
const IGNORE_LABELS: Record<IgnorePolicy, string> = {
  none: 'None',
  trim: 'Trim whitespaces',
  whitespaces: 'Ignore whitespaces',
  whitespacesAndEmptyLines: 'Ignore whitespaces and empty lines',
};
const HIGHLIGHT_LABELS: Record<HighlightPolicy, string> = {
  lines: 'Lines',
  words: 'Words',
  split: 'Split changes',
  characters: 'Characters',
  none: 'None',
};

/** The gear's Appearance, in IntelliJ's order (`SetEditorSettingsActionGroup`), and its names. */
const APPEARANCE = ['whitespace', 'lineNumbers', 'indentGuides', 'softWrap'] as const;
const APPEARANCE_LABELS: Record<(typeof APPEARANCE)[number], string> = {
  whitespace: 'Sh&ow Whitespaces',
  lineNumbers: 'Show L&ine Numbers',
  indentGuides: 'Sh&ow Indent Guides',
  softWrap: 'Soft-Wrap',
};

/** IntelliJ's two viewers of a text's diff. */
type Viewer = 'sideBySide' | 'unified';

interface Options {
  viewer: Viewer;
  collapse: boolean;
  syncScroll: boolean;
  ignore: IgnorePolicy;
  highlight: HighlightPolicy;
  /** The gear's Appearance. */
  whitespace: boolean;
  lineNumbers: boolean;
  indentGuides: boolean;
  softWrap: boolean;
}

/**
 * Collapsed to start with, as IntelliJ's diffs from the Commit tool window, the Log and a file's
 * history, where Cerebro's open (its default elsewhere is expanded: a claim that one default fits
 * here, open to change); scrolling synchronized, nothing ignored and words highlighted, line
 * numbers alone shown, as IntelliJ's defaults (`TextDiffSettingsHolder`).
 */
function readOptions(): Options {
  const defaults: Options = {
    viewer: 'sideBySide',
    collapse: true,
    syncScroll: true,
    ignore: 'none',
    highlight: 'words',
    whitespace: false,
    lineNumbers: true,
    indentGuides: false,
    softWrap: false,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Record<string, unknown>;
    const one = <T extends string>(values: readonly T[], value: unknown, fallback: T) =>
      values.find((v) => v === value) ?? fallback;
    return {
      viewer: stored.viewer === 'unified' ? 'unified' : 'sideBySide',
      collapse: stored.collapse !== false,
      syncScroll: stored.syncScroll !== false,
      ignore: one(IGNORE_POLICIES, stored.ignore, defaults.ignore),
      highlight: one(HIGHLIGHT_POLICIES, stored.highlight, defaults.highlight),
      whitespace: stored.whitespace === true,
      lineNumbers: stored.lineNumbers !== false,
      indentGuides: stored.indentGuides === true,
      softWrap: stored.softWrap === true,
    };
  } catch {
    return defaults;
  }
}

/** The settings, as kept: read as the commands are set up. */
const viewer = signal<Viewer>('sideBySide');
const collapse = signal(true);
const syncScroll = signal(true);
const ignore = signal<IgnorePolicy>('none');
const highlight = signal<HighlightPolicy>('words');
const appearance = {
  whitespace: signal(false),
  lineNumbers: signal(true),
  indentGuides: signal(false),
  softWrap: signal(false),
};

function saveOptions(): void {
  try {
    const options: Options = {
      viewer: viewer.peek(),
      collapse: collapse.peek(),
      syncScroll: syncScroll.peek(),
      ignore: ignore.peek(),
      highlight: highlight.peek(),
      whitespace: appearance.whitespace.peek(),
      lineNumbers: appearance.lineNumbers.peek(),
      indentGuides: appearance.indentGuides.peek(),
      softWrap: appearance.softWrap.peek(),
    };
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not kept: the next session starts as before.
  }
}

/** Each viewer's diff, by its element, for a key pressed in it: the one it shows now. */
const diffs = new WeakMap<Element, () => DiffControl | undefined>();

/** The diff a command acts on: its toolbar's, or the one with the keyboard's. */
function diffOf(context: unknown): DiffControl | undefined {
  if (context && typeof context === 'object' && 'next' in context) return context as DiffControl;
  const element = document.activeElement?.closest('.playground-diff');
  return element ? diffs.get(element)?.() : undefined;
}

/** The diff's commands and its Settings menu; their keys are the keymaps'. */
export function setupDiffViewer(services: MenuServices): void {
  const { commands, menus } = services;
  const options = readOptions();
  viewer.set(options.viewer);
  collapse.set(options.collapse);
  syncScroll.set(options.syncScroll);
  ignore.set(options.ignore);
  highlight.set(options.highlight);
  for (const name of APPEARANCE) appearance[name].set(options[name]);
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
  // The viewers, as IntelliJ's chooser: their names, `DiffBundle`'s `*.viewer`.
  for (const [id, label, which] of [
    ['diff.sideBySide', 'Side-by-side viewer', 'sideBySide'],
    ['diff.unified', 'Unified viewer', 'unified'],
  ] as const) {
    commands.register({
      id,
      label,
      icon: which,
      checked: () => viewer.get() === which,
      run: () => {
        viewer.set(which);
        saveOptions();
      },
    });
  }
  commands.register({
    id: 'diff.syncScroll',
    label: 'Synchronize Scrolling',
    // One editor scrolls alone.
    visible: () => viewer.get() === 'sideBySide',
    checked: () => syncScroll.get(),
    run: () => {
      syncScroll.set(!syncScroll.peek());
      saveOptions();
    },
  });
  menus.contribute({ menu: 'diff/settings', item: { command: 'diff.syncScroll' }, group: 'a' });
  // Each policy a choice of one, under its heading, as IntelliJ's gear.
  const policy = <T extends string>(
    group: string,
    heading: string,
    name: string,
    labels: Record<T, string>,
    chosen: Signal<T>,
  ) => {
    menus.contribute({ menu: 'diff/settings', item: { heading }, group });
    for (const value of Object.keys(labels) as T[]) {
      const id = `diff.${name}.${value}`;
      commands.register({
        id,
        label: labels[value],
        checked: () => chosen.get() === value,
        run: () => {
          chosen.set(value);
          saveOptions();
        },
      });
      menus.contribute({ menu: 'diff/settings', item: { command: id }, group });
    }
  };
  policy('b', 'Ignore Differences', 'ignore', IGNORE_LABELS, ignore);
  policy('c', 'Highlighting Differences', 'highlight', HIGHLIGHT_LABELS, highlight);
  // Appearance, under its heading, last, as IntelliJ's (its actions' names, `ActionsBundle`).
  menus.contribute({ menu: 'diff/settings', item: { heading: 'Appearance' }, group: 'd' });
  for (const name of APPEARANCE) {
    const id = `diff.${name}`;
    commands.register({
      id,
      label: APPEARANCE_LABELS[name],
      checked: () => appearance[name].get(),
      run: () => {
        appearance[name].set(!appearance[name].peek());
        saveOptions();
      },
    });
    menus.contribute({ menu: 'diff/settings', item: { command: id }, group: 'd' });
  }
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
        <div class="playground-diff__viewers" role="group" aria-label="Viewer">
          {button('diff.sideBySide')}
          {button('diff.unified')}
        </div>
        <button
          type="button"
          class="cerebro-toolbar-button"
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
      {() => {
        // The viewer chosen, made again when another is.
        const shared = {
          path: props.path,
          original: props.original,
          text: props.text,
          fontSize: props.fontSize,
          tabSize: props.tabSize,
          collapse: () => collapse.get(),
          ignore: () => ignore.get(),
          highlight: () => highlight.get(),
          whitespace: () => appearance.whitespace.get(),
          lineNumbers: () => appearance.lineNumbers.get(),
          indentGuides: () => appearance.indentGuides.get(),
          softWrap: () => appearance.softWrap.get(),
          control: (diff: DiffControl) => {
            control.set(diff);
          },
        };
        return viewer.get() === 'unified' ? (
          <UnifiedDiffEditor {...shared} />
        ) : (
          <DiffEditor {...shared} syncScroll={() => syncScroll.get()} />
        );
      }}
    </div>
  ) as HTMLElement;
  diffs.set(element, () => control.peek());
  return element;
}

/**
 * A file's diff as `read` gives its two texts: "Loading…" until they're read, why if they can't
 * be, then the diff and its toolbar. Read again when `version` changes (a diff window getting the
 * focus back), it's shown again only if they've changed, so the caret stays where it was.
 */
export function FileDiff(props: {
  services: MenuServices;
  path: string;
  read: () => Promise<{ original: string; text: string }>;
  version?: () => number;
  fontSize: () => number;
  tabSize: () => number;
}): Node {
  type Loaded = { original: string; text: string } | { error: string };
  const loaded = signal<Loaded | undefined>(undefined);
  const show = (next: Loaded) => {
    const now = loaded.peek();
    if (JSON.stringify(now) !== JSON.stringify(next)) loaded.set(next);
  };
  const watch = effect(() => {
    props.version?.();
    untracked(() => {
      props.read().then(show, (error: unknown) => {
        show({ error: (error as Error).message });
      });
    });
    return undefined;
  });
  onCleanup(() => {
    watch.dispose();
  });
  return (
    <div class="playground-code">
      {() => {
        const state = loaded.get();
        if (!state) return <p class="playground-code__note">Loading…</p>;
        if ('error' in state) {
          return (
            <p class="playground-code__note">
              Can’t show the changes to {props.path}: {state.error}
            </p>
          );
        }
        return (
          <DiffViewer
            services={props.services}
            path={props.path}
            original={state.original}
            text={state.text}
            fontSize={props.fontSize}
            tabSize={props.tabSize}
          />
        );
      }}
    </div>
  );
}
