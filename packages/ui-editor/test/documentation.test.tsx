import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  type AskDocumentation,
  type CodeEditorProps,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>, path = 'a.ts') {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 500px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path={path} {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

/** Moves the real pointer onto the `n`th character of the editor's text. */
async function pointAt(root: ShadowRoot, n: number) {
  const content = root.querySelector('.cm-content') as HTMLElement;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let left = n;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node.textContent as string).length;
    if (left < length) {
      const range = document.createRange();
      range.setStart(node, left);
      range.setEnd(node, left + 1);
      const rect = range.getBoundingClientRect();
      const box = content.getBoundingClientRect();
      await userEvent.hover(content, {
        position: { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + 4 },
      });
      return;
    }
    left -= length;
  }
}

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const TEXT = 'tally(2);\n\nconst n = 1;\n';

/** TypeScript's server's hover for `tally` (measured), with more of what Markdown has. */
const MARKDOWN = [
  '```typescript\n(alias) function tally(count: number): string\n```',
  'Counts the\nthings.',
  '*@param* `count` — How many there are.',
  '[MDN](https://developer.mozilla.org) and <b>tags</b>, \\*escaped\\*, a&nbsp;space  \nbroken',
  '- one\n- two',
  '1. first',
  '# Heading #',
  '> quoted',
  '***',
  '    indented code',
  '```unknown\nplain\n```',
  '```\n```',
  '[bare]()',
  '```bash\necho "hi"\necho "bye"\n```',
].join('\n\n');

const tooltip = (root: ShadowRoot) => root.querySelector<HTMLElement>('.cm-tooltip-hover');

