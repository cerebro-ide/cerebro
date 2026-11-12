// A diff with its toolbar, as IntelliJ's diff viewer: Previous and Next Difference (Shift+F7 and
// F7), what a diff window puts after them (Jump to Source, its files), Collapse Unchanged
// Fragments, the viewer (side by side or unified), and the Settings gear with Synchronize
// Scrolling, the policies (Ignore Differences and Highlighting Differences) and Appearance. The
// settings are kept for every diff, as IntelliJ keeps its diff settings, and the diffs open take
// them at once.

import { formatSequence, type Keymap } from '@cerebro-ide/commands';
import { onCleanup, type Child } from '@cerebro-ide/jsx';
import { effect, signal, untracked, type Signal } from '@cerebro-ide/reactive';
import {
  DiffEditor,
  UnifiedDiffEditor,
  HIGHLIGHT_POLICIES,
  IGNORE_POLICIES,
  type DiffControl,
  type DiffScroll,
  type HighlightPolicy,
  type IgnorePolicy,
} from '@cerebro-ide/ui-editor';
import { openMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { ToolbarButton } from '@cerebro-ide/ui-toolbar';
import { tooltip } from '@cerebro-ide/ui-tooltip';
import { ImageDiff } from '@cerebro-ide/ui-image';
import { icon } from './icons.js';
import { imageType } from './images.js';
import { globalSettings } from './settings.js';

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
  align: boolean;
  ignore: IgnorePolicy;
  highlight: HighlightPolicy;
  /** The gear's Appearance. */
  whitespace: boolean;
  lineNumbers: boolean;
  indentGuides: boolean;
  softWrap: boolean;
  /** Diffs open as editor tabs, not windows of their own. */
  inTab: boolean;
}

/**
 * Collapsed to start with, as IntelliJ's diffs from the Commit tool window, the Log and a file's
 * history, where Cerebro's open (its default elsewhere is expanded: a claim that one default fits
 * here, open to change); scrolling synchronized, nothing ignored and words highlighted, line
 * numbers alone shown, changes not aligned, as IntelliJ's defaults (`TextDiffSettingsHolder`).
 */
function readOptions(): Options {
  const defaults: Options = {
    viewer: 'sideBySide',
    collapse: true,
    syncScroll: true,
    align: false,
    ignore: 'none',
    highlight: 'words',
    whitespace: false,
    lineNumbers: true,
    indentGuides: false,
    softWrap: false,
    inTab: false,
  };
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Record<string, unknown>;
    const one = <T extends string>(values: readonly T[], value: unknown, fallback: T) =>
      values.find((v) => v === value) ?? fallback;
    return {
      viewer: stored.viewer === 'unified' ? 'unified' : 'sideBySide',
      collapse: stored.collapse !== false,
      syncScroll: stored.syncScroll !== false,
      align: stored.align === true,
      ignore: one(IGNORE_POLICIES, stored.ignore, defaults.ignore),
      highlight: one(HIGHLIGHT_POLICIES, stored.highlight, defaults.highlight),
      whitespace: stored.whitespace === true,
      lineNumbers: stored.lineNumbers !== false,
      indentGuides: stored.indentGuides === true,
      softWrap: stored.softWrap === true,
      inTab: stored.inTab === true,
    };
  } catch {
    return defaults;
  }
}

/**
 * The lines folds leave by each change, from Settings → Tools → Diff & Merge; undefined when
 * folding is turned off there (Disable). Read reactively.
 */
const contextLines = (): number | undefined => {
  const lines = globalSettings.get('diff.contextLines') as string;
  return lines === 'disable' ? undefined : Number(lines);
};

/** The settings, as kept: read as the commands are set up. */
const viewer = signal<Viewer>('sideBySide');
const collapse = signal(true);
const syncScroll = signal(true);
const align = signal(false);
const ignore = signal<IgnorePolicy>('none');
const highlight = signal<HighlightPolicy>('words');
const appearance = {
  whitespace: signal(false),
  lineNumbers: signal(true),
  indentGuides: signal(false),
  softWrap: signal(false),
};
/**
 * Whether diffs open as editor tabs, as chosen in a diff's Settings, in this window or another: read
 * as kept, not as a setting of the window's.
 */
export const diffsInTabs = (): boolean => readOptions().inTab;

/** Keeps the window's settings, and `inTab` if given (else as kept, maybe by another window). */
function saveOptions(inTab = diffsInTabs()): void {
  try {
    const options: Options = {
      viewer: viewer.peek(),
      collapse: collapse.peek(),
      syncScroll: syncScroll.peek(),
      align: align.peek(),
      ignore: ignore.peek(),
      highlight: highlight.peek(),
      whitespace: appearance.whitespace.peek(),
      lineNumbers: appearance.lineNumbers.peek(),
      indentGuides: appearance.indentGuides.peek(),
      softWrap: appearance.softWrap.peek(),
      inTab,
    };
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Not kept: the next session starts as before.
  }
}

