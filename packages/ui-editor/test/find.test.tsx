import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { EditorState } from '@codemirror/state';
import { search, SearchQuery, setSearchQuery } from '@codemirror/search';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, type CodeEditorProps } from '../src/index.js';
import { COUNT_LIMIT, countMatches } from '../src/find.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: CodeEditorProps): ShadowRoot {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 700px; height: 400px;';
  document.body.append(container);
  const handle = render(() => <CodeEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

const TEXT = 'one shape\ntwo Shape\nthree shapes\n';

/** Focuses the editor at its start. */
async function focusEditor(root: ShadowRoot): Promise<void> {
  await userEvent.click(root.querySelector('.cm-line') as HTMLElement, {
    position: { x: 1, y: 5 },
  });
  await userEvent.keyboard('{Control>}{Home}{/Control}');
}

const count = (root: ShadowRoot) => root.querySelector('.cerebro-find__count')?.textContent;
/** A document's text. */
function selection(doc: EditorDocument): string {
  return doc.text.get().toString();
}

describe('find', () => {
  it('finds as it’s typed, counting, going to the next and previous, with options', async () => {
    const root = mount({ path: 'a.txt', text: TEXT });
    await focusEditor(root);
    await userEvent.keyboard('{Control>}f{/Control}');
    const field = root.querySelector('.cerebro-find__field') as HTMLInputElement;
    expect(root.activeElement).toBe(field);
    await userEvent.keyboard('shape');
    // Case ignored: three matches, the first selected.
    expect(count(root)).toBe('1/3');
    await userEvent.keyboard('{Enter}');
    expect(count(root)).toBe('2/3');
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(count(root)).toBe('1/3');
    await userEvent.keyboard('{Alt>}c{/Alt}');
    expect(count(root)).toBe('1/2');
    expect(
      root.querySelector('[aria-label="Match Case (Alt+C)"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
    await userEvent.keyboard('{Alt>}w{/Alt}');
    expect(count(root)).toBe('1/1');
    await userEvent.keyboard('{Alt>}x{/Alt}');
    // Going to a match selects the field's text, as CodeMirror does: typing goes at its end.
    await userEvent.keyboard('{End}{Backspace}e[[s]?');
    expect(field.value).toBe('shape[s]?');
    // "shape" and "shapes"; typing chose the last.
    expect(count(root)).toBe('2/2');
    await userEvent.clear(field);
    await userEvent.type(field, 'shap');
    expect(count(root)).toBe('0 results');
    // From the cursor, on the last line.
    await userEvent.keyboard('{Alt>}w{/Alt}');
    expect(count(root)).toBe('2/2');
    await userEvent.clear(field);
    await userEvent.type(field, 'nothing');
    expect(count(root)).toBe('0 results');
    // The buttons do as the keys.
    await userEvent.clear(field);
    await userEvent.type(field, 'shape');
    (root.querySelector('[aria-label="Next Occurrence (Enter)"]') as HTMLElement).click();
    expect(count(root)).toBe('2/2');
    (root.querySelector('[aria-label="Previous Occurrence (Shift+Enter)"]') as HTMLElement).click();
    expect(count(root)).toBe('1/2');
    // A real click: the field keeps the focus.
    await userEvent.click(root.querySelector('[aria-label="Regex (Alt+X)"]') as HTMLElement);
    expect(root.activeElement).toBe(field);
    expect(root.querySelector('[aria-label="Regex (Alt+X)"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    // Escape closes it, back in the editor.
    await userEvent.keyboard('{Escape}');
    expect(root.querySelector('.cerebro-find')).toBeNull();
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
  });

  it('opens with the selected text, and goes on with F3 and Shift+F3 from the editor', async () => {
    const root = mount({ path: 'a.txt', text: TEXT });
    await focusEditor(root);
    await userEvent.keyboard('{End}{Shift>}{Control>}{ArrowLeft}{/Control}{/Shift}');
    await userEvent.keyboard('{Control>}f{/Control}');
    expect((root.querySelector('.cerebro-find__field') as HTMLInputElement).value).toBe('shape');
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{F3}');
    expect(count(root)).toBe('2/3');
    await userEvent.keyboard('{Shift>}{F3}{/Shift}');
    expect(count(root)).toBe('1/3');
    // Escape in the editor closes it too; then Escape is the editor's again.
    await userEvent.keyboard('{Escape}');
    expect(root.querySelector('.cerebro-find')).toBeNull();
    await userEvent.keyboard('{Escape}');
    // Open again: its field, its text selected.
    await userEvent.keyboard('{Control>}f{/Control}');
    await userEvent.keyboard('{Control>}f{/Control}');
    expect(root.activeElement).toBe(root.querySelector('.cerebro-find__field'));
    (root.querySelector('.cerebro-find__close') as HTMLElement).click();
    expect(root.querySelector('.cerebro-find')).toBeNull();
  });

  it('replaces one by one and all, in an editable document only', async () => {
    const doc = new EditorDocument(TEXT);
    const root = mount({ path: 'a.txt', document: doc });
    await focusEditor(root);
    await userEvent.keyboard('{Control>}r{/Control}');
    const replace = root.querySelector('.cerebro-find__replace') as HTMLInputElement;
    expect(root.activeElement).toBe(replace);
    (root.querySelector('.cerebro-find__field') as HTMLInputElement).focus();
    await userEvent.keyboard('shape');
    replace.focus();
    await userEvent.keyboard('form{Enter}');
    expect(selection(doc)).toBe('one form\ntwo Shape\nthree shapes\n');
    [...root.querySelectorAll<HTMLElement>('.cerebro-find__button')]
      .find((b) => b.textContent === 'Replace')
      ?.click();
    expect(selection(doc)).toBe('one form\ntwo form\nthree shapes\n');
    [...root.querySelectorAll<HTMLElement>('.cerebro-find__button')]
      .find((b) => b.textContent === 'Replace All')
      ?.click();
    expect(selection(doc)).toBe('one form\ntwo form\nthree forms\n');
    // Escape from a button closes it.
    await userEvent.click(
      [...root.querySelectorAll<HTMLElement>('.cerebro-find__button')].find(
        (b) => b.textContent === 'Replace All',
      ) as HTMLElement,
    );
    await userEvent.keyboard('{Escape}');
    expect(root.querySelector('.cerebro-find')).toBeNull();
    // Escape from the replace field, which Mod+R focuses, closes it.
    await userEvent.keyboard('{Control>}r{/Control}');
    expect(root.activeElement?.classList.contains('cerebro-find__replace')).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(root.querySelector('.cerebro-find')).toBeNull();
    // Mod+F after Mod+R: finding only.
    await userEvent.keyboard('{Control>}r{/Control}');
    await userEvent.keyboard('{Control>}f{/Control}');
    expect(root.querySelector('.cerebro-find__replace')).toBeNull();
  });

  it('counts so many matches up to its limit', async () => {
    const root = mount({ path: 'a.txt', text: 'a'.repeat(COUNT_LIMIT + 1) });
    await focusEditor(root);
    await userEvent.keyboard('{Control>}f{/Control}a');
    expect(count(root)).toBe(`1/${String(COUNT_LIMIT)}+`);
  });

  it('has no replacing in a read-only editor', async () => {
    const root = mount({ path: 'a.txt', text: TEXT });
    await focusEditor(root);
    await userEvent.keyboard('{Control>}r{/Control}');
    expect(root.querySelector('.cerebro-find')).toBeNull();
  });
});

describe('countMatches', () => {
  const state = (text: string, query: string) =>
    EditorState.create({
      doc: text,
      extensions: search(),
    }).update({ effects: setSearchQuery.of(new SearchQuery({ search: query, regexp: true })) })
      .state;

  it('counts to its limit, and nothing for a bad pattern', () => {
    expect(countMatches(state('a'.repeat(COUNT_LIMIT + 5), 'a'))).toEqual({
      current: 0,
      total: COUNT_LIMIT,
    });
    expect(countMatches(state('a', '('))).toEqual({ current: 0, total: 0 });
  });
});
