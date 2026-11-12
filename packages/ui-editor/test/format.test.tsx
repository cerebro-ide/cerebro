import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  ALREADY_FORMATTED,
  CodeEditor,
  EditorDocument,
  fileIn,
  formatIn,
  formattedLines,
  reindentIn,
  type FormatWords,
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

  it('formats an editor for a plugin, from the whole text formatted, in its own words', async () => {
    const words: FormatWords = {
      name: 'Reformat Code With Prettier',
      formatted: (lines) => `Prettier: formatted ${String(lines)} lines`,
      unchanged: 'Prettier: no lines changed',
    };
    const format = vi.fn<AskFormat>(() => Promise.resolve({ text: '\n\n\nf(a);\ng( b );\n' }));
    const { doc, root } = await editing(() => Promise.resolve([]));
    const content = root.querySelector('.cm-content') as HTMLElement;
    expect(fileIn(content)).toBe('a.ts');
    expect(formatIn(content, format, words)).toBe(true);
    await expect.poll(() => doc.text.peek().toString()).toBe('\n\n\nf(a);\ng( b );\n');
    expect(format).toHaveBeenCalledWith(undefined);
    await expect.poll(() => hint(root)).toBe('Prettier: formatted 1 lines');
    expect(historyNamesIn(content)?.undo).toBe('Reformat Code With Prettier');
    formatIn(content, format, words);
    await expect.poll(() => hint(root)).toBe('Prettier: no lines changed');
    // Not in an editor, or in one that can't be edited.
    expect(fileIn(document.body)).toBeUndefined();
    expect(formatIn(document.body, format)).toBe(false);
    cleanup?.();
    const readOnly = mount({ text: TEXT });
    const shown = readOnly.querySelector('.cm-content') as HTMLElement;
    expect(fileIn(shown)).toBeUndefined();
    expect(formatIn(shown, format)).toBe(false);
    expect(format).toHaveBeenCalledTimes(2);
  });

  it('reindents every line as the language does with the editor’s indent, undone as one', () => {
    const doc = new EditorDocument('if (a) {\n    b();\n  if (c) {\n d();\n  }\n}\n');
    const root = mount({ document: doc, indent: () => ({ tabs: false, size: 2 }) });
    const content = root.querySelector('.cm-content') as HTMLElement;
    expect(reindentIn(content, 'Reindent File with 2 Spaces')).toBe(true);
    expect(doc.text.peek().toString()).toBe('if (a) {\n  b();\n  if (c) {\n    d();\n  }\n}\n');
    expect(historyNamesIn(content)?.undo).toBe('Reindent File with 2 Spaces');
    expect(reindentIn(document.body, 'Reindent')).toBe(false);
  });

  it('reindents the whole file, though CodeMirror hasn’t parsed it all yet', () => {
    // Parsed as it opens up to a time budget, the rest later: lines past what's parsed get no
    // indentation, and kept theirs (main-browser's test once found a tab left, in CI on #233).
    const block = 'if (a) {\n\tb();\n}\n';
    const doc = new EditorDocument(block.repeat(20_000));
    const root = mount({ document: doc, indent: () => ({ tabs: false, size: 2 }) });
    const content = root.querySelector('.cm-content') as HTMLElement;
    reindentIn(content, 'Reindent File with 2 Spaces');
    expect(doc.text.peek().toString()).not.toContain('\t');
  });
});
