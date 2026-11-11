// IntelliJ's Annotate with Git Blame (`AnnotateToggleAction`, `AnnotationPresentation`,
// `AspectAnnotationFieldGutter`, `GitFileAnnotation`, `AnnotateActionGroup`, `ShowShortenNames`,
// `ShortNameType`, `ShowAnnotationColorsAction`, `AnnotationsSettings`, `ColorGenerator`, read from
// its source): who last changed each line of a file, and when, in the editor's gutter. From the
// gutter's menu, or Git → Current File. Lines changed since the last commit show nothing. Its menu,
// on an annotation (`EditorGutterComponentImpl.getTextAnnotationPopupActions`, then
// `AnnotateToggleAction`'s): Close Annotations, Show Diff, View (the columns, their colours, how
// names show), Copy Revision Number, and Options (`GitToggleAnnotationOptionsActionProvider`). A
// click on one shows its commit in the Log (`GitFileAnnotation.showAffectedPaths`). The view and the
// options are kept in the browser's storage.

import { ObservableMap, signal } from '@cerebro-ide/reactive';
import type { AskAnnotation, LineAnnotation, TextAnnotation } from '@cerebro-ide/ui-editor';
import type { Tab } from '@cerebro-ide/layout';
import { openContextMenu, type MenuServices } from '@cerebro-ide/ui-menu';
import { diffTab } from './changes.js';
import { active, gitRepository, hostFor } from './environments.js';
import { EMPTY_TREE } from './git-log.js';
import { notifications } from './notifications.js';

/** The host's `git.blame`. */
export interface Blame {
  lines: (string | null)[];
  commits: BlameCommit[];
}

export interface BlameCommit {
  hash: string;
  author: string;
  email: string;
  time: number;
  /** The committer's date: Show Commit Timestamp's. */
  committed: number;
  message: string;
  path?: string;
  /** The commit before that changed the file, and its path there: none where it was added. */
  previous?: { hash: string; path: string };
}

/** IntelliJ's columns, in its order (`GitFileAnnotation.getAspects`). */
const ASPECTS = [
  ['revision', 'Revision'],
  ['date', 'Date'],
  ['author', 'Author'],
] as const;
type Aspect = (typeof ASPECTS)[number][0];

/** IntelliJ's Colors, in its order: by author, by age, or none. */
const COLORS = [
  ['author', 'Author'],
  ['order', 'Order'],
  ['none', 'Hide'],
] as const;
type ColorMode = (typeof COLORS)[number][0];

/** IntelliJ's Names, in its order. */
const NAMES = [
  ['initials', 'Initials'],
  ['lastname', 'Last Name'],
  ['firstname', 'First Name'],
  ['full', 'Full Name'],
  ['email', 'Email'],
] as const;
type NameType = (typeof NAMES)[number][0];

/** How far moved lines are followed (Options): not, within the file, or across files too. */
const MOVEMENTS = ['none', 'within', 'across'] as const;
type Movements = (typeof MOVEMENTS)[number];

export interface AnnotationView {
  aspects: Record<Aspect, boolean>;
  colors: ColorMode;
  names: NameType;
  /** Options: blame ignoring whitespace (`-w`). */
  ignoreWhitespace: boolean;
  movements: Movements;
  /** Options: the committer's date in the Date column, not the author's. */
  commitDate: boolean;
}

/**
 * IntelliJ's defaults: the date and the author, coloured by age, last names; whitespace ignored,
 * no movements followed, the author's date (`GitVcsApplicationSettings`, `CommonUiProperties`).
 */
const DEFAULT_VIEW: AnnotationView = {
  aspects: { revision: false, date: true, author: true },
  colors: 'order',
  names: 'lastname',
  ignoreWhitespace: true,
  movements: 'none',
  commitDate: false,
};

const VIEW_KEY = 'cerebro.annotate.view';

