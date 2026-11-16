import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { FileSymbol } from '../src/structure.js';
import { CommandRegistry, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import {
  compareIgnoringCase,
  FOLLOW_DELAY,
  OPTIONS_MENU,
  readStructureSettings,
  setupStructureView,
  StructureView,
  UPDATE_DELAY,
  VIEW_MENU,
  type StructureViewProps,
} from '../src/structure-view.js';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const symbol = (name: string, kind: string, line: number, children: FileSymbol[] = []) => ({
  name,
  kind,
  from: { line, column: 0 },
  to: { line, column: 9 },
  at: { line, column: 6 },
  children,
});

/** Mounts the window; with no caret, as with no editor. */
function mount(props: Omit<StructureViewProps, 'caret'> & Partial<StructureViewProps>) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(() => <StructureView caret={() => undefined} {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return container;
}

const rows = (container: Element) =>
  [...container.querySelectorAll('.playground-occurrences__name')].map((name) => name.textContent);

describe('the Structure tool window', () => {
  it('shows the active file’s symbols, read again as it changes', async () => {
    const file = signal<string | undefined>(undefined);
    const doc = new EditorDocument('class A {}\n');
    const symbols = vi.fn((_path: string, text: string) =>
      Promise.resolve(
        text.includes('b()')
          ? [symbol('A', 'class', 0, [symbol('b', 'method', 1)])]
          : [symbol('A', 'class', 0, [symbol('a', 'method', 1)])],
      ),
    );
    const container = mount({
      file: () => file.get(),
      document: () => Promise.resolve(doc),
      symbols,
      show: () => undefined,
    });
    expect(container.textContent).toBe('No structure');
    file.set('/r/a.ts');
    await expect.poll(() => rows(container)).toEqual(['A', 'a']);
    expect(symbols).toHaveBeenCalledWith('/r/a.ts', 'class A {}\n');
    doc.edit([{ from: 0, to: 0, insert: 'b() ' }]);
    await expect.poll(() => rows(container), { timeout: UPDATE_DELAY + 1000 }).toEqual(['A', 'b']);
  });

  it('says why there is no structure: no server, no symbols, or a file it can’t read', async () => {
    const file = signal<string | undefined>('/r/a.txt');
    const doc = new EditorDocument('text');
    const symbols = vi.fn(() => Promise.resolve<FileSymbol[] | null>(null));
    const container = mount({
      file: () => file.get(),
      document: (path) => Promise.resolve(path === '/r/gone.ts' ? { error: 'gone' } : doc),
      symbols,
      show: () => undefined,
    });
    await expect.poll(() => container.textContent).toBe('No structure');
    symbols.mockResolvedValue([]);
    file.set('/r/b.ts');
    await expect.poll(() => container.textContent).toBe('Structure is empty');
    file.set('/r/gone.ts');
    await expect.poll(() => container.textContent).toBe('No structure');
  });

  it('shows a selected symbol in the editor, and goes to it on Enter', async () => {
    const show = vi.fn();
    const container = mount({
      file: () => '/r/a.ts',
      document: () => Promise.resolve(new EditorDocument('class A {}')),
      symbols: () => Promise.resolve([symbol('A', 'class', 0, [symbol('a', 'method', 1)])]),
      show,
    });
    await expect.poll(() => rows(container)).toEqual(['A', 'a']);
    const a = container.querySelectorAll<HTMLElement>(
      '.playground-occurrences__name',
    )[1] as HTMLElement;
    await userEvent.click(a);
    await expect
      .poll(() => show.mock.calls)
      .toEqual([[{ path: '/r/a.ts', line: 1, column: 6 }, false]]);
    await userEvent.click(a);
    expect(show).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => show.mock.calls.at(-1))
      .toEqual([{ path: '/r/a.ts', line: 1, column: 6 }, true]);
  });

  it('keeps only the latest answer, and stops reading a file once it isn’t shown', async () => {
    const file = signal<string | undefined>('/r/a.ts');
    const doc = new EditorDocument('one');
    const answers: ((s: FileSymbol[]) => void)[] = [];
    const symbols = vi.fn(
      () =>
        new Promise<FileSymbol[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    let late: ((d: EditorDocument) => void) | undefined;
    const container = mount({
      file: () => file.get(),
      document: (path) =>
        path === '/r/late.ts'
          ? new Promise((resolve) => {
              late = resolve;
            })
          : Promise.resolve(doc),
      symbols,
      show: () => undefined,
    });
    await expect.poll(() => answers.length).toBe(1);
    doc.edit([{ from: 0, to: 3, insert: 'two' }]);
    await expect.poll(() => answers.length, { timeout: UPDATE_DELAY + 1000 }).toBe(2);
    answers[1]?.([symbol('two', 'function', 0)]);
    answers[0]?.([symbol('one', 'function', 0)]);
    await expect.poll(() => rows(container)).toEqual(['two']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows(container)).toEqual(['two']);
    // Another file: the first one's edits no longer ask.
    file.set('/r/late.ts');
    doc.edit([{ from: 0, to: 3, insert: 'six' }]);
    await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY + 100));
    expect(symbols).toHaveBeenCalledTimes(2);
    // A file shown no more before its document is read isn't read at all.
    file.set(undefined);
    late?.(new EditorDocument('late'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(symbols).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('No structure');
  });
});

describe('the Structure tool window’s menus', () => {
  const services: MenuServices = {
    commands: new CommandRegistry(),
    menus: new MenuRegistry(),
    keymap: new Keymap('other'),
  };
  setupStructureView(services);
  const { commands, menus } = services;
  const checked = (id: string) => commands.isChecked(id) === true;
  const found = [
    symbol('b', 'function', 0),
    {
      ...symbol('C', 'class', 2, [symbol('y', 'method', 3), symbol('X', 'method', 4)]),
      to: { line: 5, column: 1 },
    },
    symbol('a', 'function', 7),
  ];
  const mountFound = (props: Partial<StructureViewProps> = {}) =>
    mount({
      file: () => '/r/a.ts',
      document: () => Promise.resolve(new EditorDocument('text')),
      symbols: () => Promise.resolve(found),
      show: () => undefined,
      ...props,
    });

  it('hold IntelliJ’s items, in its words, with its defaults', () => {
    expect(menus.entries(VIEW_MENU)).toEqual([
      { heading: 'Sort' },
      { command: 'structure.sortAlphabetically' },
    ]);
    expect(menus.entries(OPTIONS_MENU).map((e) => ('command' in e ? e.command : e))).toEqual([
      'structure.expandAll',
      'structure.collapseAll',
      { separator: true },
      'structure.autoscrollToSource',
      'structure.autoscrollFromSource',
    ]);
    expect(
      [
        'structure.sortAlphabetically',
        'structure.autoscrollToSource',
        'structure.autoscrollFromSource',
      ].map((id) => [commands.get(id)?.label, checked(id)]),
    ).toEqual([
      ['Alphabetically', false],
      ['Navigate with Single Click', true],
      ['Always Select Opened Element', false],
    ]);
    // Nothing to expand without a tree.
    expect(commands.isEnabled('structure.expandAll')).toBe(false);
  });

  it('sorts the symbols by name, ignoring case, what’s expanded kept; kept in storage', async () => {
    const container = mountFound();
    await expect.poll(() => rows(container)).toEqual(['b', 'C', 'y', 'X', 'a']);
    commands.execute('structure.sortAlphabetically');
    await expect.poll(() => rows(container)).toEqual(['a', 'b', 'C', 'X', 'y']);
    expect(readStructureSettings().alphabetical).toBe(true);
    commands.execute('structure.sortAlphabetically');
    await expect.poll(() => rows(container)).toEqual(['b', 'C', 'y', 'X', 'a']);
    expect(readStructureSettings().alphabetical).toBe(false);
  });

  it('collapses and expands all', async () => {
    const container = mountFound();
    await expect.poll(() => rows(container)).toHaveLength(5);
    expect(commands.isEnabled('structure.collapseAll')).toBe(true);
    commands.execute('structure.collapseAll');
    await expect.poll(() => rows(container)).toEqual(['b', 'C', 'a']);
    commands.execute('structure.expandAll');
    await expect.poll(() => rows(container)).toHaveLength(5);
    cleanup?.();
    cleanup = undefined;
    expect(commands.isEnabled('structure.collapseAll')).toBe(false);
  });

  it('shows a selected symbol only with Navigate with Single Click', async () => {
    const show = vi.fn();
    const container = mountFound({ show });
    await expect.poll(() => rows(container)).toHaveLength(5);
    commands.execute('structure.autoscrollToSource');
    expect(readStructureSettings().toSource).toBe(false);
    const names = () => container.querySelectorAll<HTMLElement>('.playground-occurrences__name');
    await userEvent.click(names()[0] as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(show).not.toHaveBeenCalled();
    commands.execute('structure.autoscrollToSource');
    await userEvent.click(names()[4] as HTMLElement);
    await expect.poll(() => show.mock.calls.length).toBe(1);
  });

  it('selects the innermost symbol at the caret a second after it moves, with Always Select Opened Element', async () => {
    const show = vi.fn();
    const caret = signal<{ line: number; column: number } | undefined>({ line: 3, column: 2 });
    const container = mountFound({ show, caret: () => caret.get() });
    await expect.poll(() => rows(container)).toHaveLength(5);
    const selected = () =>
      container.querySelector('.cerebro-tree-row--selected .playground-occurrences__name')
        ?.textContent;
    // Off: not followed.
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_DELAY + 100));
    expect(selected()).toBeUndefined();
    commands.execute('structure.autoscrollFromSource');
    expect(readStructureSettings().fromSource).toBe(true);
    commands.execute('structure.collapseAll');
    caret.set({ line: 4, column: 3 });
    // Not at once: a second after.
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_DELAY / 2));
    expect(selected()).toBeUndefined();
    // Its class opened to it; not shown in the editor, where the caret already is.
    await expect.poll(selected, { timeout: FOLLOW_DELAY + 1000 }).toBe('X');
    expect(rows(container)).toHaveLength(5);
    // Within the class, not a member: the class. Outside every symbol: the selection stays.
    caret.set({ line: 5, column: 0 });
    await expect.poll(selected, { timeout: FOLLOW_DELAY + 1000 }).toBe('C');
    caret.set({ line: 6, column: 0 });
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_DELAY + 100));
    expect(selected()).toBe('C');
    expect(show).not.toHaveBeenCalled();
    // No editor: nothing to follow.
    caret.set(undefined);
    commands.execute('structure.autoscrollFromSource');
  });
});

describe('compareIgnoringCase', () => {
  it('compares as Java’s compareToIgnoreCase, not by the locale', () => {
    expect(['b', 'C', 'a', 'Z'].sort(compareIgnoringCase)).toEqual(['a', 'b', 'C', 'Z']);
    // By the characters' codes: é after f, where the locale puts it before.
    expect(['f', 'é'].sort(compareIgnoringCase)).toEqual(['f', 'é']);
    expect(['f', 'é'].sort((a, b) => a.localeCompare(b))).toEqual(['é', 'f']);
    expect(compareIgnoringCase('A', 'a')).toBe(0);
  });
});

describe('readStructureSettings', () => {
  it('starts with IntelliJ’s defaults when nothing, or nothing readable, is kept', () => {
    localStorage.setItem('cerebro.structure', '{');
    expect(readStructureSettings()).toEqual({
      alphabetical: false,
      toSource: true,
      fromSource: false,
    });
    localStorage.removeItem('cerebro.structure');
    expect(readStructureSettings()).toEqual({
      alphabetical: false,
      toSource: true,
      fromSource: false,
    });
  });
});
