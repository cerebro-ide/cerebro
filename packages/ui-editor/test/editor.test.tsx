import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  CodeEditor,
  editorHistory,
  EditorDocument,
  languageFor,
  languageName,
  type CodeEditorProps,
  type EditorKeys,
} from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(async () => {
  cleanup?.();
  cleanup = undefined;
  await userEvent.cleanup();
});

function mount(props: CodeEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
  document.documentElement.dataset['cerebroTheme'] = 'dark';
  document.body.append(container);
  const handle = render(() => <CodeEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  // The editor is in the shadow root of the element the component returns.
  return (container.querySelector('.cerebro-editor-code') as HTMLElement).shadowRoot as ShadowRoot;
}

/** Clicks the middle of a word in the editor, with the real mouse. */
async function clickWord(root: ShadowRoot, word: string, modifiers: ('Control' | 'Alt')[] = []) {
  const line = root.querySelector('.cm-line') as HTMLElement;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = (node.textContent ?? '').indexOf(word);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    const rect = range.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    await userEvent.click(line, {
      position: {
        x: rect.left - box.left + rect.width / 2,
        y: rect.top - box.top + rect.height / 2,
      },
      modifiers,
    });
    return;
  }
  throw new Error(`no ${word}`);
}

/** The colour a piece of text is drawn in. */
function colourOf(container: ShadowRoot, text: string): string {
  const span = [...container.querySelectorAll('.cm-line span')].find((s) => s.textContent === text);
  return span ? getComputedStyle(span).color : 'none';
}

describe('languageFor', () => {
  it('knows the target languages by extension, and nothing else', () => {
    for (const path of [
      'a.ts',
      'a.tsx',
      'a.mts',
      'a.cts',
      'a.js',
      'a.mjs',
      'a.cjs',
      'a.jsx',
      'a.json',
      'a.css',
      'a.html',
      'a.htm',
      'a.md',
      'a.py',
      'a.yaml',
      'a.yml',
      'a.sh',
      'a.bash',
      'C:\\src\\A.TS',
    ]) {
      expect(languageFor(path), path).toBeDefined();
    }
    for (const path of ['a.txt', 'Makefile', '.gitignore', 'dir/']) {
      expect(languageFor(path), path).toBeUndefined();
    }
  });

  it('names each, as the status bar shows it (JavaScript was Plain Text there)', () => {
    expect(
      ['a.ts', 'a.tsx', 'eslint.config.js', 'a.mjs', 'a.py', 'a.sh', 'C:\\A.JSON', 'a.txt'].map(
        languageName,
      ),
    ).toEqual([
      'TypeScript',
      'TypeScript JSX',
      'JavaScript',
      'JavaScript',
      'Python',
      'Shell Script',
      'JSON',
      'Plain Text',
    ]);
  });
});