/** The view as kept, or the defaults where it can't be read. */
export function readView(): AnnotationView {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') as Partial<AnnotationView>;
    const one = <T extends string>(
      all: readonly (readonly [T, string])[],
      value: unknown,
      or: T,
    ) => (all.some(([id]) => id === value) ? (value as T) : or);
    const flag = (value: unknown, or: boolean) => (typeof value === 'boolean' ? value : or);
    return {
      aspects: Object.fromEntries(
        ASPECTS.map(([id]) => [
          id,
          typeof stored.aspects?.[id] === 'boolean' ? stored.aspects[id] : DEFAULT_VIEW.aspects[id],
        ]),
      ) as Record<Aspect, boolean>,
      colors: one(COLORS, stored.colors, DEFAULT_VIEW.colors),
      names: one(NAMES, stored.names, DEFAULT_VIEW.names),
      ignoreWhitespace: flag(stored.ignoreWhitespace, DEFAULT_VIEW.ignoreWhitespace),
      movements: MOVEMENTS.includes(stored.movements as Movements)
        ? (stored.movements as Movements)
        : DEFAULT_VIEW.movements,
      commitDate: flag(stored.commitDate, DEFAULT_VIEW.commitDate),
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

const view = signal(readView());

function setView(change: Partial<AnnotationView>): void {
  view.set({ ...view.peek(), ...change });
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view.peek()));
  } catch {
    // Not kept: the view still applies until the page is reloaded.
  }
}

/** IntelliJ's `ShortNameType.shorten`: a name, as "Name <email>", as the Names menu says. */
export function shortenName(input: string, type: NameType): string {
  const raw = input.replace(/\s+/g, ' ').trim();
  let name = raw;
  let fromEmail = false;
  const start = name.indexOf('<');
  const end = name.indexOf('>');
  const at = name.indexOf('@');
  if (start >= 0 && start < at && at < end) {
    const email = name.slice(start + 1, end).trim();
    if (type === 'email') return email;
    const before = name.slice(0, start).trim();
    const after = name.slice(end + 1).trim();
    name = [before, after].filter((part) => part !== '').join(' ');
    if (name === '') {
      fromEmail = true;
      name = email;
    }
  }
  if (type === 'full') return name;
  if (type === 'email') {
    const atIndex = name.indexOf('@');
    if (atIndex < 0) return name;
    const from = name.lastIndexOf(' ', atIndex);
    const to = name.indexOf(' ', atIndex);
    return name.slice(Math.max(from, 0), to < 0 ? name.length : to);
  }
  const delimiters = /[.,<>()":_-]/g;
  const atIndex = name.indexOf('@');
  if (atIndex > 0 && !name.includes(' ')) {
    fromEmail = true;
    name = name.slice(0, atIndex).replace(delimiters, ' ');
  }
  const parts = name.split(' ').filter((part) => part.trim() !== '');
  if (parts.length === 0) return raw;
  if (type === 'initials') {
    return parts
      .flatMap((part) => part.split(delimiters))
      .filter((part) => part.trim() !== '')
      .map((part) => (part[0] as string).toUpperCase())
      .join('');
  }
  let one = (type === 'firstname' ? parts[0] : parts.at(-1)) as string;
  // Emails are lower case, names capitalised.
  if (fromEmail && /^\p{Ll}/u.test(one)) one = (one[0] as string).toUpperCase() + one.slice(1);
  return one;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** IntelliJ's `DateFormatUtil.formatPrettyDate`: Today, Yesterday, else the date. */
export function formatPrettyDate(time: number, now = Date.now()): string {
  const date = new Date(time);
  const today = new Date(now);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1))) {
    return 'Yesterday';
  }
  return date.toLocaleDateString(undefined, { dateStyle: 'short' });
}

/**
 * IntelliJ's annotation colours (`AnnotationsSettings.getOrderedColors`): its five, with four
 * between each two (`ColorGenerator`), 21 from newest to oldest.
 */
export const PALETTE: readonly string[] = Array.from({ length: 21 }, (_, i) => {
  const anchor = Math.floor(i / 5) + 1;
  const step = i % 5;
  const from = `var(--cerebro-annotations-${String(anchor)})`;
  if (step === 0) return from;
  const to = `var(--cerebro-annotations-${String(anchor + 1)})`;
  return `color-mix(in srgb, ${from} ${String(100 - step * 20)}%, ${to})`;
});

