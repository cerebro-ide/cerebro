import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  FOLDS_AFTER,
  type AskFolds,
  type CodeEditorProps,
  type Fold,
} from '../src/index.js';
import { PEEK_AFTER } from '../src/folding.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>, path = 'a.ts') {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 500px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path={path} {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

const lines = (root: ShadowRoot) =>
  [...root.querySelectorAll('.cm-line')].map((line) => line.textContent);
/** Each line's chevron, `open` or `closed`, or '' for none; by where they are. */
const chevrons = (root: ShadowRoot) => {
  // Not CodeMirror's spacer, which keeps the gutter's width.
  const shown = [...root.querySelectorAll<HTMLElement>('.cm-foldGutter .cm-gutterElement')].filter(
    (e) => e.style.visibility !== 'hidden',
  );
  return [...root.querySelectorAll('.cm-line')].map((line) => {
    const { top } = line.getBoundingClientRect();
    const element = shown.find((e) => Math.abs(e.getBoundingClientRect().top - top) < 2);
    const fold = element?.querySelector('.cerebro-fold');
    if (!fold) return '';
    return fold.classList.contains('cerebro-fold--open') ? 'open' : 'closed';
  });
};
const at = (line: number, column: number) => ({ line, column });

const TEXT = [
  '/**',
  ' * Docs.',
  ' */',
  'function f() {',
  '  return 1;',
  '}',
  '// #region Setup',
  'const z = 1;',
  '// #endregion',
  'let a =',
  '  1;',
  '',
].join('\n');

/** As TypeScript's server answers (measured): a block from the space before its brace. */
const FOLDS: Fold[] = [
  { from: at(0, 0), to: at(2, 3), kind: 'comment' },
  // Two more on the block's line, inside it: the biggest is the line's.
  { from: at(3, 13), to: at(4, 4) },
  { from: at(3, 12), to: at(5, 1) },
  { from: at(3, 13), to: at(4, 5) },
  { from: at(6, 0), to: at(8, 13), kind: 'region', collapsedText: 'Setup' },
  // Neither a pair nor named: the lines after its first.
  { from: at(9, 0), to: at(10, 4) },
  // Past the text, and empty: left out.
  { from: at(40, 0), to: at(41, 0) },
  { from: at(4, 2), to: at(4, 2) },
];

