import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EditorView } from '@codemirror/view';
import {
  DiffEditor,
  diffSource,
  transferLine,
  type DiffControl,
  type DiffEditorProps,
  type HighlightPolicy,
  type IgnorePolicy,
} from '../src/index.js';
import { foldedLines, unfoldedAt } from '../src/diff.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
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
  const sides = (root: ShadowRoot) => [
    root.querySelector('.cm-diff-a') as Element,
    root.querySelector('.cm-diff-b') as Element,
  ];
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  it('shows the committed text on the left and the current on the right, changes marked by kind', () => {
    const root = mount({
      path: 'a.ts',
      original: 'const a = 1;\nconst same = 0;\n',
      text: 'const a = 2;\nconst same = 0;\nconst added = 3;\n',
    });
    const [left, right] = sides(root) as [Element, Element];
    expect(lines(left)).toEqual(['const a = 1;', 'const same = 0;', '']);
    expect(lines(right)).toContain('const added = 3;');
    expect(left.querySelector('.cm-diff-line')?.textContent).toBe('const a = 1;');
    expect([...right.querySelectorAll('.cm-diff-line')].map((l) => l.textContent)).toEqual([
      'const a = 2;',
      'const added = 3;',
    ]);
    // In IntelliJ's colours: a modified line lighter, its changed text in the full colour.
    const modified = right.querySelector('.cm-diff-modified') as Element;
    const word = right.querySelector('.cm-diff-word-modified') as Element;
    expect(word.textContent).toBe('2');
    expect(getComputedStyle(word).backgroundColor).toBe('rgb(56, 85, 112)');
    expect(getComputedStyle(modified).backgroundColor).not.toBe('rgb(56, 85, 112)');
    const added = right.querySelector('.cm-diff-inserted') as Element;
    expect(getComputedStyle(added).backgroundColor).toBe('rgb(41, 68, 54)');
    // Its lines' numbers too; on the left, a line where the added one would be.
    expect(right.querySelectorAll('.cm-gutterElement.cm-diff-gutter-inserted')).toHaveLength(1);
    expect(left.querySelector('.cm-diff-before-inserted')?.textContent).toBe('');
    // Scrollbars avoid both sides' gutters.
    expect(root.querySelectorAll('.cm-gutters[data-scrollbar-obstacle]')).toHaveLength(2);
  });

  it('joins each change across the divider, and each fold', async () => {
    const original = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`);
    const text = original.with(20, 'changed');
    const root = mount({ path: 'a.txt', original: original.join('\n'), text: text.join('\n') });
    await expect.poll(() => root.querySelectorAll('.cm-diff-divider path').length).toBe(1);
  });

  it('is as wide as the longest line on each side, though it isn’t drawn', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i)}`);
    lines[2500] = 'x'.repeat(400);
    const root = mount({ path: 'a.txt', original: lines.join('\n'), text: lines.join('\n') });
    await frame();
    await frame();
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
    const right = sides(root)[1] as Element;
    // Drawn in the next frame.
    await expect.poll(() => root.querySelector('.cm-diff-take')).not.toBeNull();
    await userEvent.click(root.querySelector('.cm-diff-take') as Element);
    expect(onEdit).toHaveBeenLastCalledWith('disk\nsame');
    await userEvent.click(right.querySelector('.cm-line') as Element);
    await userEvent.keyboard('{End}!');
    expect(onEdit).toHaveBeenLastCalledWith('disk!\nsame');
    expect(lines(right)).toEqual(['disk!', 'same']);
    // Diffed again: the change typed is marked.
    await expect.poll(() => right.querySelector('.cm-diff-word-inserted')?.textContent).toBe('!');
  });

  it('takes a change at the text’s end, with no last newline', async () => {
    const onEdit = vi.fn();
    const root = mount({ path: 'a.txt', original: 'same\nold', text: 'same', onEdit });
    await expect.poll(() => root.querySelector('.cm-diff-take')).not.toBeNull();
    await userEvent.click(root.querySelector('.cm-diff-take') as Element);
    expect(onEdit).toHaveBeenLastCalledWith('same\nold');
  });

  it('takes each kind of change, at the text’s ends too', async () => {
    const taken = async (original: string, text: string) => {
      const onEdit = vi.fn();
      const root = mount({ path: 'a.txt', original, text, onEdit });
      await expect.poll(() => root.querySelector('.cm-diff-take')).not.toBeNull();
      await userEvent.click(root.querySelector('.cm-diff-take') as Element);
      cleanup?.();
      cleanup = undefined;
      return onEdit.mock.lastCall?.[0] as string;
    };
    // A line removed on the right, a line added there, the right's last lines added.
    expect(await taken('a\nb\nc', 'a\nc')).toBe('a\nb\nc');
    expect(await taken('a\nc', 'a\nb\nc')).toBe('a\nc');
    expect(await taken('a', 'a\nb\nc')).toBe('a');
    // The right's lines, last ones too, for the left's; into an empty text.
    expect(await taken('x', 'y\nz')).toBe('x');
    expect(await taken('x', '')).toBe('x');
  });

  it('compares by the ignore and highlighting policies, again as they change', async () => {
    const ignore = signal<IgnorePolicy>('none');
    const highlight = signal<HighlightPolicy>('words');
    const root = mount({
      path: 'a.ts',
      original: 'const a = 1;\n  same();\n',
      text: 'const a = 2;\nsame();\n',
      ignore: () => ignore.get(),
      highlight: () => highlight.get(),
    });
    const [left, right] = sides(root) as [Element, Element];
    const marked = () => [...right.querySelectorAll('.cm-diff-line')].map((l) => l.textContent);
    // The left's: the indent taken out is marked there alone.
    const words = () => left.querySelectorAll('[class*="cm-diff-word-"]').length;
    expect(marked()).toEqual(['const a = 2;', 'same();']);
    expect(words()).toBe(2);
    ignore.set('trim');
    await expect.poll(marked).toEqual(['const a = 2;']);
    expect(words()).toBe(1);
    highlight.set('lines');
    await expect.poll(words).toBe(0);
    expect(right.querySelector('.cm-diff-words')).toBeNull();
    highlight.set('none');
    await expect.poll(marked).toEqual([]);
  });

  it('shows whitespace, line numbers, indent guides and soft wraps as asked, again as they change', async () => {
    const shown = {
      lineNumbers: signal(true),
      whitespace: signal(false),
      indentGuides: signal(false),
      softWrap: signal(false),
    };
    const root = mount({
      path: 'a.ts',
      original: 'if (a) {\n    b();\n}\n',
      text: 'if (a) {\n    c();\n}\n',
      lineNumbers: () => shown.lineNumbers.get(),
      whitespace: () => shown.whitespace.get(),
      indentGuides: () => shown.indentGuides.get(),
      softWrap: () => shown.softWrap.get(),
    });
    const count = (selector: string) => root.querySelectorAll(selector).length;
    // IntelliJ's defaults: line numbers alone.
    expect(count('.cm-lineNumbers')).toBe(2);
    expect(count('.cm-highlightSpace')).toBe(0);
    expect(count('.cm-indentGuide')).toBe(0);
    expect(count('.cm-lineWrapping')).toBe(0);
    shown.lineNumbers.set(false);
    shown.whitespace.set(true);
    shown.indentGuides.set(true);
    shown.softWrap.set(true);
    await expect.poll(() => count('.cm-lineNumbers')).toBe(0);
    // Each side: the indent, and the spaces between words.
    expect(count('.cm-highlightSpace')).toBeGreaterThanOrEqual(2);
    await expect.poll(() => count('.cm-indentGuide')).toBe(2);
    expect(count('.cm-lineWrapping')).toBe(2);
  });

  it('defaults its settings', () => {
    const root = mount({ path: 'a.md', original: '# a', text: '# b' });
    const scroller = root.querySelector('.cm-scroller') as Element;
    expect(getComputedStyle(scroller).fontSize).toBe('13px');
    expect(root.querySelector('.cm-diff-fold')).toBeNull();
  });
});

