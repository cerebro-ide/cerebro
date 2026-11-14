import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { EditorView } from '@codemirror/view';
import { render } from '@cerebro-ide/jsx';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor } from '../src/index.js';

describe('Scroll Up and Scroll Down', () => {
  it('scroll the text a line on Ctrl+Up and Ctrl+Down, as IntelliJ’s, the caret staying; read-only too', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
    document.body.append(container);
    const text = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join('\n');
    const handle = render(() => <CodeEditor path="a.txt" text={text} />, container);
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    const content = root.querySelector('.cm-content') as HTMLElement;
    const view = EditorView.findFromDOM(content) as EditorView;
    view.focus();
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    view.scrollDOM.scrollTop = 500;
    await frame();
    expect(view.scrollDOM.scrollTop).toBe(500);
    const caret = view.state.selection.main.head;
    await userEvent.keyboard('{Control>}{ArrowDown}{/Control}');
    expect(view.scrollDOM.scrollTop).toBeCloseTo(500 + view.defaultLineHeight, 0);
    await userEvent.keyboard('{Control>}{ArrowUp}{ArrowUp}{/Control}');
    expect(view.scrollDOM.scrollTop).toBeCloseTo(500 - view.defaultLineHeight, 0);
    expect(view.state.selection.main.head).toBe(caret);
    handle.dispose();
    container.remove();
  });
});
