import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  type BookmarkMark,
  type CodeEditorProps,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 500px;';
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  (root.querySelector('.cm-content') as HTMLElement).focus();
  return root;
}

/** Bookmarks without mnemonics on lines. */
const at = (...lines: number[]) => lines.map((line) => ({ line }));

/** The lines with a bookmark's icon, one-based as the line numbers show them. */
const marked = (root: ShadowRoot) => {
  const gutter = root.querySelector('.cerebro-bookmarks') as HTMLElement;
  const numbers = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].filter(
    (element) => element.textContent !== '',
  );
  return [...gutter.querySelectorAll('.cm-gutterElement')]
    .filter((element) => element.querySelector('.cerebro-bookmark'))
    .map((element) => {
      const top = element.getBoundingClientRect().top;
      return numbers.find((number) => number.getBoundingClientRect().top === top)?.textContent;
    });
};

describe('bookmarks', () => {
  it('show on their lines, before the line numbers, as they change', async () => {
    const lines = signal<readonly number[]>([1, 3, 9]);
    const root = mount({
      document: new EditorDocument('a\nb\nc\nd\n'),
      bookmarks: () => at(...lines.get()),
    });
    // The line past the text's end left out.
    await expect.poll(() => marked(root)).toEqual(['2', '4']);
    const gutters = [...root.querySelectorAll('.cm-gutter')].map((g) => g.className);
    expect(gutters.findIndex((c) => c.includes('cerebro-bookmarks'))).toBeLessThan(
      gutters.findIndex((c) => c.includes('cm-lineNumbers')),
    );
    lines.set([0]);
    await expect.poll(() => marked(root)).toEqual(['1']);
    expect(root.querySelector('.cerebro-bookmark')?.getAttribute('aria-label')).toBe('Bookmark');
    // Moved with no one to tell.
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => marked(root)).toEqual(['2']);
  });

  it('move with their lines’ text as it’s edited, and say where to', async () => {
    const moved = vi.fn();
    const root = mount({
      document: new EditorDocument('a\nb\nc\n'),
      bookmarks: () => at(1),
      onBookmarksMoved: moved,
    });
    await expect.poll(() => marked(root)).toEqual(['2']);
    // Typing on a line moves none.
    await userEvent.keyboard('x');
    expect(moved).not.toHaveBeenCalled();
    // A line break above takes it down; one at its line's start too.
    await userEvent.keyboard('{Enter}');
    expect(moved).toHaveBeenLastCalledWith([2]);
    await userEvent.keyboard('{ArrowDown}{Home}{Enter}');
    expect(moved).toHaveBeenLastCalledWith([3]);
    // A line joined to the one above: on it.
    await userEvent.keyboard('{Backspace}');
    expect(moved).toHaveBeenLastCalledWith([2]);
    await expect.poll(() => marked(root)).toEqual(['3']);
    // Two bookmarked lines joined: one.
    cleanup?.();
    const twice = vi.fn();
    mount({
      document: new EditorDocument('a\nb\n'),
      bookmarks: () => at(0, 1),
      onBookmarksMoved: twice,
    });
    await userEvent.keyboard('{End}{Delete}');
    expect(twice).toHaveBeenLastCalledWith([0]);
  });

  it('stay on their lines when the text is read again from disk', async () => {
    const moved = vi.fn();
    const doc = new EditorDocument('a\nb\nc\n');
    const root = mount({ document: doc, bookmarks: () => at(1, 2), onBookmarksMoved: moved });
    await expect.poll(() => marked(root)).toEqual(['2', '3']);
    // A line above them gone: up with their lines.
    expect(doc.changedOnDisk('b\nc\n')).toBe(true);
    expect(moved).toHaveBeenLastCalledWith([0, 1]);
  });

  it('show their mnemonics, the first of two on a line', async () => {
    const marks = signal<readonly BookmarkMark[]>([
      { line: 1, mnemonic: '7' },
      { line: 0 },
      { line: 1, mnemonic: 'K' },
    ]);
    const root = mount({ document: new EditorDocument('a\nb\n'), bookmarks: () => marks.get() });
    await expect.poll(() => marked(root)).toEqual(['1', '2']);
    const mnemonic = () => root.querySelector('.cerebro-bookmark--mnemonic') as HTMLElement;
    expect(mnemonic().textContent).toBe('7');
    expect(mnemonic().getAttribute('aria-label')).toBe('Bookmark 7');
    // Another on its line: shown in its place; the same again, left as it is.
    marks.set([{ line: 0 }, { line: 1, mnemonic: 'K' }]);
    await expect.poll(() => mnemonic().textContent).toBe('K');
    const shown = mnemonic();
    marks.set([{ line: 0 }, { line: 1, mnemonic: 'K' }]);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(mnemonic()).toBe(shown);
  });

  it('have no gutter when the editor shows none', () => {
    const root = mount({ document: new EditorDocument('a\n') });
    expect(root.querySelector('.cerebro-bookmarks')).toBeNull();
  });
});
