import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, type CodeEditorProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: CodeEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.body.append(container);
  const handle = render(() => <CodeEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  return {
    root,
    scroller: root.querySelector('.cm-scroller') as HTMLElement,
    content: root.querySelector('.cm-content') as HTMLElement,
  };
}

/** After CodeMirror's next measure, which runs on an animation frame. */
const frames = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
};

/** A character's width, measured on a line drawn in the editor. */
function characterWidth(root: ShadowRoot): number {
  const line = root.querySelector('.cm-line') as HTMLElement;
  const range = document.createRange();
  range.selectNodeContents(line);
  return range.getBoundingClientRect().width / line.textContent.length;
}

/** The content's least width for a line of so many columns: the line's padding (2px a side). */
const widthFor = (root: ShadowRoot, columns: number) => columns * characterWidth(root) + 4;

const minWidth = (content: HTMLElement) => parseFloat(content.style.minWidth);

describe('the content’s width', () => {
  it('is the longest line’s, wherever the editor is scrolled', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i)}`);
    // Far below what's drawn at first.
    lines[2500] = 'x'.repeat(400);
    const { scroller } = mount({ path: 'a.txt', text: lines.join('\n') });
    await frames();
    const width = scroller.scrollWidth;
    expect(width).toBeGreaterThan(2000);
    scroller.scrollTop = scroller.scrollHeight;
    await frames();
    // CodeMirror measured the line itself now: no wider.
    expect(scroller.scrollWidth).toBe(width);
    scroller.scrollTop = 0;
    await frames();
    expect(scroller.scrollWidth).toBe(width);
  });

  it('follows edits: a longer line, and the longest made shorter', async () => {
    const doc = new EditorDocument(['a', 'tab\there', 'b'.repeat(100)].join('\n'));
    const { root, content } = mount({ path: 'a.txt', document: doc });
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 100), 0);
    // The first line, longer than the longest.
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard(`{End}${'c'.repeat(20)}`);
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 100), 0);
    // The longest line emptied: the first is the longest now.
    await userEvent.click(root.querySelectorAll('.cm-line')[2] as HTMLElement);
    await userEvent.keyboard('{End}{Shift>}{Home}{/Shift}{Backspace}');
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 21), 0);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}{End}dd');
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 23), 0);
  });

  it('counts tabs at the tab size, as it changes', async () => {
    const tabSize = signal(4);
    const { root, content } = mount({
      path: 'a.txt',
      text: ['abcdefghij', '\t\tx', 'short'].join('\n'),
      tabSize: () => tabSize.get(),
    });
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 10), 0);
    tabSize.set(8);
    await frames();
    expect(minWidth(content)).toBeCloseTo(widthFor(root, 17), 0);
  });

  it('is left to the lines when they wrap', async () => {
    const softWrap = signal(false);
    const { content } = mount({
      path: 'a.txt',
      text: 'x'.repeat(400),
      softWrap: () => softWrap.get(),
    });
    await frames();
    expect(minWidth(content)).toBeGreaterThan(600);
    softWrap.set(true);
    await frames();
    expect(content.style.minWidth).toBe('');
  });
});
