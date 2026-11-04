import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  type CodeEditorProps,
  type CompletionEdit,
  type CompletionItem,
  type CompletionList,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
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

/** An editor on `text`, focused with the caret at its end. */
async function editing(text: string, props: Omit<CodeEditorProps, 'path' | 'document'>) {
  const doc = new EditorDocument(text);
  const root = mount({ document: doc, ...props });
  const content = root.querySelector('.cm-content') as HTMLElement;
  await userEvent.click(content);
  await userEvent.keyboard('{Control>}{End}{/Control}');
  return { doc, root };
}

const list = (items: CompletionItem[], incomplete = false): CompletionList => ({
  incomplete,
  items,
});

/** The list's rows, as label and detail. */
const rows = (root: ShadowRoot) =>
  [...root.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) =>
    [
      li.querySelector('.cm-completionLabel')?.textContent,
      li.querySelector('.cm-completionDetail')?.textContent,
    ].filter((part) => part),
  );

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Waits for the list, then for it to take keys: CodeMirror's takes none for its first 75 ms. */
async function shown(root: ShadowRoot) {
  await vi.waitFor(() => {
    expect(root.querySelector('.cm-tooltip-autocomplete')).not.toBeNull();
  });
  await wait(100);
}

describe('completions', () => {
  it('lists what can go at the caret as a name is typed, and Enter puts the one chosen in', async () => {
    const ask = vi.fn(() =>
      Promise.resolve(
        list([
          { label: 'target', kind: 'function', detail: '() => void', description: './a' },
          { label: 'tally', kind: 'variable', detail: 'number' },
          { label: 'other' },
        ]),
      ),
    );
    const { doc, root } = await editing('const x = 1;\n', { completions: ask });
    // Asked once CodeMirror's 100 ms after a key have passed: `t`, then `a` after the answer, as
    // keys more than 100 ms apart would be (it asked at `t` once, in a full run).
    await userEvent.keyboard('t');
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    await userEvent.keyboard('a');
    await shown(root);
    // Filtered by what's typed; where it's from over its type, as IntelliJ's.
    expect(rows(root)).toEqual([
      ['tally', 'number'],
      ['target', './a'],
    ]);
    expect(root.querySelector('.cm-completionIcon-function')).not.toBeNull();
    // Asked once, at the caret: a whole list is filtered as one types.
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith('const x = 1;\nt', { line: 1, column: 1 });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(doc.text.peek().toString()).toBe('const x = 1;\ntarget');
    expect(root.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    // The caret after it.
    await userEvent.keyboard('!');
    expect(doc.text.peek().toString()).toBe('const x = 1;\ntarget!');
  });

  it('looks as the app’s popups, the one chosen highlighted', async () => {
    const { root } = await editing('', {
      completions: () => Promise.resolve(list([{ label: 'alpha', detail: 'string' }])),
    });
    await userEvent.keyboard('a');
    await shown(root);
    const tooltip = root.querySelector('.cm-tooltip-autocomplete') as HTMLElement;
    const value = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(`--cerebro-${name}`).trim();
    const colour = (css: string) => {
      const probe = document.createElement('div');
      probe.style.color = css;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    };
    expect(getComputedStyle(tooltip).backgroundColor).toBe(colour(value('panel')));
    const ul = tooltip.querySelector('ul') as HTMLElement;
    expect(getComputedStyle(ul).scrollbarWidth).toBe('thin');
    const selected = root.querySelector('li[aria-selected]') as HTMLElement;
    expect(getComputedStyle(selected).backgroundColor).toBe(colour(value('menu-highlight')));
    const matched = root.querySelector('.cm-completionMatchedText') as HTMLElement;
    expect(matched.textContent).toBe('a');
    expect(getComputedStyle(matched).color).toBe(colour(value('accent')));
  });

  it('shows after a `.` and on Ctrl+Space, not on a number or a space, and Escape closes it', async () => {
    const ask = vi.fn(() =>
      Promise.resolve(
        list([
          { label: 'b', sortText: '2' },
          { label: 'a', sortText: '3' },
          { label: 'c', sortText: '1' },
        ]),
      ),
    );
    const { doc, root } = await editing('', { completions: ask });
    await userEvent.keyboard('1 ');
    await wait(300);
    expect(ask).not.toHaveBeenCalled();
    await userEvent.keyboard('{Control>} {/Control}');
    await shown(root);
    // In the server's order, by sortText.
    expect(rows(root)).toEqual([['c'], ['b'], ['a']]);
    expect(ask).toHaveBeenLastCalledWith('1 ', { line: 0, column: 2 });
    await userEvent.keyboard('{Escape}');
    expect(root.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    await userEvent.keyboard('x.');
    await shown(root);
    expect(ask).toHaveBeenLastCalledWith('1 x.', { line: 0, column: 4 });
    // Tab chooses too.
    await userEvent.keyboard('{Tab}');
    expect(doc.text.peek().toString()).toBe('1 x.c');
  });

  it('takes the keys it’s given to open the list', async () => {
    const { root } = await editing('', {
      completions: () => Promise.resolve(list([{ label: 'alpha' }])),
      keys: () => ({ complete: ['Alt-/'] }),
    });
    await userEvent.keyboard('{Alt>}/{/Alt}');
    await shown(root);
    expect(rows(root)).toEqual([['alpha']]);
  });

  it('asks again as one types when the list is only part of it, and drops an answer once closed', async () => {
    const answers: ((list: CompletionList) => void)[] = [];
    const ask = vi.fn(
      () =>
        new Promise<CompletionList>((resolve) => {
          answers.push(resolve);
        }),
    );
    const { root } = await editing('', { completions: ask });
    await userEvent.keyboard('a');
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(1);
    });
    // Typed on before the answer: asked again once it comes.
    await userEvent.keyboard('b');
    answers[0]?.(list([{ label: 'abandoned' }], true));
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(2);
    });
    answers[1]?.(list([{ label: 'abc' }], true));
    await shown(root);
    expect(rows(root)).toEqual([['abc']]);
    await userEvent.keyboard('c');
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(3);
    });
    answers[2]?.(list([], true));
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    });
    // Closed before the answer: it's left out.
    await userEvent.keyboard('d');
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalledTimes(4);
    });
    await userEvent.keyboard('{Escape}');
    answers[3]?.(list([{ label: 'abcde' }]));
    await wait(100);
    expect(root.querySelector('.cm-tooltip-autocomplete')).toBeNull();
  });

  it('shows nothing without an answer, and nowhere read-only', async () => {
    const ask = vi.fn(() => Promise.resolve(null));
    const { root } = await editing('', { completions: ask });
    await userEvent.keyboard('a');
    await vi.waitFor(() => {
      expect(ask).toHaveBeenCalled();
    });
    await wait(100);
    expect(root.querySelector('.cm-tooltip-autocomplete')).toBeNull();
    cleanup?.();
    const asked = vi.fn(() => Promise.resolve(list([{ label: 'a' }])));
    const readOnly = mount({ text: '', completions: asked });
    await userEvent.click(readOnly.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Control>} {/Control}');
    await wait(200);
    expect(asked).not.toHaveBeenCalled();
  });

  it('puts in the server’s edit, to the caret, and its other edits, undone as one', async () => {
    const ask = vi.fn(() =>
      Promise.resolve(
        list([
          {
            label: 'target',
            // The word as it was asked for: typed on since.
            edit: { from: { line: 1, column: 0 }, to: { line: 1, column: 1 }, text: 'target()' },
            extraEdits: [
              { from: { line: 0, column: 0 }, to: { line: 0, column: 0 }, text: 'import t;\n' },
            ],
          },
          { label: 'tab', insert: 'tab()' },
        ]),
      ),
    );
    const { doc, root } = await editing('x;\n', { completions: ask });
    await userEvent.keyboard('tar');
    await shown(root);
    await userEvent.keyboard('{Enter}');
    expect(doc.text.peek().toString()).toBe('import t;\nx;\ntarget()');
    await userEvent.keyboard('!');
    expect(doc.text.peek().toString()).toBe('import t;\nx;\ntarget()!');
    await userEvent.keyboard('{Backspace}{Control>}z{/Control}');
    expect(doc.text.peek().toString()).toBe('x;\ntar');
    // An insert, in place of the word.
    await userEvent.keyboard('{Backspace}{Backspace}{Control>} {/Control}');
    await shown(root);
    expect(rows(root)).toEqual([['tab'], ['target']]);
    await userEvent.keyboard('{Enter}');
    expect(doc.text.peek().toString()).toBe('x;\ntab()');
  });

  it('asks for a chosen one’s other edits when it has them only by asking, placed in the text as it is', async () => {
    let answer: (edits: CompletionEdit[]) => void = () => undefined;
    const item: CompletionItem = { label: 'target', resolve: { which: 'target' } };
    const resolveCompletion = vi.fn(
      () =>
        new Promise<CompletionEdit[]>((resolve) => {
          answer = resolve;
        }),
    );
    const { doc, root } = await editing('x;\n', {
      completions: () => Promise.resolve(list([item])),
      resolveCompletion,
    });
    await userEvent.keyboard('t');
    await shown(root);
    await userEvent.keyboard('{Enter}');
    expect(doc.text.peek().toString()).toBe('x;\ntarget');
    expect(resolveCompletion).toHaveBeenCalledWith(item);
    // Typed on before the answer: the import still goes where the server said.
    await userEvent.keyboard('(');
    answer([{ from: { line: 0, column: 0 }, to: { line: 0, column: 0 }, text: 'import t;\n' }]);
    await vi.waitFor(() => {
      expect(doc.text.peek().toString()).toBe('import t;\nx;\ntarget(');
    });
    // Undone with the completion, as one (with the typing next to it, as CodeMirror joins it).
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.text.peek().toString()).toBe('x;\nt');
  });

  it('puts in only the completion when asking for its other edits gives none or fails', async () => {
    const resolveCompletion = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('gone'));
    const { doc, root } = await editing('', {
      completions: () => Promise.resolve(list([{ label: 'target', resolve: 1 }])),
      resolveCompletion,
    });
    for (const expected of ['target', 'target target']) {
      await userEvent.keyboard(expected === 'target' ? 't' : ' t');
      await shown(root);
      await userEvent.keyboard('{Enter}');
      await vi.waitFor(() => {
        expect(resolveCompletion).toHaveBeenCalled();
      });
      await wait(50);
      expect(doc.text.peek().toString()).toBe(expected);
    }
    // Not asked without a way to ask.
    cleanup?.();
    const without = await editing('', {
      completions: () => Promise.resolve(list([{ label: 'target', resolve: 1 }])),
    });
    await userEvent.keyboard('t');
    await shown(without.root);
    await userEvent.keyboard('{Enter}');
    expect(without.doc.text.peek().toString()).toBe('target');
  });
});
