import type { EditorArea } from '@cerebro-ide/layout';
import type { Mark } from '@cerebro-ide/ui-editor';
import { effect } from '@cerebro-ide/reactive';
import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { documentFor } from '../src/documents.js';
import { useProjects, workspace } from '../src/environments.js';
import {
  carets,
  focusing,
  history,
  recentTabs,
  reveals,
  setupNavigation,
  tops,
  type Asked,
} from '../src/navigation.js';
import { closeAll, FakeHost, popupItems, project } from './fakes.js';

const at = (path: string, line: number, extra: object = {}) => ({
  path,
  line,
  column: 2,
  ...extra,
});
/** What the language server and the index answer, by method; a method missing fails. */
let answers: Record<string, unknown> = {};
const host = new FakeHost(
  new Proxy(
    {},
    {
      get: (_, method: string) =>
        method in answers
          ? () => {
              const answer = answers[method];
              if (answer instanceof Error) throw answer;
              return answer;
            }
          : method === 'fs.read'
            ? () => ({ text: 'text' })
            : undefined,
    },
  ),
);
const asked: Asked = { path: '/r/a.ts', text: 'const a = b;', line: 0, column: 10 };

const editor = (): EditorArea => (workspace.active as NonNullable<typeof workspace.active>).editor;
let nav: ReturnType<typeof setupNavigation>;

beforeAll(() => {
  // Recent Files and the edited ones as an earlier run kept them, one unreadable.
  localStorage.setItem('cerebro.recent:/r', JSON.stringify([{ id: '/r/old.ts', title: 'old.ts' }]));
  localStorage.setItem('cerebro.recentEdited:/r', '{unreadable');
  useProjects([project('/r', host), project('/s', undefined)]);
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
  nav = setupNavigation(editor);
});

afterEach(async () => {
  await closeAll();
  answers = {};
  host.asked.length = 0;
  workspace.activate('/r');
  vi.restoreAllMocks();
});

const labels = async () => {
  const items = await popupItems();
  const groups = [...document.querySelectorAll('.cerebro-popup__group')].map((g) => g.textContent);
  const details = [...document.querySelectorAll('.cerebro-popup-item__detail')].map(
    (d) => d.textContent,
  );
  return { items, groups, details };
};
const title = () => document.querySelector('.cerebro-popup__search')?.getAttribute('aria-label');

describe('each environment’s Recent Files', () => {
  it('start from what the last run kept, and are kept as they change', async () => {
    const recent = recentTabs();
    expect(recent?.tabs.map((t) => t.id)).toEqual(['/r/old.ts']);
    expect(recent?.edited).toEqual([]);
    nav.open({ id: '/r/new.ts', title: 'new.ts' });
    expect(recent?.tabs.map((t) => t.id)).toEqual(['/r/new.ts', '/r/old.ts']);
    await expect
      .poll(() => JSON.parse(localStorage.getItem('cerebro.recent:/r') as string) as unknown[])
      .toHaveLength(2);
    // Still followed when they can't be kept.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    nav.open({ id: '/r/third.ts', title: 'third.ts' });
    expect(recent?.tabs[0]?.id).toBe('/r/third.ts');
  });

  it('list a file edited first among the edited, in its environment, or the active one', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    workspace.activate('/r');
    const edit = async (path: string) => {
      const doc = (await documentFor(path, () => 'sample')) as EditorDocument;
      doc.edit([{ from: 0, to: 0, insert: 'x' }]);
    };
    await edit('/r/a.ts');
    expect(recentTabs()?.edited).toEqual([{ id: '/r/a.ts', title: 'a.ts' }]);
    await edit('src/sample.ts');
    expect(recentTabs()?.edited[0]).toEqual({ id: 'src/sample.ts', title: 'sample.ts' });
    workspace.activate('/s');
    expect(recentTabs()?.edited).toEqual([]);
    workspace.close('/s');
  });
});