describe('folding', () => {
  it('folds where the grammar says with nothing given, a chevron in the gutter clicked', async () => {
    const root = mount({ document: new EditorDocument('function f() {\n  return 1;\n}\n') });
    await expect.poll(() => chevrons(root)[0]).toBe('open');
    await userEvent.click(root.querySelector('.cerebro-fold--open') as HTMLElement);
    expect(lines(root)[0]).toBe('function f() {...}');
    expect(chevrons(root)[0]).toBe('closed');
    // The box clicked unfolds it.
    await userEvent.click(root.querySelector('.cerebro-folded') as HTMLElement);
    expect(lines(root)).toEqual(['function f() {', '  return 1;', '}', '']);
  });

  it('folds all where it’s given, each shown as IntelliJ’s, on Ctrl+Shift+-; and back on Ctrl+Shift+=', async () => {
    const folds = vi.fn<AskFolds>(() => Promise.resolve(FOLDS));
    const root = mount({ document: new EditorDocument(TEXT), folds });
    expect(folds).toHaveBeenCalledWith(TEXT);
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await expect.poll(() => chevrons(root).filter(Boolean).length).toBe(4);
    await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
    expect(lines(root)).toEqual(['/**...*/', 'function f() {...}', 'Setup', 'let a =...', '']);
    await userEvent.keyboard('{Control>}{Shift>}{Equal}{/Shift}{/Control}');
    expect(lines(root)).toEqual(TEXT.split('\n'));
  });

  it('collapses the part around the caret on Ctrl+-, and expands it on Ctrl+=', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      folds: () => Promise.resolve(FOLDS),
    });
    await expect.poll(() => chevrons(root).filter(Boolean).length).toBe(4);
    // In the block's body: the block folds, from the line above.
    await userEvent.click(root.querySelectorAll('.cm-line')[4] as HTMLElement);
    await userEvent.keyboard('{Control>}-{/Control}');
    expect(lines(root)[3]).toBe('function f() {...}');
    await userEvent.keyboard('{Control>}={/Control}');
    expect(lines(root)[4]).toBe('  return 1;');
    // Nothing around it: nothing folds.
    await userEvent.click(root.querySelectorAll('.cm-line')[11] as HTMLElement);
    await userEvent.keyboard('{Control>}-{/Control}');
    expect(root.querySelector('.cerebro-folded')).toBeNull();
  });

  it('moves the folds with edits, and asks again once they settle; the grammar’s with no answer', async () => {
    let answer: readonly Fold[] | null = FOLDS;
    const folds = vi.fn<AskFolds>(() => Promise.resolve(answer));
    const doc = new EditorDocument(TEXT);
    const root = mount({ document: doc, folds });
    await expect.poll(() => chevrons(root).filter(Boolean).length).toBe(4);
    // A line above them all: the ones given move down with it, the region's (the grammar has none).
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    answer = null;
    await userEvent.keyboard('{Home}x{Enter}');
    expect(chevrons(root)[7]).toBe('open');
    await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
    expect(lines(root)).toContain('Setup');
    // Asked again: no answer, so the grammar's, which folds the comment and the block only.
    await vi.waitFor(
      () => {
        expect(folds).toHaveBeenCalledTimes(2);
      },
      { timeout: FOLDS_AFTER * 4 },
    );
    await userEvent.keyboard('{Control>}{Shift>}{Equal}{/Shift}{/Control}');
    await expect.poll(() => chevrons(root).filter(Boolean).length).toBe(2);
  });

  it('folds the imports as it opens, as IntelliJ’s, but where the caret is; not those added later', async () => {
    const text = ["import { a } from './a';", "import { b } from './b';", 'a(b);', ''].join('\n');
    const imports: Fold = { from: at(0, 0), to: at(1, 24), kind: 'imports' };
    // One past the text too, and one of a line that would hide nothing, left out; and a call's
    // parentheses, not imports, left open.
    let answer: readonly Fold[] | null = [
      imports,
      { ...imports, from: at(40, 0), to: at(41, 0) },
      { ...imports, from: at(2, 0), to: at(2, 5) },
      { from: at(2, 1), to: at(2, 4) },
    ];
    const folds = vi.fn<AskFolds>(() => Promise.resolve(answer));
    /** Opened at a line, answered once the caret's there, as a server answers after. */
    const openedAt = async (line: number) => {
      let answering: (() => void) | undefined;
      const root = mount({
        document: new EditorDocument(text),
        folds: () =>
          new Promise((resolve) => {
            answering = () => {
              resolve(answer);
            };
          }),
        reveal: () => ({ line, column: 3 }),
      });
      await expect
        .poll(() => root.querySelector('.cm-activeLine')?.textContent)
        .toBe(text.split('\n')[line]);
      answering?.();
      await expect.poll(() => chevrons(root)[0]).not.toBe('');
      return root;
    };
    // Opened at the top, or below them: folded.
    let root = mount({ document: new EditorDocument(text), folds });
    await expect.poll(() => lines(root)[0]).toBe("import { a } from './a';...");
    expect(lines(root)[1]).toBe('a(b);');
    cleanup?.();
    root = await openedAt(2);
    expect(lines(root)[0]).toBe("import { a } from './a';...");
    cleanup?.();
    // In them: open.
    root = await openedAt(1);
    expect(lines(root)).toEqual(text.split('\n'));
    cleanup?.();
    // No answer at first, then some: they stay open.
    answer = null;
    const doc = new EditorDocument(`\n${text}`);
    root = mount({ document: doc, folds });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    answer = [{ ...imports, from: at(1, 0), to: at(2, 24) }];
    await userEvent.keyboard('x');
    await expect.poll(() => chevrons(root)[1], { timeout: FOLDS_AFTER * 4 }).toBe('open');
    expect(root.querySelector('.cerebro-folded')).toBeNull();
  });

  it('drops an answer to a text since edited, and folds left where its text is gone', async () => {
    const answers: ((folds: readonly Fold[]) => void)[] = [];
    const folds = vi.fn<AskFolds>(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const root = mount({ document: new EditorDocument(TEXT), folds });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('x');
    answers[0]?.(FOLDS);
    await vi.waitFor(
      () => {
        expect(answers).toHaveLength(2);
      },
      { timeout: FOLDS_AFTER * 4 },
    );
    // The region's lines given, then removed whole.
    answers[1]?.([{ from: at(6, 0), to: at(8, 13), collapsedText: 'Setup' }]);
    await expect.poll(() => chevrons(root)[6]).toBe('open');
    await userEvent.click(root.querySelectorAll('.cm-line')[6] as HTMLElement);
    await userEvent.keyboard('{Home}{Shift>}{ArrowDown}{ArrowDown}{End}{/Shift}{Delete}');
    expect(lines(root)[6]).toBe('');
    expect(chevrons(root)[6]).toBe('');
  });

  it('shows a folded part’s lines as the pointer rests on it, as IntelliJ’s; gone as it leaves, at a key, a scroll or a click', async () => {
    const root = mount({ document: new EditorDocument(TEXT), folds: () => Promise.resolve(FOLDS) });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await expect.poll(() => chevrons(root).filter(Boolean).length).toBe(4);
    await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
    const peeked = () =>
      [...root.querySelectorAll('.cerebro-foldPeek .cm-line')].map((line) => line.textContent);
    const box = () => root.querySelectorAll<HTMLElement>('.cerebro-folded')[1] as HTMLElement;
    const started = performance.now();
    await userEvent.hover(box());
    expect(peeked()).toEqual([]);
    // The block's whole lines, highlighted, after a while.
    await expect.poll(peeked).toEqual(['function f() {', '  return 1;', '}']);
    expect(performance.now() - started).toBeGreaterThanOrEqual(PEEK_AFTER);
    expect(
      root.querySelector('.cerebro-foldPeek .tok-keyword, .cerebro-foldPeek span[class]'),
    ).not.toBeNull();
    // Under the fold's line.
    const line = (root.querySelectorAll('.cm-line')[1] as HTMLElement).getBoundingClientRect();
    const tip = () =>
      (root.querySelector('.cerebro-foldPeek') as HTMLElement).getBoundingClientRect().top;
    // Placed once CodeMirror has measured where.
    await expect.poll(tip).toBeGreaterThan(line.top + line.height / 2);
    expect(tip()).toBeLessThan(line.bottom + 4);
    await userEvent.unhover(box());
    expect(peeked()).toEqual([]);
    await userEvent.hover(box());
    await expect.poll(peeked).toHaveLength(3);
    await userEvent.keyboard('{Shift}');
    expect(peeked()).toEqual([]);
    await userEvent.unhover(box());
    await userEvent.hover(box());
    await expect.poll(peeked).toHaveLength(3);
    root.querySelector('.cm-scroller')?.dispatchEvent(new Event('scroll'));
    await expect.poll(peeked).toEqual([]);
    await userEvent.unhover(box());
    await userEvent.hover(box());
    await expect.poll(peeked).toHaveLength(3);
    await userEvent.click(box());
    expect(peeked()).toEqual([]);
    expect(lines(root)[2]).toBe('  return 1;');
    // Unfolded before it shows: nothing shows.
    await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
    await userEvent.hover(box());
    await userEvent.click(box());
    await new Promise((resolve) => setTimeout(resolve, PEEK_AFTER * 2));
    expect(peeked()).toEqual([]);
  });

  it('shows as many of its lines as fit below, in a file of no language too', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount(
      {
        document: new EditorDocument(text),
        folds: () => Promise.resolve([{ from: at(0, 0), to: at(199, 8) }]),
      },
      'a.txt',
    );
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await expect.poll(() => chevrons(root)[0]).toBe('open');
    await userEvent.keyboard('{Control>}{Shift>}{Minus}{/Shift}{/Control}');
    // A scroll with nothing shown changes nothing.
    root.querySelector('.cm-scroller')?.dispatchEvent(new Event('scroll'));
    await userEvent.hover(root.querySelector('.cerebro-folded') as HTMLElement);
    await expect
      .poll(() => root.querySelector('.cerebro-foldPeek .cm-line')?.textContent)
      .toBe('line 0');
    const shown = root.querySelectorAll('.cerebro-foldPeek .cm-line');
    expect(shown.length).toBeLessThan(200);
    const last = (shown[shown.length - 1] as HTMLElement).getBoundingClientRect();
    expect(last.bottom).toBeLessThanOrEqual(window.innerHeight + 2);
  });
});