describe('documentation', () => {
  it('shows with the pointer on a symbol: its definition as code, then its comments', async () => {
    const ask = vi.fn<AskDocumentation>(() => Promise.resolve({ text: MARKDOWN }));
    const root = mount({ document: new EditorDocument(TEXT), documentation: ask });
    await pointAt(root, 2);
    const shown = await vi.waitUntil(() => tooltip(root), { timeout: 2000 });
    expect(ask).toHaveBeenCalledWith({ line: 0, column: 2 });
    const definition = shown.querySelector('.cerebro-doc__definition') as HTMLElement;
    expect(definition.textContent).toBe('(alias) function tally(count: number): string');
    // Highlighted as TypeScript, in the editor's colours.
    const keyword = [...definition.querySelectorAll('span')].find(
      (s) => s.textContent === 'function',
    );
    expect(keyword?.className).not.toBe('');
    const content = shown.querySelector('.cerebro-doc__content') as HTMLElement;
    const parts = [...content.children].map((c) => [c.tagName, c.textContent]);
    expect(parts).toEqual([
      // A line break in a paragraph is a space.
      ['P', 'Counts the things.'],
      ['P', '@param count — How many there are.'],
      ['P', 'MDN and <b>tags</b>, *escaped*, a spacebroken'],
      ['UL', 'onetwo'],
      ['OL', 'first'],
      ['P', 'Heading'],
      ['BLOCKQUOTE', 'quoted'],
      ['HR', ''],
      ['PRE', 'indented code'],
      ['PRE', 'plain'],
      ['PRE', ''],
      ['P', 'bare'],
      ['PRE', 'echo "hi"\necho "bye"'],
    ]);
    expect(content.querySelector('em')?.textContent).toBe('@param');
    expect(content.querySelector('code')?.textContent).toBe('count');
    expect(content.querySelector('br')).not.toBeNull();
    expect(content.querySelector('b')).toBeNull();
    expect(content.querySelector('.cerebro-doc__heading')?.textContent).toBe('Heading');
    const links = [...content.querySelectorAll<HTMLElement>('.cerebro-doc__link')];
    expect(links.map((l) => [l.textContent, l.title])).toEqual([
      ['MDN', 'https://developer.mozilla.org'],
      // No address: none on the pointer.
      ['bare', ''],
    ]);
    // A language it doesn't know: plain; a shell script's, highlighted.
    const blocks = content.querySelectorAll('pre');
    expect(blocks[1]?.querySelector('span')).toBeNull();
    expect(blocks[3]?.querySelector('span')).toBeInstanceOf(HTMLSpanElement);
    // In the tooltips' look.
    expect(getComputedStyle(shown).borderTopStyle).toBe('solid');
    expect(getComputedStyle(shown.querySelector('.cerebro-doc') as HTMLElement).maxWidth).toBe(
      '600px',
    );
  });

  it('sets apart only a definition it starts with, once, and shows one with no more', async () => {
    const answers = [
      // basedpyright's (measured): a rule after the definition.
      '```python\n(function) def walk(n: int) -> str\n```\n---\nWalks n steps.',
      'Just text.\n\n```ts\nlet a\n```',
      '```ts\nlet a\n```',
    ];
    const ask = vi.fn<AskDocumentation>(() => Promise.resolve({ text: answers.shift() as string }));
    const root = mount({ document: new EditorDocument(TEXT), documentation: ask });
    const next = async (n: number) => {
      await pointAt(root, n);
      const shown = await vi.waitUntil(() => tooltip(root), { timeout: 2000 });
      const doc = shown.querySelector('.cerebro-doc') as HTMLElement;
      const html = [...doc.children].map((c) => [c.className, c.textContent]);
      // Away, outside the editor.
      await userEvent.hover(document.body, { position: { x: 790, y: 790 } });
      await vi.waitUntil(() => !tooltip(root), { timeout: 2000 });
      return html;
    };
    expect(await next(1)).toEqual([
      ['cerebro-doc__definition', '(function) def walk(n: int) -> str'],
      ['cerebro-doc__content', 'Walks n steps.'],
    ]);
    expect(await next(14)).toEqual([['cerebro-doc__content', 'Just text.let a']]);
    expect(await next(2)).toEqual([['cerebro-doc__definition', 'let a']]);
  });

  it('asks nothing off a word, and shows nothing without an answer', async () => {
    const ask = vi.fn<AskDocumentation>(() => Promise.resolve(null));
    const root = mount({ text: TEXT, documentation: ask });
    // The `=`, between spaces (counted without line breaks).
    await pointAt(root, 17);
    await wait(500);
    expect(ask).not.toHaveBeenCalled();
    await pointAt(root, 2);
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    await wait(100);
    expect(tooltip(root)).toBeNull();
  });

  it('shows below a problem’s message there, in the same tooltip', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      problems: () =>
        Promise.resolve([
          {
            from: { line: 0, column: 0 },
            to: { line: 0, column: 5 },
            severity: 'error' as const,
            message: "Cannot find name 'tally'.",
          },
        ]),
      documentation: () => Promise.resolve({ text: 'Counts.' }),
    });
    await vi.waitUntil(() => root.querySelector('.cerebro-problem--error'), { timeout: 2000 });
    await pointAt(root, 2);
    await vi.waitUntil(() => tooltip(root)?.querySelector('.cerebro-doc'), { timeout: 2000 });
    const sections = [...(tooltip(root) as HTMLElement).querySelectorAll('.cm-tooltip-section')];
    expect(sections.map((s) => s.textContent)).toEqual(["Cannot find name 'tally'.", 'Counts.']);
    expect(getComputedStyle(sections[1] as HTMLElement).borderTopStyle).toBe('solid');
  });

  it('shows for the caret’s symbol on its keys, until Escape, an edit or the caret moves', async () => {
    const ask = vi.fn<AskDocumentation>(() => Promise.resolve({ text: 'Counts.' }));
    const doc = new EditorDocument(TEXT);
    const root = mount({
      document: doc,
      documentation: ask,
      keys: () => ({ quickDocumentation: ['F1'] }),
    });
    const quick = () => root.querySelector<HTMLElement>('.cerebro-quickDoc');
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowRight}{F1}');
    const shown = await vi.waitUntil(quick, { timeout: 2000 });
    expect(ask).toHaveBeenLastCalledWith({ line: 0, column: 1 });
    expect(shown.textContent).toBe('Counts.');
    expect(shown.classList.contains('cm-tooltip')).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(quick()).toBeNull();
    // Escape with none shown is left to others.
    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{F1}');
    await vi.waitUntil(quick, { timeout: 2000 });
    await userEvent.keyboard('{ArrowRight}');
    expect(quick()).toBeNull();
    await userEvent.keyboard('{F1}');
    await vi.waitUntil(quick, { timeout: 2000 });
    await userEvent.keyboard('x');
    expect(quick()).toBeNull();
    expect(doc.text.peek().toString()).toBe(`tax${TEXT.slice(2)}`);
  });

  it('shows in place of the pointer’s, and the pointer’s not beside it', async () => {
    const root = mount({
      document: new EditorDocument(TEXT),
      documentation: () => Promise.resolve({ text: 'Counts.' }),
    });
    const quick = () => root.querySelector('.cerebro-quickDoc');
    await pointAt(root, 2);
    await vi.waitUntil(() => tooltip(root), { timeout: 2000 });
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}{Home}{/Control}{Control>}q{/Control}');
    await vi.waitUntil(quick, { timeout: 2000 });
    expect(tooltip(root)).toBeNull();
    // The pointer resting on a word meanwhile: no second one.
    await pointAt(root, 1);
    await wait(600);
    expect(tooltip(root)).toBeNull();
    expect(quick()).not.toBeNull();
  });

  it('shows nothing on its keys without an answer, or when the caret has moved by then', async () => {
    let answer: (found: { text: string } | null) => void = () => undefined;
    const ask = vi.fn<AskDocumentation>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const root = mount({ document: new EditorDocument(TEXT), documentation: ask });
    const quick = () => root.querySelector('.cerebro-quickDoc');
    await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>}{Home}{/Control}{Control>}q{/Control}');
    answer(null);
    await wait(50);
    expect(quick()).toBeNull();
    await userEvent.keyboard('{Control>}q{/Control}{ArrowRight}');
    answer({ text: 'Late.' });
    await wait(50);
    expect(quick()).toBeNull();
    // At the end of the text, off any word: still asked, at the caret.
    await userEvent.keyboard('{Control>}{End}{/Control}{Control>}q{/Control}');
    answer({ text: 'There.' });
    await vi.waitUntil(quick, { timeout: 2000 });
    expect(ask).toHaveBeenLastCalledWith({ line: 3, column: 0 });
  });
});
