import { CommandRegistry, Keymap, MenuRegistry, displayText } from '@cerebro-ide/commands';
import { visibleEntries, type MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotationFor,
  formatPrettyDate,
  PALETTE,
  present,
  readView,
  setupBlame,
  shortenName,
  tooltipOf,
  type AnnotationView,
  type Blame,
} from '../src/blame.js';
import { revisionTab } from '../src/changes.js';
import { useProjects, workspace } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { readState } from '../src/repository-state.js';
import { closeAll, FakeHost, menuItem, menuItems, project } from './fakes.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 9, 12).getTime();

const ada = {
  hash: 'a'.repeat(40),
  author: 'Ada Lovelace',
  email: 'ada@x.org',
  time: NOW - 1000,
  committed: NOW - 1000,
  message: 'Newest\n\nWith a body.',
  previous: { hash: 'b'.repeat(40), path: 'a.ts' },
};
const bob = {
  hash: 'b'.repeat(40),
  author: 'Bob',
  email: '',
  time: NOW - DAY,
  // Committed later than written: Show Commit Timestamp's date.
  committed: NOW - 1000,
  message: 'Older',
};
const cy = {
  hash: 'c'.repeat(40),
  author: 'Cy Young',
  email: 'cy@x.org',
  time: new Date(2026, 0, 2).getTime(),
  committed: new Date(2026, 0, 2).getTime(),
  message: 'Oldest',
  path: 'old/a.ts',
};
const BLAME: Blame = {
  lines: [ada.hash, null, bob.hash, cy.hash, ada.hash],
  commits: [ada, bob, cy],
};

const VIEW: AnnotationView = {
  aspects: { revision: false, date: true, author: true },
  colors: 'order',
  names: 'lastname',
  ignoreWhitespace: true,
  movements: 'none',
  commitDate: false,
};

describe('names, as IntelliJ shortens them', () => {
  // IntelliJ's own cases (AnnotationShortNameTest): first, last, initials, full, email.
  const cases: [string, string, string, string, string, string][] = [
    [
      'Vasya Pavlovich Pupkin <asdasd@localhost>',
      'Vasya',
      'Pupkin',
      'VPP',
      'Vasya Pavlovich Pupkin',
      'asdasd@localhost',
    ],
    [
      'danah boyd <danah@datasociety.net>',
      'danah',
      'boyd',
      'DB',
      'danah boyd',
      'danah@datasociety.net',
    ],
    ['geohot <geohot@gmail.com>', 'geohot', 'geohot', 'G', 'geohot', 'geohot@gmail.com'],
    [
      'Vasya Pavlovich Pupkin',
      'Vasya',
      'Pupkin',
      'VPP',
      'Vasya Pavlovich Pupkin',
      'Vasya Pavlovich Pupkin',
    ],
    [
      'vasya.pupkin@localhost.com',
      'Vasya',
      'Pupkin',
      'VP',
      'vasya.pupkin@localhost.com',
      'vasya.pupkin@localhost.com',
    ],
    [
      'vasya-pavlovich-pupkin@localhost.com',
      'Vasya',
      'Pupkin',
      'VPP',
      'vasya-pavlovich-pupkin@localhost.com',
      'vasya-pavlovich-pupkin@localhost.com',
    ],
    ['vasya', 'vasya', 'vasya', 'V', 'vasya', 'vasya'],
    ['Vasya  Pupkin', 'Vasya', 'Pupkin', 'VP', 'Vasya Pupkin', 'Vasya Pupkin'],
    [
      'Catherine Zeta-Jones',
      'Catherine',
      'Zeta-Jones',
      'CZJ',
      'Catherine Zeta-Jones',
      'Catherine Zeta-Jones',
    ],
    ['vasya-pupkin', 'vasya-pupkin', 'vasya-pupkin', 'VP', 'vasya-pupkin', 'vasya-pupkin'],
    ['vasya.pupkin', 'vasya.pupkin', 'vasya.pupkin', 'VP', 'vasya.pupkin', 'vasya.pupkin'],
    [
      '<asdasd@localhost> Vasya Pupkin',
      'Vasya',
      'Pupkin',
      'VP',
      'Vasya Pupkin',
      'asdasd@localhost',
    ],
    [
      '<vasya.pupkin@localhost>',
      'Vasya',
      'Pupkin',
      'VP',
      'vasya.pupkin@localhost',
      'vasya.pupkin@localhost',
    ],
    ['pupkin <vasya@localhost>', 'pupkin', 'pupkin', 'P', 'pupkin', 'vasya@localhost'],
    ['@localhost', '@localhost', '@localhost', '@', '@localhost', '@localhost'],
    ['vasya <email>', 'vasya', '<email>', 'VE', 'vasya <email>', 'vasya <email>'],
    ['vasya <.email.>', 'vasya', '<.email.>', 'VE', 'vasya <.email.>', 'vasya <.email.>'],
    ['Vasya-TEST@localhost', 'Vasya', 'TEST', 'VT', 'Vasya-TEST@localhost', 'Vasya-TEST@localhost'],
  ];
  it.each(cases)('%s', (input, first, last, initials, full, email) => {
    expect(shortenName(input, 'firstname')).toBe(first);
    expect(shortenName(input, 'lastname')).toBe(last);
    expect(shortenName(input, 'initials')).toBe(initials);
    expect(shortenName(input, 'full')).toBe(full);
    expect(shortenName(input, 'email')).toBe(email);
  });

  it('gives back what has no name in it', () => {
    expect(shortenName('<x@y>', 'initials')).toBe('X');
    expect(shortenName(' ', 'lastname')).toBe('');
    // An email among words: from the space before it, as IntelliJ's.
    expect(shortenName('Vasya vasya@x.org Pupkin', 'email')).toBe(' vasya@x.org');
  });
});

