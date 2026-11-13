import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  ANNOTATIONS_AFTER,
  CodeEditor,
  EditorDocument,
  type AskAnnotation,
  type CodeEditorProps,
  type TextAnnotation,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(props: Omit<CodeEditorProps, 'path'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each annotated line drawn: its line number, and its columns' texts. */
function drawn(root: ShadowRoot) {
  const numbers = [...root.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')]
    .filter((e) => e.style.visibility !== 'hidden')
    .map((e) => ({
      text: e.textContent,
      top: e.getBoundingClientRect().top,
    }));
  // Not in CodeMirror's spacer, which keeps the gutter's width.
  return [...root.querySelectorAll('.cerebro-annotation')]
    .filter((a) => a.closest<HTMLElement>('.cm-gutterElement')?.style.visibility !== 'hidden')
    .map((a) => {
      const { top } = a.getBoundingClientRect();
      const near = numbers.find((n) => Math.abs(n.top - top) < 8);
      const texts = [...a.querySelectorAll('.cerebro-annotation__column')].map(
        (c) => c.textContent,
      );
      return `${String(near?.text)}: ${texts.join(' | ')}`;
    });
}

const annotation = (overrides: Partial<TextAnnotation> = {}): TextAnnotation => ({
  lines: [
    { texts: ['Yesterday', 'Lovelace'], latest: true, background: 'rgb(47, 81, 148)' },
    null,
    { texts: ['1/2/26', 'Babbage'] },
  ],
  tooltip: (line) => `line ${String(line)}`,
  menu: () => undefined,
  click: () => undefined,
  ...overrides,
});

describe('text annotations', () => {
  it('show in columns before the line numbers, each as wide as its widest text', async () => {
    const root = mount({ text: 'a\nb\nc\n', annotate: () => () => Promise.resolve(annotation()) });
    await expect
      .poll(() => drawn(root))
      .toEqual(['1: Yesterday | Lovelace', '3: 1/2/26 | Babbage']);
    const gutters = [...root.querySelectorAll('.cm-gutter')].map((g) => g.classList[1]);
    expect(gutters.indexOf('cerebro-annotations')).toBeLessThan(gutters.indexOf('cm-lineNumbers'));
    const [first, third] = [...root.querySelectorAll<HTMLElement>('.cerebro-annotation')].filter(
      (a) => a.textContent !== '',
    );
    const widths = (a: HTMLElement | undefined) =>
      [...(a?.children ?? [])].map((c) => c.getBoundingClientRect().width);
    expect(widths(first)).toEqual(widths(third));
    // Lovelace is wider than Babbage: its width in the gutter's font, and the 5px after.
    const context = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
    context.font = '13px "Inter Variable", Inter, system-ui, sans-serif';
    expect(widths(first)[1]).toBe(Math.ceil(context.measureText('Lovelace').width) + 5);
    // The latest commit's in its colour, over its background; the tooltip, the line's.
    expect(first?.classList.contains('cerebro-annotation--latest')).toBe(true);
    expect(getComputedStyle(first as Element).color).toBe('rgb(206, 208, 214)');
    expect(getComputedStyle(third as Element).color).toBe('rgb(141, 145, 153)');
    expect(first?.style.background).toContain('rgb(47, 81, 148)');
    expect(first?.title).toBe('line 0');
    expect(third?.title).toBe('line 2');
  });

  it('are asked once as an editor opens annotated, each read of them a new ask', async () => {
    const asked = vi.fn();
    const root = mount({
      text: 'a\nb\nc\n',
      annotate: () => (text) => {
        asked(text);
        return Promise.resolve(annotation());
      },
    });
    await expect.poll(() => drawn(root)).toHaveLength(2);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('keep their width with no annotated line in view', async () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${String(i)}`).join('\n');
    const lines = [{ texts: ['Today', 'Ada'] }];
    const root = mount({ text, annotate: () => () => Promise.resolve(annotation({ lines })) });
    await expect.poll(() => drawn(root)).toEqual(['1: Today | Ada']);
    const gutter = root.querySelector('.cerebro-annotations') as HTMLElement;
    const width = gutter.getBoundingClientRect().width;
    expect(width).toBeGreaterThan(20);
    (root.querySelector('.cm-scroller') as HTMLElement).scrollTop = 2000;
    await expect.poll(() => drawn(root)).toEqual([]);
    expect(gutter.getBoundingClientRect().width).toBe(width);
  });

  it('are asked again once an edit has settled, moved with the text until then', async () => {
    const document = new EditorDocument('a\nb\nc\n');
    const ask = vi.fn<AskAnnotation>(() => Promise.resolve(annotation()));
    const root = mount({ document, annotate: () => ask });
    await expect
      .poll(() => drawn(root))
      .toEqual(['1: Yesterday | Lovelace', '3: 1/2/26 | Babbage']);
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Home}{Enter}');
    // A line before them: they move down with their lines.
    await expect
      .poll(() => drawn(root))
      .toEqual(['2: Yesterday | Lovelace', '4: 1/2/26 | Babbage']);
    expect(ask).toHaveBeenCalledTimes(1);
    await wait(ANNOTATIONS_AFTER + 100);
    expect(ask).toHaveBeenLastCalledWith('\na\nb\nc\n');
    await expect
      .poll(() => drawn(root))
      .toEqual(['1: Yesterday | Lovelace', '3: 1/2/26 | Babbage']);
  });

  it('leave an answer for an older text, or none, unshown', async () => {
    const document = new EditorDocument('a\nb\n');
    let answer: (found: TextAnnotation | undefined) => void = () => undefined;
    const ask = vi.fn<AskAnnotation>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const root = mount({ document, annotate: () => ask });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('x');
    answer(annotation());
    await wait(50);
    expect(drawn(root)).toEqual([]);
    await wait(ANNOTATIONS_AFTER + 100);
    answer(undefined);
    await wait(50);
    expect(drawn(root)).toEqual([]);
    // Lines past the text's end: left out.
    const shorter = mount({ text: 'a', annotate: () => () => Promise.resolve(annotation()) });
    await expect.poll(() => drawn(shorter)).toEqual(['1: Yesterday | Lovelace']);
  });

  it('leave an answer that comes once they’re closed unshown', async () => {
    let answer: (found: TextAnnotation | undefined) => void = () => undefined;
    const ask: AskAnnotation = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const shown = signal(true);
    const root = mount({ text: 'a\nb\n', annotate: () => (shown.get() ? ask : undefined) });
    shown.set(false);
    answer(annotation());
    await wait(50);
    expect(root.querySelector('.cerebro-annotations')).toBeNull();
  });

  it('open their line’s menu on a right-click; none where a line has none', async () => {
    const menu = vi.fn();
    const root = mount({
      text: 'a\nb\nc\n',
      annotate: () => () => Promise.resolve(annotation({ menu })),
    });
    await expect.poll(() => drawn(root)).toHaveLength(2);
    const annotated = [...root.querySelectorAll<HTMLElement>('.cerebro-annotation')].filter(
      (a) => a.textContent !== '',
    );
    await userEvent.click(annotated[1] as HTMLElement, { button: 'right' });
    expect(menu).toHaveBeenCalledWith(2, expect.any(MouseEvent));
    // Line 2's place in the gutter, which CodeMirror draws nothing in.
    const number = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (e) => e.textContent === '2',
    ) as HTMLElement;
    const gutter = root.querySelector('.cerebro-annotations') as HTMLElement;
    const right = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: gutter.getBoundingClientRect().left + 2,
      clientY: number.getBoundingClientRect().top + 2,
    });
    gutter.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(false);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('act on a click with the main button, under a hand; not where a line has none', async () => {
    const click = vi.fn();
    const root = mount({
      text: 'a\nb\nc\n',
      annotate: () => () => Promise.resolve(annotation({ click })),
    });
    await expect.poll(() => drawn(root)).toHaveLength(2);
    const annotated = [...root.querySelectorAll<HTMLElement>('.cerebro-annotation')].filter(
      (a) => a.textContent !== '',
    );
    expect(getComputedStyle(annotated[0] as HTMLElement).cursor).toBe('pointer');
    await userEvent.click(annotated[1] as HTMLElement);
    expect(click).toHaveBeenCalledWith(2);
    // The middle button, and line 2's place, which has none: nothing.
    const gutter = root.querySelector('.cerebro-annotations') as HTMLElement;
    const number = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].find(
      (e) => e.textContent === '2',
    ) as HTMLElement;
    const at = (
      element: HTMLElement,
      button: number,
      y = element.getBoundingClientRect().top + 2,
    ) =>
      new MouseEvent('click', {
        bubbles: true,
        button,
        clientX: gutter.getBoundingClientRect().left + 2,
        clientY: y,
      });
    gutter.dispatchEvent(at(annotated[0] as HTMLElement, 1));
    gutter.dispatchEvent(at(number, 0));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('leave the text focused when pressed, as the line numbers do, not the scroller', async () => {
    const root = mount({ text: 'a\nb\nc\n', annotate: () => () => Promise.resolve(annotation()) });
    await expect.poll(() => drawn(root)).toHaveLength(2);
    const annotated = [...root.querySelectorAll<HTMLElement>('.cerebro-annotation')].find(
      (a) => a.textContent !== '',
    ) as HTMLElement;
    await userEvent.click(annotated);
    expect(root.activeElement?.className).toContain('cm-content');
    const number = root.querySelector('.cm-lineNumbers .cm-gutterElement:not([style*="hidden"])');
    await userEvent.click(number as HTMLElement);
    expect(root.activeElement?.className).toContain('cm-content');
    // In the text: CodeMirror's own, as before.
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    expect(root.activeElement?.className).toContain('cm-content');
  });

  it('show and close as asked, without opening the editor again', async () => {
    const shown = signal<AskAnnotation | undefined>(undefined);
    const ask = vi.fn<AskAnnotation>(() => Promise.resolve(annotation()));
    const root = mount({ text: 'a\nb\nc\n', annotate: () => shown.get() });
    expect(root.querySelector('.cerebro-annotations')).toBeNull();
    const view = root.querySelector('.cm-editor');
    shown.set(ask);
    await expect.poll(() => drawn(root)).toHaveLength(2);
    // The same asker again: not asked again.
    shown.set(ask);
    expect(ask).toHaveBeenCalledTimes(1);
    shown.set(undefined);
    expect(root.querySelector('.cerebro-annotations')).toBeNull();
    expect(root.querySelector('.cm-editor')).toBe(view);
  });
});
