import { CommandRegistry, KeyDispatcher, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import type { Problem } from '@cerebro-ide/ui-editor';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  askProblems,
  compareProblems,
  fileProblems,
  hasErrors,
  hasErrorsBeneath,
  ProblemsView,
  readViewOptions,
  setupProblems,
} from '../src/problems.js';
import { documentFor } from '../src/documents.js';
import { useProjects, workspace } from '../src/environments.js';
import type { EditorDocument } from '@cerebro-ide/ui-editor';
import { closeAll, FakeHost, menuItem, menuItems, project } from './fakes.js';

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };
const opened: { path: string; line: number; column: number }[] = [];
const file = signal<string | undefined>(undefined);
const vertical = signal(false);
let dispose: (() => void) | undefined;
/** What the preview asked its file's server: the path, and the text. */
const asked: [string, string][] = [];
/** The files the preview reads. */
const TEXT = Array.from({ length: 12 }, (_, i) => `line ${String(i)}`).join('\n') + '\n';
const host = new FakeHost({
  'fs.read': () => ({ text: TEXT }),
});

beforeAll(() => {
  // The Commit window's Jump to Source has F4 too: the one enabled runs.
  commands.register({
    id: 'changes.jumpToSource',
    label: 'Jump',
    enabled: () => false,
    run: () => undefined,
  });
  keymap.bindDefault('F4', 'changes.jumpToSource');
  setupProblems(services, { openAt: (at) => void opened.push(at) });
  useProjects([project('/r', host)]);
  workspace.openOrActivate({ id: '/r', name: 'r', branch: 'main' });
});

afterEach(async () => {
  await closeAll();
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  opened.length = 0;
  asked.length = 0;
  fileProblems.clear();
  file.set(undefined);
});

function mount() {
  const box = document.createElement('div');
  box.style.cssText = 'position: fixed; inset: 0; display: flex;';
  document.body.append(box);
  const handle = render(
    () => (
      <ProblemsView
        services={services}
        file={() => file.get()}
        openAt={(at) => void opened.push(at)}
        vertical={() => vertical.get()}
        problems={(path, text) => {
          asked.push([path, text]);
          return Promise.resolve(PROBLEMS);
        }}
      />
    ),
    box,
  );
  dispose = () => {
    handle.dispose();
  };
  return box;
}

const at = (line: number, column: number) => ({
  from: { line, column },
  to: { line, column: column + 1 },
});

const PROBLEMS: Problem[] = [
  { ...at(4, 2), severity: 'warning', message: "'x' is declared but never used." },
  { ...at(1, 0), severity: 'hint', message: 'Unreachable.', unused: true },
  { ...at(9, 6), severity: 'error', message: "Cannot find name 'y'." },
  { ...at(2, 1), severity: 'weak', message: 'Missing semicolon.' },
  { ...at(0, 3), severity: 'error', message: "Type 'string' is not assignable." },
];

/** The rows as they read. */
const rows = (box: HTMLElement) =>
  [...box.querySelectorAll('.cerebro-tree-row')].map((r) => r.textContent);

const row = (box: HTMLElement, text: string) =>
  [...box.querySelectorAll<HTMLElement>('.cerebro-tree-row')].find((r) =>
    r.textContent.includes(text),
  ) as HTMLElement;

