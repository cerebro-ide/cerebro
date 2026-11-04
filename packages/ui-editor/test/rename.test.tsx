import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  NOTHING_TO_RENAME,
  type AskRenaming,
  type CodeEditorProps,
  type Rename,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: Omit<CodeEditorProps, 'path'>) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 500px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor path="a.ts" {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

const TEXT = '\n\n\nconst tally = 1;\ntally + tally;\n';

/** `tally` on line 3, as a server says where a name is. */
const TALLY = { from: { line: 3, column: 6 }, to: { line: 3, column: 11 }, name: 'tally' };

/** An editor on TEXT, the caret in `tally` on line 3. */
async function editing(
  props: Omit<CodeEditorProps, 'path' | 'document'>,
  doc = new EditorDocument(TEXT),
) {
  const root = mount({ document: doc, ...props });
  await userEvent.click(root.querySelector('.cm-content') as HTMLElement);
  await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}{ArrowDown}{ArrowDown}');
  for (let n = 0; n < 8; n++) await userEvent.keyboard('{ArrowRight}');
  return { doc, root };
}

/** Renames as the app does: each of the name's places, in the document, as one edit. */
function renamesIn(doc: EditorDocument): Rename {
  return (_at, name) => {
    const text = doc.text.peek().toString();
    const edits = [...text.matchAll(/tally/g)].map((match) => ({
      from: match.index,
      to: match.index + 5,
      insert: name,
    }));
    doc.edit(edits);
    return Promise.resolve(undefined);
  };
}

const boxed = (root: ShadowRoot) => root.querySelector('.cerebro-rename')?.textContent;
const hint = (root: ShadowRoot) => root.querySelector('.cerebro-hint')?.textContent;
const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('rename', () => {
  it('boxes the name on Shift+F6, and renames it everywhere on Enter, undone as one', async () => {
    const ask = vi.fn<AskRenaming>(() => Promise.resolve(TALLY));
    const doc = new EditorDocument(TEXT);
    const rename = vi.fn<Rename>((at, name) => {
      // Asked of the text as it was: the name not yet typed over.
      expect(doc.text.peek().toString()).toBe(TEXT);
      return renamesIn(doc)(at, name);
    });
    const { root } = await editing({ renaming: ask, onRename: rename }, doc);
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    expect(ask).toHaveBeenCalledWith({ line: 3, column: 8 });
    // Again while it's going: nothing more.
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(ask).toHaveBeenCalledTimes(1);
    // Selected: typed over.
    await userEvent.keyboard('count');
    expect(boxed(root)).toBe('count');
    await userEvent.keyboard('{Enter}');
    expect(rename).toHaveBeenCalledWith({ line: 3, column: 8 }, 'count');
    expect(doc.text.peek().toString()).toBe('\n\n\nconst count = 1;\ncount + count;\n');
    expect(boxed(root)).toBeUndefined();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.text.peek().toString()).toBe(TEXT);
  });

  it('puts the name back on Escape, and renames nothing for the same name or none', async () => {
    const rename = vi.fn<Rename>(() => Promise.resolve(undefined));
    const { doc, root } = await editing({
      renaming: () => Promise.resolve(TALLY),
      onRename: rename,
    });
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    await userEvent.keyboard('count{Escape}');
    expect(doc.text.peek().toString()).toBe(TEXT);
    expect(boxed(root)).toBeUndefined();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    // Typed away: an empty box.
    await userEvent.keyboard('{Backspace}');
    expect(root.querySelector('.cerebro-rename--empty')).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    expect(rename).not.toHaveBeenCalled();
    expect(doc.text.peek().toString()).toBe(TEXT);
    // Escape with no rename going is the editor's.
    await userEvent.keyboard('{Escape}');
    expect(doc.text.peek().toString()).toBe(TEXT);
    // So is Enter.
    await userEvent.keyboard('{Enter}');
    expect(doc.text.peek().toString()).not.toBe(TEXT);
  });

  it('renames once the caret leaves the box, as typing at its ends grows it', async () => {
    const doc = new EditorDocument(TEXT);
    const rename = vi.fn<Rename>(renamesIn(doc));
    const { root } = await editing(
      { renaming: () => Promise.resolve(TALLY), onRename: rename },
      doc,
    );
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    // At the box's end: still in it, and what's typed there is in the name.
    await userEvent.keyboard('{ArrowRight}s');
    expect(boxed(root)).toBe('tallys');
    // Moved out twice before it's ended: renamed once.
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-editor') as HTMLElement,
    ) as EditorView;
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({ selection: { anchor: 1 } });
    await expect.poll(() => rename.mock.calls.length).toBe(1);
    expect(rename).toHaveBeenCalledWith({ line: 3, column: 8 }, 'tallys');
    expect(doc.text.peek().toString()).toBe('\n\n\nconst tallys = 1;\ntallys + tallys;\n');
  });

  it('says why where there’s nothing to rename, or the rename is refused, until the caret moves', async () => {
    const answers: Awaited<ReturnType<AskRenaming>>[] = [
      null,
      { refused: 'You cannot rename this element.' },
      TALLY,
    ];
    const { root } = await editing({
      renaming: () => Promise.resolve(answers.shift()),
      onRename: () => Promise.resolve('Not a name.'),
    });
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => hint(root)).toBe(NOTHING_TO_RENAME);
    await userEvent.keyboard('{ArrowLeft}');
    expect(hint(root)).toBeUndefined();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await expect.poll(() => hint(root)).toBe('You cannot rename this element.');
    await userEvent.keyboard('{ArrowRight}{Shift>}{F6}{/Shift}');
    await expect.poll(() => boxed(root)).toBe('tally');
    await userEvent.keyboard('1x{Enter}');
    await expect.poll(() => hint(root)).toBe('Not a name.');
  });

  it('starts nothing for text changed before the answer, or a place not in the text', async () => {
    let answer!: (found: Awaited<ReturnType<AskRenaming>>) => void;
    const { doc, root } = await editing({
      renaming: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      onRename: () => Promise.resolve(undefined),
    });
    await userEvent.keyboard('{Shift>}{F6}{/Shift}x');
    answer(TALLY);
    await wait(50);
    expect(boxed(root)).toBeUndefined();
    await userEvent.keyboard('{Backspace}{Shift>}{F6}{/Shift}');
    answer({ ...TALLY, to: { line: 3, column: 99 } });
    await wait(50);
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    answer({ ...TALLY, from: { line: 99, column: 0 } });
    await wait(50);
    expect(boxed(root)).toBeUndefined();
    expect(doc.text.peek().toString()).toBe(TEXT);
  });

  it('is left out read-only, and takes the keys it’s given', async () => {
    const ask = vi.fn<AskRenaming>(() => Promise.resolve(TALLY));
    const readOnly = mount({
      text: TEXT,
      renaming: ask,
      onRename: () => Promise.resolve(undefined),
    });
    await userEvent.click(readOnly.querySelector('.cm-content') as HTMLElement);
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    await wait(50);
    expect(ask).not.toHaveBeenCalled();
    cleanup?.();
    const { root } = await editing({
      renaming: ask,
      onRename: () => Promise.resolve(undefined),
      keys: () => ({ rename: ['F9'] }),
    });
    await userEvent.keyboard('{F9}');
    await expect.poll(() => boxed(root)).toBe('tally');
  });
});