describe('a jump to a place', () => {
  it('reads an open file again first, so the place is in what’s changed on disk since', async () => {
    answers['fs.read'] = { text: 'old' };
    const doc = (await documentFor('/r/changed.ts', () => 'sample')) as EditorDocument;
    // Changed outside Cerebro: a diff read from disk names a line the editor doesn't have yet.
    answers['fs.read'] = { text: 'one\ntwo\nthree' };
    const seen: string[] = [];
    const watching = effect(() => {
      if (reveals.get('/r/changed.ts')) seen.push(doc.text.peek().toString());
      return undefined;
    });
    nav.openAt(at('/r/changed.ts', 2));
    expect(reveals.has('/r/changed.ts')).toBe(false);
    await expect.poll(() => seen).toEqual(['one\ntwo\nthree']);
    expect(reveals.get('/r/changed.ts')).toEqual({ line: 2, column: 2 });
    watching.dispose();
    delete answers['fs.read'];
  });
});

describe('Back and Forward', () => {
  it('return to the places left, where the caret and the view were', () => {
    nav.open({ id: '/r/one.ts', title: 'one.ts' });
    carets.set('/r/one.ts', { line: 4, column: 1 });
    tops.set('/r/one.ts', 2);
    nav.openAt(at('/r/two.ts', 7));
    expect(reveals.get('/r/two.ts')).toEqual({ line: 7, column: 2 });
    // A jump within the file is a place left too.
    carets.set('/r/two.ts', { line: 7, column: 2 });
    nav.openAt(at('/r/two.ts', 9));
    history()?.goBack();
    expect(reveals.get('/r/two.ts')).toEqual({ line: 7, column: 2, top: undefined });
    history()?.goBack();
    expect(editor().activeGroup.active).toBe('/r/one.ts');
    expect(reveals.get('/r/one.ts')).toEqual({ line: 4, column: 1, top: 2 });
    // A tab without a caret (a diff) has none to put back.
    nav.open({ id: 'diff:x', title: 'x' });
    reveals.delete('/r/one.ts');
    nav.open({ id: '/r/one.ts', title: 'one.ts' });
    history()?.goBack();
    expect(editor().activeGroup.active).toBe('diff:x');
    expect(reveals.has('diff:x')).toBe(false);
  });

  it('are none without an environment', () => {
    workspace.close('/r');
    try {
      expect([history(), recentTabs(), nav.available()]).toEqual([undefined, undefined, false]);
    } finally {
      workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    }
  });
});

describe('opening a file', () => {
  it('focuses its editor, each time asked', () => {
    nav.open({ id: '/r/f.ts', title: 'f.ts' });
    const first = focusing.get('/r/f.ts');
    nav.open({ id: '/r/f.ts', title: 'f.ts' });
    expect(focusing.get('/r/f.ts')).not.toBe(first);
  });

  it('starts its language server, if it has one, in the app', async () => {
    expect(nav.available()).toBe(true);
    answers = { 'lsp.open': null };
    nav.opened('/r/a.ts', 'text');
    await expect
      .poll(() => host.params('lsp.open'))
      .toEqual([{ worktree: '/r', path: '/r/a.ts', text: 'text' }]);
    answers = {};
    nav.opened('/r/a.ts', 'text');
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    nav.opened('/s/a.ts', 'text');
    expect(host.params('lsp.open')).toHaveLength(2);
    workspace.close('/s');
  });
});

