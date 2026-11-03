import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  problemIcon,
  PROBLEMS_AFTER,
  type CodeEditorProps,
  type Problem,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>, theme = 'dark') {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.documentElement.dataset['cerebroTheme'] = theme;
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

const TEXT = 'const n: number = "x";\nconst unused = old();\nlog(n)\n';

const at = (line: number, from: number, to: number) => ({
  from: { line, column: from },
  to: { line, column: to },
});

const PROBLEMS: Problem[] = [
  {
    ...at(0, 6, 7),
    severity: 'error',
    message: "Type 'string' is not assignable to type 'number'.",
  },
  { ...at(1, 6, 12), severity: 'hint', message: "'unused' is never read.", unused: true },
  { ...at(1, 15, 18), severity: 'warning', message: "'old' is deprecated.", deprecated: true },
  // Empty, at its line's end: a missing semicolon.
  { ...at(2, 6, 6), severity: 'weak', message: 'Missing semicolon.' },
];

/** The text marked as problems, and how. */
const marked = (root: ShadowRoot) =>
  [...root.querySelectorAll<HTMLElement>('.cerebro-problem')].map((m) => [
    m.textContent,
    m.className.replace('cerebro-problem ', ''),
  ]);

/** Moves the real pointer to the middle of an element in the editor's text. */
async function pointAt(root: ShadowRoot, element: Element | Range) {
  const rect = element.getBoundingClientRect();
  const content = root.querySelector('.cm-content') as HTMLElement;
  const box = content.getBoundingClientRect();
  await userEvent.hover(content, {
    position: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 },
  });
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('problems', () => {
  it('marks errors and warnings with waves, unused code greyed and deprecated struck out', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(PROBLEMS),
    });
    await expect
      .poll(() => marked(root))
      .toEqual([
        ['n', 'cerebro-problem--error'],
        ['unused', 'cerebro-problem--unused'],
        ['old', 'cerebro-problem--warning cerebro-problem--deprecated'],
        [')', 'cerebro-problem--weak'],
      ]);
    // IntelliJ's Islands Dark: the waves' colours, and unused code's.
    const style = (text: string) =>
      getComputedStyle(
        [...root.querySelectorAll('.cerebro-problem')].find(
          (m) => m.textContent === text,
        ) as Element,
      );
    expect(style('n').textDecorationStyle).toBe('wavy');
    expect(style('n').textDecorationColor).toBe('rgb(250, 102, 117)');
    expect(style(')').textDecorationColor).toBe('rgb(133, 112, 66)');
    expect(style('unused').color).toBe('rgb(111, 115, 122)');
    expect(style('old').textDecorationLine).toBe('line-through');
  });

  it('gives a warning a background in the light theme, as IntelliJ’s', async () => {
    const root = mount(
      {
        document: new EditorDocument(TEXT),
        problems: () => Promise.resolve([{ ...at(0, 0, 5), severity: 'warning', message: 'w' }]),
      },
      'light',
    );
    await expect.poll(() => root.querySelector('.cerebro-problem--warning')).not.toBeNull();
    const style = getComputedStyle(root.querySelector('.cerebro-problem--warning') as Element);
    expect(style.backgroundColor).toBe('rgb(252, 244, 212)');
    expect(style.textDecorationColor).toBe('rgba(0, 0, 0, 0)');
  });

  it('marks errors and warnings on the error stripe, errors over warnings, hints not', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(PROBLEMS),
    });
    const marks = () =>
      [...root.querySelectorAll<HTMLElement>('.cerebro-problemMark')].map((m) => [
        m.className.replace('cerebro-stripeMark cerebro-problemMark ', ''),
        getComputedStyle(m).backgroundColor,
      ]);
    // The least bad first, so the worst is drawn over it.
    await expect.poll(marks).toEqual([
      ['cerebro-problemMark--weak', 'rgb(117, 109, 86)'],
      ['cerebro-problemMark--warning', 'rgb(194, 158, 74)'],
      ['cerebro-problemMark--error', 'rgb(214, 77, 91)'],
    ]);
  });

  it('shows a problem’s message with the pointer over it', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(PROBLEMS),
    });
    await expect.poll(() => root.querySelector('.cerebro-problem--error')).not.toBeNull();
    await pointAt(root, root.querySelector('.cerebro-problem--error') as Element);
    await expect
      .poll(() => root.querySelector('.cerebro-problemTooltip')?.textContent)
      .toBe("Type 'string' is not assignable to type 'number'.");
    // Away, below the text: it goes (it covers the next line, with no room above the first).
    await userEvent.hover(root.querySelector('.cm-content') as HTMLElement, {
      position: { x: 300, y: 300 },
    });
    await expect.poll(() => root.querySelector('.cerebro-problemTooltip')).toBeNull();
    // Not for a hint, shown only by its tag.
    await pointAt(root, root.querySelector('.cerebro-problem--unused') as Element);
    await expect.poll(() => root.querySelector('.cerebro-problemTooltip')).toBeNull();
  });

  it('counts errors and warnings in the corner, and goes to them: arrows, F2 and Shift+F2', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(PROBLEMS),
    });
    const widget = () => root.querySelector('.cerebro-problems') as HTMLElement;
    await expect.poll(() => widget().hidden).toBe(false);
    // Weak warnings counted with warnings; a hint not.
    expect(
      [...widget().querySelectorAll<HTMLElement>('.cerebro-problems__count')].map((c) => [
        c.textContent,
        c.title,
      ]),
    ).toEqual([
      ['1', '1 error'],
      ['2', '2 warnings'],
    ]);
    const caretLine = () => root.querySelector('.cm-activeLine')?.textContent;
    // Errors only, while there are some: from anywhere to the one error.
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{F2}');
    await expect.poll(caretLine).toBe('const n: number = "x";');
    const arrows = widget().querySelectorAll<HTMLElement>('.cerebro-problems__arrow');
    expect([...arrows].map((a) => a.title)).toEqual([
      'Previous Highlighted Error',
      'Next Highlighted Error',
    ]);
    await userEvent.click(arrows[1] as HTMLElement);
    await expect.poll(caretLine).toBe('const n: number = "x";');
    // Clicking the arrow left the focus in the editor.
    expect(root.activeElement).toBe(root.querySelector('.cm-content'));
  });

  it('shows the Problems tool window from its counts, not from its arrows', async () => {
    const onShowProblems = vi.fn<() => void>();
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(PROBLEMS),
      onShowProblems,
    });
    const count = () => root.querySelector<HTMLElement>('.cerebro-problems__count');
    await expect.poll(count).not.toBeNull();
    expect(getComputedStyle(count() as HTMLElement).cursor).toBe('pointer');
    await userEvent.click(count() as HTMLElement);
    expect(onShowProblems).toHaveBeenCalledTimes(1);
    await userEvent.click(root.querySelector('.cerebro-problems__arrow') as HTMLElement);
    expect(onShowProblems).toHaveBeenCalledTimes(1);
  });

  it('shows the tick that opens the Problems tool window too', async () => {
    const onShowProblems = vi.fn<() => void>();
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve([]),
      onShowProblems,
    });
    const ok = () => root.querySelector<HTMLElement>('.cerebro-problems__ok');
    await expect.poll(ok).not.toBeNull();
    await userEvent.click(ok() as HTMLElement);
    expect(onShowProblems).toHaveBeenCalledTimes(1);
  });

  it('gives its icons to draw elsewhere, in the theme’s colours', () => {
    document.documentElement.dataset['cerebroTheme'] = 'dark';
    const icons = (['error', 'warning', 'weak'] as const).map((s) => problemIcon(s));
    document.body.append(...icons);
    const theme = getComputedStyle(document.documentElement);
    const fill = (svg: SVGSVGElement) => getComputedStyle(svg.firstElementChild as Element).fill;
    const rgb = (name: string) => {
      const probe = document.createElement('i');
      probe.style.color = `var(--cerebro-${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    expect(theme.getPropertyValue('--cerebro-icon-error')).not.toBe('');
    expect(icons.map(fill)).toEqual([rgb('icon-error'), rgb('icon-warning'), rgb('icon-warning')]);
    for (const icon of icons) icon.remove();
  });

  it('goes through warnings when there are no errors, wrapping around', async () => {
    const warnings = PROBLEMS.filter((p) => p.severity !== 'error');
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () => Promise.resolve(warnings),
    });
    const widget = () => root.querySelector('.cerebro-problems') as HTMLElement;
    await expect.poll(() => widget().textContent).toBe('2');
    const caretLine = () => root.querySelector('.cm-activeLine')?.textContent;
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{F2}');
    await expect.poll(caretLine).toBe('const unused = old();');
    await userEvent.keyboard('{F2}');
    await expect.poll(caretLine).toBe('log(n)');
    await userEvent.keyboard('{F2}');
    await expect.poll(caretLine).toBe('const unused = old();');
    await userEvent.keyboard('{Shift>}{F2}{/Shift}');
    await expect.poll(caretLine).toBe('log(n)');
    await userEvent.click(widget().querySelector('.cerebro-problems__arrow') as HTMLElement);
    await expect.poll(caretLine).toBe('const unused = old();');
  });

  it('shows a tick for none, and nothing before the first answer', async () => {
    let answer: (problems: Problem[]) => void = () => undefined;
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await wait(50);
    expect((root.querySelector('.cerebro-problems') as HTMLElement).hidden).toBe(true);
    answer([]);
    await expect
      .poll(() => root.querySelector<HTMLElement>('.cerebro-problems__ok')?.title)
      .toBe('No problems found');
    // F2 with none: nothing to go to, the key left alone.
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{F2}');
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('const n: number = "x";');
  });

  it('asks again once an edit has settled, keeping the marks in place meanwhile', async () => {
    const asked: string[] = [];
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: (text) => {
        asked.push(text);
        return Promise.resolve(asked.length === 1 ? PROBLEMS.slice(0, 1) : []);
      },
    });
    await expect.poll(() => marked(root)).toEqual([['n', 'cerebro-problem--error']]);
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{Control>}{Home}{/Control}// ');
    // Moved with the edit, until the answer for the text as it is.
    expect(marked(root)).toEqual([['n', 'cerebro-problem--error']]);
    await expect.poll(() => asked.length, { timeout: PROBLEMS_AFTER * 5 }).toBe(2);
    expect(asked[1]?.startsWith('// const n')).toBe(true);
    await expect.poll(() => marked(root)).toEqual([]);
  });

  it('drops an answer for text since edited, and keeps what’s shown without an answer', async () => {
    const answers: ((problems: Problem[] | null) => void)[] = [];
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    });
    await expect.poll(() => answers.length).toBe(1);
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('x');
    // The answer for the text before the edit: dropped.
    answers[0]?.(PROBLEMS);
    await wait(20);
    expect(marked(root)).toEqual([]);
    await expect.poll(() => answers.length, { timeout: PROBLEMS_AFTER * 5 }).toBe(2);
    answers[1]?.(PROBLEMS.slice(0, 1));
    await expect.poll(() => marked(root).length).toBe(1);
    await userEvent.keyboard('y');
    await expect.poll(() => answers.length, { timeout: PROBLEMS_AFTER * 5 }).toBe(3);
    // No answer: what's shown stays.
    answers[2]?.(null);
    await wait(20);
    expect(marked(root).length).toBe(1);
  });

  it('draws an empty problem on the character beside it, and keeps problems within the text', async () => {
    const root = mount({
      document: new EditorDocument('abcdefgh\n\nde'),
      problems: () =>
        Promise.resolve([
          // Empty, within its line: the character after it.
          { ...at(0, 1, 1), severity: 'error', message: 'here' },
          // Empty, on an empty line: nothing to draw, but counted.
          { ...at(1, 0, 0), severity: 'error', message: 'empty line' },
          // Two at one place, a warning and an error: both said, the error first.
          { ...at(2, 0, 2), severity: 'warning', message: 'second' },
          { ...at(2, 0, 2), severity: 'error', message: 'first' },
          // Past the text: at its end.
          { ...at(9, 0, 3), severity: 'warning', message: 'past' },
        ]),
    });
    await expect
      .poll(() => marked(root))
      .toEqual([
        ['b', 'cerebro-problem--error'],
        ['de', 'cerebro-problem--warning'],
        ['de', 'cerebro-problem--error'],
        ['e', 'cerebro-problem--warning'],
      ]);
    expect(
      [...root.querySelectorAll<HTMLElement>('.cerebro-problems__count')].map((c) => c.title),
    ).toEqual(['3 errors', '2 warnings']);
    const errors = root.querySelectorAll('.cerebro-problem--error');
    await pointAt(root, errors[1] as Element);
    await expect
      .poll(() =>
        [...root.querySelectorAll('.cerebro-problemTooltip__message')].map((m) => m.textContent),
      )
      .toEqual(['first', 'second']);
    // Over text with none: no message, once the pointer has stayed there. Away first: the
    // message, above its line, covers the first.
    await userEvent.hover(root.querySelector('.cm-content') as HTMLElement, {
      position: { x: 300, y: 300 },
    });
    await expect.poll(() => root.querySelector('.cerebro-problemTooltip')).toBeNull();
    const line = root.querySelectorAll('.cm-line')[0] as Element;
    const plain = document.createRange();
    plain.setStart(line.lastChild as Node, 4);
    plain.setEnd(line.lastChild as Node, 5);
    await pointAt(root, plain);
    await wait(600);
    expect(root.querySelector('.cerebro-problemTooltip')).toBeNull();
  });

  it('asks nothing, and draws nothing, without a way to ask', async () => {
    const root = mount({ document: new EditorDocument(TEXT) });
    await wait(50);
    expect(root.querySelector('.cerebro-problems')).toBeNull();
    // F2 is left to others.
    const pressed = vi.fn();
    root.addEventListener('keydown', pressed);
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{F2}');
    expect(pressed).toHaveBeenCalled();
  });
});
