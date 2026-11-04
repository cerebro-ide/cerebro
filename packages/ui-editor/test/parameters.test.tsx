import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  PARAMETERS_AFTER,
  type AskSignatures,
  type CodeEditorProps,
  type Signatures,
} from '../src/index.js';
import { parametersView } from '../src/parameters.js';

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

/** TypeScript's server's answer in `add(1, |` (measured), as the host has it. */
const ADD: Signatures = {
  signatures: [
    {
      label: 'add(a: number, b?: number): number',
      parameters: [
        { from: 4, to: 13 },
        { from: 15, to: 25 },
      ],
      active: 1,
    },
  ],
  active: 0,
};

const TEXT = 'const n = 1;\n\n\n\nadd(1, 2);\n';

const info = (root: ShadowRoot) => root.querySelector<HTMLElement>('.cerebro-parameterInfo');

describe('Parameter Info', () => {
  it('shows each signature’s parameters, the one the caret is at in bold', () => {
    const view = parametersView({
      signatures: [
        ...ADD.signatures,
        { label: 'add(): number', parameters: [] },
        { label: '(x)', parameters: [{ from: 1, to: 2 }] },
      ],
      active: 0,
    });
    const rows = [...view.children] as HTMLElement[];
    expect(rows.map((row) => row.textContent)).toEqual([
      'a: number, b?: number',
      '<no parameters>',
      'x',
    ]);
    expect(rows[0]?.querySelector('strong')?.textContent).toBe('b?: number');
    // The call's own is marked when there are others.
    expect(
      rows.map((row) => row.classList.contains('cerebro-parameterInfo__signature--current')),
    ).toEqual([true, false, false]);
    expect(rows[2]?.querySelector('strong')).toBeNull();
    // Only one: none marked.
    const one = parametersView(ADD).firstElementChild as HTMLElement;
    expect(one.classList.contains('cerebro-parameterInfo__signature--current')).toBe(false);
  });

  it('shows on its keys, above the caret, follows the caret, and goes outside the call or on Escape', async () => {
    const ask = vi.fn<AskSignatures>(({ line, column }) =>
      Promise.resolve(line === 4 && column >= 4 && column <= 8 ? ADD : null),
    );
    const root = mount({ document: new EditorDocument(TEXT), parameterInfo: ask });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard(
      '{Control>}{Home}{/Control}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Control>}p{/Control}',
    );
    // Outside a call: nothing.
    await expect.poll(() => ask).toHaveBeenCalledWith({ line: 4, column: 0 });
    expect(info(root)).toBeNull();
    for (let n = 0; n < 7; n++) await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{Control>}p{/Control}');
    await expect.poll(() => info(root)?.textContent).toBe('a: number, b?: number');
    expect(info(root)?.classList.contains('cm-tooltip')).toBe(true);
    // Above the caret's line, not over its text.
    const line = (root.querySelectorAll('.cm-line')[4] as HTMLElement).getBoundingClientRect();
    expect((info(root) as HTMLElement).getBoundingClientRect().bottom).toBeLessThan(
      line.top + line.height / 2,
    );
    // It asks again as the caret moves, and goes once the caret's out of the call.
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => ask).toHaveBeenLastCalledWith({ line: 4, column: 8 });
    expect(info(root)).not.toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    await expect.poll(() => info(root)).toBeNull();
    await userEvent.keyboard('{ArrowLeft}{Control>}p{/Control}');
    await expect.poll(() => info(root)).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(info(root)).toBeNull();
    // Escape with none shown is the editor's.
    await userEvent.keyboard('{Escape}');
    expect(info(root)).toBeNull();
  });

  it('shows after a moment once a call’s ( or a , is typed, and on the keys the keymap gives', async () => {
    const ask = vi.fn<AskSignatures>(() => Promise.resolve(ADD));
    const root = mount({
      document: new EditorDocument(''),
      parameterInfo: ask,
      keys: () => ({ parameterInfo: ['F9'] }),
    });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('add');
    expect(ask).not.toHaveBeenCalled();
    await userEvent.keyboard('(');
    const typed = performance.now();
    await expect.poll(() => info(root), { timeout: PARAMETERS_AFTER * 3 }).not.toBeNull();
    expect(performance.now() - typed).toBeGreaterThanOrEqual(PARAMETERS_AFTER - 50);
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{F9}');
    await expect.poll(() => info(root)).not.toBeNull();
  });

  it('stays hidden after Escape, though a , was typed while it showed', async () => {
    const ask = vi.fn<AskSignatures>(() => Promise.resolve(ADD));
    const root = mount({ document: new EditorDocument(TEXT), parameterInfo: ask });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}{End}{/Control}{Control>}p{/Control}');
    await expect.poll(() => info(root)).not.toBeNull();
    await userEvent.keyboard('x(1,');
    await userEvent.keyboard('{Escape}');
    expect(info(root)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, PARAMETERS_AFTER + 200));
    expect(info(root)).toBeNull();
  });

  it('hides on Escape though a completion was asked as one typed, with no list shown', async () => {
    const ask = vi.fn<AskSignatures>(() => Promise.resolve(ADD));
    const completions = vi.fn(() =>
      Promise.resolve({ incomplete: false, items: [{ label: 'add' }] }),
    );
    const root = mount({ document: new EditorDocument(''), parameterInfo: ask, completions });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('add');
    await expect.poll(() => root.querySelector('.cm-tooltip-autocomplete')).not.toBeNull();
    await userEvent.keyboard('(1, {Control>}p{/Control}');
    await expect.poll(() => info(root)).not.toBeNull();
    // Not a list: CodeMirror keeps one disabled, with nothing to choose, once `(` is typed.
    expect(root.querySelector('.cm-tooltip-autocomplete-disabled')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(info(root)).toBeNull();
  });

  it('shows only the latest answer, for the text and caret it was asked for', async () => {
    const answers: ((found: Signatures | null) => void)[] = [];
    const ask = vi.fn<AskSignatures>(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    const root = mount({ document: new EditorDocument(TEXT), parameterInfo: ask });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard(
      '{Control>}{Home}{/Control}{Control>}p{/Control}{Control>}p{/Control}',
    );
    await expect.poll(() => answers.length).toBe(2);
    // The first, after the second was asked: not shown.
    answers[0]?.(ADD);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(info(root)).toBeNull();
    // An answer after the caret moved: not shown.
    await userEvent.keyboard('{ArrowRight}');
    answers[1]?.(ADD);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(info(root)).toBeNull();
    // After the editor's gone: not shown, and nothing's asked.
    await userEvent.keyboard('{Control>}p{/Control}');
    await expect.poll(() => answers.length).toBe(3);
    await userEvent.keyboard('x(');
    cleanup?.();
    cleanup = undefined;
    answers[2]?.(ADD);
    await new Promise((resolve) => setTimeout(resolve, PARAMETERS_AFTER + 100));
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('is left out without what to ask', async () => {
    const root = mount({ document: new EditorDocument(TEXT) });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}p{/Control}(');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(info(root)).toBeNull();
  });
});
