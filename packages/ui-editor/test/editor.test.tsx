import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, languageFor, type CodeEditorProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: CodeEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  // The editor is in the shadow root of the element the component returns.
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

/** Clicks the middle of a word in the editor, with the real mouse. */
async function clickWord(root: ShadowRoot, word: string, modifiers: ('Control' | 'Alt')[] = []) {
  const line = root.querySelector('.cm-line') as HTMLElement;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').indexOf(word);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    const rect = range.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    await userEvent.click(line, {
      position: {
        x: rect.left - box.left + rect.width / 2,
        y: rect.top - box.top + rect.height / 2,
      },
      modifiers,
    });
    return;
  }
  throw new Error(`no ${word}`);
}

/** The colour a piece of text is drawn in. */
function colourOf(container: ShadowRoot, text: string): string {
  const span = [...container.querySelectorAll('.cm-line span')].find((s) => s.textContent === text);
  return span ? getComputedStyle(span).color : 'none';
}

describe('languageFor', () => {
  it('knows the target languages by extension, and nothing else', () => {
    for (const path of [
      'a.ts',
      'a.tsx',
      'a.mts',
      'a.cts',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.jsx',
      'a.json',
      'a.css',
      'a.html',
      'a.htm',
      'a.md',
      'a.py',
      'a.yaml',
      'a.yml',
      'a.sh',
      'a.bash',
      'C:\\src\\A.TS',
    ]) {
      expect(languageFor(path), path).toBeDefined();
    }
    for (const path of ['a.txt', 'Makefile', '.gitignore', 'dir/']) {
      expect(languageFor(path), path).toBeUndefined();
    }
  });
});

