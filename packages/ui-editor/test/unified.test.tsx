import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { Text } from '@codemirror/state';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { compare } from '../src/compare.js';
import {
  diffSource,
  UnifiedDiffEditor,
  type DiffControl,
  type DiffEditorProps,
} from '../src/index.js';
import { unify } from '../src/unified.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(props: Omit<DiffEditorProps, 'syncScroll' | 'align'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 300px;';
  document.body.append(container);
  const handle = render(() => <UnifiedDiffEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-diff') as HTMLElement).shadowRoot as ShadowRoot;
}

const texts = (root: ShadowRoot, selector: string) =>
  [...root.querySelectorAll(selector)].map((element) => element.textContent);

describe('unifying two texts', () => {
  const text = (lines: string[]) => Text.of(lines);
  const run = (a: string[], b: string[], ...policies: [] | ['whitespacesAndEmptyLines']) =>
    unify(text(a), text(b), compare(text(a), text(b), ...policies));

  it('puts each change’s removed lines above its added ones, among the right’s', () => {
    const unified = run(['a', 'old', 'b', 'gone'], ['a', 'new', 'b', 'added', 'c']);
    expect(unified.text.split('\n')).toEqual(['a', 'old', 'new', 'b', 'gone', 'added', 'c']);
    expect(unified.lines).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: undefined },
      { a: undefined, b: 1 },
      { a: 2, b: 2 },
      { a: 3, b: undefined },
      { a: undefined, b: 3 },
      { a: undefined, b: 4 },
    ]);
    expect(unified.blocks.map(({ start, middle, end }) => [start, middle, end])).toEqual([
      [1, 2, 3],
      [4, 5, 7],
    ]);
  });

  it('numbers the left’s lines while it has them, where unchanged runs differ', () => {
    const unified = run(['a', 'b'], ['a', '', 'b'], 'whitespacesAndEmptyLines');
    expect(unified.blocks).toEqual([]);
    expect(unified.lines).toEqual([
      { a: 0, b: 0 },
      { a: 1, b: 1 },
      { a: undefined, b: 2 },
    ]);
  });
});

