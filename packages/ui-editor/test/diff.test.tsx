import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DiffEditor, diffSource, transferLine, type DiffEditorProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(props: DiffEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 300px;';
  document.body.append(container);
  const handle = render(() => <DiffEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-diff') as HTMLElement).shadowRoot as ShadowRoot;
}

const lines = (editor: Element) =>
  [...editor.querySelectorAll('.cm-line')].map((line) => line.textContent);

describe('the diff editor', () => {
  it('shows the committed text on the left and the current on the right, changes marked', () => {
    const root = mount({
      path: 'a.ts',
      original: 'const a = 1;\nconst same = 0;\n',
      text: 'const a = 2;\nconst same = 0;\nconst added = 3;\n',
    });
    const [left, right] = root.querySelectorAll('.cm-mergeViewEditor .cm-editor');
    expect(lines(left as Element)).toEqual(['const a = 1;', 'const same = 0;', '']);
    expect(lines(right as Element)).toContain('const added = 3;');
    expect(left?.querySelector('.cm-changedLine')?.textContent).toBe('const a = 1;');
    expect(
      [...(right as Element).querySelectorAll('.cm-changedLine')].map((l) => l.textContent),
    ).toEqual(['const a = 2;', 'const added = 3;']);
    // In the theme's colours.
    const removed = getComputedStyle(left?.querySelector('.cm-changedLine') as Element);
    expect(removed.backgroundColor).toBe('rgb(62, 42, 44)'); // Scrollbars avoid both sides' gutters.
    expect(root.querySelectorAll('.cm-gutters[data-scrollbar-obstacle]')).toHaveLength(2);
  });

  it('is as wide as the longest line on each side, though it isn’t drawn', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i)}`);
    lines[2500] = 'x'.repeat(400);
    const root = mount({ path: 'a.txt', original: lines.join('\n'), text: lines.join('\n') });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    for (const content of root.querySelectorAll<HTMLElement>('.cm-content')) {
      expect(parseFloat(content.style.minWidth)).toBeGreaterThan(2000);
    }
  });

  it('applies the font size and tab size as they change, and shows a file of no language', () => {
    const fontSize = signal(13);
    const root = mount({
      path: 'notes',
      original: '',
      text: 'new\n',
      fontSize: () => fontSize.get(),
      tabSize: () => 2,
    });
    const scrollers = root.querySelectorAll<HTMLElement>('.cm-scroller');
    expect(getComputedStyle(scrollers[1] as Element).fontSize).toBe('13px');
    fontSize.set(16);
    expect(getComputedStyle(scrollers[0] as Element).fontSize).toBe('16px');
    expect(getComputedStyle(scrollers[1] as Element).fontSize).toBe('16px');
  });

  it('merges into the right side: typed into, or taking the left’s change by its arrow', async () => {
    const onEdit = vi.fn();
    const root = mount({ path: 'a.txt', original: 'disk\nsame', text: 'memory\nsame', onEdit });
    const right = root.querySelectorAll('.cm-editor')[1] as Element;
    // Drawn once the view has measured itself.
    await expect.poll(() => root.querySelector('.cm-merge-revert button')).not.toBeNull();
    await userEvent.click(root.querySelector('.cm-merge-revert button') as Element);
    expect(onEdit).toHaveBeenLastCalledWith('disk\nsame');
    await userEvent.click(right.querySelector('.cm-line') as Element);
    await userEvent.keyboard('{End}!');
    expect(onEdit).toHaveBeenLastCalledWith('disk!\nsame');
    expect(lines(right)).toEqual(['disk!', 'same']);
  });

  it('defaults its settings', () => {
    const root = mount({ path: 'a.md', original: '# a', text: '# b' });
    const scroller = root.querySelector('.cm-scroller') as Element;
    expect(getComputedStyle(scroller).fontSize).toBe('13px');
  });
});

describe('transferLine', () => {
  // Line 1 changed into lines 1 to 3; lines 5 and 6 removed.
  const ranges = [
    { start1: 1, end1: 2, start2: 1, end2: 4 },
    { start1: 5, end1: 7, start2: 7, end2: 7 },
  ];

  it('carries a line across as IntelliJ does: same before, shifted after, inside clamped', () => {
    expect(transferLine(0, ranges)).toBe(0);
    expect(transferLine(1, ranges)).toBe(1);
    // After the first change: shifted by the two lines it added.
    expect(transferLine(2, ranges)).toBe(4);
    expect(transferLine(4, ranges)).toBe(6);
    // In the removed lines: where they were.
    expect(transferLine(5, ranges)).toBe(7);
    expect(transferLine(6, ranges)).toBe(7);
    expect(transferLine(7, ranges)).toBe(7);
    expect(transferLine(9, ranges)).toBe(9);
    // As far into a change as there are lines on the right, at most.
    expect(transferLine(3, [{ start1: 1, end1: 5, start2: 1, end2: 3 }])).toBe(3);
    expect(transferLine(2, [{ start1: 1, end1: 5, start2: 1, end2: 4 }])).toBe(2);
  });
});

describe('diffSource', () => {
  const caret = async (root: ShadowRoot, side: 0 | 1, text: string) => {
    const editor = root.querySelectorAll('.cm-mergeViewEditor .cm-editor')[side] as Element;
    const line = [...editor.querySelectorAll('.cm-line')].find((l) => l.textContent === text);
    await userEvent.click(line as Element);
  };

  it('gives the caret’s place in the file as it is now, carried over from the left', async () => {
    const root = mount({
      path: 'a.ts',
      original: 'one\ntwo\nthree\nfour\n',
      text: 'one\nadded\nmore\ntwo\nfour\n',
    });
    const element = root.host;
    // Before either side has the focus: the right side's caret, at the start.
    expect(diffSource(element)).toEqual({ line: 0, column: 0 });
    await caret(root, 1, 'more');
    expect(diffSource(element)).toMatchObject({ line: 2 });
    // On the left, "four" is after the changes: on the right, a line further down.
    await caret(root, 0, 'four');
    expect(diffSource(element)).toMatchObject({ line: 4 });
    // "three", removed, is where it was.
    await caret(root, 0, 'three');
    expect(diffSource(element)).toMatchObject({ line: 4 });
    expect(diffSource(document.body)).toBeUndefined();
  });

  it('carries a line after a changed one down by the lines it gained', async () => {
    const root = mount({
      path: 'a.ts',
      original: '// Shapes.\nexport class Shape {}\n',
      text: '// Shapes, longer\n// and more.\nexport class Shape {}\n',
    });
    await caret(root, 0, 'export class Shape {}');
    expect(diffSource(root.host)).toMatchObject({ line: 2 });
  });

  it('stays in the right side’s lines, from a line past its end', async () => {
    const root = mount({ path: 'a.ts', original: 'one\ntwo\nthree', text: '' });
    await caret(root, 0, 'three');
    expect(diffSource(root.host)).toEqual({ line: 0, column: expect.any(Number) as number });
  });
});