/** By author, the palette shuffled so neighbours differ (`getAuthorsColors`). */
const AUTHOR_PALETTE = [0, 1, 2, 3].flatMap((first) =>
  PALETTE.flatMap((_, k) =>
    k * 4 + first < PALETTE.length ? [PALETTE[k * 4 + first] as string] : [],
  ),
);

/** Each commit's background: by its age, or its author's; none with one commit, or Hide. */
function backgrounds(commits: readonly BlameCommit[], mode: ColorMode): Map<string, string> {
  const colors = new Map<string, string>();
  if (commits.length < 2 || mode === 'none') return colors;
  if (mode === 'order') {
    commits.forEach((commit, i) => {
      colors.set(commit.hash, PALETTE[Math.floor((PALETTE.length * i) / commits.length)] as string);
    });
    return colors;
  }
  const authors = [...new Set(commits.map((c) => c.author))].sort();
  for (const commit of commits) {
    const index = authors.indexOf(commit.author) % AUTHOR_PALETTE.length;
    colors.set(commit.hash, AUTHOR_PALETTE[index] as string);
  }
  return colors;
}

/** "Name <email>", as IntelliJ's `VcsUserUtil.toExactString`. */
const exactName = (commit: BlameCommit) =>
  commit.email === '' ? commit.author : `${commit.author} <${commit.email}>`;

/** IntelliJ's tooltip: the commit, its author and date, where the file was, and its message. */
export function tooltipOf(commit: BlameCommit): string {
  const date = new Date(commit.time).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const lines = [`commit ${commit.hash}`, `Author: ${exactName(commit)}`, `Date: ${date}`];
  if (commit.path !== undefined) lines.push(`Path: ${commit.path}`);
  return `${lines.join('\n')}\n\n${commit.message}`;
}

/** A blame as the gutter shows it, in the view given, with what its menu and a click do. */
export function present(
  blame: Blame,
  shown: AnnotationView,
  actions: Pick<TextAnnotation, 'menu' | 'click'>,
  now = Date.now(),
): TextAnnotation {
  const commits = new Map(blame.commits.map((c) => [c.hash, c]));
  const colors = backgrounds(blame.commits, shown.colors);
  // The file's last commit, in the latest's colour.
  const latest = blame.commits[0]?.hash;
  const columns = ASPECTS.filter(([id]) => shown.aspects[id]).map(([id]) => id);
  const text = (aspect: Aspect, commit: BlameCommit) =>
    aspect === 'revision'
      ? commit.hash.slice(0, 8)
      : aspect === 'date'
        ? formatPrettyDate(shown.commitDate ? commit.committed : commit.time, now)
        : shortenName(exactName(commit), shown.names);
  const lines = blame.lines.map((hash): LineAnnotation | null => {
    const commit = hash === null ? undefined : commits.get(hash);
    if (!commit) return null;
    const background = colors.get(commit.hash);
    return {
      texts: columns.map((aspect) => text(aspect, commit)),
      latest: commit.hash === latest,
      ...(background === undefined ? {} : { background }),
    };
  });
  return {
    lines,
    tooltip: (line) => {
      const hash = blame.lines[line];
      const commit = hash ? commits.get(hash) : undefined;
      return commit ? tooltipOf(commit) : '';
    },
    ...actions,
  };
}

/** A file annotated: its worktree, and its path in it. */
interface Annotated {
  worktree: string;
  path: string;
}

/** The files annotated, by their tabs' ids. */
const annotated = new ObservableMap<string, Annotated>();

/** What the menus on an annotation are given: the file's tab, and the line's commit. */
export interface AnnotationContext {
  file: string;
  hash: string;
  /** The file's path in its worktree at that commit. */
  path: string;
  commit: BlameCommit;
}

let menuServices: MenuServices | undefined;
let blameSetup: BlameSetup | undefined;