describe('what a language server says of a file', () => {
  it('is its answer, or none where it has none or fails', async () => {
    answers = {
      'lsp.highlights': [{ from: 0, to: 1, kind: 'read' }],
      'lsp.markers': [{ line: 0 }],
      'lsp.folds': [{ from: { line: 0, column: 1 }, to: { line: 2, column: 0 } }],
      'lsp.problems': [{ message: 'no' }],
      'lsp.completions': { incomplete: false, items: [{ label: 'a' }] },
      'lsp.hover': { text: 'Counts.' },
      'lsp.completionEdits': [{ text: 'import a;\n' }],
    };
    expect(await nav.usages(asked)).toEqual([{ from: 0, to: 1, kind: 'read' }]);
    expect(await nav.completions(asked)).toEqual({ incomplete: false, items: [{ label: 'a' }] });
    expect(await nav.documentation(asked)).toEqual({ text: 'Counts.' });
    expect(host.params('lsp.hover')).toEqual([{ worktree: '/r', ...asked }]);
    expect(await nav.completionEdits('/r/a.ts', { label: 'a', resolve: { data: 1 } })).toEqual([
      { text: 'import a;\n' },
    ]);
    expect(host.params('lsp.completions')).toEqual([{ worktree: '/r', ...asked }]);
    // Asked with the server's own item.
    expect(host.params('lsp.completionEdits')).toEqual([
      { worktree: '/r', path: '/r/a.ts', item: { data: 1 } },
    ]);
    expect(await nav.markers('/r/a.ts', 'text')).toEqual([{ line: 0 }]);
    expect(await nav.folds('/r/a.ts', 'text')).toEqual([
      { from: { line: 0, column: 1 }, to: { line: 2, column: 0 } },
    ]);
    expect(host.params('lsp.folds')).toEqual([{ worktree: '/r', path: '/r/a.ts', text: 'text' }]);
    expect(await nav.problems('/r/a.ts', 'text')).toEqual([{ message: 'no' }]);
    expect(host.params('lsp.highlights')).toEqual([{ worktree: '/r', ...asked }]);
    expect(host.params('lsp.markers')).toEqual([{ worktree: '/r', path: '/r/a.ts', text: 'text' }]);
    answers = {};
    expect(await nav.usages(asked)).toBeNull();
    expect(await nav.completions(asked)).toBeNull();
    expect(await nav.documentation(asked)).toBeNull();
    expect(await nav.completionEdits('/r/a.ts', { label: 'a' })).toBeNull();
    expect(await nav.markers('/r/a.ts', 'text')).toBeNull();
    expect(await nav.folds('/r/a.ts', 'text')).toBeNull();
    expect(await nav.problems('/r/a.ts', 'text')).toBeNull();
  });

  it('is none outside the app', async () => {
    workspace.openOrActivate({ id: '/s', name: 's', branch: 'main' });
    expect(await nav.usages(asked)).toBeNull();
    expect(await nav.completionEdits('/s/a.ts', { label: 'a' })).toBeNull();
    expect(await nav.markers('/s/a.ts', 'text')).toBeNull();
    expect(await nav.folds('/s/a.ts', 'text')).toBeNull();
    expect(await nav.problems('/s/a.ts', 'text')).toBeNull();
    expect(await nav.hasDefinition('a', asked)).toBe(false);
    workspace.close('/s');
    workspace.close('/r');
    try {
      expect(await nav.usages(asked)).toBeNull();
      expect(await nav.completionEdits('/r/a.ts', { label: 'a' })).toBeNull();
      expect(await nav.markers('/r/a.ts', 'text')).toBeNull();
      expect(await nav.folds('/r/a.ts', 'text')).toBeNull();
      expect(await nav.problems('/r/a.ts', 'text')).toBeNull();
      nav.opened('/r/a.ts', 'text');
      expect(host.asked).toEqual([]);
    } finally {
      workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    }
  });
});

describe('a gutter marker', () => {
  const mark = (targets: object[]): Mark =>
    ({ line: 0, kind: 'implemented', name: 'Shape', targets }) as unknown as Mark;

  it('goes to its one place', async () => {
    await nav.goToMarked(mark([at('/r/circle.ts', 3)]));
    expect(editor().activeGroup.active).toBe('/r/circle.ts');
  });

  it('offers its places, as IntelliJ’s list, and goes to the one chosen', async () => {
    const done = nav.goToMarked(mark([at('/r/circle.ts', 3), at('/elsewhere/square.ts', 5)]));
    expect(await labels()).toEqual({
      items: ['circle.ts', 'square.ts'],
      groups: [],
      details: ['circle.ts:4', '/elsewhere/square.ts:6'],
    });
    expect(title()).toBe('Implementations of Shape');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await done;
    expect(editor().activeGroup.active).toBe('/elsewhere/square.ts');
    expect(reveals.get('/elsewhere/square.ts')).toEqual({ line: 5, column: 2 });
  });
});

