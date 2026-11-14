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

/** An editor of 200 lines, `height` px high, scrolled to `top` once it's laid out; its view. */
async function scrolledEditor(top: number, height = 300) {
  const container = document.createElement('div');
  container.style.cssText = `position: fixed; left: 0; top: 0; width: 600px; height: ${String(height)}px;`;
  document.body.append(container);
  const text = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join('\n');
  const handle = render(() => <CodeEditor path="a.txt" text={text} />, container);
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const view = EditorView.findFromDOM(
    root.querySelector('.cm-content') as HTMLElement,
  ) as EditorView;
  view.focus();
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  await frame();
  view.scrollDOM.scrollTop = top;
  await frame();
  return {
    view,
    frame,
    /** The number of the line the caret is on, from 0. */
    line: () => view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    close: () => {
      handle.dispose();
      container.remove();
    },
  };
}

describe('Scroll to Center', () => {
  it('scrolls the caret’s line to the middle on Ctrl+M, as IntelliJ’s', async () => {
    const { view, frame, close } = await scrolledEditor(0);
    view.dispatch({ selection: { anchor: view.state.doc.line(101).from } });
    await userEvent.keyboard('{Control>}m{/Control}');
    await frame();
    const line = view.lineBlockAt(view.state.selection.main.head);
    const middle = view.scrollDOM.scrollTop + view.scrollDOM.clientHeight / 2;
    expect(Math.abs(line.top + line.height / 2 - middle)).toBeLessThan(line.height);
    close();
  });
});

describe('Move Caret to Page Top and Bottom', () => {
  it('moves the caret to the first and last lines wholly in view, at its column, on Ctrl+PageUp and Down', async () => {
    const { view, line, close } = await scrolledEditor(0);
    const height = view.defaultLineHeight;
    // Half a line cut off at the top: the next is the first wholly in view.
    view.scrollDOM.scrollTop = 20 * height + height / 2;
    view.dispatch({ selection: { anchor: view.state.doc.line(26).from + 2 } });
    await userEvent.keyboard('{Control>}{PageUp}{/Control}');
    expect(line()).toBe(21);
    expect(view.state.selection.main.head - view.state.doc.line(22).from).toBe(2);
    await userEvent.keyboard('{Control>}{PageDown}{/Control}');
    // The view's bottom, from the text's top as the lines are measured.
    const bottom =
      view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.clientHeight - view.documentTop;
    const last = view.lineBlockAt(view.state.selection.main.head);
    expect(last.bottom).toBeLessThanOrEqual(bottom);
    expect(last.bottom + height).toBeGreaterThan(bottom);
    close();
  });

  it('selects to there with Shift, from where the selection started', async () => {
    const { view, line, close } = await scrolledEditor(0);
    view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    await userEvent.keyboard('{Control>}{Shift>}{PageDown}{/Shift}{/Control}');
    expect(view.state.selection.main.anchor).toBe(view.state.doc.line(5).from);
    const bottom = line();
    expect(bottom).toBeGreaterThan(4);
    await userEvent.keyboard('{Control>}{Shift>}{PageUp}{/Shift}{/Control}');
    expect(view.state.selection.main.anchor).toBe(view.state.doc.line(5).from);
    expect(line()).toBe(0);
    close();
  });

  it('keeps the line cut off at the top where the next doesn’t start in view', async () => {
    const { view, frame, line, close } = await scrolledEditor(0, 10);
    const top = view.lineBlockAt(view.state.doc.line(21).from).top;
    // The view's top 4px into line 20, past what's between the scroller and the text.
    const viewTop = () => view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    view.scrollDOM.scrollTop = top;
    await frame();
    view.scrollDOM.scrollTop = top + (top - viewTop()) + 4;
    await frame();
    expect(viewTop()).toBe(top + 4);
    await userEvent.keyboard('{Control>}{PageUp}{/Control}');
    expect(line()).toBe(20);
    close();
  });

  it('keeps to a line shorter than the caret’s column', async () => {
    const { view, line, close } = await scrolledEditor(0);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.line(1).to, insert: 'x' },
      selection: { anchor: view.state.doc.line(5).to },
    });
    await userEvent.keyboard('{Control>}{PageUp}{/Control}');
    expect(line()).toBe(0);
    expect(view.state.selection.main.head).toBe(1);
    close();
  });
});