describe('the unified diff editor', () => {
  it('shows both texts as one, removed lines as deleted and added as inserted, with both numbers', async () => {
    const root = mount({
      path: 'a.ts',
      original: 'const a = 1;\nconst same = 0;\nconst gone = 2;\n',
      text: 'const a = 3;\nconst same = 0;\n',
    });
    expect(texts(root, '.cm-line')).toEqual([
      'const a = 1;',
      'const a = 3;',
      'const same = 0;',
      'const gone = 2;',
      '',
    ]);
    expect(texts(root, '.cm-diff-deleted')).toEqual(['const a = 1;', 'const gone = 2;']);
    expect(texts(root, '.cm-diff-inserted')).toEqual(['const a = 3;']);
    // Changed text in the full colour, by the side it's on; the lines lighter.
    expect(texts(root, '.cm-diff-word-deleted')).toEqual(['1']);
    expect(texts(root, '.cm-diff-word-inserted')).toEqual(['3']);
    const word = root.querySelector('.cm-diff-word-inserted') as Element;
    expect(getComputedStyle(word).backgroundColor).toBe('rgb(41, 68, 54)');
    expect(root.querySelectorAll('.cm-diff-words')).toHaveLength(2);
    // The left's line numbers, then the right's: none where a line isn't on that side.
    await expect
      .poll(() => texts(root, '.cm-diff-numbers-a .cm-gutterElement').slice(1))
      .toEqual(['1', '', '2', '3', '4']);
    expect(texts(root, '.cm-diff-numbers-b .cm-gutterElement').slice(1)).toEqual([
      '',
      '1',
      '2',
      '',
      '3',
    ]);
    // Both columns in the change's colour.
    for (const side of ['a', 'b']) {
      const marked = `.cm-diff-numbers-${side} .cm-diff-gutter-deleted`;
      expect(root.querySelectorAll(marked)).toHaveLength(2);
    }
    // Read-only.
    const content = root.querySelector('.cm-content') as HTMLElement;
    await userEvent.click(content);
    await userEvent.keyboard('x');
    expect(texts(root, '.cm-line')[0]).toBe('const a = 1;');
  });

  it('marks text added within a line on its added line alone', () => {
    const root = mount({ path: 'a.ts', original: 'f(x);', text: 'f(x, y);' });
    expect(texts(root, '.cm-diff-word-inserted')).toEqual([', y']);
    expect(root.querySelector('.cm-diff-word-deleted')).toBeNull();
  });

  it('marks lines alone when highlighting by lines, and compares again as the policies change', async () => {
    const ignore = signal<'none' | 'trim'>('none');
    const highlight = signal<'words' | 'lines'>('lines');
    const root = mount({
      path: 'a.txt',
      original: 'x\n  y\n',
      text: 'z\ny\n',
      ignore: () => ignore.get(),
      highlight: () => highlight.get(),
    });
    expect(texts(root, '.cm-diff-line')).toEqual(['x', '  y', 'z', 'y']);
    expect(root.querySelector('.cm-diff-words')).toBeNull();
    ignore.set('trim');
    await expect.poll(() => texts(root, '.cm-diff-line')).toEqual(['x', 'z']);
    expect(texts(root, '.cm-line')).toEqual(['x', 'z', 'y', '']);
    highlight.set('words');
    await expect.poll(() => root.querySelectorAll('.cm-diff-words').length).toBe(2);
  });

  it('collapses unchanged lines, shows more of them on a click, and goes from change to change', async () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const text = original.with(10, 'one').with(30, 'two').with(50, 'three');
    const collapse = signal(true);
    const fontSize = signal(13);
    let control: DiffControl | undefined;
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      collapse: () => collapse.get(),
      fontSize: () => fontSize.get(),
      tabSize: () => 2,
      control: (diff) => {
        control = diff;
      },
    });
    const diff = control as DiffControl;
    const folds = () => texts(root, '.cm-diff-fold');
    // Before the first, between each two (11 lines less 8 of context), and after the last.
    await expect.poll(() => folds().length).toBe(4);
    const band = () => root.querySelector('.cm-diff-fold') as HTMLElement;
    expect(band().getAttribute('aria-label')).toBe('6 unchanged lines');
    // 4 more lines shown: 2 left before the first change.
    band().click();
    await expect.poll(() => band().getAttribute('aria-label')).toBe('2 unchanged lines');
    // Then 8 more would leave none folded: all shown.
    band().click();
    await expect.poll(() => folds().length).toBe(3);
    collapse.set(false);
    await expect.poll(() => folds().length).toBe(0);
    collapse.set(true);
    await expect.poll(() => folds().length).toBe(4);
    // The caret at the first change to start with; Next and Previous from there.
    const source = () => diffSource(root.host);
    expect(source()).toEqual({ line: 10, column: 0 });
    expect(diff.hasPrevious()).toBe(false);
    diff.next();
    expect(source()).toEqual({ line: 30, column: 0 });
    diff.next();
    expect(diff.hasNext()).toBe(false);
    diff.next();
    diff.previous();
    expect(source()).toEqual({ line: 30, column: 0 });
    // Taking the font's size.
    fontSize.set(20);
    await expect
      .poll(() => getComputedStyle(root.querySelector('.cm-scroller') as Element).fontSize)
      .toBe('20px');
  });

  it('leaves the lines of context asked for by each change, folded again as they change', async () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const context = signal(1);
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: original.with(30, 'changed').join('\n'),
      collapse: () => true,
      context: () => context.get(),
    });
    const folds = () =>
      [...root.querySelectorAll('.cm-diff-fold')].map((band) => band.getAttribute('aria-label'));
    // 30 lines before the change, 1 left; 29 after it.
    await expect.poll(folds).toEqual(['29 unchanged lines', '28 unchanged lines']);
    context.set(8);
    await expect.poll(folds).toEqual(['22 unchanged lines', '21 unchanged lines']);
  });

  it('starts at the last change if asked, and takes the focus when asked', () => {
    let control: DiffControl | undefined;
    const root = mount({
      path: 'a.txt',
      original: 'a\nb\nc\nd',
      text: 'a\nB\nc\nD',
      scrollTo: 'lastChange',
      control: (c) => {
        control = c;
      },
    });
    expect(diffSource(root.host)).toEqual({ line: 3, column: 0 });
    (control as DiffControl).focus();
    expect(root.activeElement).toBe(root.querySelector('.cm-content'));
  });

  it('jumps to the right’s line from an added or unchanged line, and to its change’s from a removed one', async () => {
    const root = mount({ path: 'a.txt', original: 'a\nold\nb', text: 'a\nnew\nb' });
    // The caret on "old", the first change's removed line: where the change is on the right.
    expect(diffSource(root.host)).toEqual({ line: 1, column: 0 });
    // On "new", the right's own line, where the caret is in it.
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{ArrowDown}{ArrowRight}');
    expect(diffSource(root.host)).toEqual({ line: 1, column: 1 });
    cleanup?.();
    // Removed after the right's last line: its last line.
    const empty = mount({ path: 'a.txt', original: 'kept\ngone', text: 'kept' });
    expect(diffSource(empty.host)).toEqual({ line: 0, column: 0 });
  });

  it('hides both columns of numbers when line numbers are off', async () => {
    const numbers = signal(true);
    const root = mount({
      path: 'a.ts',
      original: 'a\n',
      text: 'b\n',
      lineNumbers: () => numbers.get(),
    });
    expect(root.querySelectorAll('.cm-diff-numbers-a, .cm-diff-numbers-b')).toHaveLength(2);
    numbers.set(false);
    await expect
      .poll(() => root.querySelectorAll('.cm-diff-numbers-a, .cm-diff-numbers-b').length)
      .toBe(0);
  });

  it('edits the right’s lines, not the removed ones nor the breaks around them, as IntelliJ’s', async () => {
    const onEdit = vi.fn();
    const root = mount({ path: 'a.txt', original: 'a\nold\nb', text: 'a\nnew\nb', onEdit });
    const line = (text: string) =>
      [...root.querySelectorAll('.cm-line')].find((l) => l.textContent === text) as Element;
    expect(texts(root, '.cm-line')).toEqual(['a', 'old', 'new', 'b']);
    // An added line, typed into.
    await userEvent.click(line('new'));
    await userEvent.keyboard('{End}!');
    expect(onEdit).toHaveBeenLastCalledWith('a\nnew!\nb');
    // An unchanged one: compared again, it's a change, joined with the one below, their old lines
    // above them; the caret where it was.
    await userEvent.click(line('a'));
    await userEvent.keyboard('{End}2');
    expect(onEdit).toHaveBeenLastCalledWith('a2\nnew!\nb');
    await expect.poll(() => texts(root, '.cm-line')).toEqual(['a', 'old', 'a2', 'new!', 'b']);
    await expect.poll(() => texts(root, '.cm-diff-deleted')).toEqual(['a', 'old']);
    await userEvent.keyboard('3');
    expect(onEdit).toHaveBeenLastCalledWith('a23\nnew!\nb');
    // A removed line isn't typed into, nor is the break before or after it taken out.
    onEdit.mockClear();
    await userEvent.click(line('old'));
    await userEvent.keyboard('{End}x{Home}{Backspace}');
    await userEvent.click(line('a23'));
    await userEvent.keyboard('{Home}{Backspace}');
    expect(onEdit).not.toHaveBeenCalled();
    expect(texts(root, '.cm-line')).toEqual(['a', 'old', 'a23', 'new!', 'b']);
  });

  it('shows the same text unmarked, with no change to go to', () => {
    let control: DiffControl | undefined;
    const root = mount({
      path: 'a.txt',
      original: 'same',
      text: 'same',
      control: (diff) => {
        control = diff;
      },
    });
    expect(texts(root, '.cm-line')).toEqual(['same']);
    expect(control?.hasNext()).toBe(false);
  });
});