describe('dates, as IntelliJ’s formatPrettyDate', () => {
  it('names today and yesterday, else gives the date', () => {
    expect(formatPrettyDate(NOW - 1000, NOW)).toBe('Today');
    expect(formatPrettyDate(NOW - DAY, NOW)).toBe('Yesterday');
    const older = new Date(2026, 0, 2).getTime();
    expect(formatPrettyDate(older, NOW)).toBe(
      new Date(older).toLocaleDateString(undefined, { dateStyle: 'short' }),
    );
  });
});

describe('a blame, as the gutter shows it', () => {
  const menu = { menu: () => undefined, click: () => undefined };

  it('gives each line the date and the author, IntelliJ’s defaults; none for lines changed since', () => {
    const shown = present(BLAME, VIEW, menu, NOW);
    const older = new Date(cy.time).toLocaleDateString(undefined, { dateStyle: 'short' });
    expect(shown.lines.map((l) => l?.texts.join(' | ') ?? null)).toEqual([
      'Today | Lovelace',
      null,
      'Yesterday | Bob',
      `${older} | Young`,
      'Today | Lovelace',
    ]);
    // The file's last commit, in the latest's colour.
    expect(shown.lines.map((l) => l?.latest ?? null)).toEqual([true, null, false, false, true]);
    expect(shown.menu).toBe(menu.menu);
    expect(shown.click).toBe(menu.click);
  });

  it('shows the columns asked for, in IntelliJ’s order, with names as asked', () => {
    const shown = present(
      BLAME,
      { ...VIEW, aspects: { revision: true, date: false, author: true }, names: 'initials' },
      menu,
      NOW,
    );
    expect(shown.lines[0]?.texts).toEqual(['aaaaaaaa', 'AL']);
  });

  it('colours by age, newest first, or by author, or not at all; never with one commit', () => {
    const byAge = present(BLAME, VIEW, menu, NOW);
    expect(byAge.lines.map((l) => l?.background ?? null)).toEqual([
      PALETTE[0],
      null,
      PALETTE[7],
      PALETTE[14],
      PALETTE[0],
    ]);
    // Authors sorted: Ada, Bob, Cy; the palette shuffled so neighbours differ.
    const byAuthor = present(BLAME, { ...VIEW, colors: 'author' }, menu, NOW);
    expect(byAuthor.lines.map((l) => l?.background ?? null)).toEqual([
      PALETTE[0],
      null,
      PALETTE[4],
      PALETTE[8],
      PALETTE[0],
    ]);
    const hidden = present(BLAME, { ...VIEW, colors: 'none' }, menu, NOW);
    expect(hidden.lines.some((l) => l?.background !== undefined)).toBe(false);
    const one = present({ lines: [ada.hash], commits: [ada] }, VIEW, menu, NOW);
    expect(one.lines[0]?.background).toBeUndefined();
  });

  it('is IntelliJ’s five colours with four between each two', () => {
    expect(PALETTE).toHaveLength(21);
    expect(PALETTE[0]).toBe('var(--cerebro-annotations-1)');
    expect(PALETTE[1]).toBe(
      'color-mix(in srgb, var(--cerebro-annotations-1) 80%, var(--cerebro-annotations-2))',
    );
    expect(PALETTE[20]).toBe('var(--cerebro-annotations-5)');
  });

  it('says in a line’s tooltip the commit, its author and date, where the file was, and its message', () => {
    const date = (time: number) =>
      new Date(time).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    const shown = present(BLAME, VIEW, menu, NOW);
    expect(shown.tooltip(0)).toBe(
      `commit ${ada.hash}\nAuthor: Ada Lovelace <ada@x.org>\nDate: ${date(ada.time)}\n\nNewest\n\nWith a body.`,
    );
    expect(tooltipOf(bob)).toBe(
      `commit ${bob.hash}\nAuthor: Bob\nDate: ${date(bob.time)}\n\nOlder`,
    );
    expect(shown.tooltip(3)).toContain('\nPath: old/a.ts\n');
    expect(shown.tooltip(1)).toBe('');
  });
});