describe('collapsing unchanged fragments', () => {
  // 100 lines, the 51st changed.
  const original = Array.from({ length: 100 }, (_, i) => `line ${String(i)}`);
  const text = original.with(50, 'changed');
  const folds = (root: ShadowRoot, side: 'a' | 'b') =>
    [...root.querySelectorAll(`.cm-diff-${side} .cm-diff-fold`)].map((f) =>
      f.getAttribute('aria-label'),
    );

  it('folds the lines more than 4 from a change, shows more of them when clicked, then all', async () => {
    const collapse = signal(true);
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      collapse: () => collapse.get(),
    });
    await expect.poll(() => folds(root, 'a')).toEqual(['46 unchanged lines', '45 unchanged lines']);
    expect(folds(root, 'b')).toEqual(['46 unchanged lines', '45 unchanged lines']);
    // The lines kept: 4 each side of the change.
    expect(lines(root.querySelector('.cm-diff-b') as Element)).toEqual(
      expect.arrayContaining(['line 46', 'changed', 'line 54']) as string[],
    );
    expect(lines(root.querySelector('.cm-diff-b') as Element)).not.toContain('line 45');
    // Joined across the divider, as the change is.
    await expect.poll(() => root.querySelectorAll('.cm-diff-divider path').length).toBe(3);
    // Clicked: 4 more lines each side, then 8 more, then all, on both sides.
    const first = () => root.querySelector('.cm-diff-b .cm-diff-fold') as Element;
    await userEvent.click(first());
    await expect.poll(() => folds(root, 'a')).toEqual(['42 unchanged lines', '45 unchanged lines']);
    await userEvent.click(first());
    await expect.poll(() => folds(root, 'b')).toEqual(['34 unchanged lines', '45 unchanged lines']);
    await userEvent.click(first());
    await expect.poll(() => folds(root, 'b')).toEqual(['45 unchanged lines']);
    // Turned off, nothing's folded; on again, all is, as IntelliJ's toggle refolds.
    collapse.set(false);
    await expect.poll(() => folds(root, 'b')).toEqual([]);
    collapse.set(true);
    await expect.poll(() => folds(root, 'b')).toEqual(['46 unchanged lines', '45 unchanged lines']);
  });

  it('leaves the lines of context asked for by each change, folded again as they change', async () => {
    const context = signal(2);
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      collapse: () => true,
      context: () => context.get(),
    });
    await expect.poll(() => folds(root, 'b')).toEqual(['48 unchanged lines', '47 unchanged lines']);
    await expect.poll(() => root.querySelectorAll('.cm-diff-divider path').length).toBe(3);
    // Shown more: twice as many.
    await userEvent.click(root.querySelector('.cm-diff-b .cm-diff-fold') as Element);
    await expect.poll(() => folds(root, 'b')).toEqual(['46 unchanged lines', '47 unchanged lines']);
    context.set(8);
    await expect.poll(() => folds(root, 'b')).toEqual(['42 unchanged lines', '41 unchanged lines']);
  });

  it('shows all at once a fold too short to keep folding', async () => {
    // 12 unchanged lines before the change: 8 folded, then 4, then too few at 16 lines of context.
    const root = mount({
      path: 'a.txt',
      original: original.slice(0, 14).join('\n'),
      text: original.slice(0, 14).with(12, 'changed').join('\n'),
      collapse: () => true,
    });
    await expect.poll(() => folds(root, 'b')).toEqual(['8 unchanged lines']);
    await userEvent.click(root.querySelector('.cm-diff-b .cm-diff-fold') as Element);
    await expect.poll(() => folds(root, 'b')).toEqual(['4 unchanged lines']);
    await userEvent.click(root.querySelector('.cm-diff-b .cm-diff-fold') as Element);
    await expect.poll(() => folds(root, 'b')).toEqual([]);
  });
});