describe('the Problems tool window', () => {
  it('says to open a file, then that it’s analysing it, then what was found', async () => {
    const box = mount();
    expect(box.textContent).toBe('Open file in editor to see problems');
    file.set('/w/src/a.ts');
    let answer: (problems: Problem[] | null) => void = () => undefined;
    const asked = askProblems(
      '/w/src/a.ts',
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    expect(box.textContent).toBe('Analyzing a.ts');
    answer([]);
    expect(await asked).toEqual([]);
    expect(box.textContent).toBe('No problems in a.ts');
    // No language server for a file: none.
    file.set('/w/notes.txt');
    expect(await askProblems('/w/notes.txt', () => Promise.resolve(null))).toBeNull();
    expect(box.textContent).toBe('No problems in notes.txt');
  });

  it('lists the same problem twice as two rows', async () => {
    const box = mount();
    file.set('/w/a.ts');
    const twice = PROBLEMS.slice(2, 3);
    await askProblems('/w/a.ts', () => Promise.resolve([...twice, ...twice]));
    await expect.poll(() => rows(box).length).toBe(3);
  });

  it('lists the file’s problems under it, the worst first, then in order, with their lines', async () => {
    const box = mount();
    file.set('/w/src/a.ts');
    await askProblems('/w/src/a.ts', () => Promise.resolve(PROBLEMS));
    await expect.poll(() => rows(box).length).toBe(5);
    // As IntelliJ's: the file, its folder and how many; a hint not listed.
    expect(rows(box)).toEqual([
      'a.ts/w/src4 problems',
      "Type 'string' is not assignable.:1",
      "Cannot find name 'y'.:10",
      "'x' is declared but never used.:5",
      'Missing semicolon.:3',
    ]);
    const icons = [...box.querySelectorAll('.playground-problems__icon svg')];
    expect(icons).toHaveLength(4);
    // An error's icon is the error circle; a warning's, and a weak one's, the triangle.
    expect(icons.map((i) => i.firstElementChild?.tagName)).toEqual([
      'circle',
      'circle',
      'path',
      'path',
    ]);
  });

  it('follows new answers, keeping the selection, and another file', async () => {
    const box = mount();
    file.set('/w/a.ts');
    await askProblems('/w/a.ts', () => Promise.resolve(PROBLEMS));
    await expect.poll(() => rows(box).length).toBe(5);
    await userEvent.click(row(box, 'Cannot find'));
    const tree = box.querySelector('.cerebro-tree') as HTMLElement;
    await askProblems('/w/a.ts', () => Promise.resolve(PROBLEMS.slice(0, 3)));
    await expect.poll(() => rows(box).length).toBe(3);
    expect(box.querySelector('.cerebro-tree')).toBe(tree);
    expect(box.querySelector('.cerebro-tree-row--selected')?.textContent).toBe(
      "Cannot find name 'y'.:10",
    );
    expect(rows(box)[0]).toBe('a.ts/w2 problems');
    await askProblems('/w/a.ts', () =>
      Promise.resolve([{ ...at(0, 0), severity: 'error', message: 'One.' }] as Problem[]),
    );
    await expect.poll(() => rows(box)[0]).toBe('a.ts/w1 problem');
    file.set('/w/b.ts');
    expect(box.textContent).toBe('No problems in b.ts');
  });

  it('goes to a problem: double-click, Enter, F4 while it has the keyboard, or its context menu', async () => {
    const box = mount();
    file.set('/w/a.ts');
    await askProblems('/w/a.ts', () => Promise.resolve(PROBLEMS));
    await expect.poll(() => rows(box).length).toBe(5);
    await userEvent.dblClick(row(box, 'Cannot find'));
    expect(opened).toEqual([{ path: '/w/a.ts', line: 9, column: 6 }]);
    await userEvent.keyboard('{ArrowUp}{Enter}');
    expect(opened.at(-1)).toEqual({ path: '/w/a.ts', line: 0, column: 3 });
    // Jump to Source: F4, as IntelliJ's, for the problem selected while the window has the keys.
    expect(new KeyDispatcher(keymap, commands).press('F4')).toBe('handled');
    expect(opened.at(-1)).toEqual({ path: '/w/a.ts', line: 0, column: 3 });
    expect(opened).toHaveLength(3);
    // On the file's row, nothing to go to.
    await userEvent.keyboard('{ArrowUp}');
    expect(commands.isEnabled('problems.jumpToSource')).toBe(false);
    // Enter folds the file, as a folder, and opens it again.
    await userEvent.keyboard('{Enter}');
    expect(rows(box)).toHaveLength(1);
    await userEvent.keyboard('{Enter}');
    expect(rows(box)).toHaveLength(5);
    expect(opened).toHaveLength(3);
    // Elsewhere, it isn't the Problems window's.
    await userEvent.keyboard('{ArrowDown}');
    (document.activeElement as HTMLElement).blur();
    expect(commands.isEnabled('problems.jumpToSource')).toBe(false);
    await userEvent.click(row(box, 'Missing'), { button: 'right' });
    expect(await menuItems()).toEqual(['Jump to Source']);
    await userEvent.click(document.querySelector('.cerebro-menu-item') as HTMLElement);
    expect(opened.at(-1)).toEqual({ path: '/w/a.ts', line: 2, column: 1 });
    // The file's row has no menu.
    await userEvent.click(row(box, 'problems'), { button: 'right' });
    expect(document.querySelector('.cerebro-menu')).toBeNull();
  });
});

describe('Open Editor Preview', () => {
  const button = (box: HTMLElement) =>
    box.querySelector('[aria-label="Open Editor Preview"]') as HTMLButtonElement;
  const preview = (box: HTMLElement) =>
    box.querySelector('.playground-problems__preview .cerebro-editor-code')?.shadowRoot;
  const caretLine = (box: HTMLElement) =>
    preview(box)?.querySelector('.cm-activeLine')?.textContent;

  afterEach(() => {
    // Off again, for the tests after; there's no button if a test failed before mounting.
    const on = document.querySelector<HTMLButtonElement>('[aria-label="Open Editor Preview"]');
    if (on?.ariaPressed === 'true') on.click();
    vertical.set(false);
    localStorage.clear();
  });

  it('shows the row selected in an editor of its file, at the problem, as IntelliJ’s', async () => {
    const box = mount();
    file.set('/r/a.ts');
    fileProblems.set('/r/a.ts', PROBLEMS);
    expect(button(box).ariaPressed).toBe('false');
    expect(box.querySelector('[role="toolbar"]')?.getAttribute('aria-orientation')).toBe(
      'vertical',
    );
    // Off to start with: no room taken.
    expect(box.querySelector('.playground-problems__preview')).toBeNull();
    await userEvent.click(button(box));
    expect(button(box).ariaPressed).toBe('true');
    expect(button(box).classList.contains('cerebro-toolbar-button--pressed')).toBe(true);
    // Nothing selected, nothing previewed.
    expect(box.querySelector('.playground-problems__preview')?.childElementCount).toBe(0);
    await userEvent.click(row(box, 'Cannot find name'));
    await expect.poll(() => caretLine(box)).toBe('line 9');
    // Its problems underlined, asked of the file's server as its tab asks.
    await expect
      .poll(() => preview(box)?.querySelectorAll('.cerebro-problem--error').length)
      .toBe(2);
    expect(asked).toEqual([['/r/a.ts', TEXT]]);
    // The focus stays in the tree, and the same editor shows the next problem chosen.
    expect(document.activeElement?.closest('.cerebro-tree')).not.toBeNull();
    const editor = box.querySelector('.playground-problems__preview .cerebro-editor-code');
    await userEvent.keyboard('{ArrowUp}');
    await expect.poll(() => caretLine(box)).toBe('line 0');
    expect(box.querySelector('.playground-problems__preview .cerebro-editor-code')).toBe(editor);
    // Beside the tree, half the room each.
    const split = box.querySelector('.playground-problems__split') as HTMLElement;
    const tree = box.querySelector('.playground-problems__tree') as HTMLElement;
    expect(tree.style.flexBasis).toBe('50%');
    const whole = split.getBoundingClientRect().width;
    expect(tree.getBoundingClientRect().width / whole).toBeCloseTo(0.5, 1);
    expect(split.classList.contains('playground-problems__split--vertical')).toBe(false);
    // Under it, with the window on the left or right.
    vertical.set(true);
    expect(split.classList.contains('playground-problems__split--vertical')).toBe(true);
    expect(box.querySelector('.cerebro-splitter--horizontal')).not.toBeNull();
    // The toolbar goes across the window's top, as IntelliJ's.
    const toolbar = box.querySelector('[role="toolbar"]') as HTMLElement;
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    const [eye, toggle] = [...toolbar.querySelectorAll('button')].map((b) =>
      b.getBoundingClientRect(),
    );
    expect([toggle?.top, (toggle?.left ?? 0) >= (eye?.right ?? 0)]).toEqual([eye?.top, true]);
    expect((eye?.bottom ?? 0) <= split.getBoundingClientRect().top).toBe(true);
    // It edits the file, as IntelliJ's.
    const doc = (await documentFor('/r/a.ts')) as EditorDocument;
    expect(doc.content()).toBe(TEXT);
    expect(JSON.parse(localStorage.getItem('cerebro.problems.view') as string)).toMatchObject({
      showPreview: true,
      share: 0.5,
    });
    // The file's row: the file, from its top, nothing selected in it.
    await userEvent.click(row(box, '/r'));
    await expect.poll(() => caretLine(box)).toBe('line 0');
    // Named as it's pointed at.
    await userEvent.hover(button(box));
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toContain('Open Editor Preview');
    // Off, it goes, and the tree has the room.
    await userEvent.click(button(box));
    expect(box.querySelector('.playground-problems__preview')).toBeNull();
    expect(tree.style.flexBasis).toBe('');
  });

  it('shows nothing for a file it can’t read', async () => {
    const box = mount();
    file.set('/r/gone.ts');
    fileProblems.set('/r/gone.ts', PROBLEMS);
    const read = host.answers['fs.read'];
    host.answers['fs.read'] = () => {
      throw new Error('ENOENT');
    };
    try {
      await userEvent.click(button(box));
      await userEvent.click(row(box, 'Cannot find name'));
      await documentFor('/r/gone.ts');
      expect(preview(box)).toBeUndefined();
    } finally {
      host.answers['fs.read'] = read as never;
    }
  });

  it('keeps the split where it’s dragged', async () => {
    const box = mount();
    file.set('/r/a.ts');
    fileProblems.set('/r/a.ts', PROBLEMS);
    await userEvent.click(button(box));
    const width = (box.querySelector('.playground-problems__split') as HTMLElement).clientWidth;
    /** Drags the splitter across by so much. */
    const drag = (across: number) => {
      const splitter = box.querySelector('.cerebro-splitter') as HTMLElement;
      const at = splitter.getBoundingClientRect();
      const from = { clientX: at.left, clientY: at.top, bubbles: true };
      const to = { clientX: at.left + across, clientY: at.top, bubbles: true };
      splitter.dispatchEvent(new PointerEvent('pointerdown', { ...from, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', to));
      window.dispatchEvent(new PointerEvent('pointerup', to));
    };
    drag(-width / 4);
    expect(readViewOptions().share).toBeCloseTo(0.25, 1);
    // Never all or none of the room.
    drag(width);
    expect(readViewOptions().share).toBe(0.9);
    localStorage.setItem('cerebro.problems.view', '{"share":-3}');
    expect(readViewOptions().share).toBe(0.1);
    // Back to the middle, for the tests after.
    drag(-width * 0.4);
    expect(readViewOptions().share).toBeCloseTo(0.5, 1);
    // Under the tree, it's dragged down and up.
    vertical.set(true);
    const height = (box.querySelector('.playground-problems__split') as HTMLElement).clientHeight;
    const splitter = box.querySelector('.cerebro-splitter') as HTMLElement;
    const at = splitter.getBoundingClientRect();
    splitter.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: at.left,
        clientY: at.top,
        button: 0,
        bubbles: true,
      }),
    );
    const to = { clientX: at.left, clientY: at.top + height / 4 };
    window.dispatchEvent(new PointerEvent('pointermove', to));
    window.dispatchEvent(new PointerEvent('pointerup', to));
    expect(readViewOptions().share).toBeCloseTo(0.75, 1);
    splitter.dispatchEvent(new PointerEvent('pointerdown', { ...to, button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: at.left, clientY: at.top }));
    window.dispatchEvent(new PointerEvent('pointerup', {}));
    expect(readViewOptions().share).toBeCloseTo(0.5, 1);
  });
});

describe('the View Options', () => {
  /** Whether each View Option is on, by its command. */
  const options = () =>
    Object.fromEntries(
      [
        'problems.show.warning',
        'problems.show.weak',
        'problems.sortBySeverity',
        'problems.sortByName',
      ].map((id) => [id, commands.isChecked(id)]),
    );

  afterEach(() => {
    // Back to IntelliJ's defaults, for the tests after.
    for (const [id, on] of Object.entries(options())) {
      if (on !== (id !== 'problems.sortByName')) commands.execute(id);
    }
    localStorage.clear();
  });

  it('are a menu from the window’s toolbar: Show, then Sort By, as IntelliJ’s', async () => {
    mount();
    const button = document.querySelector('[aria-label="View Options"]') as Element;
    await userEvent.hover(button);
    await expect
      .poll(() => document.querySelector('.cerebro-tooltip')?.textContent)
      .toBe('View Options');
    await userEvent.click(button);
    expect(await menuItems()).toEqual(['Warning', 'Weak Warning', 'Severity', 'Name']);
    expect(
      [...document.querySelectorAll('.cerebro-menu-heading')].map((h) => h.textContent),
    ).toEqual(['Show', 'Sort By']);
    expect(options()).toEqual({
      'problems.show.warning': true,
      'problems.show.weak': true,
      'problems.sortBySeverity': true,
      'problems.sortByName': false,
    });
    await userEvent.click(menuItem('Weak Warning'));
    expect(commands.isChecked('problems.show.weak')).toBe(false);
  });

  it('hide warnings and weak ones, not errors, and say problems could be filtered out', async () => {
    const box = mount();
    file.set('/w/src/a.ts');
    await askProblems('/w/src/a.ts', () => Promise.resolve(PROBLEMS));
    await expect.poll(() => rows(box).length).toBe(5);
    commands.execute('problems.show.warning');
    commands.execute('problems.show.weak');
    await expect
      .poll(() => rows(box))
      .toEqual([
        'a.ts/w/src2 problems',
        "Type 'string' is not assignable.:1",
        "Cannot find name 'y'.:10",
      ]);
    // Only warnings: none shown, and why there may be none.
    await askProblems('/w/src/a.ts', () => Promise.resolve(PROBLEMS.slice(0, 1)));
    const empty = () => box.querySelector('.playground-project__empty');
    await expect
      .poll(() => empty()?.textContent)
      .toBe('No problems in a.tsProblems could be filtered out');
    // On a line of its own.
    expect(empty()?.querySelector('br')).not.toBeNull();
    commands.execute('problems.show.warning');
    await expect.poll(() => rows(box).length).toBe(2);
  });

  it('sort by name, or by place without severity, and are kept', async () => {
    const box = mount();
    file.set('/w/src/a.ts');
    await askProblems('/w/src/a.ts', () => Promise.resolve(PROBLEMS));
    await expect.poll(() => rows(box).length).toBe(5);
    commands.execute('problems.sortBySeverity');
    await expect
      .poll(() => rows(box).slice(1))
      .toEqual([
        "Type 'string' is not assignable.:1",
        'Missing semicolon.:3',
        "'x' is declared but never used.:5",
        "Cannot find name 'y'.:10",
      ]);
    commands.execute('problems.sortByName');
    await expect
      .poll(() => rows(box).slice(1))
      .toEqual([
        "'x' is declared but never used.:5",
        "Cannot find name 'y'.:10",
        'Missing semicolon.:3',
        "Type 'string' is not assignable.:1",
      ]);
    commands.execute('problems.show.weak');
    expect(readViewOptions()).toMatchObject({
      hidden: ['weak'],
      sortBySeverity: false,
      sortByName: true,
    });
  });

  it('read as IntelliJ’s defaults when not kept, or unreadable', () => {
    const defaults = {
      hidden: [],
      sortBySeverity: true,
      sortByName: false,
      showPreview: false,
      share: 0.5,
    };
    expect(readViewOptions()).toEqual(defaults);
    localStorage.setItem('cerebro.problems.view', '{"hidden":["error","weak"]}');
    expect(readViewOptions()).toEqual({ ...defaults, hidden: ['weak'] });
    localStorage.setItem('cerebro.problems.view', '{"hidden":"weak"}');
    expect(readViewOptions()).toEqual(defaults);
    localStorage.setItem('cerebro.problems.view', '{unreadable');
    expect(readViewOptions()).toEqual(defaults);
  });

  it('compare as IntelliJ’s: numbers in messages by their value, then by place', () => {
    const p = (message: string, line: number, column = 0) =>
      ({ severity: 'error', message, line, column }) as const;
    const by = { severity: true, name: true };
    expect(compareProblems(p('item 9', 1), p('item 10', 0), by)).toBeLessThan(0);
    expect(compareProblems(p('same', 2, 1), p('same', 2, 0), by)).toBeGreaterThan(0);
    // By place, then by message.
    const place = { severity: false, name: false };
    expect(compareProblems(p('b', 3), p('a', 3), place)).toBeGreaterThan(0);
  });
});

describe('files with errors', () => {
  it('are those with an error, and the folders they’re in, not warnings', async () => {
    await askProblems('/w/src/a.ts', () => Promise.resolve(PROBLEMS));
    await askProblems('/w/lib/b.ts', () => Promise.resolve(PROBLEMS.slice(0, 2)));
    expect(hasErrors('/w/src/a.ts')).toBe(true);
    expect(hasErrors('/w/lib/b.ts')).toBe(false);
    expect(hasErrors('/w/c.ts')).toBe(false);
    expect(hasErrorsBeneath('/w')).toBe(true);
    expect(hasErrorsBeneath('/w/src')).toBe(true);
    expect(hasErrorsBeneath('/w/lib')).toBe(false);
    // A folder whose name starts the same isn't it.
    expect(hasErrorsBeneath('/w/sr')).toBe(false);
  });
});