describe('the view', () => {
  afterEach(() => {
    localStorage.removeItem('cerebro.annotate.view');
  });

  it('is IntelliJ’s defaults until changed, kept as changed; what can’t be read, the defaults', () => {
    expect(readView()).toEqual(VIEW);
    localStorage.setItem(
      'cerebro.annotate.view',
      JSON.stringify({
        aspects: { revision: true, date: 'x' },
        colors: 'author',
        names: 'nope',
        ignoreWhitespace: false,
        movements: 'far',
        commitDate: 1,
      }),
    );
    expect(readView()).toEqual({
      ...VIEW,
      aspects: { revision: true, date: true, author: true },
      colors: 'author',
      ignoreWhitespace: false,
    });
    localStorage.setItem('cerebro.annotate.view', '{');
    expect(readView()).toEqual(VIEW);
  });
});

describe('Annotate with Git Blame', () => {
  const host = new FakeHost({ 'git.blame': () => BLAME });
  const open = vi.fn();
  const showInLog = vi.fn();
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
  let tab: string | undefined = '/r/a.ts';

  beforeAll(() => {
    useProjects([project('/r', host), project('/s', undefined)]);
    setupBlame(services, { activeTab: () => tab, open, showInLog });
  });

  beforeEach(() => {
    workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    tab = '/r/a.ts';
  });

  afterEach(async () => {
    await closeAll();
    host.asked.length = 0;
    localStorage.removeItem('cerebro.annotate.view');
    vi.restoreAllMocks();
    // Each test starts with nothing annotated.
    if (annotationFor('/r/a.ts')) commands.get('vcs.annotate')?.run({ file: '/r/a.ts' });
  });

  const labels = (menu: string, context?: unknown) =>
    visibleEntries(services, menu, context).map((e) =>
      'command' in e ? displayText(e.label, e.dialog) : 'label' in e ? displayText(e.label) : '-',
    );
  const annotate = commands.get.bind(commands);

  it('is in the gutter’s menu and Git → Current File, for a file in a git worktree', () => {
    expect(labels('editor/gutter', { file: '/r/a.ts' })).toEqual(['Annotate with Git Blame']);
    expect(labels('main/git/file')).toEqual(['Annotate with Git Blame']);
    // Outside the worktree, or with no file: none.
    expect(labels('editor/gutter', { file: '/elsewhere/a.ts' })).toEqual([]);
    tab = undefined;
    expect(labels('main/git/file')).toEqual([]);
    // No host: none.
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(labels('editor/gutter', { file: '/s/a.ts' })).toEqual([]);
  });

  it('annotates a repository version, blamed at its commit, as IntelliJ’s AnnotateVcsVirtualFileAction', async () => {
    const version = revisionTab('src/a.ts', cy.hash).id;
    expect(labels('editor/gutter', { file: version })).toEqual(['Annotate with Git Blame']);
    annotate('vcs.annotate')?.run({ file: version });
    await annotationFor(version)?.('then');
    expect(host.params('git.blame').at(-1)).toEqual({
      path: '/r',
      file: 'src/a.ts',
      hash: cy.hash,
      ignoreWhitespace: true,
      movements: 'none',
    });
    annotate('vcs.annotate')?.run({ file: version });
    expect(annotationFor(version)).toBeUndefined();
  });

  it('shows the file’s annotations, asked of git with its text, until closed', async () => {
    expect(annotationFor('/r/a.ts')).toBeUndefined();
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    expect(annotate('vcs.annotate')?.checked?.({ file: '/r/a.ts' })).toBe(true);
    const shown = await annotationFor('/r/a.ts')?.('the text');
    expect(host.params('git.blame')).toEqual([
      { path: '/r', file: 'a.ts', contents: 'the text', ignoreWhitespace: true, movements: 'none' },
    ]);
    expect(shown?.lines[0]?.texts).toEqual([formatPrettyDate(ada.time), 'Lovelace']);
    // From the main menu, the active editor's: closes them.
    annotate('vcs.annotate')?.run(undefined);
    expect(annotationFor('/r/a.ts')).toBeUndefined();
  });

  it('has IntelliJ’s menu on an annotation: Close Annotations, Show Diff, View, Copy Revision Number, Annotate Revision, Annotate Previous Revision, Options', async () => {
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('text');
    shown?.menu(2, new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }));
    expect(await menuItems()).toEqual([
      'Close Annotations',
      'Show Diff',
      'View',
      'Copy Revision Number',
      'Annotate Revision',
      'Annotate Previous Revision',
      'Options',
    ]);
    expect(labels('editor/annotation')).toEqual([
      'Close Annotations',
      'Show Diff',
      'View',
      'Copy Revision Number',
      '-',
      'Annotate Revision',
      'Annotate Previous Revision',
      '-',
      'Options',
    ]);
    expect(labels('editor/annotation/options')).toEqual([
      'Ignore Whitespaces',
      'Detect Movements Within File',
      'Detect Movements Across Files',
      'Show Commit Timestamp',
    ]);
    await closeAll();
    expect(labels('editor/annotation/view')).toEqual([
      'Revision',
      'Date',
      'Author',
      '-',
      'Colors',
      'Names',
    ]);
    expect(labels('editor/annotation/colors')).toEqual(['Author', 'Order', 'Hide']);
    expect(labels('editor/annotation/names')).toEqual([
      'Initials',
      'Last Name',
      'First Name',
      'Full Name',
      'Email',
    ]);
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    annotate('annotate.copyRevision')?.run({ file: '/r/a.ts', hash: bob.hash });
    expect(write).toHaveBeenCalledWith(bob.hash);
    annotate('annotate.close')?.run({ file: '/r/a.ts', hash: bob.hash });
    expect(annotationFor('/r/a.ts')).toBeUndefined();
  });

  it('shows a line’s commit in the Log on a click, the file as it was named then selected', async () => {
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('text');
    shown?.click(0);
    expect(showInLog).toHaveBeenLastCalledWith(ada.hash, 'a.ts');
    // Renamed since: its path in that commit.
    shown?.click(3);
    expect(showInLog).toHaveBeenLastCalledWith(cy.hash, 'old/a.ts');
  });

  it('shows the diff of a line’s commit to the file: from the commit before, or from nothing', async () => {
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('text');
    shown?.menu(0, new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }));
    await menuItems();
    menuItem('Show Diff').click();
    expect(open).toHaveBeenLastCalledWith({
      id: `diff@${bob.hash}..${ada.hash}:a.ts`,
      title: 'a.ts',
    });
    // Where the file was added: against the empty tree.
    annotate('annotate.showDiff')?.run({
      file: '/r/a.ts',
      hash: cy.hash,
      path: 'old/a.ts',
      commit: cy,
    });
    expect(open).toHaveBeenLastCalledWith({
      id: `diff@4b825dc642cb6eb9a060e54bf8d69288fbee4904..${cy.hash}:old/a.ts`,
      title: 'a.ts',
    });
  });

  it('annotates a line’s commit, or the one before, in a tab of its own, at the line carried into it', async () => {
    host.answers['git.fileAt'] = () => ({ text: 'zero\none\ntwo\n' });
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('one\ntwo\nthree\nfour\nfive\n');
    shown?.menu(0, new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }));
    await menuItems();
    menuItem('Annotate Revision').click();
    // Line 0, "one", is line 1 in that commit's file.
    const at = revisionTab('a.ts', ada.hash);
    await vi.waitFor(() => {
      expect(open).toHaveBeenLastCalledWith(at, 1);
    });
    expect(host.params('git.fileAt').at(-1)).toEqual({ path: '/r', hash: ada.hash, file: 'a.ts' });
    // Its annotations: the file at that commit, blamed.
    await annotationFor(at.id)?.('zero\none\ntwo\n');
    expect(host.params('git.blame').at(-1)).toEqual({
      path: '/r',
      file: 'a.ts',
      hash: ada.hash,
      ignoreWhitespace: true,
      movements: 'none',
    });
    annotate('annotate.close')?.run({ file: at.id });
    // The commit before that changed the file, at its path there; where it's not, the line as is.
    host.answers['git.fileAt'] = () => null;
    const context = { file: '/r/a.ts', worktree: '/r', line: 3, text: 'a\n' };
    await annotate('annotate.previousRevision')?.run({ ...context, commit: ada });
    expect(open).toHaveBeenLastCalledWith(revisionTab('a.ts', bob.hash), 3);
    annotate('annotate.close')?.run({ file: revisionTab('a.ts', bob.hash).id });
    // Where git can't say: likewise.
    delete host.answers['git.fileAt'];
    await annotate('annotate.revision')?.run({ ...context, hash: cy.hash, path: 'old/a.ts' });
    expect(open).toHaveBeenLastCalledWith(revisionTab('old/a.ts', cy.hash), 3);
    annotate('annotate.close')?.run({ file: revisionTab('old/a.ts', cy.hash).id });
    // Where the file was added, nothing before it: disabled.
    expect(annotate('annotate.previousRevision')?.enabled?.({ commit: cy })).toBe(false);
    expect(annotate('annotate.previousRevision')?.enabled?.({ commit: ada })).toBe(true);
    // Not in Find Action, which asks with no annotation; nor are the annotation's other commands.
    for (const id of [
      'annotate.revision',
      'annotate.previousRevision',
      'annotate.close',
      'annotate.showDiff',
      'annotate.copyRevision',
    ]) {
      expect(commands.isEnabled(id)).toBe(false);
    }
  });

  it('close when the file’s last commit moves, as the repository’s refs change, as IntelliJ’s', async () => {
    let base = 'base1';
    let refs = 'refs1';
    host.answers['git.lastCommit'] = () => base;
    host.answers['git.state'] = () => ({ conflicts: false, refs });
    await readState('/r');
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    await annotationFor('/r/a.ts')?.('text');
    expect(host.params('git.lastCommit')).toEqual([{ path: '/r', file: 'a.ts' }]);
    // The refs change, the file's last commit doesn't (a commit of another file): still annotated.
    refs = 'refs2';
    await readState('/r');
    await vi.waitFor(() => {
      expect(host.params('git.lastCommit')).toHaveLength(2);
    });
    expect(annotationFor('/r/a.ts')).toBeDefined();
    // It moves: closed.
    base = 'base2';
    refs = 'refs3';
    await readState('/r');
    await vi.waitFor(() => {
      expect(annotationFor('/r/a.ts')).toBeUndefined();
    });
    // Annotated again, the new base; a file no commit has (none) never closes, nor one unread.
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    await annotationFor('/r/a.ts')?.('text');
    base = 'base3';
    refs = 'refs4';
    await readState('/r');
    await vi.waitFor(() => {
      expect(annotationFor('/r/a.ts')).toBeUndefined();
    });
    host.answers['git.lastCommit'] = () => null;
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    await annotationFor('/r/a.ts')?.('text');
    host.answers['git.lastCommit'] = () => 'base4';
    refs = 'refs5';
    await readState('/r');
    expect(annotationFor('/r/a.ts')).toBeDefined();
    // Where git can't say, it says why, and it stays.
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    host.answers['git.lastCommit'] = () => 'base5';
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    await annotationFor('/r/a.ts')?.('text');
    delete host.answers['git.lastCommit'];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    refs = 'refs6';
    await readState('/r');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith('Reading an annotation’s base failed', expect.any(Error));
    });
    expect(annotationFor('/r/a.ts')).toBeDefined();
    delete host.answers['git.state'];
  });

  it('has IntelliJ’s Options, kept with the view, asked of git and shown', async () => {
    const checked = () =>
      ['ignoreWhitespace', 'movementsWithin', 'movementsAcross', 'commitDate'].map((id) =>
        annotate(`annotate.options.${id}`)?.checked?.(undefined),
      );
    const run = (id: string) => annotate(`annotate.options.${id}`)?.run(undefined);
    // IntelliJ's defaults: whitespace ignored, nothing else.
    expect(checked()).toEqual([true, false, false, false]);
    run('ignoreWhitespace');
    // Across files checks within too; within off turns both off; across off leaves within on.
    run('movementsAcross');
    expect(checked()).toEqual([false, true, true, false]);
    run('movementsAcross');
    expect(checked()).toEqual([false, true, false, false]);
    run('movementsAcross');
    run('movementsWithin');
    expect(checked()).toEqual([false, false, false, false]);
    run('movementsWithin');
    run('commitDate');
    expect(checked()).toEqual([false, true, false, true]);
    expect(readView()).toMatchObject({
      ignoreWhitespace: false,
      movements: 'within',
      commitDate: true,
    });
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('text');
    expect(host.params('git.blame').at(-1)).toMatchObject({
      ignoreWhitespace: false,
      movements: 'within',
    });
    // Bob's line, by when it was committed.
    expect(shown?.lines[2]?.texts[0]).toBe(formatPrettyDate(bob.committed));
    // Put back.
    run('ignoreWhitespace');
    run('movementsWithin');
    run('commitDate');
  });

  it('changes and keeps the view: the columns, the colours and the names', async () => {
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const before = annotationFor('/r/a.ts');
    annotate('annotate.aspect.revision')?.run(undefined);
    annotate('annotate.colors.none')?.run(undefined);
    annotate('annotate.names.email')?.run(undefined);
    expect(annotate('annotate.aspect.revision')?.checked?.(undefined)).toBe(true);
    expect(annotate('annotate.colors.none')?.checked?.(undefined)).toBe(true);
    expect(annotate('annotate.names.email')?.checked?.(undefined)).toBe(true);
    expect(annotate('annotate.names.lastname')?.checked?.(undefined)).toBe(false);
    // Asked again, in the view as it is now.
    const after = annotationFor('/r/a.ts');
    expect(after).not.toBe(before);
    const shown = await after?.('text');
    expect(shown?.lines[0]).toEqual({
      texts: ['aaaaaaaa', formatPrettyDate(ada.time), 'ada@x.org'],
      latest: true,
    });
    expect(readView()).toEqual({
      ...VIEW,
      aspects: { revision: true, date: true, author: true },
      colors: 'none',
      names: 'email',
    });
    // Put back.
    annotate('annotate.aspect.revision')?.run(undefined);
    annotate('annotate.colors.order')?.run(undefined);
    annotate('annotate.names.lastname')?.run(undefined);
  });

  it('says why it couldn’t, and closes', async () => {
    host.answers['git.blame'] = () => {
      throw new Error("fatal: no such path 'a.ts' in HEAD");
    };
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    expect(await annotationFor('/r/a.ts')?.('text')).toBeUndefined();
    expect(notifications.all.get(0)).toMatchObject({
      title: 'Cannot load annotations',
      content: "fatal: no such path 'a.ts' in HEAD",
      type: 'error',
    });
    expect(annotationFor('/r/a.ts')).toBeUndefined();
    host.answers['git.blame'] = () => BLAME;
  });

  it('keeps the view when the browser’s storage can’t', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    annotate('annotate.colors.author')?.run(undefined);
    expect(annotate('annotate.colors.author')?.checked?.(undefined)).toBe(true);
    vi.restoreAllMocks();
    annotate('annotate.colors.order')?.run(undefined);
  });
});