describe('foldedLines', () => {
  const changes = [{ start1: 10, end1: 11, start2: 10, end2: 12 }];

  it('keeps context around changes, the more the deeper, and folds no fewer than 2 lines', () => {
    expect(foldedLines(changes, 0, 'a', 30, 0)).toEqual({ from: 0, to: 6 });
    expect(foldedLines(changes, 0, 'a', 30, 1)).toEqual({ from: 0, to: 2 });
    expect(foldedLines(changes, 0, 'a', 30, 2)).toBeUndefined();
    expect(foldedLines(changes, 1, 'a', 30, 0)).toEqual({ from: 15, to: 30 });
    expect(foldedLines(changes, 1, 'b', 30, 0)).toEqual({ from: 16, to: 30 });
    expect(foldedLines(changes, 1, 'b', 30, 3)).toBeUndefined();
    expect(foldedLines([], 0, 'a', 1, 0)).toBeUndefined();
  });

  it('unfolds as little as shows a line: each fold over it a level deeper till it isn’t', () => {
    expect(unfoldedAt([0, 0], changes, 'a', 30, 3)).toEqual([1, 0]);
    expect(unfoldedAt([0, 0], changes, 'a', 30, 0)).toEqual([2, 0]);
    expect(unfoldedAt([0, 0], changes, 'a', 30, 20)).toEqual([0, 2]);
    // Shown already: as it was.
    expect(unfoldedAt([0, 3], changes, 'a', 30, 12)).toEqual([0, 3]);
  });
});