/** What asks for a file's annotations while it's annotated, in the view as it is. Reactive. */
export function annotationFor(file: string): AskAnnotation | undefined {
  const target = annotated.get(file);
  if (!target) return undefined;
  const shown = view.get();
  return async (text) => {
    const host = hostFor(target.worktree);
    try {
      const blame = (await host?.request('git.blame', {
        path: target.worktree,
        file: target.path,
        contents: text,
        ignoreWhitespace: shown.ignoreWhitespace,
        movements: shown.movements,
      })) as Blame;
      const commits = new Map(blame.commits.map((c) => [c.hash, c]));
      const context = (line: number): AnnotationContext => {
        const commit = commits.get(blame.lines[line] as string) as BlameCommit;
        return { file, hash: commit.hash, path: commit.path ?? target.path, commit };
      };
      return present(blame, shown, {
        menu: (line, event) => {
          openContextMenu(menuServices as MenuServices, 'editor/annotation', event, context(line));
        },
        // IntelliJ's: the commit in the Log, the file selected among its changes.
        click: (line) => {
          const { hash, path } = context(line);
          blameSetup?.showInLog(hash, path);
        },
      });
    } catch (error) {
      annotated.delete(file);
      notifications.notify({
        title: 'Cannot load annotations',
        content: (error as Error).message,
        type: 'error',
      });
      return undefined;
    }
  };
}

export interface BlameSetup {
  /** The active editor tab's id. */
  activeTab: () => string | undefined;
  /** Opens a tab in the editor: Show Diff's. */
  open: (tab: Tab) => void;
  /** Shows a commit in the Git tool window's Log, a file (in the worktree) selected in it. */
  showInLog: (hash: string, path: string) => void;
}

/** IntelliJ's Options, in its order, toggled as it toggles them (`GitToggleAnnotationOptionsActionProvider`). */
const OPTIONS: readonly {
  id: string;
  label: string;
  checked: (shown: AnnotationView) => boolean;
  toggle: (shown: AnnotationView) => Partial<AnnotationView>;
}[] = [
  {
    id: 'ignoreWhitespace',
    label: 'Ignore Whitespaces',
    checked: (shown) => shown.ignoreWhitespace,
    toggle: (shown) => ({ ignoreWhitespace: !shown.ignoreWhitespace }),
  },
  {
    // Checked for across files too; off, it follows none.
    id: 'movementsWithin',
    label: 'Detect Movements Within File',
    checked: (shown) => shown.movements !== 'none',
    toggle: (shown) => ({ movements: shown.movements === 'none' ? 'within' : 'none' }),
  },
  {
    // Off, it still follows them within the file.
    id: 'movementsAcross',
    label: 'Detect Movements Across Files',
    checked: (shown) => shown.movements === 'across',
    toggle: (shown) => ({ movements: shown.movements === 'across' ? 'within' : 'across' }),
  },
  {
    id: 'commitDate',
    label: 'Show Commit Timestamp',
    checked: (shown) => shown.commitDate,
    toggle: (shown) => ({ commitDate: !shown.commitDate }),
  },
];

/** A file in the active git worktree, by its tab's id. */
function fileIn(tab: string | undefined): Annotated | undefined {
  const env = active();
  if (!env || tab === undefined || !hostFor(env.id) || !gitRepository.get()) return undefined;
  const prefix = `${env.id}/`;
  return tab.startsWith(prefix) ? { worktree: env.id, path: tab.slice(prefix.length) } : undefined;
}