describe('CodeEditor', () => {
  it('shows the text with line numbers', () => {
    const container = mount({ path: 'a.txt', text: 'one\ntwo\nthree' });
    expect([...container.querySelectorAll('.cm-line')].map((l) => l.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
    expect(container.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length).toBeGreaterThan(
      2,
    ); // Scrollbars avoid the gutters: the horizontal one starts after them.
    expect(container.querySelector('.cm-gutters')?.hasAttribute('data-scrollbar-obstacle')).toBe(
      true,
    );
  });

  it('highlights the file’s language in the theme’s colours', () => {
    const container = mount({ path: 'a.ts', text: 'const answer = "yes"; // why\n' });
    const style = getComputedStyle(document.documentElement);
    const rgb = (hex: string) => {
      const n = parseInt(hex.trim().slice(1), 16);
      return `rgb(${String(n >> 16)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
    };
    expect(colourOf(container, 'const')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-keyword')),
    );
    expect(colourOf(container, '"yes"')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-string')),
    );
    expect(colourOf(container, '// why')).toBe(
      rgb(style.getPropertyValue('--cerebro-syntax-comment')),
    );
  });

  it('draws the caret in the theme’s text colour, seen in either theme', async () => {
    const container = mount({ path: 'a.txt', text: 'one\ntwo' });
    await userEvent.click(container.querySelector('.cm-line') as HTMLElement);
    const caret = await vi.waitFor(() => {
      const found = container.querySelector('.cm-cursor');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const text = () => {
      const n = parseInt(
        getComputedStyle(document.documentElement)
          .getPropertyValue('--cerebro-text')
          .trim()
          .slice(1),
        16,
      );
      return `rgb(${String(n >> 16)}, ${String((n >> 8) & 255)}, ${String(n & 255)})`;
    };
    // CodeMirror's own is black: unseen on the dark theme's background.
    expect(getComputedStyle(caret).borderLeftColor).toBe(text());
    document.documentElement.dataset['cerebroTheme'] = 'light';
    expect(getComputedStyle(caret).borderLeftColor).toBe(text());
    document.documentElement.dataset['cerebroTheme'] = 'dark';
  });

  it('applies the settings as they change', () => {
    const fontSize = signal(13);
    const softWrap = signal(false);
    const tabSize = signal(4);
    const container = mount({
      path: 'a.txt',
      text: `\tindented ${'long '.repeat(80)}`,
      fontSize: () => fontSize.get(),
      softWrap: () => softWrap.get(),
      tabSize: () => tabSize.get(),
    });
    const content = container.querySelector('.cm-content') as HTMLElement;
    const scroller = container.querySelector('.cm-scroller') as HTMLElement;
    expect(getComputedStyle(scroller).fontSize).toBe('13px');
    expect(content.classList.contains('cm-lineWrapping')).toBe(false);
    expect(getComputedStyle(content).tabSize).toBe('4');
    fontSize.set(18);
    softWrap.set(true);
    tabSize.set(2);
    expect(getComputedStyle(scroller).fontSize).toBe('18px');
    expect(content.classList.contains('cm-lineWrapping')).toBe(true);
    expect(getComputedStyle(content).tabSize).toBe('2');
  });

  it('uses its defaults without settings', () => {
    const container = mount({ path: 'a.txt', text: 'x' });
    expect(getComputedStyle(container.querySelector('.cm-scroller') as HTMLElement).fontSize).toBe(
      '13px',
    );
  });

  it('is empty with neither a text nor a document', () => {
    const container = mount({ path: 'a.txt' });
    expect(container.querySelector('.cm-line')?.textContent).toBe('');
  });

  it('can’t be edited, even by real typing', async () => {
    const container = mount({ path: 'a.txt', text: 'fixed' });
    // Playwright reaches into open shadow roots.
    await userEvent.click(container.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('typed');
    expect(container.querySelector('.cm-line')?.textContent).toBe('fixed');
  });

  it('edits its document by real typing, with undo', async () => {
    const doc = new EditorDocument('one');
    const root = mount({ path: 'a.txt', document: doc });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{End} two');
    expect(doc.content()).toBe('one two');
    expect(doc.modified.get()).toBe(true);
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one');
    expect(doc.modified.get()).toBe(false);
  });

  it('keeps a document’s edits, selection and undo history for its next editor', async () => {
    const doc = new EditorDocument('one');
    let root = mount({ path: 'a.txt', document: doc });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{End} two');
    cleanup?.();
    root = mount({ path: 'a.txt', document: doc });
    expect(root.querySelector('.cm-line')?.textContent).toBe('one two');
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('!');
    expect(doc.content()).toBe('one two!');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one two');
  });

  it('shows a document’s text read again from disk, which undo doesn’t take back', async () => {
    const doc = new EditorDocument('one');
    const onCaret = vi.fn();
    const root = mount({ path: 'a.txt', document: doc, onCaret });
    expect(doc.changedOnDisk('changed')).toBe(true);
    expect(root.querySelector('.cm-line')?.textContent).toBe('changed');
    (root.querySelector('.cm-content') as HTMLElement).focus();
    // Only what differs is replaced: the caret, after it, stays where it was in the text.
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}');
    expect(doc.changedOnDisk('so changed')).toBe(true);
    // And says where it's gone.
    expect(onCaret).toHaveBeenLastCalledWith({ line: 0, column: 5 }, undefined);
    await userEvent.keyboard('!');
    expect(root.querySelector('.cm-line')?.textContent).toBe('so ch!anged');
    // One undo at a time: two edits close together are one (CodeMirror's 500 ms `newGroupDelay`),
    // and a loaded run once took longer between keys (measured: 600 ms apart, "!" and Backspace
    // were two, and undo left "so ch!anged").
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(root.querySelector('.cm-line')?.textContent).toBe('so changed');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(root.querySelector('.cm-line')?.textContent).toBe('so changed');
  });

  it('keeps an edit made elsewhere apart from typing right after it, for undo', async () => {
    const doc = new EditorDocument('one');
    const root = mount({ path: 'a.txt', document: doc });
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{End}');
    doc.edit([{ from: 3, to: 3, insert: '!' }]);
    // Next to it, at once: CodeMirror would make them one step.
    await userEvent.keyboard('x');
    expect(doc.content()).toMatch(/^one!?x!?$/);
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one!');
  });

  it('takes an edit made to its document elsewhere as an edit, which undo takes back', async () => {
    const doc = new EditorDocument('one two\nthree');
    let root = mount({ path: 'a.txt', document: doc });
    doc.edit([
      { from: 0, to: 3, insert: '1' },
      { from: 8, to: 13, insert: '3' },
    ]);
    expect(doc.content()).toBe('1 two\n3');
    expect([...root.querySelectorAll('.cm-line')].map((line) => line.textContent)).toEqual([
      '1 two',
      '3',
    ]);
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one two\nthree');
    // Made while no editor shows it: the next one still takes it back, from the state it keeps.
    cleanup?.();
    doc.edit([{ from: 0, to: 3, insert: 'ONE' }]);
    root = mount({ path: 'a.txt', document: doc });
    expect(root.querySelector('.cm-line')?.textContent).toBe('ONE two');
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one two\nthree');
    // The text changed again after an edit, or since: shown as it is.
    cleanup?.();
    doc.edit([{ from: 0, to: 3, insert: 'x' }]);
    doc.text.set(Text.of(['y']));
    root = mount({ path: 'a.txt', document: doc });
    expect(root.querySelector('.cm-line')?.textContent).toBe('y');
    doc.text.set(Text.of(['z']));
    expect(root.querySelector('.cm-line')?.textContent).toBe('z');
  });

  it('reveals a position given before it’s in the document, once it is', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'position: fixed; left: 0; top: 0; width: 600px; height: 400px;';
    document.body.append(container);
    const text = Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join('\n');
    const handle = render(
      () => <CodeEditor path="a.txt" text={text} reveal={() => ({ line: 40, column: 0 })} />,
      container,
    );
    cleanup = () => {
      handle.dispose();
      container.remove();
    };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const root = (container.querySelector('.cerebro-editor-code') as HTMLElement)
      .shadowRoot as ShadowRoot;
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 40');
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
  });

  it('doesn’t reveal in an editor taken away before it could', async () => {
    const detached = document.createElement('div');
    const handle = render(
      () => <CodeEditor path="a.txt" text="x" reveal={() => ({ line: 0, column: 0 })} />,
      detached,
    );
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(document.body);
    handle.dispose();
  });

  it('takes the focus when asked, where its caret is, and not when taken away first', async () => {
    const focus = signal<object | undefined>(undefined);
    const root = mount({ path: 'a.txt', text: 'one\ntwo', focus: () => focus.get() });
    await new Promise((resolve) => setTimeout(resolve));
    expect(root.activeElement).toBeNull();
    focus.set({});
    await new Promise((resolve) => setTimeout(resolve));
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('one');
    (document.activeElement as HTMLElement).blur();
    // The same request, to another editor: taken already.
    const again = focus.peek() as object;
    const other = document.createElement('div');
    document.body.append(other);
    const shown = render(() => <CodeEditor path="b.txt" text="x" focus={() => again} />, other);
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(document.body);
    shown.dispose();
    other.remove();

    const detached = document.createElement('div');
    const handle = render(() => <CodeEditor path="a.txt" text="x" focus={() => ({})} />, detached);
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(document.body);
    handle.dispose();
  });

  it('reveals a position: selected, and scrolled into view', async () => {
    const reveal = signal<{ line: number; column: number; end?: number } | undefined>(undefined);
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({ path: 'a.txt', text, reveal: () => reveal.get() });
    reveal.set({ line: 250, column: 5 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 250');
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
    // To an end column: that part of the line selected.
    reveal.set({ line: 250, column: 5, end: 8 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect((root as ShadowRoot & { getSelection: () => Selection }).getSelection().toString()).toBe(
      '250',
    );
    // Beyond the end, the last line.
    reveal.set({ line: 9999, column: 0 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 299');
  });

  it('keeps where a document was scrolled for its next editor, and reveals a position only once', async () => {
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const document = new EditorDocument(text);
    // Revealed by the first editor: the second, given it again, stays where the first was scrolled.
    const reveal = { line: 200, column: 0 };
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const scrollerOf = (root: ShadowRoot) => root.querySelector('.cm-scroller') as HTMLElement;
    let root = mount({ path: 'a.txt', document, reveal: () => reveal, revealFocus: false });
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 200');
    });
    scrollerOf(root).scrollTop = 1500;
    await frame();
    const before = scrollerOf(root).scrollTop;
    cleanup?.();
    root = mount({ path: 'a.txt', document, reveal: () => reveal, revealFocus: false });
    await frame();
    await frame();
    expect(scrollerOf(root).scrollTop).toBe(before);
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 200');
  });

  it('says which line is at the top as it scrolls, and puts it back there when revealing', async () => {
    const onScroll = vi.fn();
    const reveal = signal<{ line: number; column: number; top?: number } | undefined>(undefined);
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({ path: 'a.txt', text, onScroll, reveal: () => reveal.get() });
    const scroller = root.querySelector('.cm-scroller') as HTMLElement;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    /** The line drawn at the editor's top edge. */
    const shown = () => {
      const box = scroller.getBoundingClientRect();
      const line = root
        .elementsFromPoint(box.left + box.width / 2, box.top + 1)
        .find((e) => e.classList.contains('cm-line'));
      return Number(line?.textContent.split(' ')[1]);
    };
    // Far down: the lines above that were never drawn have estimated heights, so it's whichever
    // line is drawn there. Said first by the estimates, then again once they're measured
    // (measured, scrolled to 1000: line 45, then 71, as CodeMirror kept the line in place).
    scroller.scrollTop = 2200;
    await vi.waitFor(() => {
      expect(onScroll).toHaveBeenLastCalledWith(shown());
    });
    expect(shown()).toBeGreaterThan(50);
    // The caret at line 120, with line 110 at the top: not centred.
    reveal.set({ line: 120, column: 0, top: 110 });
    await frame();
    await frame();
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 120');
    await vi.waitFor(() => {
      expect(onScroll).toHaveBeenLastCalledWith(110);
    });
    expect(shown()).toBe(110);
  });

  it('leaves Mod+[ and Mod+] to the app: Back and Forward on macOS, not indenting', async () => {
    const document = new EditorDocument('    indented');
    const root = mount({ path: 'a.txt', document });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    // Mod is Ctrl here, off macOS; [ is written [[.
    await userEvent.keyboard('{Control>}[[{/Control}');
    expect(document.text.get().toString()).toBe('    indented');
    await userEvent.keyboard('{Control>}]{/Control}');
    expect(document.text.get().toString()).toBe('    indented');
  });

  it('says where the caret is and what’s selected, as it opens and as either changes', async () => {
    const onCaret = vi.fn();
    const root = mount({ path: 'a.txt', text: 'first 😀\nsecond line', onCaret });
    expect(onCaret).toHaveBeenLastCalledWith({ line: 0, column: 0 }, undefined);
    await userEvent.click(root.querySelectorAll('.cm-line')[1] as HTMLElement);
    await userEvent.keyboard('{End}');
    expect(onCaret).toHaveBeenLastCalledWith({ line: 1, column: 11 }, undefined);
    await userEvent.keyboard('{Shift>}{Home}{/Shift}');
    expect(onCaret).toHaveBeenLastCalledWith({ line: 1, column: 0 }, { chars: 11, lineBreaks: 0 });
    // The emoji is one character, as IntelliJ counts them, though two in JavaScript.
    await userEvent.keyboard('{Control>}a{/Control}');
    expect(onCaret).toHaveBeenLastCalledWith({ line: 1, column: 11 }, { chars: 19, lineBreaks: 1 });
  });

  it('indents as the settings say, or as the file does, and says which', async () => {
    const document = new EditorDocument('a\n  b\n  c\nd');
    const detect = signal(false);
    const indent = signal({ tabs: false, size: 4 });
    const onIndent = vi.fn();
    const root = mount({
      path: 'a.txt',
      document,
      tabSize: () => 8,
      indent: () => indent.get(),
      detectIndent: () => detect.get(),
      onIndent,
    });
    expect(onIndent).toHaveBeenLastCalledWith({ tabs: false, size: 4 }, false);
    await userEvent.click(root.querySelectorAll('.cm-line')[3] as HTMLElement);
    await userEvent.keyboard('{Home}{Tab}');
    expect(document.text.get().toString()).toBe('a\n  b\n  c\n    d');
    // The file's: 2 spaces, looked at again after the edit.
    detect.set(true);
    expect(onIndent).toHaveBeenLastCalledWith({ tabs: false, size: 2 }, true);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}{Home}{Tab}');
    expect(document.text.get().toString()).toBe('a\n  b\n  c\n    d');
    const told = onIndent.mock.calls.length;
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await Promise.resolve();
    // The same: not told again.
    expect(onIndent).toHaveBeenCalledTimes(told);
    // Tabs, at the tab size.
    detect.set(false);
    indent.set({ tabs: true, size: 4 });
    expect(onIndent).toHaveBeenLastCalledWith({ tabs: true, size: 4 }, false);
    await userEvent.keyboard('{Home}{Tab}');
    expect(document.text.get().toString()).toBe('a\n  b\n  c\n\t  d');
  });

  it('indents by 4 spaces without settings, as IntelliJ', async () => {
    const document = new EditorDocument('line');
    const root = mount({ path: 'a.txt', document });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Home}{Tab}');
    expect(document.text.get().toString()).toBe('    line');
  });

  it('reveals a position without taking the focus, when asked', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({
      path: 'a.txt',
      text,
      reveal: () => ({ line: 200, column: 0 }),
      revealFocus: false,
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 200');
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('reveals a position without taking the focus, when the position says', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({
      path: 'a.txt',
      text,
      reveal: () => ({ line: 200, column: 0, focus: false }),
    });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 200');
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it('draws the selection in the theme’s colour, focused or not', async () => {
    const root = mount({ path: 'a.txt', text: 'selected text' });
    const expected = getComputedStyle(document.documentElement)
      .getPropertyValue('--cerebro-editor-selection')
      .trim();
    const probe = document.createElement('div');
    probe.style.backgroundColor = expected;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const content = root.querySelector('.cm-content') as HTMLElement;
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}a{/Control}');
    const background = () =>
      getComputedStyle(root.querySelector('.cm-selectionBackground') as HTMLElement)
        .backgroundColor;
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-editor')?.classList.contains('cm-focused')).toBe(true);
      expect(background()).toBe(colour);
    });
    content.blur();
    await vi.waitFor(() => {
      expect(root.querySelector('.cm-editor')?.classList.contains('cm-focused')).toBe(false);
      expect(background()).toBe(colour);
    });
  });

  it.each(['1.25', '1.5'])(
    'draws a selection over several lines without a seam, at a scale of %s',
    async (zoom) => {
      const text = Array.from({ length: 8 }, (_, i) => `line ${String(i)} ${'x'.repeat(i * 3)}`);
      const root = mount({ path: 'a.txt', text: text.join('\n') });
      const container = (root.host as HTMLElement).parentElement as HTMLElement;
      // A fractional scale, as a display's: the seams between the selection's parts fall inside
      // device pixels.
      container.style.zoom = zoom;
      await userEvent.click(root.querySelectorAll('.cm-line')[2] as HTMLElement);
      // From the end of a line to four lines down: the line's end, three lines, the last's start.
      await userEvent.keyboard('{End}{Shift>}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{/Shift}');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      // A column of pixels through the selection, right of where the first line's part starts.
      const base64 = await page.screenshot({ element: container, save: false });
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d') as CanvasRenderingContext2D;
      context.drawImage(image, 0, 0);
      const x = Math.floor(image.width * 0.9);
      const column = Array.from({ length: image.height }, (_, y) =>
        [...context.getImageData(x, y, 1, 1).data.slice(0, 3)].join(','),
      );
      const selected = '33,66,131';
      const first = column.indexOf(selected);
      const last = column.lastIndexOf(selected);
      expect(first).toBeGreaterThan(0);
      // Within 4 of the selection's colour in each channel: the parts' anti-aliased edges, now over
      // the strip, still round a level or so off (measured: 3 at most). The seam itself was 15
      // levels darker in blue.
      const off = column
        .slice(first, last + 1)
        .map((colour) => colour.split(',').map(Number))
        .filter((rgb) =>
          rgb.some((value, i) => Math.abs(value - ([33, 66, 131][i] as number)) > 4),
        );
      expect(off).toEqual([]);
    },
  );

  it('bridges only where two lines’ parts of the selection meet', async () => {
    const root = mount({ path: 'a.txt', text: 'a longer line\nshort\nthe longest line of all' });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    // From the first line's end to the same column a line down: the parts meet at a corner.
    await userEvent.keyboard('{End}{Shift>}{ArrowDown}{/Shift}');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const parts = () => root.querySelectorAll('.cm-selectionLayer .cm-selectionBackground').length;
    // Two parts in CodeMirror's layer; nothing to bridge in Cerebro's.
    expect(parts()).toBe(2);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Three parts, and a bridge over each of the two seams.
    expect(parts()).toBe(5);
  });

  it('goes to a definition with Mod+B or Mod+click, and finds usages with Alt+F7', async () => {
    const onGoToDefinition = vi.fn();
    const onFindUsages = vi.fn();
    const root = mount({
      path: 'a.ts',
      text: 'const answer = compute(1);',
      onGoToDefinition,
      onFindUsages,
    });
    // Where the word is, for a language server: within it.
    const within = (from: number, to: number) =>
      expect.objectContaining({
        line: 0,
        column: expect.toSatisfy((column: number) => column >= from && column <= to) as number,
      }) as unknown;
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(onGoToDefinition).toHaveBeenLastCalledWith('answer', within(6, 12));
    await userEvent.keyboard('{Alt>}{F7}{/Alt}');
    expect(onFindUsages).toHaveBeenLastCalledWith('answer', within(6, 12));
    await clickWord(root, 'compute', ['Control']);
    expect(onGoToDefinition).toHaveBeenLastCalledWith('compute', within(15, 22));
  });

  it('leaves the text as it is on Ctrl+Shift+Backspace and Delete, as IntelliJ’s, the keys going on', async () => {
    const doc = new EditorDocument('hello world\nnext');
    const root = mount({ path: 'a.txt', document: doc });
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-content') as HTMLElement,
    ) as EditorView;
    view.focus();
    view.dispatch({ selection: { anchor: 5 } });
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener('keydown', listener);
    await userEvent.keyboard('{Control>}{Shift>}{Backspace}{Delete}{/Shift}{/Control}');
    window.removeEventListener('keydown', listener);
    expect(doc.content()).toBe('hello world\nnext');
    expect(seen).toEqual(expect.arrayContaining(['Backspace', 'Delete']));
  });

  it('goes to the next and previous method with Alt+Down and Alt+Up', async () => {
    const onMethod = vi.fn();
    const root = mount({ path: 'a.ts', text: 'a\nbc', onMethod });
    await userEvent.click(root.querySelectorAll('.cm-line')[1] as HTMLElement);
    await userEvent.keyboard('{End}{Alt>}{ArrowDown}{ArrowUp}{/Alt}');
    expect(onMethod.mock.calls).toEqual([
      [{ line: 1, column: 2 }, true],
      [{ line: 1, column: 2 }, false],
    ]);
    // Without a handler, the keys are left alone.
    cleanup?.();
    const without = mount({ path: 'a.ts', text: 'x' });
    await userEvent.click(without.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  });

  it('goes to the super method with Mod+U, from wherever the caret is', async () => {
    const onGoToSuperMethod = vi.fn();
    const root = mount({ path: 'a.ts', text: 'class A {\n  run() {}\n}', onGoToSuperMethod });
    await userEvent.click(root.querySelectorAll('.cm-line')[1] as HTMLElement);
    await userEvent.keyboard('{Home}{Control>}u{/Control}');
    expect(onGoToSuperMethod).toHaveBeenCalledWith({ line: 1, column: 2 });
    // Without a handler, the key's left alone.
    cleanup?.();
    const without = mount({ path: 'a.ts', text: 'x' });
    await userEvent.click(without.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Control>}u{/Control}');
  });

  it('goes to implementations with Mod+Alt+B, and to the type’s declaration with Mod+Shift+B', async () => {
    const onGoToImplementation = vi.fn();
    const onGoToTypeDeclaration = vi.fn();
    const root = mount({
      path: 'a.ts',
      text: 'const answer = compute(1);',
      onGoToImplementation,
      onGoToTypeDeclaration,
    });
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Control>}{Alt>}b{/Alt}{/Control}');
    expect(onGoToImplementation).toHaveBeenCalledWith(
      'answer',
      expect.objectContaining({ line: 0 }),
    );
    await userEvent.keyboard('{Control>}{Shift>}B{/Shift}{/Control}');
    expect(onGoToTypeDeclaration).toHaveBeenCalledWith(
      'answer',
      expect.objectContaining({ line: 0 }),
    );
  });

  it('asks what can be done at the caret with Alt+Enter, saying where the caret is on screen', async () => {
    const onContextActions = vi.fn();
    const lines = Array.from({ length: 200 }, (_, n) => `line ${String(n)}`).join('\n');
    const root = mount({ path: 'a.ts', text: `const answer = 1;\n${lines}`, onContextActions });
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
    const [at, caret] = onContextActions.mock.lastCall as [
      { line: number; column: number },
      Pick<Element, 'getBoundingClientRect'>,
    ];
    expect(at.line).toBe(0);
    // The caret's own line: the list goes below it.
    const line = (root.querySelector('.cm-line') as HTMLElement).getBoundingClientRect();
    const rect = caret.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(line.top);
    expect(rect.bottom).toBeLessThanOrEqual(line.bottom);
    expect(rect.left).toBeGreaterThan(line.left);
    // Scrolled out of view: the editor's corner.
    const scroller = root.querySelector('.cm-scroller') as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(caret.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top);
    // Its line still drawn there (measured); one CodeMirror has no place for: the same.
    const none = vi.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue(null);
    scroller.scrollTop = 0;
    expect(caret.getBoundingClientRect().top).toBe(scroller.getBoundingClientRect().top);
    none.mockRestore();
  });

  it('leaves Alt+Enter alone without a handler for it', async () => {
    const root = mount({ path: 'a.txt', document: new EditorDocument('a') });
    const taken: boolean[] = [];
    // Seen after the editor's own handlers.
    window.addEventListener('keydown', (event) => taken.push(event.defaultPrevented), {
      once: true,
    });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}');
    expect(taken).toEqual([false]);
  });

  it('leaves the keys of IntelliJ’s other actions to the app, Escape dropping the selection', async () => {
    const root = mount({ path: 'a.txt', document: new EditorDocument('one\ntwo') });
    const view = EditorView.findFromDOM(
      root.querySelector('.cm-content') as HTMLElement,
    ) as EditorView;
    const taken: boolean[] = [];
    const seen = (event: KeyboardEvent) => taken.push(event.defaultPrevented);
    window.addEventListener('keydown', seen);
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    // Push, and Next Method: CodeMirror's deleted the line, and moved one.
    await userEvent.keyboard('{Control>}{Shift>}K{/Shift}{/Control}');
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    window.removeEventListener('keydown', seen);
    expect(view.state.doc.toString()).toBe('one\ntwo');
    expect(taken.filter(Boolean)).toEqual([]);
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    await userEvent.keyboard('{Escape}');
    expect(view.state.selection.main.empty).toBe(true);
  });

  it('takes its actions’ keys from the keymap, as they change', async () => {
    const onGoToDefinition = vi.fn();
    const onFindUsages = vi.fn();
    const keys = signal<EditorKeys>({
      goToDefinition: ['F12'],
      findUsages: ['Shift-F12'],
      replace: ['Mod-h'],
    });
    const root = mount({
      path: 'a.ts',
      document: new EditorDocument('const answer = 1;'),
      onGoToDefinition,
      onFindUsages,
      keys: () => keys.get(),
    });
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Control>}b{/Control}{F12}{Shift>}{F12}{/Shift}');
    expect(onGoToDefinition.mock.calls.map(([word]) => word as string)).toEqual(['answer']);
    expect(onFindUsages).toHaveBeenCalledTimes(1);
    // Find isn't given: IntelliJ's. Replace is the keymap's.
    await userEvent.keyboard('{Control>}h{/Control}');
    expect(root.activeElement?.classList.contains('cerebro-find__replace')).toBe(true);
    keys.set({});
    await clickWord(root, 'answer');
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(onGoToDefinition).toHaveBeenCalledTimes(2);
  });

  it('undoes and redoes with IntelliJ’s keys', async () => {
    const doc = new EditorDocument('one');
    const root = mount({ path: 'a.txt', document: doc });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{End}!');
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(doc.content()).toBe('one');
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(doc.content()).toBe('one!');
  });

  it('leaves undo and redo to the app when it gives no keys: its Edit commands', async () => {
    const doc = new EditorDocument('one');
    const root = mount({ path: 'a.txt', document: doc, keys: () => ({ undo: [], redo: [] }) });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{End}!');
    // The app's keymap takes the key the editor leaves, keeping the browser's own undo from it.
    const app = (event: KeyboardEvent) => {
      if (event.key === 'z' && !event.defaultPrevented) event.preventDefault();
    };
    window.addEventListener('keydown', app);
    await userEvent.keyboard('{Control>}z{/Control}');
    window.removeEventListener('keydown', app);
    expect(doc.content()).toBe('one!');
    const content = root.querySelector('.cm-content') as HTMLElement;
    expect(editorHistory(content, 'undo')).toBe(true);
    expect(doc.content()).toBe('one');
    expect(editorHistory(content, 'redo')).toBe(true);
    expect(doc.content()).toBe('one!');
  });

  it('leaves Edit → Undo to the system outside an editor with a history', () => {
    const root = mount({ path: 'a.txt', text: 'read only' });
    expect(editorHistory(root.querySelector('.cm-content') as Element, 'undo')).toBe(false);
    expect(editorHistory(document.body, 'undo')).toBe(false);
  });

  it('leaves the keys alone without handlers, or off a word', async () => {
    const root = mount({ path: 'a.ts', text: 'x   y' });
    await userEvent.click(root.querySelector('.cm-line') as HTMLElement);
    await userEvent.keyboard('{Control>}b{/Control}{Alt>}{F7}{/Alt}');
    const onGoToDefinition = vi.fn();
    cleanup?.();
    const spaced = mount({ path: 'a.ts', text: '   ', onGoToDefinition, onFindUsages: vi.fn() });
    await userEvent.click(spaced.querySelector('.cm-line') as HTMLElement, {
      modifiers: ['Control'],
    });
    await userEvent.keyboard('{Control>}b{/Control}{Alt>}{F7}{/Alt}');
    expect(onGoToDefinition).not.toHaveBeenCalled();
  });

  it('shows a selection on the caret’s line over the active line’s colour', async () => {
    // It was hidden: a double-clicked word, or a drag, showed nothing on that line.
    const doc = new EditorDocument('const answer = 1;\nnext line');
    // Plain text: the line is one text node.
    const root = mount({ path: 'a.txt', document: doc });
    const line = root.querySelector('.cm-line') as HTMLElement;
    const text = line.firstChild;
    const range = document.createRange();
    range.setStart(text as Node, 6);
    range.setEnd(text as Node, 12);
    const rect = range.getBoundingClientRect();
    const box = line.getBoundingClientRect();
    const middle = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    await userEvent.dblClick(line, { position: { x: middle.x - box.left, y: middle.y - box.top } });
    // What's seen at the word: the topmost element painting a background is the selection's.
    const painted = root
      .elementsFromPoint(middle.x, middle.y)
      .find((element) => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)');
    expect(painted?.className).toBe('cm-selectionBackground');
  });

  it('is gone when disposed', () => {
    const root = mount({ path: 'a.txt', text: 'x' });
    expect(root.querySelector('.cm-editor')).not.toBeNull();
    cleanup?.();
    cleanup = undefined;
    expect(root.querySelector('.cm-editor')).toBeNull();
  });

  it('styles itself with constructable stylesheets, not <style> elements', () => {
    const before = document.querySelectorAll('style').length;
    const root = mount({ path: 'a.ts', text: 'const x = 1;' });
    expect(document.querySelectorAll('style').length).toBe(before);
    expect(root.adoptedStyleSheets.length).toBeGreaterThan(0);
  });
});

describe('EditorDocument', () => {
  it('saves with the file’s line separator', () => {
    const crlf = new EditorDocument('a\r\nb');
    expect(crlf.lineSeparator).toBe('\r\n');
    expect(crlf.text.get().lines).toBe(2);
    expect(crlf.content()).toBe('a\r\nb');
    expect(new EditorDocument('a\nb\n').content()).toBe('a\nb\n');
    // The first, as IntelliJ detects it; classic Mac OS's too.
    expect(new EditorDocument('a\rb\r\nc').lineSeparator).toBe('\r');
    expect(new EditorDocument('a\rb').content()).toBe('a\rb');
    expect(new EditorDocument('a').lineSeparator).toBe('\n');
  });

  it('changes its line separator and byte order mark, modified until saved', () => {
    const doc = new EditorDocument('a\nb');
    doc.format.set({ lineSeparator: '\r\n', bom: true });
    expect(doc.modified.get()).toBe(true);
    expect(doc.content()).toBe('\uFEFFa\r\nb');
    doc.saved();
    expect(doc.modified.get()).toBe(false);
    // Changed back on disk: taken, the text as it was.
    const text = doc.text.get();
    expect(doc.changedOnDisk('a\nb')).toBe(true);
    expect(doc.format.get()).toEqual({ lineSeparator: '\n', bom: false });
    expect(doc.text.get()).toBe(text);
    expect(doc.changedOnDisk('a\nb')).toBe(false);
  });

  it('saves with the file’s byte order mark, which isn’t shown', () => {
    const marked = new EditorDocument('﻿a\r\nb');
    expect(marked.bom).toBe(true);
    expect(marked.text.get().toString()).toBe('a\nb');
    expect(marked.content()).toBe('﻿a\r\nb');
    // Read again from disk with it: no change.
    expect(marked.changedFrom('﻿a\nb')).toBe(false);
    expect(new EditorDocument('a').bom).toBe(false);
  });

  it('knows it’s modified until saved', () => {
    const doc = new EditorDocument('a');
    const edited = Text.of(['ab']);
    doc.text.set(edited);
    expect(doc.modified.get()).toBe(true);
    doc.saved();
    expect(doc.modified.get()).toBe(false);
    expect(doc.disk.get()).toBe(edited);
  });

  it('knows whether the file on disk changed from what it last read or saved', () => {
    const doc = new EditorDocument('a\r\nb');
    expect(doc.changedFrom('a\nb')).toBe(false);
    expect(doc.changedFrom('a\nc')).toBe(true);
  });

  it('resolves a conflict: the text as an edit of only what differs, and the disk’s', () => {
    const doc = new EditorDocument('one two three');
    doc.text.set(Text.of(['one 2 three']));
    // Kept: the same text, now to be written over the disk's.
    doc.resolve('one 2 three', 'one two three');
    expect(doc.lastEdit).toBeUndefined();
    expect(doc.disk.get().toString()).toBe('one two three');
    expect(doc.modified.get()).toBe(true);
    // Loaded: the disk's, changing only the middle.
    doc.resolve('one two three', 'one two three');
    expect(doc.content()).toBe('one two three');
    expect(doc.modified.get()).toBe(false);
    const change: { from: number; to: number; insert: string }[] = [];
    doc.lastEdit?.changes.iterChanges((from, to, _f, _t, inserted) => {
      change.push({ from, to, insert: inserted.toString() });
    });
    expect(change).toEqual([{ from: 4, to: 5, insert: 'two' }]);
  });

  it('becomes another text as an edit of each part that differs, so a caret between stays', () => {
    const doc = new EditorDocument('const  a=1;\nkeep\nconst b  =2;');
    doc.replace('const  a=1;\nkeep\nconst b  =2;');
    expect(doc.lastEdit).toBeUndefined();
    doc.replace('const a = 1;\nkeep\nconst b = 2;');
    expect(doc.content()).toBe('const a = 1;\nkeep\nconst b = 2;');
    const changed: string[] = [];
    doc.lastEdit?.changes.iterChangedRanges((from, to) => {
      changed.push(doc.lastEdit?.before.sliceString(from, to) ?? '');
    });
    // Not one change from the first line to the last, over "keep".
    expect(changed.every((text) => !text.includes('keep'))).toBe(true);
  });

  it('takes the text changed on disk, unless it’s modified or the same', () => {
    const doc = new EditorDocument('a');
    expect(doc.changedOnDisk('a')).toBe(false);
    expect(doc.changedOnDisk('b')).toBe(true);
    expect(doc.content()).toBe('b');
    doc.text.set(Text.of(['mine']));
    expect(doc.changedOnDisk('c')).toBe(false);
    expect(doc.content()).toBe('mine');
  });
});
