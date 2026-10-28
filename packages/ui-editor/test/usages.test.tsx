import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { Text } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  USAGES_AFTER,
  type CodeEditorProps,
  type Place,
  type Usage,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.keyboard('{/Control}');
  await userEvent.cleanup();
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

const TEXT = 'const extra = 1;\nlog(extra);\n';

/** The screen rectangle of the `n`th occurrence of a word in the editor's text. */
function wordRect(root: ShadowRoot, word: string, n = 0): DOMRect {
  const walker = document.createTreeWalker(
    root.querySelector('.cm-content') as Node,
    NodeFilter.SHOW_TEXT,
  );
  let seen = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let at = (node.textContent ?? '').indexOf(word); at >= 0;) {
      if (seen++ === n) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        return range.getBoundingClientRect();
      }
      at = (node.textContent ?? '').indexOf(word, at + 1);
    }
  }
  throw new Error(`no ${word}`);
}

/** Moves the real pointer to the middle of a word's `n`th occurrence. */
async function pointAt(root: ShadowRoot, word: string, n = 0) {
  const rect = wordRect(root, word, n);
  const content = root.querySelector('.cm-content') as HTMLElement;
  const box = content.getBoundingClientRect();
  await userEvent.hover(content, {
    position: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 },
  });
}

/** Clicks the middle of a word's `n`th occurrence, with the real mouse. */
async function clickAt(root: ShadowRoot, word: string, n = 0) {
  const rect = wordRect(root, word, n);
  const content = root.querySelector('.cm-content') as HTMLElement;
  const box = content.getBoundingClientRect();
  await userEvent.click(content, {
    position: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 },
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => wait(USAGES_AFTER + 50);

/** The usages drawn: their class, and where they are. */
const drawn = (root: ShadowRoot) =>
  [...root.querySelectorAll<HTMLElement>('.cerebro-usage')].map((e) => {
    const { left, width } = e.getBoundingClientRect();
    return { write: e.classList.contains('cerebro-usage--write'), left, width };
  });

/** `extra`'s usages in TEXT: declared with a value, then read. */
const EXTRA: Usage[] = [
  { from: { line: 0, column: 6 }, to: { line: 0, column: 11 }, write: true },
  { from: { line: 1, column: 4 }, to: { line: 1, column: 9 }, write: false },
];

describe('usages at the caret', () => {
  it('highlights where the symbol at the caret is, written apart from read, as asked', async () => {
    const usages = vi.fn((at: Place) =>
      Promise.resolve(at.line === 1 && at.column >= 4 && at.column <= 9 ? EXTRA : []),
    );
    const root = mount({ document: new EditorDocument(TEXT), usages });
    await settle();
    // At the start: not on the symbol.
    expect(drawn(root)).toEqual([]);
    await clickAt(root, 'extra', 1);
    await settle();
    const [declared, read] = [wordRect(root, 'extra', 0), wordRect(root, 'extra', 1)];
    expect(drawn(root)).toEqual([
      { write: true, left: declared.left, width: declared.width },
      { write: false, left: read.left, width: read.width },
    ]);
    // In IntelliJ's colours, under the text.
    const [w, r] = root.querySelectorAll('.cerebro-usage');
    expect(getComputedStyle(w as Element).backgroundColor).toBe('rgb(64, 47, 51)');
    expect(getComputedStyle(r as Element).backgroundColor).toBe('rgb(55, 59, 57)');
    // Elsewhere: none.
    await clickAt(root, 'log');
    await settle();
    expect(drawn(root)).toEqual([]);
  });

  it('moves them along with an edit, and keeps an answer that comes late from the wrong place', async () => {
    let answer: (found: Usage[] | null) => void = () => undefined;
    const usages = vi.fn(
      () =>
        new Promise<Usage[] | null>((resolve) => {
          answer = resolve;
        }),
    );
    const root = mount({ document: new EditorDocument(TEXT), usages });
    await clickAt(root, 'extra', 1);
    await settle();
    answer(EXTRA);
    await expect.poll(() => drawn(root).length).toBe(2);
    // Typed before both: they move with the text until the next answer.
    await userEvent.keyboard('{Control>}{Home}{/Control}x');
    expect(drawn(root)[0]?.left).toBeCloseTo(wordRect(root, 'extra', 0).left, 0);
    const late = answer;
    await settle();
    // An answer for where the caret was: the caret moved on.
    await userEvent.keyboard('{ArrowRight}');
    late([]);
    await wait(20);
    expect(drawn(root)).toHaveLength(2);
    // An answer for the text before an edit: dropped too.
    await settle();
    const before = answer;
    await userEvent.keyboard('y');
    before([]);
    await wait(20);
    expect(drawn(root)).toHaveLength(2);
    // None, or places beyond the text: nothing drawn past it.
    await settle();
    answer(null);
    await expect.poll(() => drawn(root)).toEqual([]);
    await userEvent.keyboard('{ArrowRight}');
    await settle();
    answer([{ from: { line: 1, column: 0 }, to: { line: 9, column: 0 }, write: false }]);
    await expect.poll(() => drawn(root).length).toBeGreaterThan(0);
  });

  it('asks nothing without a way to ask', async () => {
    const root = mount({ document: new EditorDocument(TEXT) });
    await clickAt(root, 'extra', 1);
    await settle();
    expect(root.querySelector('.cerebro-usageLayer')).toBeNull();
  });
});

describe('links with Ctrl held', () => {
  const link = (root: ShadowRoot) => root.querySelector<HTMLElement>('.cerebro-link');

  it('shows the word under the pointer as a link while Ctrl is held, when it has a definition', async () => {
    const canGoToDefinition = vi.fn((word: string) => Promise.resolve(word === 'extra'));
    const root = mount({ text: TEXT, canGoToDefinition });
    await pointAt(root, 'extra', 1);
    // Not without Ctrl.
    expect(link(root)).toBeNull();
    await userEvent.keyboard('{Control>}');
    await expect.poll(() => link(root)?.textContent).toBe('extra');
    expect(canGoToDefinition).toHaveBeenLastCalledWith('extra', { line: 1, column: 4 });
    // In IntelliJ's link colour, underlined.
    const style = getComputedStyle(link(root) as HTMLElement);
    expect(style.color).toBe('rgb(84, 138, 247)');
    expect(style.textDecorationLine).toBe('underline');
    expect(style.cursor).toBe('pointer');
    // Moved within the word: asked once.
    await pointAt(root, 'extra', 1);
    expect(canGoToDefinition).toHaveBeenCalledTimes(1);
    // A word with none: no link.
    await pointAt(root, 'log');
    await wait(20);
    expect(link(root)).toBeNull();
    // Back, then let go of Ctrl: gone.
    await pointAt(root, 'extra', 1);
    await expect.poll(() => link(root)).not.toBeNull();
    await userEvent.keyboard('{/Control}');
    expect(link(root)).toBeNull();
    // Moved without Ctrl, other keys, and leaving: none.
    await pointAt(root, 'extra', 0);
    await userEvent.keyboard('{Shift}');
    expect(link(root)).toBeNull();
  });

  it('shows none beside a word, past its line’s end, or once the pointer has left', async () => {
    const root = mount({ text: TEXT, canGoToDefinition: () => Promise.resolve(true) });
    await userEvent.keyboard('{Control>}');
    const content = root.querySelector('.cm-content') as HTMLElement;
    const rect = wordRect(root, ';');
    const box = content.getBoundingClientRect();
    // Past the first line's end.
    await userEvent.hover(content, {
      position: { x: rect.right - box.left + 40, y: rect.top - box.top + rect.height / 2 },
    });
    await wait(20);
    expect(link(root)).toBeNull();
    // Left of the second line's first word.
    const log = wordRect(root, 'log');
    await userEvent.hover(content, { position: { x: 1, y: log.top - box.top + log.height / 2 } });
    await wait(20);
    expect(link(root)).toBeNull();
    await pointAt(root, 'extra');
    await expect.poll(() => link(root)).not.toBeNull();
    // Out of the editor.
    await userEvent.hover(document.body, { position: { x: 700, y: 500 } });
    expect(link(root)).toBeNull();
    // The window losing the focus: Ctrl's release wouldn't come.
    await pointAt(root, 'extra');
    await expect.poll(() => link(root)).not.toBeNull();
    window.dispatchEvent(new Event('blur'));
    expect(link(root)).toBeNull();
  });

  it('drops an answer for a word the pointer has left, and a link on an edit', async () => {
    const answers: ((yes: boolean) => void)[] = [];
    const doc = new EditorDocument(TEXT);
    const root = mount({
      document: doc,
      canGoToDefinition: () =>
        new Promise<boolean>((resolve) => {
          answers.push(resolve);
        }),
    });
    await pointAt(root, 'extra', 1);
    // Ctrl pressed with the pointer still: asked then.
    await userEvent.keyboard('{Control>}');
    await expect.poll(() => answers.length).toBe(1);
    await pointAt(root, 'log');
    answers[0]?.(true);
    await wait(20);
    expect(link(root)).toBeNull();
    answers[1]?.(true);
    await expect.poll(() => link(root)?.textContent).toBe('log');
    // Edited: the link goes.
    await userEvent.keyboard('{/Control}');
    await clickAt(root, 'extra');
    await userEvent.keyboard('{Control>}');
    // Pressed over the word clicked, then moved: asked about each.
    await pointAt(root, 'extra', 1);
    await expect.poll(() => answers.length).toBe(4);
    answers[3]?.(true);
    await expect.poll(() => link(root)).not.toBeNull();
    // Changed elsewhere (read again from disk).
    doc.text.set(Text.of(`// ${TEXT}`.split('\n')));
    expect(link(root)).toBeNull();
  });
});
