import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  MARKS_AFTER,
  type CodeEditorProps,
  type Mark,
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

const TEXT = 'class A extends B {\n  run() {}\n  walk() {}\n}\n';
const MARKS: Mark[] = [
  { line: 1, kind: 'implements', name: 'run' },
  { line: 1, kind: 'overridden', name: 'run' },
  { line: 2, kind: 'overrides', name: 'walk' },
  // Past the text's end (an answer for an older text): left out.
  { line: 40, kind: 'implemented', name: 'gone' },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The markers drawn: each line's (one-based, by its number in the gutter) labels. */
function drawn(root: ShadowRoot) {
  const numbers = [...root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')].map((e) => ({
    text: e.textContent,
    top: e.getBoundingClientRect().top,
  }));
  return [...root.querySelectorAll('.cerebro-markers__line')].map((line) => {
    const { top } = line.getBoundingClientRect();
    const near = numbers.find((n) => Math.abs(n.top - top) < 8);
    return `${String(near?.text)}: ${[...line.querySelectorAll('.cerebro-marker')].map((m) => m.getAttribute('aria-label')).join(', ')}`;
  });
}

describe('gutter markers', () => {
  it('shows what a line’s member implements or overrides and what does, after the numbers', async () => {
    const marks = vi.fn(() => Promise.resolve(MARKS));
    const root = mount({ text: TEXT, marks });
    await expect
      .poll(() => drawn(root))
      .toEqual(['2: Implements run, Is overridden run', '3: Overrides walk']);
    expect(marks).toHaveBeenCalledWith(TEXT);
    // In IntelliJ's colours: I in green with a red arrow up; O in blue with a grey arrow down.
    const [implementing, overridden] = root.querySelectorAll('.cerebro-marker');
    const fill = (marker: Element | undefined, part: string) =>
      getComputedStyle(marker?.querySelector(`.cerebro-marker__${part}`) as Element).fill;
    expect(fill(implementing, 'disc')).toBe('rgb(37, 54, 39)');
    expect(fill(implementing, 'mark')).toBe('rgb(87, 150, 92)');
    expect(fill(implementing, 'arrow')).toBe('rgb(219, 92, 92)');
    expect(fill(overridden, 'disc')).toBe('rgb(37, 50, 77)');
    expect(fill(overridden, 'mark')).toBe('rgb(84, 138, 247)');
    expect(fill(overridden, 'arrow')).toBe('rgb(206, 208, 214)');
    // Between the numbers and the text, in the room WebStorm leaves there (42px).
    const number = root.querySelector('.cm-lineNumbers .cm-gutterElement') as HTMLElement;
    const gutter = root.querySelector('.cerebro-markers') as HTMLElement;
    expect(getComputedStyle(number).paddingRight).toBe('6px');
    expect(gutter.getBoundingClientRect().left).toBe(number.getBoundingClientRect().right);
    expect(gutter.getBoundingClientRect().width).toBe(36);
  });

  it('goes where the one clicked says, and ignores a click beside them', async () => {
    const onMark = vi.fn();
    const root = mount({ text: TEXT, marks: () => Promise.resolve(MARKS), onMark });
    await expect.poll(() => root.querySelectorAll('.cerebro-marker').length).toBe(3);
    await userEvent.click(root.querySelectorAll('.cerebro-marker')[1] as Element);
    expect(onMark).toHaveBeenCalledWith(MARKS[1]);
    // Beside them, on a line with none.
    const empty = [...root.querySelectorAll('.cerebro-markers .cm-gutterElement')].at(
      -1,
    ) as Element;
    await userEvent.click(empty);
    expect(onMark).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a click without a way to go', async () => {
    const root = mount({ text: TEXT, marks: () => Promise.resolve(MARKS) });
    await expect.poll(() => root.querySelectorAll('.cerebro-marker').length).toBe(3);
    await userEvent.click(root.querySelector('.cerebro-marker') as Element);
  });

  it('moves them with an edit, asks again once it settles, and drops an answer for older text', async () => {
    const answers: ((marks: Mark[] | null) => void)[] = [];
    const marks = vi.fn(
      () =>
        new Promise<Mark[] | null>((resolve) => {
          answers.push(resolve);
        }),
    );
    const root = mount({ document: new EditorDocument(TEXT), marks });
    answers[0]?.(MARKS);
    await expect
      .poll(() => drawn(root))
      .toEqual(['2: Implements run, Is overridden run', '3: Overrides walk']);
    // A line added above them: they move down with their lines.
    await userEvent.click(root.querySelector('.cm-line') as Element);
    await userEvent.keyboard('{Home}{Enter}');
    expect(drawn(root)).toEqual(['3: Implements run, Is overridden run', '4: Overrides walk']);
    expect(marks).toHaveBeenCalledTimes(1);
    await wait(MARKS_AFTER + 50);
    expect(marks).toHaveBeenLastCalledWith(`\n${TEXT}`);
    // Edited again before the answer: it's for the older text, so dropped.
    await userEvent.keyboard('x');
    answers[1]?.([]);
    await wait(20);
    expect(drawn(root)).toHaveLength(2);
    await wait(MARKS_AFTER + 50);
    // None, now.
    answers[2]?.(null);
    await expect.poll(() => drawn(root)).toEqual([]);
  });

  it('keeps a line’s icons for the same answer, and redraws them for another', async () => {
    const answers: ((marks: Mark[]) => void)[] = [];
    const root = mount({
      document: new EditorDocument(TEXT),
      marks: () =>
        new Promise<Mark[]>((resolve) => {
          answers.push(resolve);
        }),
      // Its own effects pass through the markers' state.
      usages: () => Promise.resolve([]),
    });
    answers[0]?.(MARKS);
    await expect.poll(() => drawn(root)).toHaveLength(2);
    const first = root.querySelector('.cerebro-markers__line');
    await userEvent.click(root.querySelector('.cm-line') as Element);
    await userEvent.keyboard('{End}x');
    await expect.poll(() => answers.length, { timeout: 2_000 }).toBe(2);
    answers[1]?.(MARKS.map((m) => ({ ...m })));
    await wait(20);
    expect(root.querySelector('.cerebro-markers__line')).toBe(first);
    // Fewer on one line, another kind on the other.
    await userEvent.keyboard('y');
    await expect.poll(() => answers.length, { timeout: 2_000 }).toBe(3);
    answers[2]?.([
      { line: 1, kind: 'implements', name: 'run' },
      { line: 2, kind: 'implemented', name: 'walk' },
    ]);
    await expect.poll(() => drawn(root)).toEqual(['2: Implements run', '3: Is implemented walk']);
  });

  it('leaves the room after the numbers as it is without them', () => {
    const root = mount({ text: TEXT });
    expect(root.querySelector('.cerebro-markers')).toBeNull();
    const number = root.querySelector('.cm-lineNumbers .cm-gutterElement') as HTMLElement;
    expect(getComputedStyle(number).paddingRight).toBe('42px');
  });
});
