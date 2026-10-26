import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
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
