import { CommandRegistry, KeyDispatcher, Keymap, MenuRegistry } from '@cerebro-ide/commands';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import type { Problem } from '@cerebro-ide/ui-editor';
import type { MenuServices } from '@cerebro-ide/ui-menu';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  askProblems,
  fileProblems,
  hasErrors,
  hasErrorsBeneath,
  ProblemsView,
  setupProblems,
} from '../src/problems.js';
import { closeAll, menuItems } from './fakes.js';

const commands = new CommandRegistry();
const menus = new MenuRegistry();
const keymap = new Keymap('other');
const services: MenuServices = { commands, menus, keymap };
const opened: { path: string; line: number; column: number }[] = [];
const file = signal<string | undefined>(undefined);
let dispose: (() => void) | undefined;

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
});

afterEach(async () => {
  await closeAll();
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  opened.length = 0;
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