describe('CodeEditor', () => {
  it('shows the text with line numbers', () => {
    const container = mount({ path: 'a.txt', text: 'one\ntwo\nthree' });
    expect([...container.querySelectorAll('.cm-line')].map((l) => l.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(container.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length).toBeGreaterThan(
      2,
    );
  });

  it('highlights the file’s language in the theme’s colours', () => {
    const container = mount({ path: 'a.ts', text: 'const answer = "yes"; // why\n' });
    const style = getComputedStyle(document.documentElement);
    const rgb = (hex: string) => {
      const n = parseInt(hex.trim().slice(1), 16);
      return `rgb(${String(n >> 16)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
    };
    expect(colourOf(container, 'const')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-keyword')),
    );
    expect(colourOf(container, '"yes"')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-string')),
    );
    expect(colourOf(container, '// why')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-comment')),
    );
  });

  it('applies the settings as they change', () => {
    const fontSize = signal(13);
    const softWrap = signal(false);
    const tabSize = signal(4);
    const container = mount({
      path: 'a.txt',
      text: `\tindented ${'long '.repeat(80)}`,
      fontSize: () => fontSize.get(),
      softWrap: () => softWrap.get(),
      tabSize: () => tabSize.get(),
    });
    const content = container.querySelector('.cm-content') as HTMLElement;
    const scroller = container.querySelector('.cm-scroller') as HTMLElement;
    expect(getComputedStyle(scroller).fontSize).toBe('13px');
    expect(content.classList.contains('cm-lineWrapping')).toBe(false);
    expect(getComputedStyle(content).tabSize).toBe('4');
    fontSize.set(18);
    softWrap.set(true);
    tabSize.set(2);
    expect(getComputedStyle(scroller).fontSize).toBe('18px');
    expect(content.classList.contains('cm-lineWrapping')).toBe(true);
    expect(getComputedStyle(content).tabSize).toBe('2');
  });

  it('uses its defaults without settings', () => {
    const container = mount({ path: 'a.txt', text: 'x' });
    expect(getComputedStyle(container.querySelector('.cm-scroller') as HTMLElement).fontSize).toBe(
      '13px',
    );
  });

  it('can’t be edited, even by real typing', async () => {
    const container = mount({ path: 'a.txt', text: 'fixed' });
    // Playwright reaches into open shadow roots.
    await userEvent.click(container.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('typed');
    expect(container.querySelector('.cm-line')?.textContent).toBe('fixed');
  });

  it('reveals a position given before it’s in the document, once it is', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
    document.body.append(container);
    const text = Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join('\n');
    const handle = render(
      () => <CodeEditor path="a.txt" text={text} reveal={() => ({ line: 40, column: 0 })} />,
      container,
    );
    cleanup = () => {
      handle.dispose();
      container.remove();
    };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 40');
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
  });

  it('doesn’t reveal in an editor taken away before it could', async () => {
    const detached = document.createElement('div');
    const handle = render(
      () => <CodeEditor path="a.txt" text="x" reveal={() => ({ line: 0, column: 0 })} />,
      detached,
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(document.body);
    handle.dispose();
  });

  it('reveals a position: selected, and scrolled into view', async () => {
    const reveal = signal<{ line: number; column: number } | undefined>(undefined);
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({ path: 'a.txt', text, reveal: () => reveal.get() });
    reveal.set({ line: 250, column: 5 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 250');
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
    // Beyond the end, the last line.
    reveal.set({ line: 9999, column: 0 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 299');
  });

  it('draws the selection in the theme’s colour, focused or not', async () => {
    const root = mount({ path: 'a.txt', text: 'selected text' });
    const expected = getComputedStyle(document.documentElement)
      .getPropertyValue('--cerebro-editor-selection')
      .trim();
    const probe = document.createElement('div');
    probe.style.backgroundColor = expected;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const content = root.querySelector('.cm-content') as HTMLElement;
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}a{/Control}');
    const background = () =>
      getComputedStyle(root.querySelector('.cm-selectionBackground') as HTMLElement)
        .backgroundColor;
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-editor')?.classList.contains('cm-focused')).toBe(true);
      expect(background()).toBe(colour);
    });
    content.blur();
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-editor')?.classList.contains('cm-focused')).toBe(false);
      expect(background()).toBe(colour);
    });
  });

  it('goes to a definition with Mod+B or Mod+click, and finds usages with Alt+F7', async () => {
    const onGoToDefinition = vi.fn();
    const onFindUsages = vi.fn();
    const root = mount({
      path: 'a.ts',
      text: 'const answer = compute(1);',
      onGoToDefinition,
      onFindUsages,
    });
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(onGoToDefinition).toHaveBeenLastCalledWith('answer');
    await userEvent.keyboard('{Alt>}{F7}{/Alt}');
    expect(onFindUsages).toHaveBeenLastCalledWith('answer');
    await clickWord(root, 'compute', ['Control']);
    expect(onGoToDefinition).toHaveBeenLastCalledWith('compute');
  });

  it('leaves the keys alone without handlers, or off a word', async () => {
    const root = mount({ path: 'a.ts', text: 'x   y' });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Control>}b{/Control}{Alt>}{F7}{/Alt}');
    const onGoToDefinition = vi.fn();
    cleanup?.();
    const spaced = mount({ path: 'a.ts', text: '   ', onGoToDefinition, onFindUsages: vi.fn() });
    await userEvent.click(spaced.querySelector('.cm-line') as HTMLElement, {
      modifiers: ['Control'],
    });
    await userEvent.keyboard('{Control>}b{/Control}{Alt>}{F7}{/Alt}');
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });

  it('is gone when disposed', () => {
    const root = mount({ path: 'a.txt', text: 'x' });
    expect(root.querySelector('.cm-editor')).not.toBeNull();
    cleanup?.();
    cleanup = undefined;
    expect(root.querySelector('.cm-editor')).toBeNull();
  });

  it('styles itself with constructable stylesheets, not <style> elements', () => {
    const before = document.querySelectorAll('style').length;
    const root = mount({ path: 'a.ts', text: 'const x = 1;' });
    expect(document.querySelectorAll('style').length).toBe(before);
    expect(root.adoptedStyleSheets.length).toBeGreaterThan(0);
  });
});