describe('synchronized scrolling', () => {
  // 300 lines, 20 more added on the right after the 100th.
  const original = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`);
  const added = Array.from({ length: 20 }, (_, i) => `added ${String(i)}`);
  const text = [...original.slice(0, 100), ...added, ...original.slice(100)];
  const scrollers = (root: ShadowRoot) =>
    [...root.querySelectorAll<HTMLElement>('.cm-scroller')] as [HTMLElement, HTMLElement];
  /** The line a third of the way down a side. */
  const third = (scroller: HTMLElement) => {
    const box = scroller.getBoundingClientRect();
    const root = scroller.getRootNode() as ShadowRoot;
    const at = root.elementsFromPoint(box.left + 80, box.top + box.height / 3);
    return at.find((e) => e.classList.contains('cm-line'))?.textContent;
  };

  it('draws the side it scrolled at once, though CodeMirror hasn’t seen it on screen yet', async () => {
    // CodeMirror (6.43.14) ignores a scroll made before its IntersectionObserver first reports, and
    // doesn't measure when it does: the left stayed drawn at the top, a gap where it was scrolled
    // to (CI, #223 and #245). An observer that never reports makes that moment last.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    const root = mount({ path: 'a.txt', original: original.join('\n'), text: text.join('\n') });
    const [left, right] = scrollers(root);
    await expect.poll(() => right.scrollTop).toBeGreaterThan(0);
    await expect.poll(() => third(left)).toMatch(/^line \d+$/);
  });

  it('scrolls the other side to the same line, carried across the changes', async () => {
    const sync = signal(true);
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      syncScroll: () => sync.get(),
    });
    const [left, right] = scrollers(root);
    // To start with, at the first change, the left keeping up. The diff scrolls there at its first
    // measure, which undoes a scroll made before it: measured, the right set to line 200 at once
    // was back at the first change a frame later (2065 of 7048), as CI once found it.
    await expect.poll(() => right.scrollTop).toBeGreaterThan(0);
    /** What's a third of the way down a side, for when no line is: CI once found none on the left. */
    const under = (scroller: HTMLElement) => {
      const box = scroller.getBoundingClientRect();
      const root = scroller.getRootNode() as ShadowRoot;
      const at = root.elementsFromPoint(box.left + 80, box.top + box.height / 3);
      const lines = scroller.querySelectorAll('.cm-line');
      return `scrolled ${String(scroller.scrollTop)} of ${String(scroller.scrollHeight)}, ${String(lines.length)} lines drawn (${String(lines[0]?.textContent)} to ${String(lines[lines.length - 1]?.textContent)}), at the point: ${at
        .slice(0, 3)
        .map((e) => e.className)
        .join(' < ')}`;
    };
    await expect.poll(() => third(left) ?? `no line: ${under(left)}`).toMatch(/^line \d+$/);
    const level = () => {
      const [a, b] = [third(left), third(right)];
      if (a !== undefined && a === b) return a;
      return `${String(a)} ≠ ${String(b)}; left ${under(left)}; right ${under(right)}`;
    };
    right.scrollTop = 200 * 22;
    await expect.poll(level).toMatch(/^line \d+$/);
    // Off, the other side stays; on again, it catches up.
    sync.set(false);
    const before = left.scrollTop;
    right.scrollTop = 250 * 22;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(left.scrollTop).toBe(before);
    sync.set(true);
    await expect.poll(level).toMatch(/^line 2\d\d$/);
    // From the left, the right follows.
    left.scrollTop = 20 * 22;
    await expect.poll(level).toMatch(/^line \d\d$/);
  });
});

describe('aligning changes', () => {
  /** Where a side's line with `text` starts and ends, down from its text's top. */
  const place = (root: ShadowRoot, side: 'a' | 'b', text: string) => {
    const editor = root.querySelector(`.cm-diff-${side}`) as Element;
    const top = (editor.querySelector('.cm-content') as Element).getBoundingClientRect().top;
    const line = [...editor.querySelectorAll('.cm-line')].find((l) => l.textContent === text);
    const rect = (line as Element).getBoundingClientRect();
    return [Math.round(rect.top - top), Math.round(rect.bottom - top)];
  };
  const room = (root: ShadowRoot, side: 'a' | 'b') =>
    [...root.querySelectorAll<HTMLElement>(`.cm-diff-${side} .cm-diff-spacer`)].map((spacer) => [
      spacer.className.replace('cm-diff-spacer cm-diff-spacer-', ''),
      Math.round(spacer.getBoundingClientRect().height),
    ]);

  it('lines each change up on both sides, filling out the shorter, when turned on', async () => {
    const align = signal(true);
    const ignore = signal<IgnorePolicy>('whitespacesAndEmptyLines');
    const root = mount({
      path: 'a.txt',
      // A line made three, a blank line not a difference above, two lines removed, one added.
      original: ['top', 'x', 'one', 'kept', 'gone 1', 'gone 2', 'more', 'end'].join('\n'),
      text: ['top', '', 'x', 'one 1', 'one 2', 'one 3', 'kept', 'more', 'added', 'end'].join('\n'),
      ignore: () => ignore.get(),
      align: () => align.get(),
    });
    const line = 22;
    // Above the first change, room for the blank line; below it, for the two lines more.
    await expect
      .poll(() => room(root, 'a'))
      .toEqual([
        ['modified', line],
        ['modified', 2 * line],
        ['inserted', line],
      ]);
    expect(room(root, 'b')).toEqual([['deleted', 2 * line]]);
    expect(place(root, 'a', 'one')[0]).toBe(place(root, 'b', 'one 1')[0]);
    expect(place(root, 'a', 'kept')).toEqual(place(root, 'b', 'kept'));
    expect(place(root, 'a', 'more')).toEqual(place(root, 'b', 'more'));
    expect(place(root, 'a', 'end')).toEqual(place(root, 'b', 'end'));
    // Joined across level, each change's room in its joint: the left's ends at the right's.
    const joints = () =>
      [...root.querySelectorAll('.cm-diff-divider path')].map((path) => {
        const y = (path.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
        // M0 a1 C… w b1 L w b2 C… 0 a2: the left's top and bottom, then the right's.
        return [y[1], y[15], y[7], y[9]].map((n) => Math.round(n as number)) as [
          number,
          number,
          number,
          number,
        ];
      });
    await expect
      .poll(() => joints().map(([a1, a2, b1, b2]) => a1 === b1 && a2 === b2 && a2 > a1))
      .toEqual([true, true, true]);
    // Where lines are missing, in their change's colour, lighter; none for a modified change's.
    const colour = (side: 'a' | 'b', kind: string) =>
      getComputedStyle(root.querySelector(`.cm-diff-${side} .cm-diff-spacer-${kind}`) as Element)
        .backgroundColor;
    expect(colour('b', 'deleted')).toMatch(/^color\(srgb .* 0\.78\)$|^rgba\(.*, 0\.78\d*\)$/);
    expect(colour('a', 'inserted')).toMatch(/^color\(srgb .* 0\.78\)$|^rgba\(.*, 0\.78\d*\)$/);
    expect(colour('a', 'modified')).toBe('rgba(0, 0, 0, 0)');
    // The blank line a difference: room for it instead of above the next, the rest as it was.
    ignore.set('none');
    await expect
      .poll(() => room(root, 'a'))
      .toEqual([
        ['inserted', line],
        ['modified', 2 * line],
        ['inserted', line],
      ]);
    expect(room(root, 'b')).toEqual([['deleted', 2 * line]]);
    expect(place(root, 'a', 'end')).toEqual(place(root, 'b', 'end'));
    // Off: as they are.
    align.set(false);
    await expect.poll(() => room(root, 'a')).toEqual([]);
    expect(room(root, 'b')).toEqual([]);
    expect(place(root, 'a', 'end')).not.toEqual(place(root, 'b', 'end'));
  });

  it('lines up a change at the text’s end, and scrolls both sides as one', async () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const text = [...original.slice(0, 10), 'new', ...original.slice(10)].slice(0, 50);
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      align: () => true,
    });
    const [left, right] = root.querySelectorAll<HTMLElement>('.cm-scroller') as unknown as [
      HTMLElement,
      HTMLElement,
    ];
    await expect.poll(() => room(root, 'a')).toEqual([['inserted', 22]]);
    right.scrollTop = 300;
    await expect.poll(() => left.scrollTop).toBe(300);
    expect(place(root, 'a', 'line 30')).toEqual(place(root, 'b', 'line 30'));
    // Eleven lines gone at the right's end: room for them after its last, as high as the left's.
    left.scrollTop = 10_000;
    await expect.poll(() => room(root, 'b')).toEqual([['deleted', 11 * 22]]);
    await expect.poll(() => right.scrollTop).toBe(left.scrollTop);
    expect(place(root, 'a', 'line 48')).toEqual(place(root, 'b', 'line 48'));
  });
});

describe('previous and next difference', () => {
  it('starts at the first change, and goes to the one after the caret, or before', async () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const text = original.with(10, 'one').with(30, 'two').with(50, 'three');
    let control: DiffControl | undefined;
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      control: (c) => {
        control = c;
      },
    });
    const diff = control as DiffControl;
    expect(diffSource(root.host)).toEqual({ line: 10, column: 0 });
    expect(diff.hasPrevious()).toBe(false);
    expect(diff.hasNext()).toBe(true);
    diff.next();
    expect(diffSource(root.host)).toEqual({ line: 30, column: 0 });
    diff.next();
    expect(diffSource(root.host)).toEqual({ line: 50, column: 0 });
    expect(diff.hasNext()).toBe(false);
    diff.next();
    expect(diffSource(root.host)).toEqual({ line: 50, column: 0 });
    diff.previous();
    diff.previous();
    expect(diffSource(root.host)).toEqual({ line: 10, column: 0 });
    diff.previous();
    expect(diffSource(root.host)).toEqual({ line: 10, column: 0 });
    // On the left, from its caret, once it's focused.
    const left = root.querySelector('.cm-diff-a') as Element;
    await userEvent.click(
      [...left.querySelectorAll('.cm-line')].find((l) => l.textContent === 'line 12') as Element,
    );
    expect(diff.hasPrevious()).toBe(true);
    diff.next();
    expect(diffSource(root.host)).toEqual({ line: 30, column: 0 });
  });

  it('starts at the last change if asked, as IntelliJ coming back from the next file', () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    let control: DiffControl | undefined;
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: original.with(10, 'one').with(50, 'three').join('\n'),
      scrollTo: 'lastChange',
      control: (c) => {
        control = c;
      },
    });
    expect(diffSource(root.host)).toEqual({ line: 50, column: 0 });
    expect((control as DiffControl).hasNext()).toBe(false);
    // Focused: the right side, to start with.
    (control as DiffControl).focus();
    expect(root.activeElement).toBe(root.querySelector('.cm-diff-b .cm-content'));
  });
});

describe('a line to start at', () => {
  it('puts the caret on the right’s line asked for, and the left’s beside it, as IntelliJ’s SCROLL_TO_LINE', () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    // Two lines added at 10: the right's 30 is the left's 28.
    const text = [...original.slice(0, 10), 'new', 'new', ...original.slice(10)];
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      scrollTo: { line: 30 },
    });
    expect(diffSource(root.host)).toEqual({ line: 30, column: 0 });
    const left = EditorView.findFromDOM(root.querySelector('.cm-diff-a') as HTMLElement);
    const head = left?.state.selection.main.head ?? -1;
    expect(left?.state.doc.lineAt(head).number).toBe(29);
  });

  it('unfolds the unchanged lines the caret starts in, as IntelliJ’s caret does', () => {
    const original = Array.from({ length: 60 }, (_, i) => `line ${String(i)}`);
    const text = [...original.slice(0, 10), 'new', 'new', ...original.slice(10)];
    const root = mount({
      path: 'a.txt',
      original: original.join('\n'),
      text: text.join('\n'),
      collapse: () => true,
      scrollTo: { line: 40 },
    });
    const [left, right] = [root.querySelector('.cm-diff-a'), root.querySelector('.cm-diff-b')] as [
      Element,
      Element,
    ];
    expect(lines(right)).toContain('line 38');
    expect(lines(left)).toContain('line 38');
    // Folds elsewhere stay: the lines before the change.
    expect(lines(right)).not.toContain('line 0');
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
    const editor = root.querySelectorAll('.cm-editor')[side] as Element;
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
    // Before either side has the focus: the right side's caret, at the first change.
    expect(diffSource(element)).toEqual({ line: 1, column: 0 });
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
