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

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 500px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
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
});
