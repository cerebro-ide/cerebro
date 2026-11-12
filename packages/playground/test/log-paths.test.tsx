import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  MAX_PATHS,
  pathState,
  pathsText,
  pathsTooltip,
  pickPaths,
  readPaths,
  shortenPath,
  shortenText,
  togglePath,
  type PathSource,
} from '../src/log-paths.js';
import type { FileNode } from '../src/project.js';

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe('the Paths filter’s paths', () => {
  it('are checked, or under or over one that is, as IntelliJ’s tree has them', () => {
    const selected = new Set(['src/', 'docs/a.md']);
    expect(pathState('src/', selected)).toBe('selected');
    expect(pathState('src/main.ts', selected)).toBe('above');
    expect(pathState('src/ui/', selected)).toBe('above');
    expect(pathState('docs/', selected)).toBe('below');
    expect(pathState('srcs/', selected)).toBe('clear');
    // A file holds nothing.
    expect(pathState('docs/a.md', new Set(['docs/a.mdx']))).toBe('clear');
  });

  it('toggle, but not one under a checked folder, nor one over a checked path, nor past the limit', () => {
    const selected = new Set(['src/']);
    expect([...togglePath('a.txt', selected)]).toEqual(['src/', 'a.txt']);
    expect([...togglePath('src/', selected)]).toEqual([]);
    expect(togglePath('src/main.ts', selected)).toBe(selected);
    expect(togglePath('src/', new Set(['src/a.ts']))).toEqual(new Set(['src/a.ts']));
    expect(togglePath('b.txt', new Set(['a.txt']), 1)).toEqual(new Set(['a.txt']));
  });

  it('shorten as IntelliJ’s StringUtil: the start and the end, past 30 characters', () => {
    expect(shortenPath('src/main.ts')).toBe('src/main.ts');
    const long = 'packages/playground/src/log-paths.tsx';
    expect(shortenPath(long)).toBe('packag...und/src/log-paths.tsx');
    expect(shortenPath(long)).toHaveLength(30);
  });

  it('shorten text as IntelliJ’s StringUtil: to the length given, the last three dots', () => {
    expect(shortenText('A subject of forty characters, exactly!!')).toHaveLength(40);
    expect(shortenText('A subject of forty characters, exactly!!')).toBe(
      'A subject of forty characters, exactly!!',
    );
    expect(shortenText('A subject longer than forty characters, by far')).toBe(
      'A subject longer than forty character...',
    );
  });

  it('are listed in the tooltip, as IntelliJ’s: sorted, ten at most, then "..."', () => {
    expect(pathsTooltip(['src/', 'a.txt'])).toBe('Paths:\na.txt\nsrc/');
    const many = Array.from({ length: 11 }, (_, i) => `f${String(i).padStart(2, '0')}`);
    expect(pathsTooltip(many).split('\n')).toEqual(['Paths:', ...many.slice(0, 10), '...']);
  });

  it('show the first, and how many more', () => {
    expect(pathsText(['src/'])).toBe('src/');
    expect(pathsText(['src/', 'a.txt', 'b/'])).toBe('a.txt + 2');
  });

  it('are read from the repository’s top, with forward slashes', () => {
    expect(readPaths(['/r/src/', 'a.txt', 'C:\\other\\b', '/rest'], '/r')).toEqual([
      'src/',
      'a.txt',
      'C:/other/b',
      '/rest',
    ]);
    expect(readPaths(['C:\\r\\src\\a.ts'], 'C:\\r\\')).toEqual(['src/a.ts']);
  });
});

/** The popup's source: a repository of `count` files, and what was chosen. */
function source(count = 2, current?: readonly string[]) {
  const chosen: (readonly string[] | undefined)[] = [];
  const files: FileNode[] = Array.from({ length: count }, (_, i) => ({
    path: `/r/f${String(i)}`,
    name: `f${String(i)}`,
    kind: 'file',
  }));
  const it: PathSource = {
    worktree: '/r',
    platform: 'other',
    list: (folder) =>
      Promise.resolve(
        folder === undefined ? [{ path: '/r/d', name: 'd', kind: 'directory' }, ...files] : [],
      ),
    current: () => current,
    choose: (paths) => chosen.push(paths),
  };
  return { source: it, chosen };
}