/** Going on (1) or back (-1). */
type Step = 1 | -1;

/** A diff window's other files, where Next and Previous Difference go on past a file's ends. */
export interface DiffFiles {
  /** Whether there's a file `step` away from the one shown; read reactively. */
  has(step: Step): boolean;
  /** Shows it, the caret at its first change going on, at its last coming back. */
  go(step: Step): void;
}

/**
 * Past a file's last difference (or before its first), the first press says to press again, and
 * the second goes on to the next file, as IntelliJ's diff (`DiffDifferenceNavigationAction`, its
 * Go to next file setting on, as it is by default): which way a press made ready, until a
 * difference is gone to or the diff shown is another.
 */
let ready: Step | undefined;
/** The hint saying to press again, while it's shown: any key or scrolling hides it, as IntelliJ's. */
const pressAgain = signal<Step | undefined>(undefined);

/** Each viewer's diff, by its element, for a key pressed in it: the one it shows now. */
const diffs = new WeakMap<Element, () => DiffControl | undefined>();

/**
 * The diff a command acts on: its toolbar's, or the one `element` is (by default, the one with the
 * keyboard).
 */
function diffOf(
  context: unknown,
  element = document.activeElement?.closest('.playground-diff'),
): DiffControl | undefined {
  if (context && typeof context === 'object' && 'next' in context) return context as DiffControl;
  return element ? diffs.get(element)?.() : undefined;
}

/**
 * Where a diff shown moves to, and how: IntelliJ's Show Diff in Editor Tab, from a diff window, and
 * Show Diff in Separate Window, from a tab (`MoveDiffEditorAction`).
 */
export interface DiffMove {
  to: 'tab' | 'window';
  /** Whether the diff whose Settings button this is moves (Local History's diff doesn't). */
  moves(button: unknown): boolean;
  /** Moves that diff; diffs open there from now on. */
  move(button: unknown): void;
}

/**
 * The diff's commands and its Settings menu; their keys are the keymaps'. A diff window gives its
 * `files`, for Next and Previous Difference to go on to; in the app, `move` moves diffs between
 * windows and tabs.
 */
