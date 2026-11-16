import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { Text } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, type CodeEditorProps } from '../src/index.js';
import { PREVIEW_AFTER } from '../src/scrollbar-preview.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 300px-high editor on `lines` lines, `line {n}` each. */
async function mount(
  lines: number,
  path = 'a.ts',
  props: Omit<CodeEditorProps, 'path' | 'document'> = {},
) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const text = Array.from({ length: lines }, (_, i) => `const line${String(i + 1)} = 1;`).join(
    '\n',
  );
  const doc = new EditorDocument(text);
  const handle = render(() => <CodeEditor path={path} document={doc} {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  const scroller = root.querySelector('.cm-scroller') as HTMLElement;
  // Once its lines are measured: until then CodeMirror guesses their height.
  await wait(50);
  return { root, scroller, doc };
}

/** What `ui-scrollbar` tells the area as the pointer moves over its bar, or leaves it. */
const hover = (scroller: HTMLElement, clientY: number | null) =>
  scroller.dispatchEvent(new CustomEvent('scrollbar-hover', { detail: clientY }));

const preview = (root: ShadowRoot) => root.querySelector<HTMLElement>('.cerebro-scrollbarPreview');
/** The preview's lines, as their numbers and their text. */
const previewed = (root: ShadowRoot) => {
  const shown = preview(root);
  if (!shown) return [];
  // Not CodeMirror's spacer: hidden, sized for the widest number.
  const numbers = [...shown.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')]
    .filter((element) => element.style.visibility !== 'hidden')
    .map((element) => element.textContent);
  const texts = [...shown.querySelectorAll('.cm-line')].map((line) => line.textContent);
  return texts.map((text, i) => `${numbers[i] ?? ''} ${text}`);
};

describe('the scrollbar’s preview', () => {
  it('shows the lines around one out of view, as IntelliJ’s, after a while, then follows the pointer', async () => {
    const { root, scroller } = await mount(200);
    const { top, height } = scroller.getBoundingClientRect();
    // Near the bar's bottom: line 191 of 200, the text being taller than the area.
    const started = performance.now();
    hover(scroller, top + height * 0.95);
    expect(preview(root)).toBeNull();
    await expect.poll(() => previewed(root).length).toBe(10);
    expect(performance.now() - started).toBeGreaterThanOrEqual(PREVIEW_AFTER);
    const lines = previewed(root);
    expect(lines[0]).toMatch(/^1[89]\d const line1[89]\d = 1;$/);
    const first = Number(lines[0]?.split(' ')[0]);
    expect(lines).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `${String(first + i)} const line${String(first + i)} = 1;`,
      ),
    );
    // Highlighted, left of the bar, at the pointer's height.
    expect(preview(root)?.querySelector('.cm-line span[class]')).not.toBeNull();
    const box = (preview(root) as HTMLElement).getBoundingClientRect();
    const editor = (root.querySelector('.cm-editor') as HTMLElement).getBoundingClientRect();
    expect(editor.right - box.right).toBe(14);
    expect(box.left).toBe(editor.left);
    expect(box.top).toBeLessThan(top + height * 0.95);
    expect(box.bottom).toBeLessThanOrEqual(editor.bottom);
    // Further up: at once.
    hover(scroller, top + height * 0.5);
    expect(previewed(root)[0]).toMatch(/^9\d /);
    // Over the lines that show: gone; and off the bar.
    hover(scroller, top + 2);
    expect(preview(root)).toBeNull();
    hover(scroller, top + height * 0.5);
    await expect.poll(() => preview(root)).not.toBeNull();
    hover(scroller, null);
    expect(preview(root)).toBeNull();
  });

  it('says the problems’ messages at their lines’ ends, as IntelliJ’s, not the usages’', async () => {
    const at = (line: number, from: number, to: number) => ({
      from: { line, column: from },
      to: { line, column: to },
    });
    const { root, scroller } = await mount(200, 'a.ts', {
      problems: () =>
        Promise.resolve([
          { ...at(190, 6, 12), severity: 'error' as const, message: 'Second\n  of two.' },
          { ...at(190, 0, 5), severity: 'warning' as const, message: 'First.' },
          // Hints have no mark: none.
          { ...at(191, 0, 5), severity: 'hint' as const, message: 'Hint.' },
        ]),
      usages: () => Promise.resolve([{ ...at(192, 6, 12), write: false }]),
    });
    await expect.poll(() => root.querySelectorAll('.cerebro-problemMark').length).toBe(2);
    const { top, height } = scroller.getBoundingClientRect();
    hover(scroller, top + height * 0.95);
    await expect.poll(() => previewed(root).length).toBe(10);
    const line = [...(preview(root) as HTMLElement).querySelectorAll('.cm-line')].find((l) =>
      l.textContent.startsWith('const line191 '),
    ) as HTMLElement;
    const labels = [
      ...line.querySelectorAll<HTMLElement>('.cerebro-scrollbarPreview__description'),
    ];
    // In the order they start, on one line, after the line's text.
    expect(labels.map((l) => l.textContent)).toEqual(['First.', 'Second of two.']);
    expect(line.textContent).toBe('const line191 = 1;First.Second of two.');
    expect(getComputedStyle(labels[0] as HTMLElement).backgroundColor).toBe('rgb(68, 50, 29)');
    expect(
      (preview(root) as HTMLElement).querySelectorAll('.cerebro-scrollbarPreview__description'),
    ).toHaveLength(2);
  });

  it('shows fewer lines near the text’s start, in a file of no language too', async () => {
    const { root, scroller } = await mount(60, 'a.txt');
    scroller.scrollTop = scroller.scrollHeight;
    await wait(50);
    const { top } = scroller.getBoundingClientRect();
    hover(scroller, top + 1);
    await expect.poll(() => previewed(root).length).toBe(5);
    expect(previewed(root)[0]).toBe('1 const line1 = 1;');
  });

  it('is gone at a key, an edit, or a scroll, and with the pointer gone before it shows', async () => {
    const { root, scroller, doc } = await mount(200);
    const { top, height } = scroller.getBoundingClientRect();
    const show = async () => {
      hover(scroller, top + height * 0.9);
      await expect.poll(() => preview(root)).not.toBeNull();
    };
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await show();
    await userEvent.keyboard('{Shift}');
    expect(preview(root)).toBeNull();
    await show();
    doc.text.set(doc.text.peek().replace(0, 0, Text.of(['x'])));
    await expect.poll(() => preview(root)).toBeNull();
    await show();
    scroller.scrollTop = 40;
    await expect.poll(() => preview(root)).toBeNull();
    // Gone before it shows: it doesn't.
    hover(scroller, top + height * 0.9);
    hover(scroller, null);
    await wait(PREVIEW_AFTER * 2);
    expect(preview(root)).toBeNull();
  });
});
