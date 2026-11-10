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
import { useProjects, workspace } from '../src/environments.js';
import { notifications } from '../src/notifications.js';
import { closeAll, FakeHost, menuItems, project } from './fakes.js';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 9, 12).getTime();

const ada = {
  hash: 'a'.repeat(40),
  author: 'Ada Lovelace',
  email: 'ada@x.org',
  time: NOW - 1000,
  message: 'Newest\n\nWith a body.',
};
const bob = { hash: 'b'.repeat(40), author: 'Bob', email: '', time: NOW - DAY, message: 'Older' };
const cy = {
  hash: 'c'.repeat(40),
  author: 'Cy Young',
  email: 'cy@x.org',
  time: new Date(2026, 0, 2).getTime(),
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
  const menu = () => undefined;

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
    expect(shown.menu).toBe(menu);
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
      JSON.stringify({ aspects: { revision: true, date: 'x' }, colors: 'author', names: 'nope' }),
    );
    expect(readView()).toEqual({
      aspects: { revision: true, date: true, author: true },
      colors: 'author',
      names: 'lastname',
    });
    localStorage.setItem('cerebro.annotate.view', '{');
    expect(readView()).toEqual(VIEW);
  });
});

describe('Annotate with Git Blame', () => {
  const host = new FakeHost({ 'git.blame': () => BLAME });
  const commands = new CommandRegistry();
  const menus = new MenuRegistry();
  const services: MenuServices = { commands, menus, keymap: new Keymap('other') };
  let tab: string | undefined = '/r/a.ts';

  beforeAll(() => {
    useProjects([project('/r', host), project('/s', undefined)]);
    setupBlame(services, { activeTab: () => tab });
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

  it('shows the file’s annotations, asked of git with its text, until closed', async () => {
    expect(annotationFor('/r/a.ts')).toBeUndefined();
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    expect(annotate('vcs.annotate')?.checked?.({ file: '/r/a.ts' })).toBe(true);
    const shown = await annotationFor('/r/a.ts')?.('the text');
    expect(host.params('git.blame')).toEqual([{ path: '/r', file: 'a.ts', contents: 'the text' }]);
    expect(shown?.lines[0]?.texts).toEqual([formatPrettyDate(ada.time), 'Lovelace']);
    // From the main menu, the active editor's: closes them.
    annotate('vcs.annotate')?.run(undefined);
    expect(annotationFor('/r/a.ts')).toBeUndefined();
  });

  it('has a menu on an annotation: Close Annotations, View, Copy Revision Number', async () => {
    annotate('vcs.annotate')?.run({ file: '/r/a.ts' });
    const shown = await annotationFor('/r/a.ts')?.('text');
    shown?.menu(2, new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }));
    expect(await menuItems()).toEqual(['Close Annotations', 'View', 'Copy Revision Number']);
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