/** Annotate with Git Blame, its menus, and the menu on an annotation. */
export function setupBlame(services: MenuServices, setup: BlameSetup): void {
  menuServices = services;
  blameSetup = setup;
  const { commands, menus } = services;
  /** The file a command is for: the gutter's, or the active editor's. */
  const target = (c: unknown) => (c as { file?: string } | undefined)?.file ?? setup.activeTab();
  commands.register({
    id: 'vcs.annotate',
    label: 'A&nnotate with Git Blame',
    visible: (c) => fileIn(target(c)) !== undefined,
    checked: (c) => annotated.has(target(c) as string),
    run: (c) => {
      const file = target(c) as string;
      if (annotated.has(file)) annotated.delete(file);
      else annotated.set(file, fileIn(file) as Annotated);
    },
  });
  commands.register<AnnotationContext>({
    id: 'annotate.close',
    label: 'Close Annotations',
    run: (c) => annotated.delete(c.file),
  });
  // The commit's changes to the file: from the commit before that changed it, as IntelliJ's.
  commands.register<AnnotationContext>({
    id: 'annotate.showDiff',
    label: 'Show Diff',
    run: (c) => {
      setup.open(diffTab(c.path, { from: c.commit.previous?.hash ?? EMPTY_TREE, to: c.hash }));
    },
  });
  for (const option of OPTIONS) {
    commands.register({
      id: `annotate.options.${option.id}`,
      label: option.label,
      checked: () => option.checked(view.get()),
      run: () => {
        setView(option.toggle(view.peek()));
      },
    });
  }
  commands.register<AnnotationContext>({
    id: 'annotate.copyRevision',
    label: 'Copy Revision Number',
    run: (c) => navigator.clipboard.writeText(c.hash),
  });
  for (const [id, label] of ASPECTS) {
    commands.register({
      id: `annotate.aspect.${id}`,
      label,
      checked: () => view.get().aspects[id],
      run: () => {
        setView({ aspects: { ...view.peek().aspects, [id]: !view.peek().aspects[id] } });
      },
    });
  }
  for (const [id, label] of COLORS) {
    commands.register({
      id: `annotate.colors.${id}`,
      label,
      checked: () => view.get().colors === id,
      run: () => {
        setView({ colors: id });
      },
    });
  }
  for (const [id, label] of NAMES) {
    commands.register({
      id: `annotate.names.${id}`,
      label,
      checked: () => view.get().names === id,
      run: () => {
        setView({ names: id });
      },
    });
  }

  // The gutter's menu, Annotate first, as IntelliJ's; Git → Current File, after Uncommitted Changes.
  menus.contribute({ menu: 'editor/gutter', item: { command: 'vcs.annotate' }, group: 'a' });
  menus.contribute({
    menu: 'main/git',
    item: { submenu: 'main/git/file', label: 'Current File' },
    group: 'b',
    order: 1,
  });
  menus.contribute({ menu: 'main/git/file', item: { command: 'vcs.annotate' } });
  // On an annotation, as IntelliJ's: Close Annotations, Show Diff, View, Copy Revision Number;
  // then (after Annotate Revision's group, not yet here) Options.
  const first = ['annotate.close', 'annotate.showDiff', 'view', 'annotate.copyRevision'];
  first.forEach((id, order) => {
    menus.contribute({
      menu: 'editor/annotation',
      item: id === 'view' ? { submenu: 'editor/annotation/view', label: 'View' } : { command: id },
      group: 'a',
      order,
    });
  });
  menus.contribute({
    menu: 'editor/annotation',
    item: { submenu: 'editor/annotation/options', label: 'Options' },
    group: 'c',
  });
  for (const option of OPTIONS) {
    menus.contribute({
      menu: 'editor/annotation/options',
      item: { command: `annotate.options.${option.id}` },
    });
  }
  for (const [id] of ASPECTS) {
    menus.contribute({
      menu: 'editor/annotation/view',
      item: { command: `annotate.aspect.${id}` },
      group: 'a',
    });
  }
  menus.contribute({
    menu: 'editor/annotation/view',
    item: { submenu: 'editor/annotation/colors', label: 'Colors' },
    group: 'b',
  });
  menus.contribute({
    menu: 'editor/annotation/view',
    item: { submenu: 'editor/annotation/names', label: 'Names' },
    group: 'b',
  });
  for (const [id] of COLORS) {
    menus.contribute({
      menu: 'editor/annotation/colors',
      item: { command: `annotate.colors.${id}` },
    });
  }
  for (const [id] of NAMES) {
    menus.contribute({
      menu: 'editor/annotation/names',
      item: { command: `annotate.names.${id}` },
    });
  }
}
