import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, type CodeEditorProps } from '../src/index.js';

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

const popup = (root: ShadowRoot) => root.querySelector('.cerebro-quickDef');

describe('Quick Definition', () => {
  const definition = 'function area() {\n  return 1;\n}';

  it('shows the definition of the symbol at the caret, titled and highlighted, on its keys', async () => {
    const open = vi.fn();
    const ask = vi.fn(() => Promise.resolve({ path: '/r/shape.ts', text: definition, open }));
    const root = mount({ document: new EditorDocument('x = area();\n'), quickDefinition: ask });
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}');
    expect(ask).toHaveBeenCalledWith({ line: 0, column: 5 });
    await expect.poll(() => popup(root)).not.toBeNull();
    const shown = popup(root) as HTMLElement;
    expect(shown.querySelector('.cerebro-quickDef__title')?.textContent).toBe('Definition of area');
    expect(shown.querySelector('.cerebro-quickDef__header')?.textContent).toBe('areashape.ts');
    const lines = [...shown.querySelectorAll('.cm-line')].map((line) => line.textContent);
    expect(lines).toEqual(['function area() {', '  return 1;', '}']);
    // Highlighted as the file's language: `function` a keyword.
    const keyword = [...shown.querySelectorAll('.cm-line span')].find(
      (span) => span.textContent === 'function',
    ) as HTMLElement;
    expect(getComputedStyle(keyword).color).not.toBe(getComputedStyle(shown).color);
    // Escape closes it; Enter then is the editor's again.
    await userEvent.keyboard('{Escape}');
    expect(popup(root)).toBeNull();
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}');
    await expect.poll(() => popup(root)).not.toBeNull();
    // Edit Source: F4, or Enter, opens it.
    await userEvent.keyboard('{F4}');
    expect(open).toHaveBeenCalledTimes(1);
    expect(popup(root)).toBeNull();
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}');
    await expect.poll(() => popup(root)).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(open).toHaveBeenCalledTimes(2);
    expect(popup(root)).toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('shows nothing for no definition, or once the caret has moved; and has no keys without one', async () => {
    let answer: (value: null | { path: string; text: string; open: () => void }) => void = () =>
      undefined;
    const ask = vi.fn(
      () =>
        new Promise<null | { path: string; text: string; open: () => void }>((resolve) => {
          answer = resolve;
        }),
    );
    const root = mount({ document: new EditorDocument('x = area();\n'), quickDefinition: ask });
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}');
    answer(null);
    await userEvent.keyboard('{ArrowRight}{Control>}{Shift>}i{/Shift}{/Control}{ArrowRight}');
    answer({ path: 'b.txt', text: 'plain', open: () => undefined });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(popup(root)).toBeNull();
    // A file of no language, on a place of no word.
    cleanup?.();
    const spaced = mount({ document: new EditorDocument(' \n'), quickDefinition: ask });
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}');
    answer({ path: 'b.txt', text: 'plain', open: () => undefined });
    await expect.poll(() => popup(spaced)).not.toBeNull();
    expect(popup(spaced)?.querySelector('.cerebro-quickDef__title')?.textContent).toBe(
      'Definition of ',
    );
    cleanup?.();
    const none = mount({ document: new EditorDocument('x\n') });
    await userEvent.keyboard('{Control>}{Shift>}i{/Shift}{/Control}{F4}');
    expect(popup(none)).toBeNull();
  });
});
