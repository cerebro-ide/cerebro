import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { Text } from '@codemirror/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CodeEditor, EditorDocument, languageFor, type CodeEditorProps } from '../src/index.js';

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
    const root = mount({ path: 'a.txt', document: doc });
    expect(doc.changedOnDisk('changed')).toBe(true);
    expect(root.querySelector('.cm-line')?.textContent).toBe('changed');
    (root.querySelector('.cm-content') as HTMLElement).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(root.querySelector('.cm-line')?.textContent).toBe('changed');
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

  it('reveals a position: selected, and scrolled into view', async () => {
    const reveal = signal<{ line: number; column: number } | undefined>(undefined);
    const text = Array.from({ length: 300 }, (_, i) => `line ${String(i)}`).join('\n');
    const root = mount({ path: 'a.txt', text, reveal: () => reveal.get() });
    reveal.set({ line: 250, column: 5 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 250');
    expect(root.activeElement?.classList.contains('cm-content')).toBe(true);
    // Beyond the end, the last line.
    reveal.set({ line: 9999, column: 0 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(root.querySelector('.cm-activeLine')?.textContent).toBe('line 299');
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

  it('says where the caret is as it opens and as it moves', async () => {
    const onCaret = vi.fn();
    const root = mount({ path: 'a.txt', text: 'first\nsecond line', onCaret });
    expect(onCaret).toHaveBeenLastCalledWith({ line: 0, column: 0 });
    await userEvent.click(root.querySelectorAll('.cm-line')[1] as HTMLElement);
    await userEvent.keyboard('{End}');
    expect(onCaret).toHaveBeenLastCalledWith({ line: 1, column: 11 });
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
