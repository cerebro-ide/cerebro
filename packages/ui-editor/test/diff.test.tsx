import '@cerebro-ide/theme/themes.css';
import '../src/styles.css';
import { render } from '@cerebro-ide/jsx';
import { signal } from '@cerebro-ide/reactive';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { DiffEditor, type DiffEditorProps } from '../src/index.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function mount(props: DiffEditorProps) {
  const container = document.createElement('div');
  container.style.cssText = 'position: fixed; left: 0; top: 0; width: 800px; height: 300px;';
  document.body.append(container);
  const handle = render(() => <DiffEditor {...props} />, container);
  cleanup = () => {
    handle.dispose();
    container.remove();
  };
  return (container.querySelector('.cerebro-editor-diff') as HTMLElement).shadowRoot as ShadowRoot;
}

const lines = (editor: Element) =>
  [...editor.querySelectorAll('.cm-line')].map((line) => line.textContent);

describe('the diff editor', () => {
  it('shows the committed text on the left and the current on the right, changes marked', () => {
    const root = mount({
      path: 'a.ts',
      original: 'const a = 1;\nconst same = 0;\n',
      text: 'const a = 2;\nconst same = 0;\nconst added = 3;\n',
    });
    const [left, right] = root.querySelectorAll('.cm-mergeViewEditor .cm-editor');
    expect(lines(left as Element)).toEqual(['const a = 1;', 'const same = 0;', '']);
    expect(lines(right as Element)).toContain('const added = 3;');
    expect(left?.querySelector('.cm-changedLine')?.textContent).toBe('const a = 1;');
    expect(
      [...(right as Element).querySelectorAll('.cm-changedLine')].map((l) => l.textContent),
    ).toEqual(['const a = 2;', 'const added = 3;']);
    // In the theme's colours.
    const removed = getComputedStyle(left?.querySelector('.cm-changedLine') as Element);
    expect(removed.backgroundColor).toBe('rgb(62, 42, 44)'); // Scrollbars avoid both sides' gutters.
    expect(root.querySelectorAll('.cm-gutters[data-scrollbar-obstacle]')).toHaveLength(2);
  });

  it('is as wide as the longest line on each side, though it isn’t drawn', async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${String(i)}`);
    lines[2500] = 'x'.repeat(400);
    const root = mount({ path: 'a.txt', original: lines.join('\n'), text: lines.join('\n') });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    for (const content of root.querySelectorAll<HTMLElement>('.cm-content')) {
      expect(parseFloat(content.style.minWidth)).toBeGreaterThan(2000);
    }
  });

  it('applies the font size and tab size as they change, and shows a file of no language', () => {
    const fontSize = signal(13);
    const root = mount({
      path: 'notes',
      original: '',
      text: 'new\n',
      fontSize: () => fontSize.get(),
      tabSize: () => 2,
    });
    const scrollers = root.querySelectorAll<HTMLElement>('.cm-scroller');
    expect(getComputedStyle(scrollers[1] as Element).fontSize).toBe('13px');
    fontSize.set(16);
    expect(getComputedStyle(scrollers[0] as Element).fontSize).toBe('16px');
    expect(getComputedStyle(scrollers[1] as Element).fontSize).toBe('16px');
  });

  it('merges into the right side: typed into, or taking the left’s change by its arrow', async () => {
    const onEdit = vi.fn();
    const root = mount({ path: 'a.txt', original: 'disk\nsame', text: 'memory\nsame', onEdit });
    const right = root.querySelectorAll('.cm-editor')[1] as Element;
    // Drawn once the view has measured itself.
    await expect.poll(() => root.querySelector('.cm-merge-revert button')).not.toBeNull();
    await userEvent.click(root.querySelector('.cm-merge-revert button') as Element);
    expect(onEdit).toHaveBeenLastCalledWith('disk\nsame');
    await userEvent.click(right.querySelector('.cm-line') as Element);
    await userEvent.keyboard('{End}!');
    expect(onEdit).toHaveBeenLastCalledWith('disk!\nsame');
    expect(lines(right)).toEqual(['disk!', 'same']);
  });

  it('defaults its settings', () => {
    const root = mount({ path: 'a.md', original: '# a', text: '# b' });
    const scroller = root.querySelector('.cm-scroller') as Element;
    expect(getComputedStyle(scroller).fontSize).toBe('13px');
  });
});
