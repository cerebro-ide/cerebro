import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  ALREADY_FORMATTED,
  CodeEditor,
  EditorDocument,
  formattedLines,
  historyNamesIn,
  type AskFormat,
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
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

// Lines above the caret: the hint shows above it.
const TEXT = '\n\n\nf( a );\ng( b );\n';
const at = (line: number, column: number) => ({ line, column });
/** The edits that take the spaces inside the parentheses away, on `lines`. */
const tidy = (...lines: number[]) =>
  lines.flatMap((line) => [
    { from: at(line, 2), to: at(line, 3), text: '' },
    { from: at(line, 4), to: at(line, 5), text: '' },
  ]);

const hint = (root: ShadowRoot) => root.querySelector('.cerebro-hint')?.textContent;

/** An editor on TEXT, the caret at the end. */
async function editing(format: AskFormat, doc = new EditorDocument(TEXT)) {
  const root = mount({ document: doc, format });
  await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
  await userEvent.keyboard('{Control>}{End}{/Control}');
  return { doc, root };
}

describe('Reformat Code', () => {
  it('formats the text on Ctrl+Alt+L, says how many lines changed, and is undone as one', async () => {
    const format = vi.fn<AskFormat>(() => Promise.resolve(tidy(3, 4)));
    const { doc, root } = await editing(format);
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(() => doc.text.peek().toString()).toBe('\n\n\nf(a);\ng(b);\n');
    expect(format).toHaveBeenCalledWith(undefined);
    await expect.poll(() => hint(root)).toBe('Formatted 2 lines');
    expect(historyNamesIn(root.querySelector('.cm-content') as HTMLElement)?.undo).toBe(
      'Reformat Code',
    );
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.text.peek().toString()).toBe(TEXT);
  });

  it('formats the selection, a line of it', async () => {
    const format = vi.fn<AskFormat>(() => Promise.resolve(tidy(4)));
    const { doc, root } = await editing(format);
    await userEvent.keyboard('{ArrowUp}{Shift>}{ArrowUp}{/Shift}');
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    await expect.poll(() => hint(root)).toBe(formattedLines(1));
    expect(format).toHaveBeenCalledWith({ from: at(3, 0), to: at(4, 0) });
    expect(doc.text.peek().toString()).toBe('\n\n\nf( a );\ng(b);\n');
  });

  it('says when nothing changed, or why it wasn’t formatted', async () => {
    const answers: Awaited<ReturnType<AskFormat>>[] = [
      [],
      // As it was: no change.
      [{ from: at(3, 0), to: at(3, 1), text: 'f' }],
      { refused: 'Its language server doesn’t format it.' },
    ];
    const { doc, root } = await editing(() => Promise.resolve(answers.shift() ?? []));
    for (const expected of [
      ALREADY_FORMATTED,
      ALREADY_FORMATTED,
      'Its language server doesn’t format it.',
    ]) {
      await userEvent.keyboard('{ArrowLeft}{Control>}{Alt>}l{/Alt}{/Control}');
      await expect.poll(() => hint(root)).toBe(expected);
    }
    expect(doc.text.peek().toString()).toBe(TEXT);
  });

  it('makes nothing of an answer to text changed since, and isn’t there read-only', async () => {
    let answer!: (edits: Awaited<ReturnType<AskFormat>>) => void;
    const format = vi.fn<AskFormat>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const { doc, root } = await editing(format);
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}x');
    answer(tidy(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(doc.text.peek().toString()).toBe(`${TEXT}x`);
    expect(hint(root)).toBeUndefined();
    cleanup?.();
    const readOnly = mount({ text: TEXT, format });
    await userEvent.click(readOnly.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}{Alt>}l{/Alt}{/Control}');
    expect(format).toHaveBeenCalledTimes(1);
  });
});