describe('Go to Definition', () => {
  it('is there where the language server, or else the index, has a definition', async () => {
    answers = { 'lsp.definitions': [at('/r/a.ts', 1)] };
    expect(await nav.hasDefinition('a', asked)).toBe(true);
    answers = { 'lsp.definitions': [] };
    expect(await nav.hasDefinition('a', asked)).toBe(false);
    answers = { 'index.definitions': [at('/r/a.ts', 1)] };
    expect(await nav.hasDefinition('a', asked)).toBe(true);
    expect(host.params('index.definitions')).toEqual([{ worktree: '/r', name: 'a' }]);
    answers = {};
    expect(await nav.hasDefinition('a', asked)).toBe(false);
  });

  it('goes to the language server’s one definition, or offers several', async () => {
    answers = { 'lsp.definitions': [at('/r/def.ts', 1)] };
    await nav.goToDefinition('a', asked);
    expect(editor().activeGroup.active).toBe('/r/def.ts');
    answers = { 'lsp.definitions': [at('/r/d1.ts', 1), at('/r/d2.ts', 2, { kind: 'function' })] };
    const done = nav.goToDefinition('a', asked);
    expect(await labels()).toEqual({
      items: ['a', 'a'],
      groups: [],
      details: ['d1.ts:2', 'd2.ts:3'],
    });
    expect(title()).toBe('Definitions of a');
    expect(document.querySelector('.cerebro-popup-item__shortcut')?.textContent).toBe('');
    await userEvent.keyboard('{Escape}');
    await done;
    expect(editor().activeGroup.active).toBe('/r/def.ts');
  });

  it('goes by name, as the index matches it, without a language server', async () => {
    answers = { 'index.definitions': [at('/r/byname.ts', 1)] };
    await nav.goToDefinition('a');
    expect(editor().activeGroup.active).toBe('/r/byname.ts');
    answers = {
      'lsp.definitions': null,
      'index.definitions': [at('/r/n1.ts', 1, { name: 'aa', kind: 'class' }), at('/r/n2.ts', 2)],
    };
    const done = nav.goToDefinition('a', asked);
    expect(await labels()).toEqual({
      items: ['aa', 'a'],
      groups: ['Name matches'],
      details: ['n1.ts:2', 'n2.ts:3'],
    });
    expect(document.querySelector('.cerebro-popup-item__shortcut')?.textContent).toBe('class');
    await userEvent.keyboard('{Escape}');
    await done;
    answers = { 'index.definitions': [] };
    const none = nav.goToDefinition('zz');
    await popupItems();
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe(
      'No definition named zz',
    );
    await userEvent.keyboard('{Escape}');
    await none;
  });

  it('shows the usages on a declaration, as IntelliJ’s, its definition being where the caret is', async () => {
    // The caret at `b` (column 10): a definition starting there is the declaration itself.
    answers = {
      'lsp.definitions': [at('/r/a.ts', 0, { column: 10 })],
      'lsp.usages': [at('/r/src/u1.ts', 1)],
    };
    let done = nav.goToDefinition('b', asked);
    expect(await labels()).toEqual({ items: ['u1.ts'], groups: [], details: ['src/u1.ts:2'] });
    expect(title()).toBe('Usages of b');
    expect(host.params('lsp.usages')).toEqual([{ worktree: '/r', ...asked }]);
    await userEvent.keyboard('{Escape}');
    await done;
    // Anywhere in the word: the caret at its end.
    answers = { ...answers, 'lsp.definitions': [at('/r/a.ts', 0, { column: 9 })] };
    done = nav.goToDefinition('b', asked);
    await expect.poll(title).toBe('Usages of b');
    await userEvent.keyboard('{Escape}');
    await done;
    // The index's name matches, without a server: the same.
    answers = {
      'lsp.definitions': null,
      'index.definitions': [at('/r/a.ts', 0, { column: 10 })],
      'index.usages': [at('/r/u2.ts', 4)],
    };
    done = nav.goToDefinition('b', asked);
    expect(await labels()).toEqual({
      items: ['u2.ts'],
      groups: ['Name matches'],
      details: ['u2.ts:5'],
    });
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('goes to the definition from anywhere else, and lists several with the declaration among them', async () => {
    const elsewhere = [
      // Another file; another line; before the word; after it.
      at('/r/b.ts', 0, { column: 10 }),
      at('/r/a.ts', 1, { column: 10 }),
      at('/r/a.ts', 0, { column: 8 }),
      at('/r/a.ts', 0, { column: 11 }),
    ];
    for (const place of elsewhere) {
      answers = { 'lsp.definitions': [place] };
      await nav.goToDefinition('b', asked);
      expect(host.params('lsp.usages')).toEqual([]);
    }
    expect(editor().activeGroup.active).toBe('/r/a.ts');
    answers = { 'lsp.definitions': [at('/r/a.ts', 0, { column: 10 }), at('/r/b.ts', 3)] };
    const done = nav.goToDefinition('b', asked);
    await expect.poll(title).toBe('Definitions of b');
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('finds no definitions without an environment', async () => {
    workspace.close('/r');
    try {
      const done = nav.goToDefinition('a');
      await popupItems();
      expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe(
        'No definition named a',
      );
      await userEvent.keyboard('{Escape}');
      await done;
    } finally {
      workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
    }
  });
});

describe('Go to Implementation and Go to Type Declaration', () => {
  it('go to the language server’s one place', async () => {
    answers = { 'lsp.implementations': [at('/r/impl.ts', 1)] };
    await nav.goToImplementation('a', asked);
    expect(editor().activeGroup.active).toBe('/r/impl.ts');
    expect(host.params('lsp.implementations')).toEqual([{ worktree: '/r', ...asked }]);
    answers = { 'lsp.typeDefinitions': [at('/r/type.ts', 1)] };
    await nav.goToTypeDeclaration('a', asked);
    expect(editor().activeGroup.active).toBe('/r/type.ts');
  });

  it('offer several, as IntelliJ’s lists', async () => {
    answers = { 'lsp.implementations': [at('/r/i1.ts', 1), at('/r/i2.ts', 2)] };
    let done = nav.goToImplementation('a', asked);
    expect(await labels()).toEqual({
      items: ['i1.ts', 'i2.ts'],
      groups: [],
      details: ['i1.ts:2', 'i2.ts:3'],
    });
    expect(title()).toBe('Choose Implementation of a (2 found)');
    await userEvent.keyboard('{Enter}');
    await done;
    expect(editor().activeGroup.active).toBe('/r/i1.ts');
    answers = { 'lsp.typeDefinitions': [at('/r/t1.ts', 1), at('/r/t2.ts', 2)] };
    done = nav.goToTypeDeclaration('a', asked);
    expect((await labels()).items).toEqual(['t1.ts', 't2.ts']);
    expect(title()).toBe('Choose Type');
    await userEvent.keyboard('{Escape}');
    await done;
  });

  it('say there are no implementations, as IntelliJ, and go nowhere with no type', async () => {
    answers = { 'lsp.implementations': null };
    const done = nav.goToImplementation('a', asked);
    await popupItems();
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe(
      'No implementations found',
    );
    await userEvent.keyboard('{Escape}');
    await done;
    answers = { 'lsp.typeDefinitions': [] };
    const before = editor().activeGroup.active;
    await nav.goToTypeDeclaration('a', asked);
    expect(editor().activeGroup.active).toBe(before);
    expect(document.querySelector('.cerebro-popup')).toBeNull();
  });
});

describe('context actions', () => {
  const caret = () => {
    const place = document.createElement('div');
    place.style.cssText = 'position: fixed; left: 100px; top: 200px; width: 0; height: 20px;';
    document.body.append(place);
    return place;
  };
  const fix = {
    title: 'from lib import walk',
    edits: [
      { from: { line: 0, column: 0 }, to: { line: 0, column: 4 }, text: 'walk' },
      { from: { line: 0, column: 0 }, to: { line: 0, column: 0 }, text: 'from lib import walk\n' },
    ],
  };
  const ignore = {
    title: 'Add `# pyright: ignore`',
    edits: [{ from: { line: 0, column: 6 }, to: { line: 0, column: 6 }, text: '  # ignore' }],
  };

  it('lists the server’s below the caret, and makes the one chosen in the document', async () => {
    const doc = new EditorDocument('walk()\n');
    const here = { path: '/r/a.py', text: 'walk()\n', line: 0, column: 2 };
    answers = { 'lsp.contextActions': [fix, ignore] };
    const focused = focusing.get('/r/a.py');
    const place = caret();
    const done = nav.contextActions(here, place, doc);
    expect(await popupItems()).toEqual(['from lib import walk', 'Add `# pyright: ignore`']);
    expect(host.params('lsp.contextActions')).toEqual([{ worktree: '/r', ...here }]);
    const popup = document.querySelector('.cerebro-popup') as HTMLElement;
    expect(popup.getBoundingClientRect().top).toBeGreaterThanOrEqual(220);
    expect(popup.getBoundingClientRect().left).toBe(100);
    // Filtered as typed, as IntelliJ's list.
    await userEvent.keyboard('ignore');
    expect(await popupItems()).toEqual(['Add `# pyright: ignore`']);
    await userEvent.keyboard('{Backspace>6/}{Enter}');
    await done;
    expect(doc.content()).toBe('from lib import walk\nwalk()\n');
    // Undone as one edit.
    expect(doc.lastEdit?.before.toString()).toBe('walk()\n');
    // The editor has the focus again.
    expect(focusing.get('/r/a.py')).not.toBe(focused);
    place.remove();
  });

  it('makes none in text changed since, or when none is chosen', async () => {
    const doc = new EditorDocument('walk()\n');
    const here = { path: '/r/a.py', text: 'walk()\n', line: 0, column: 2 };
    answers = { 'lsp.contextActions': [fix] };
    const place = caret();
    let done = nav.contextActions(here, place, doc);
    await popupItems();
    doc.edit([{ from: 0, to: 0, insert: '#' }]);
    await userEvent.keyboard('{Enter}');
    await done;
    expect(doc.content()).toBe('#walk()\n');
    done = nav.contextActions({ ...here, text: '#walk()\n' }, place, doc);
    await popupItems();
    await userEvent.keyboard('{Escape}');
    await done;
    expect(doc.content()).toBe('#walk()\n');
    place.remove();
  });

  it('says there are none, as IntelliJ, with no server to ask', async () => {
    const doc = new EditorDocument('x');
    const place = caret();
    const done = nav.contextActions({ ...asked, text: 'x' }, place, doc);
    await vi.waitUntil(() => document.querySelector('.cerebro-popup__empty'));
    expect(document.querySelector('.cerebro-popup__empty')?.textContent).toBe(
      'No context actions available at this location',
    );
    await userEvent.keyboard('{Escape}');
    await done;
    place.remove();
  });
});

describe('Find Usages', () => {
  it('lists the language server’s usages, or else the index’s by name', async () => {
    answers = { 'lsp.usages': [at('/r/src/u1.ts', 1)] };
    let done = nav.findUsages('a', asked);
    expect(await labels()).toEqual({ items: ['u1.ts'], groups: [], details: ['src/u1.ts:2'] });
    expect(title()).toBe('Usages of a');
    await userEvent.keyboard('{Enter}');
    await done;
    expect(editor().activeGroup.active).toBe('/r/src/u1.ts');
    answers = { 'index.usages': [at('/r/u2.ts', 4)] };
    done = nav.findUsages('a');
    expect(await labels()).toEqual({
      items: ['u2.ts'],
      groups: ['Name matches'],
      details: ['u2.ts:5'],
    });
    await userEvent.keyboard('{Escape}');
    await done;
    expect(host.params('index.usages')).toEqual([{ worktree: '/r', name: 'a' }]);
  });
});