export function setupDiffViewer(services: MenuServices, files?: DiffFiles, move?: DiffMove): void {
  const { commands, menus } = services;
  const options = readOptions();
  viewer.set(options.viewer);
  collapse.set(options.collapse);
  syncScroll.set(options.syncScroll);
  align.set(options.align);
  ignore.set(options.ignore);
  highlight.set(options.highlight);
  for (const name of APPEARANCE) appearance[name].set(options[name]);
  for (const [id, label, step] of [
    ['diff.previousDifference', 'Previous Difference', -1],
    ['diff.nextDifference', 'Next Difference', 1],
  ] as const) {
    /** Whether the diff has a difference that way from its caret. */
    const has = (diff: DiffControl | undefined) =>
      (step > 0 ? diff?.hasNext() : diff?.hasPrevious()) === true;
    /** The diff acted on: in a diff window, its one diff, wherever the keyboard is. */
    const diffFor = (context: unknown) =>
      diffOf(context) ??
      (files ? diffOf(context, document.querySelector('.playground-diff')) : undefined);
    commands.register({
      id,
      label,
      icon: step > 0 ? 'nextDiff' : 'previousDiff',
      enabled: (context) => has(diffFor(context)) || files?.has(step) === true,
      run: (context) => {
        const diff = diffFor(context);
        if (has(diff)) {
          if (step > 0) diff?.next();
          else diff?.previous();
          ready = undefined;
        } else if (ready === step) {
          files?.go(step);
        } else {
          ready = step;
          pressAgain.set(step);
        }
      },
    });
  }
  commands.register({
    id: 'diff.collapseUnchanged',
    label: 'Collapse Unchanged Fragments',
    icon: 'collapseAll',
    // Nothing to fold with folding turned off in Settings.
    enabled: () => contextLines() !== undefined,
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
  // First in the gear, before Synchronize Scrolling, as IntelliJ's (its name, `ActionsBundle`'s
  // Vcs.Diff.ToggleDiffAligningMode in the gear's popup).
  commands.register({
    id: 'diff.alignChanges',
    label: 'Align Changes Highlighting',
    // The unified viewer has one side.
    visible: () => viewer.get() === 'sideBySide',
    checked: () => align.get(),
    run: () => {
      align.set(!align.peek());
      saveOptions();
    },
  });
  menus.contribute({ menu: 'diff/settings', item: { command: 'diff.alignChanges' }, group: 'a' });
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
  // After them, as IntelliJ's gear puts its Diff.DiffModes (`SetEditorSettingsActionGroup`); each
  // shown where the diff isn't (its names, `ActionsBundle`'s Vcs.Diff.ShowDiffIn*).
  if (move) {
    const id = move.to === 'tab' ? 'diff.showInEditorTab' : 'diff.showInWindow';
    commands.register({
      id,
      label: move.to === 'tab' ? 'Show Diff in Editor Tab' : 'Show Diff in Separate Window',
      visible: (button) => move.moves(button),
      run: (button) => {
        saveOptions(move.to === 'tab');
        move.move(button);
      },
    });
    menus.contribute({ menu: 'diff/settings', item: { command: id }, group: 'a' });
  }
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
  /** Where the caret starts: the first change, the last, or a line (`DiffEditorProps`). */
  scrollTo?: DiffScroll;
  /** The diff takes the keyboard as it shows, as IntelliJ's diff window gives it to its editor. */
  focus?: boolean;
  /**
   * What goes after Next Difference, as IntelliJ's diff window has Jump to Source and its files
   * there: made with `button`, a command's button as the toolbar's own.
   */
  navigation?: (button: (command: string) => Node) => Child;
  /** Makes the right side editable: called with its text as it's edited. */
  onEdit?: (text: string) => void;
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
        {props.navigation?.(button)}
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
            openMenu(
              services,
              'diff/settings',
              { anchor, placement: 'below' },
              { owner: anchor, context: anchor },
            );
          }}
        >
          {icon('settings')}
        </button>
      </div>
      <div class="playground-diff__body">
        {() => {
          // The viewer chosen, made again when another is.
          const shared = {
            path: props.path,
            original: props.original,
            text: props.text,
            fontSize: props.fontSize,
            tabSize: props.tabSize,
            collapse: () => collapse.get() && contextLines() !== undefined,
            context: () => contextLines() ?? 0,
            ignore: () => ignore.get(),
            highlight: () => highlight.get(),
            whitespace: () => appearance.whitespace.get(),
            lineNumbers: () => appearance.lineNumbers.get(),
            indentGuides: () => appearance.indentGuides.get(),
            softWrap: () => appearance.softWrap.get(),
            control: (diff: DiffControl) => {
              control.set(diff);
              if (props.focus) diff.focus();
            },
            ...(props.scrollTo ? { scrollTo: props.scrollTo } : {}),
            ...(props.onEdit ? { onEdit: props.onEdit } : {}),
          };
          return viewer.get() === 'unified' ? (
            <UnifiedDiffEditor {...shared} />
          ) : (
            <DiffEditor {...shared} syncScroll={() => syncScroll.get()} align={() => align.get()} />
          );
        }}
        {() => {
          const step = pressAgain.get();
          if (step === undefined) return null;
          // Over the diff, near its end the way it goes, as IntelliJ's (its words, `DiffBundle`).
          return (
            <div
              class={`playground-diff__hint playground-diff__hint--${step > 0 ? 'next' : 'previous'}`}
              role="status"
            >
              {step > 0
                ? 'Press again to go to the next file'
                : 'Press again to go to the previous file'}
            </div>
          );
        }}
      </div>
    </div>
  ) as HTMLElement;
  diffs.set(element, () => control.peek());
  // Any key or scrolling hides the hint; the next press still goes on.
  const hide = () => {
    pressAgain.set(undefined);
  };
  window.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  onCleanup(() => {
    window.removeEventListener('keydown', hide, true);
    window.removeEventListener('scroll', hide, true);
    // Another diff shown: what a press made ready is forgotten, as IntelliJ's.
    ready = undefined;
    hide();
  });
  return element;
}

/**
 * The text a diff's right side edits, as IntelliJ's diff of a file as it is edits the file's
 * document: read reactively, and edited from the diff.
 */
export interface DiffDocument {
  /** Undefined if it can't be read (a file deleted): the diff then shows what `read` gives. */
  text(): string | undefined;
  edit(text: string): void;
}

/**
 * A file's diff as `read` gives its two texts: "Loading…" until they're read, why if they can't
 * be, then the diff and its toolbar. Read again when `version` changes (a diff window getting the
 * focus back), it's shown again only if they've changed, so the caret stays where it was. With a
 * `document`, the right side is its text, and edits it: shown again when it's changed elsewhere.
 */
/**
 * What the host's `git.diff` gives: the two sides' texts, or a binary file's bytes, in base64, null
 * for a side it isn't on.
 */
