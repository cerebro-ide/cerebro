import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  CodeEditor,
  EditorDocument,
  hasEditorAction,
  runEditorAction,
  selectedLines,
  selectionIn,
  type CodeEditorProps,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: CodeEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 300px;';
  document.body.append(container);
  const handle = render(() => <CodeEditor {...props} />, container);
  const outside = document.createElement('button');
  document.body.append(outside);
  cleanup = () => {
    handle.dispose();
    container.remove();
    outside.remove();
  };
  const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
    .shadowRoot as ShadowRoot;
  return { content: root.querySelector('.cm-content') as HTMLElement, outside };
}

describe('the editor’s actions', () => {
  it('are those it can run: a go-to with somewhere to go, an edit in an editable one', () => {
    const { content, outside } = mount({ path: 'a.ts', text: 'x', onGoToDefinition: vi.fn() });
    expect(hasEditorAction(content, 'goToDefinition')).toBe(true);
    expect(hasEditorAction(content, 'goToImplementation')).toBe(false);
    expect(hasEditorAction(content, 'scrollUp')).toBe(true);
    // No document: nothing to change.
    expect(hasEditorAction(content, 'toggleCase')).toBe(false);
    expect(hasEditorAction(outside, 'scrollUp')).toBe(false);
    expect(runEditorAction(outside, 'scrollUp')).toBe(false);
    expect(runEditorAction(content, 'toggleCase')).toBe(false);
  });

  it('tell whether the editor has text selected; nothing outside one', async () => {
    const { content, outside } = mount({ path: 'a.ts', text: 'const answer = 1;' });
    expect(selectionIn(content)).toBe(false);
    await userEvent.click(content);
    await userEvent.keyboard('{Home}{Shift>}{ArrowRight}{/Shift}');
    expect(selectionIn(content)).toBe(true);
    expect(selectionIn(outside)).toBe(false);
  });

  it('tell the lines selected, as IntelliJ’s GitHub links take them; none outside one', async () => {
    const { content, outside } = mount({ path: 'a.ts', text: 'a\nb\nc\n' });
    expect(selectedLines(outside)).toBeUndefined();
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}{Home}{/Control}{ArrowDown}');
    expect(selectedLines(content)).toEqual({ first: 1, last: 1 });
    // A selection ending at a line's start leaves that line out; one ending in it, not.
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(selectedLines(content)).toEqual({ first: 1, last: 1 });
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(selectedLines(content)).toEqual({ first: 1, last: 2 });
  });

  it('run from outside on the editor, the keyboard back in it', async () => {
    const doc = new EditorDocument('const answer = 1;');
    const { content, outside } = mount({ path: 'a.ts', document: doc });
    await userEvent.click(content);
    await userEvent.keyboard('{Home}{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    outside.focus();
    expect(runEditorAction(content, 'toggleCase')).toBe(true);
    expect(doc.content()).toBe('COnst answer = 1;');
    expect((content.getRootNode() as ShadowRoot).activeElement).toBe(content);
  });

  it('keep a key they ran from the app’s own commands for it, and pass one they didn’t', async () => {
    const onGoToDefinition = vi.fn();
    const { content } = mount({ path: 'a.ts', text: 'answer  ', onGoToDefinition });
    const seen: string[] = [];
    const listen = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener('keydown', listen);
    try {
      await userEvent.click(content);
      await userEvent.keyboard('{Home}{Control>}b{/Control}');
      expect(onGoToDefinition).toHaveBeenCalledTimes(1);
      expect(seen).not.toContain('b');
      // At the line's end, past the word: nothing to go to, so the key goes on.
      await userEvent.keyboard('{End}{Control>}b{/Control}');
      expect(onGoToDefinition).toHaveBeenCalledTimes(1);
      expect(seen).toContain('b');
    } finally {
      window.removeEventListener('keydown', listen);
    }
  });
});