const button = () => {
  const element = document.createElement('button');
  document.body.append(element);
  return element;
};
const box = (name: string) =>
  document.querySelector<HTMLInputElement>(`.playground-paths input[aria-label="${name}"]`);

describe('the Paths filter’s tree', () => {
  it('checks the selected row with Space', async () => {
    const { source: paths, chosen } = source();
    pickPaths(button(), paths);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await vi.waitUntil(() => box('f0'));
    await userEvent.click(
      document.querySelectorAll('.playground-paths .cerebro-tree-row')[1] as HTMLElement,
    );
    await userEvent.keyboard(' ');
    expect(box('f0')?.checked).toBe(true);
    // Other keys are the tree's.
    await userEvent.keyboard('{ArrowDown} ');
    expect(box('f1')?.checked).toBe(true);
    await userEvent.keyboard('x');
    await userEvent.click(
      document.querySelector('.cerebro-dialog__button--primary') as HTMLElement,
    );
    await expect.poll(() => chosen).toEqual([['f0', 'f1']]);
  });

  it('takes no more than a hundred, and says so', async () => {
    const full = Array.from({ length: MAX_PATHS }, (_, i) => `x${String(i)}`);
    const { source: paths, chosen } = source(1, full);
    pickPaths(button(), paths);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await vi.waitUntil(() => box('f0'));
    expect(document.querySelector('.playground-paths__limit')?.textContent).toBe(
      'Selected: (You have added 100 elements. No more is allowed.)',
    );
    await userEvent.click(box('f0') as HTMLElement);
    expect(box('f0')?.checked).toBe(false);
    // Cancelled: nothing chosen.
    await userEvent.keyboard('{Escape}');
    await vi.waitUntil(() => !box('f0'));
    expect(chosen).toEqual([]);
  });
});

describe('the Paths filter’s Select…', () => {
  it('cancels on Escape or a click outside, and clears when emptied', async () => {
    const { source: paths, chosen } = source(0, ['b/', 'a']);
    const field = () => document.querySelector<HTMLTextAreaElement>('.playground-values__field');
    const open = async () => {
      pickPaths(button(), paths);
      await userEvent.keyboard('{Enter}');
      await vi.waitUntil(() => document.activeElement === field());
    };
    await open();
    // Those chosen, sorted, a line each; with how to finish.
    expect(field()?.value).toBe('a\nb/');
    expect(document.querySelector('.playground-values__hint')?.textContent).toBe(
      'Select one or more values separated with new lines, use Ctrl+Enter to finish',
    );
    await userEvent.keyboard('{Escape}');
    expect(field()).toBeNull();
    await open();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(field()).toBeNull();
    await open();
    (field() as HTMLElement).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(field()).not.toBeNull();
    await userEvent.keyboard('{Control>}a{/Control}{Backspace} {Control>}{Enter}{/Control}');
    expect(chosen).toEqual([undefined]);
    expect(localStorage.length).toBe(0);
  });

  it('finishes on Cmd+Enter on macOS', async () => {
    const { source: paths, chosen } = source(0);
    pickPaths(button(), { ...paths, platform: 'mac' });
    await userEvent.keyboard('{Enter}');
    await vi.waitUntil(() => document.activeElement?.matches('.playground-values__field'));
    expect(document.querySelector('.playground-values__hint')?.textContent).toMatch(
      /use ⌘.+ to finish$/,
    );
    await userEvent.keyboard('a.txt{Control>}{Enter}{/Control}');
    expect(chosen).toEqual([]);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(chosen).toEqual([['a.txt']]);
  });
});
