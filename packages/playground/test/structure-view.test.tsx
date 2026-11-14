import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { EditorDocument } from '@cerebro-ide/ui-editor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { FileSymbol } from '../src/structure.js';
import { StructureView, UPDATE_DELAY, type StructureViewProps } from '../src/structure-view.js';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const symbol = (name: string, kind: string, line: number, children: FileSymbol[] = []) => ({
  name,
  kind,
  from: { line, column: 0 },
  to: { line, column: 9 },
  at: { line, column: 6 },
  children,
});

function mount(props: StructureViewProps) {
  const container = document.createElement('div');
  document.body.append(container);
  const handle = render(() => <StructureView {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return container;
}

const rows = (container: Element) =>
  [...container.querySelectorAll('.playground-occurrences__name')].map((name) => name.textContent);

describe('the Structure tool window', () => {
  it('shows the active file’s symbols, read again as it changes', async () => {
    const file = signal<string | undefined>(undefined);
    const doc = new EditorDocument('class A {}\n');
    const symbols = vi.fn((_path: string, text: string) =>
      Promise.resolve(
        text.includes('b()')
          ? [symbol('A', 'class', 0, [symbol('b', 'method', 1)])]
          : [symbol('A', 'class', 0, [symbol('a', 'method', 1)])],
      ),
    );
    const container = mount({
      file: () => file.get(),
      document: () => Promise.resolve(doc),
      symbols,
      show: () => undefined,
    });
    expect(container.textContent).toBe('No structure');
    file.set('/r/a.ts');
    await expect.poll(() => rows(container)).toEqual(['A', 'a']);
    expect(symbols).toHaveBeenCalledWith('/r/a.ts', 'class A {}\n');
    doc.edit([{ from: 0, to: 0, insert: 'b() ' }]);
    await expect.poll(() => rows(container), { timeout: UPDATE_DELAY + 1000 }).toEqual(['A', 'b']);
  });

  it('says why there is no structure: no server, no symbols, or a file it can’t read', async () => {
    const file = signal<string | undefined>('/r/a.txt');
    const doc = new EditorDocument('text');
    const symbols = vi.fn(() => Promise.resolve<FileSymbol[] | null>(null));
    const container = mount({
      file: () => file.get(),
      document: (path) => Promise.resolve(path === '/r/gone.ts' ? { error: 'gone' } : doc),
      symbols,
      show: () => undefined,
    });
    await expect.poll(() => container.textContent).toBe('No structure');
    symbols.mockResolvedValue([]);
    file.set('/r/b.ts');
    await expect.poll(() => container.textContent).toBe('Structure is empty');
    file.set('/r/gone.ts');
    await expect.poll(() => container.textContent).toBe('No structure');
  });

  it('shows a selected symbol in the editor, and goes to it on Enter', async () => {
    const show = vi.fn();
    const container = mount({
      file: () => '/r/a.ts',
      document: () => Promise.resolve(new EditorDocument('class A {}')),
      symbols: () => Promise.resolve([symbol('A', 'class', 0, [symbol('a', 'method', 1)])]),
      show,
    });
    await expect.poll(() => rows(container)).toEqual(['A', 'a']);
    const a = container.querySelectorAll<HTMLElement>(
      '.playground-occurrences__name',
    )[1] as HTMLElement;
    await userEvent.click(a);
    await expect
      .poll(() => show.mock.calls)
      .toEqual([[{ path: '/r/a.ts', line: 1, column: 6 }, false]]);
    await userEvent.click(a);
    expect(show).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    await expect
      .poll(() => show.mock.calls.at(-1))
      .toEqual([{ path: '/r/a.ts', line: 1, column: 6 }, true]);
  });

  it('keeps only the latest answer, and stops reading a file once it isn’t shown', async () => {
    const file = signal<string | undefined>('/r/a.ts');
    const doc = new EditorDocument('one');
    const answers: ((s: FileSymbol[]) => void)[] = [];
    const symbols = vi.fn(
      () =>
        new Promise<FileSymbol[]>((resolve) => {
          answers.push(resolve);
        }),
    );
    let late: ((d: EditorDocument) => void) | undefined;
    const container = mount({
      file: () => file.get(),
      document: (path) =>
        path === '/r/late.ts'
          ? new Promise((resolve) => {
              late = resolve;
            })
          : Promise.resolve(doc),
      symbols,
      show: () => undefined,
    });
    await expect.poll(() => answers.length).toBe(1);
    doc.edit([{ from: 0, to: 3, insert: 'two' }]);
    await expect.poll(() => answers.length, { timeout: UPDATE_DELAY + 1000 }).toBe(2);
    answers[1]?.([symbol('two', 'function', 0)]);
    answers[0]?.([symbol('one', 'function', 0)]);
    await expect.poll(() => rows(container)).toEqual(['two']);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rows(container)).toEqual(['two']);
    // Another file: the first one's edits no longer ask.
    file.set('/r/late.ts');
    doc.edit([{ from: 0, to: 3, insert: 'six' }]);
    await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY + 100));
    expect(symbols).toHaveBeenCalledTimes(2);
    // A file shown no more before its document is read isn't read at all.
    file.set(undefined);
    late?.(new EditorDocument('late'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(symbols).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('No structure');
  });
});