export type DiffSides =
  | { original: string; text: string }
  | { binary: true; original: string | null; text: string | null };

export function FileDiff(props: {
  services: MenuServices;
  path: string;
  read: () => Promise<DiffSides>;
  /** A binary file's sides' names: the revision, or "Your version". */
  titles: readonly [string, string];
  document?: DiffDocument;
  version?: () => number;
  fontSize: () => number;
  tabSize: () => number;
  scrollTo?: DiffViewerProps['scrollTo'];
  focus?: boolean;
  navigation?: DiffViewerProps['navigation'];
}): Node {
  type Loaded = DiffSides | { error: string };
  const loaded = signal<Loaded | undefined>(undefined);
  /** What's shown, as the diff's editors have it: an edit there isn't news. */
  let shown = '';
  const show = (next: Loaded) => {
    const key = JSON.stringify(next);
    if (key === shown) return;
    shown = key;
    loaded.set(next);
  };
  const { document } = props;
  const watch = effect(() => {
    props.version?.();
    untracked(() => {
      props.read().then(
        (read) => {
          show(
            'binary' in read
              ? read
              : { original: read.original, text: document?.text() ?? read.text },
          );
        },
        (error: unknown) => {
          show({ error: (error as Error).message });
        },
      );
    });
    return undefined;
  });
  // The document changed elsewhere (its file's tab): shown as it is.
  const following = effect(() => {
    const text = document?.text();
    untracked(() => {
      const now = loaded.peek();
      if (text !== undefined && now && !('error' in now) && !('binary' in now)) {
        show({ original: now.original, text });
      }
    });
    return undefined;
  });
  const edit = (text: string) => {
    const now = loaded.peek() as { original: string; text: string };
    shown = JSON.stringify({ original: now.original, text });
    document?.edit(text);
  };
  onCleanup(() => {
    watch.dispose();
    following.dispose();
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
        if ('binary' in state)
          return <BinaryDiff path={props.path} sides={state} titles={props.titles} />;
        return (
          <DiffViewer
            services={props.services}
            path={props.path}
            original={state.original}
            text={state.text}
            fontSize={props.fontSize}
            tabSize={props.tabSize}
            {...(props.navigation ? { navigation: props.navigation } : {})}
            {...(props.scrollTo ? { scrollTo: props.scrollTo } : {})}
            {...(props.focus ? { focus: true } : {})}
            {...(untracked(() => document?.text()) === undefined ? {} : { onEdit: edit })}
          />
        );
      }}
    </div>
  );
}

/**
 * A diff's sides' names: at two commits, theirs, shortened; against a branch or a tag, its name and
 * the current `branch`'s, as local; against a commit, its hash and "Local"; else the last commit's
 * and "Your version", as IntelliJ names a file as it is (a claim, from memory).
 */
export const sideTitles = (
  range: { from: string; to?: string } | undefined,
  branch?: string,
): [string, string] => {
  if (!range) return ['HEAD', 'Your version'];
  // IntelliJ's `DvcsCompareWithAction` and `VcsDiffUtil.getRevisionTitle`, read in its source.
  if (range.to === undefined) {
    // A commit's, or a branch's or tag's: the current branch's as local only beside a ref.
    const ref = range.from.startsWith('refs/');
    const local = ref && branch !== undefined ? `${branch} (Local)` : 'Local';
    return [revisionName(range.from), local];
  }
  return [range.from.slice(0, 8), range.to.slice(0, 8)];
};

/** A revision's name to show: a branch's or a tag's (`refs/tags/v1` is `v1`), or a short hash. */
export const revisionName = (revision: string): string => {
  const ref = /^refs\/(?:heads|remotes|tags)\/(.+)$/.exec(revision);
  return ref ? (ref[1] as string) : revision.slice(0, 8);
};

/** A side's bytes, from base64. */
const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/**
 * A binary file's diff: an image's in the image diff; another's, as IntelliJ's, whether its
 * contents differ (its `DiffBundle`'s words), with neither shown.
 */
function BinaryDiff(props: {
  path: string;
  sides: Extract<DiffSides, { binary: true }>;
  titles: readonly [string, string];
}): Child {
  const { original, text } = props.sides;
  const [left, right] = props.titles;
  const type = imageType(props.path);
  if (type !== undefined) {
    return (
      <ImageDiff
        before={original === null ? undefined : { bytes: bytesOf(original), title: left }}
        after={text === null ? undefined : { bytes: bytesOf(text), title: right }}
        type={type}
        label={props.path}
      />
    );
  }
  return (
    <p class="playground-code__note">
      {original === text ? 'Files contents are identical' : 'Files contents are different'}
    </p>
  );
}
